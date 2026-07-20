import { beforeEach, describe, expect, it } from "vitest";

import { executeEndpointRequest } from "../../src/core/network/request-policy";
import { verifyShopifyVariantPriceConsistency } from "../../src/core/shopify/price-consistency";
import { scanStorefront } from "../../src/core/shopify/storefront-scanner";
import { scanGenericCatalog } from "../../src/core/shopify/catalog-scanner";
import { analyzeStorefront } from "../../src/core/analysis/storefront-analysis";

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
