import { beforeEach, describe, expect, it } from "vitest";

import { executeEndpointRequest } from "../../src/core/network/request-policy";
import { verifyShopifyVariantPriceConsistency } from "../../src/core/shopify/price-consistency";
import { scanStorefront } from "../../src/core/shopify/storefront-scanner";
import { scanGenericCatalog } from "../../src/core/shopify/catalog-scanner";
import { analyzeStorefront } from "../../src/core/analysis/storefront-analysis";
import {
  deriveSourceMapCapability,
  executeRegisteredResourceRequest,
  registerResourceCandidates,
} from "../../src/core/frontend/resource-policy";
import { inspectSourceMapText } from "../../src/core/frontend/source-map-policy";
import { collectPublicSourceBundle } from "../../src/core/export/source-bundle-export";

const origin = process.env.M0_TEST_ORIGIN;
const liveDescribe = origin === undefined ? describe.skip : describe;

liveDescribe("RequestPolicy against the live M0 dual-port fixture", () => {
  const session = { origin: origin ?? "http://127.0.0.1:1" };

  beforeEach(async () => {
    const response = await fetch(`${session.origin}/__reset`);
    expect(response.ok).toBe(true);
  });

  it("accepts typed public endpoints and strips cart payload to currency", async () => {
    const meta = await executeEndpointRequest(session, { kind: "meta" });
    const products = await executeEndpointRequest(session, {
      kind: "products-page",
      page: 1,
      limit: 3,
    });
    const cart = await executeEndpointRequest(session, { kind: "cart-context" });

    expect(meta).toMatchObject({ ok: true, status: 200 });
    expect(products).toMatchObject({ ok: true, status: 200 });
    expect(cart).toMatchObject({
      ok: true,
      status: 200,
      data: { currency: "USD" },
    });
    if (cart.ok) expect(Object.keys(cart.data as object)).toEqual(["currency"]);
  });

  it("enforces M3 resource MIME, size, hash and zero-second-hop policy", async () => {
    const registered = registerResourceCandidates(
      [
        {
          url: `${session.origin}/assets/m3-theme.js?v=1`,
          kind: "script",
          queryPolicy: "cache-key",
          sources: ["dom"],
        },
        {
          url: `${session.origin}/assets/m3-wrong-mime.js`,
          kind: "script",
          queryPolicy: "none",
          sources: ["dom"],
        },
        {
          url: `${session.origin}/assets/m3-large.js`,
          kind: "script",
          queryPolicy: "none",
          sources: ["dom"],
        },
        {
          url: `${session.origin}/redirect-same/assets/m3-theme.js`,
          kind: "script",
          queryPolicy: "none",
          sources: ["dom"],
        },
      ],
      session,
    );
    const [script, wrongMime, large, redirected] = registered;
    if (
      script === undefined ||
      wrongMime === undefined ||
      large === undefined ||
      redirected === undefined
    ) {
      throw new Error("resource fixture registration failed");
    }

    await expect(
      executeRegisteredResourceRequest(session, script),
    ).resolves.toMatchObject({
      ok: true,
      descriptor: {
        contentType: "text/javascript",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    await expect(
      executeRegisteredResourceRequest(session, wrongMime),
    ).resolves.toMatchObject({ ok: false, reason: "mime_rejected" });
    await expect(
      executeRegisteredResourceRequest(session, large),
    ).resolves.toMatchObject({ ok: false, reason: "too_large" });
    await expect(
      executeRegisteredResourceRequest(session, redirected),
    ).resolves.toMatchObject({ ok: false, reason: "network_error" });

    const stats = (await (
      await fetch(`${session.origin}/__stats`)
    ).json()) as { redirectTargets: { sameOrigin: number } };
    expect(stats.redirectTargets.sameOrigin).toBe(0);
  });

  it("derives and fetches an external same-origin source map through ResourcePolicy", async () => {
    const [script] = registerResourceCandidates(
      [
        {
          url: `${session.origin}/assets/m3-theme.js?v=1`,
          kind: "script",
          queryPolicy: "cache-key",
          sources: ["dom"],
        },
      ],
      session,
      {
        createResourceId: () => "00000000-0000-4000-8000-000000000001",
      },
    );
    if (script === undefined) throw new Error("script capability missing");

    const parent = await executeRegisteredResourceRequest(session, script);
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;

    const sourceMap = deriveSourceMapCapability(
      session,
      parent.descriptor,
      parent.text,
      {
        createResourceId: () => "00000000-0000-4000-8000-000000000002",
      },
    );
    expect(sourceMap).toMatchObject({
      url: `${session.origin}/assets/m3-theme.js.map?v=1`,
      kind: "source-map",
      sources: ["source-map-reference"],
      derivedFromResourceId: script.resourceId,
      fetchStatus: "pending",
    });
    if (sourceMap === undefined) return;

    const fetchedMap = await executeRegisteredResourceRequest(session, sourceMap);
    expect(fetchedMap.ok).toBe(true);
    if (!fetchedMap.ok) return;
    expect(fetchedMap.descriptor).toMatchObject({
      contentType: "application/json",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      fetchStatus: "analyzed",
    });
    const inspection = inspectSourceMapText(
      fetchedMap.text,
      fetchedMap.descriptor.url,
    );
    expect(inspection).toEqual({
      status: "inline",
      sourceCount: 1,
      nameCount: 1,
      hasSourcesContent: true,
    });
    expect(JSON.stringify(inspection)).not.toContain("rawFixtureSource");
  });

  it("builds an explicit public source bundle through the same live ResourcePolicy", async () => {
    const registered = registerResourceCandidates(
      [
        {
          url: `${session.origin}/assets/m3-theme.js?v=1`,
          kind: "script",
          queryPolicy: "cache-key",
          sources: ["dom"],
        },
        {
          url: `${session.origin}/assets/m3-theme.css`,
          kind: "style",
          queryPolicy: "none",
          sources: ["dom"],
        },
      ],
      session,
    );
    const analyzed = [];
    for (const descriptor of registered) {
      const result = await executeRegisteredResourceRequest(session, descriptor);
      expect(result.ok).toBe(true);
      if (result.ok) analyzed.push(result.descriptor);
    }

    const bundle = await collectPublicSourceBundle({
      snapshotId: "live-m3-snapshot",
      storeKey: session.origin,
      resources: analyzed,
      execute: (resourceId) => {
        const descriptor = registered.find(
          (candidate) => candidate.resourceId === resourceId,
        );
        if (descriptor === undefined) throw new Error("missing capability");
        return executeRegisteredResourceRequest(session, descriptor);
      },
    });

    expect(bundle.value.meta).toMatchObject({
      exportedFileCount: 2,
      sourceOrigins: [session.origin],
      status: "completed",
    });
    expect(bundle.value.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: `${session.origin}/assets/m3-theme.js?v=1`,
          changedSinceScan: false,
        }),
      ]),
    );
    expect(bundle.json).toContain("sourceMappingURL=m3-theme.js.map");
  });

  it.each([
    ["same-origin", "/rr/", "sameOrigin"],
    ["cross-origin", "/rx/", "crossOrigin"],
  ] as const)(
    "blocks %s redirects without a second hop",
    async (_label, routeRoot, targetKey) => {
      const result = await executeEndpointRequest(
        session,
        { kind: "cart-context" },
        { routeRoot },
      );
      expect(result).toMatchObject({
        ok: false,
        category: "network",
        redirectDetection: "unavailable",
      });

      const stats = (await (
        await fetch(`${session.origin}/__stats`)
      ).json()) as {
        redirectTargets: Record<string, number>;
      };
      expect(stats.redirectTargets[targetKey]).toBe(0);
    },
  );

  it("classifies live 429, 430, password, and challenge fixtures", async () => {
    const limited = await executeEndpointRequest(
      session,
      { kind: "cart-context" },
      { routeRoot: "/rl/" },
    );
    const rejected = await executeEndpointRequest(
      session,
      { kind: "cart-context" },
      { routeRoot: "/rs/" },
    );
    const password = await executeEndpointRequest(session, {
      kind: "page-html",
      target: "password",
    });
    const challenge = await executeEndpointRequest(
      session,
      { kind: "cart-context" },
      { routeRoot: "/zz/" },
    );

    expect(limited).toMatchObject({
      ok: false,
      category: "rate_limited",
      retryAfterSeconds: 2,
    });
    expect(rejected).toMatchObject({
      ok: false,
      category: "security_rejected",
    });
    expect(password).toMatchObject({
      ok: false,
      category: "password_page",
    });
    expect(challenge).toMatchObject({
      ok: false,
      category: "challenge_page",
    });
  });

  it("verifies B-grade decimal prices against Ajax minor units by variant ID", async () => {
    const products = await executeEndpointRequest(session, {
      kind: "products-page",
      page: 1,
      limit: 1,
    });
    expect(products.ok).toBe(true);
    if (!products.ok) return;

    const envelope = products.data as { products: unknown[] };
    const candidate = envelope.products[0] as { handle?: unknown } | undefined;
    expect(typeof candidate?.handle).toBe("string");
    if (typeof candidate?.handle !== "string") return;

    const ajax = await executeEndpointRequest(session, {
      kind: "product-ajax-js",
      handle: candidate.handle,
    });
    expect(ajax.ok).toBe(true);
    if (!ajax.ok) return;

    expect(
      verifyShopifyVariantPriceConsistency(candidate, ajax.data, "USD"),
    ).toMatchObject({
      status: "verified",
      checkedVariants: 1,
      samples: [{ productsJsonMinor: "1200", productAjaxMinor: "1200" }],
    });
  });

  it("runs hosted M1 context/catalog and M2 analysis end to end", async () => {
    const execute = async (request: Parameters<typeof executeEndpointRequest>[1], options: { routeRoot?: string; signal?: AbortSignal } = {}) =>
      executeEndpointRequest(session, request, {
        ...(options.routeRoot === undefined
          ? {}
          : { routeRoot: options.routeRoot }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    const result = await scanStorefront({
      origin: session.origin,
      main: {
        shop: "m0-fixture.myshopify.com",
        routeRoot: "/",
        locale: "en",
        country: "US",
        currencyActive: "USD",
        themeId: 1,
      },
      collector: {
        ok: true,
        generator: "Shopify",
        scriptUrls: [],
        linkUrls: [
          "https://cdn.shopify.com/s/files/1/0000/t/1/assets/theme.css",
        ],
        checkoutUrls: [],
        jsonLdCount: 0,
        pageProducts: [],
        collectionHandles: [],
        socials: [],
      },
      execute,
    });

    expect(result).toMatchObject({
      status: "completed",
      detection: { storefrontKind: "hosted-theme" },
      context: {
        country: "US",
        countrySource: "anonymous-page",
        currency: "USD",
        priceSourceStatus: { "products-json": "verified" },
        priceContextVerified: true,
      },
      catalog: {
        complete: true,
        coverage: {
          productsFetched: 3,
          truncated: false,
          sources: ["products-json"],
          capabilityProbes: {
            meta: "ok",
            "cart-context": "ok",
            "products-json": "ok",
          },
        },
      },
    });
    const analysis = await analyzeStorefront(execute, result, {
      origin: session.origin,
    });
    expect(analysis).toMatchObject({
      status: "completed",
      statistics: {
        productCount: 3,
        variantCount: 3,
        price: { minMinor: "1200", maxMinor: "3600" },
      },
      bestSelling: {
        scope: { kind: "all-storefront", handle: "all" },
        items: [
          { rank: 1, handle: "m0-alpha" },
          { rank: 2, handle: "m0-beta" },
          { rank: 3, handle: "m0-gamma" },
        ],
      },
      newness: { status: "completed" },
    });
  });

  it("rebuilds bounded sitemap fields without accepting an arbitrary URL", async () => {
    const result = await scanGenericCatalog(
      async (request, options = {}) =>
        executeEndpointRequest(session, request, {
          ...(options.routeRoot === undefined
            ? {}
            : { routeRoot: options.routeRoot }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      {
        origin: session.origin,
        productLimit: 2,
        maxSitemapFiles: 1,
      },
    );

    expect(result).toMatchObject({
      termination: "generic-sitemap",
      coverage: {
        productsFetched: 2,
        truncated: true,
        sources: ["sitemap"],
        capabilityProbes: { sitemap: "ok" },
      },
    });
  });
});
