import { describe, expect, it } from "vitest";

import { executeEndpointRequest } from "../../src/core/network/request-policy";
import { verifyShopifyVariantPriceConsistency } from "../../src/core/shopify/price-consistency";
import {
  scanGenericCatalog,
  scanHostedCatalog,
} from "../../src/core/shopify/catalog-scanner";
import { scanStorefront } from "../../src/core/shopify/storefront-scanner";
import { analyzeStorefront } from "../../src/core/analysis/storefront-analysis";

const storefrontOrigin = process.env.M0_SHOPIFY_ORIGIN;
const myshopifyOrigin = process.env.M0_MYSHOPIFY_ORIGIN;
const liveDescribe = storefrontOrigin === undefined ? describe.skip : describe;

liveDescribe("approved live Shopify evidence", () => {
  it("runs a bounded anonymous M2 scan with context, rankings and newness", async () => {
    const session = { origin: storefrontOrigin ?? "https://invalid.example" };
    const execute = async (
      request: Parameters<typeof executeEndpointRequest>[1],
      options: { routeRoot?: string; signal?: AbortSignal } = {},
    ) =>
      executeEndpointRequest(session, request, {
        ...(options.routeRoot === undefined
          ? {}
          : { routeRoot: options.routeRoot }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    const scan = await scanStorefront({
      origin: session.origin,
      main: { routeRoot: "/", locale: "en", themeId: 1 },
      collector: {
        ok: true,
        generator: "Shopify",
        scriptUrls: [],
        linkUrls: [
          "https://cdn.shopify.com/s/files/1/fixture/t/1/assets/theme.css",
        ],
        checkoutUrls: [],
        jsonLdCount: 0,
        pageProducts: [],
        collectionHandles: [],
      },
      execute,
      productLimit: 10,
      pageSize: 10,
      priceSampleLimit: 1,
    });
    expect(scan).toMatchObject({
      detection: { storefrontKind: "hosted-theme", isShopify: true },
      context: {
        country: expect.stringMatching(/^[A-Z]{2}$/u),
        countrySource: "anonymous-page",
        currency: expect.stringMatching(/^[A-Z]{3}$/u),
        priceSourceStatus: { "products-json": "verified" },
        priceContextVerified: true,
      },
      catalog: {
        coverage: { productsFetched: 10, truncated: true },
      },
    });

    const analysis = await analyzeStorefront(execute, scan, {
      origin: session.origin,
      productLimit: 10,
      maxCollectionPages: 2,
    });
    expect(analysis).toMatchObject({
      statistics: {
        productCount: 10,
        variantCount: expect.any(Number),
      },
      bestSelling: {
        scope: { handle: expect.any(String) },
        items: expect.any(Array),
        disclaimer: expect.stringContaining("不等于真实销量"),
      },
      newness: {
        candidates: expect.any(Array),
      },
    });
    expect(analysis.bestSelling.items.length).toBeGreaterThan(0);
    expect(analysis.newness.candidates.length).toBeGreaterThan(0);
  }, 60_000);

  it("checks anonymous currency and B-grade prices against Ajax minor units", async () => {
    const session = { origin: storefrontOrigin ?? "https://invalid.example" };
    const cart = await executeEndpointRequest(session, { kind: "cart-context" });
    expect(cart.ok).toBe(true);
    if (!cart.ok) return;
    const currency = readCurrency(cart.data);
    expect(currency).toMatch(/^[A-Z]{3}$/u);
    if (currency === undefined) return;

    const products = await executeEndpointRequest(session, {
      kind: "products-page",
      page: 1,
      limit: 3,
    });
    expect(products.ok).toBe(true);
    if (!products.ok) return;
    const candidate = firstProduct(products.data);
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;

    const ajax = await executeEndpointRequest(session, {
      kind: "product-ajax-js",
      handle: candidate.handle,
    });
    expect(ajax.ok).toBe(true);
    if (!ajax.ok) return;

    expect(
      verifyShopifyVariantPriceConsistency(candidate.value, ajax.data, currency),
    ).toMatchObject({
      status: "verified",
      currency,
      checkedVariants: expect.any(Number),
    });
  });

  it("runs the M1 products capability probe before a bounded live page", async () => {
    const session = { origin: storefrontOrigin ?? "https://invalid.example" };
    const catalog = await scanHostedCatalog(
      async (request, options = {}) =>
        executeEndpointRequest(session, request, {
          ...(options.routeRoot === undefined
            ? {}
            : { routeRoot: options.routeRoot }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      {
        origin: session.origin,
        productLimit: 3,
        pageSize: 3,
      },
    );

    expect(catalog).toMatchObject({
      termination: "products-json-complete",
      coverage: {
        productsFetched: 3,
        truncated: true,
        sources: ["products-json"],
        capabilityProbes: { "products-json": "ok" },
      },
    });
  });

  it("rebuilds Shopify sitemap from/to bounds and discovers a bounded fallback", async () => {
    const session = { origin: storefrontOrigin ?? "https://invalid.example" };
    const catalog = await scanGenericCatalog(
      async (request, options = {}) =>
        executeEndpointRequest(session, request, {
          ...(options.routeRoot === undefined
            ? {}
            : { routeRoot: options.routeRoot }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      {
        origin: session.origin,
        productLimit: 3,
        maxSitemapFiles: 1,
      },
    );

    expect(catalog).toMatchObject({
      termination: "generic-sitemap",
      complete: false,
      coverage: {
        productsFetched: 3,
        truncated: true,
        sources: ["sitemap"],
        capabilityProbes: { sitemap: "ok" },
      },
    });
  });

  const aliasIt = myshopifyOrigin === undefined ? it.skip : it;
  aliasIt("does not follow away from the observed myshopify origin", async () => {
    const result = await executeEndpointRequest(
      { origin: myshopifyOrigin ?? "https://invalid.myshopify.com" },
      { kind: "products-page", page: 1, limit: 1 },
    );

    if (result.ok) {
      expect(new URL(result.responseUrl).origin).toBe(
        new URL(myshopifyOrigin ?? "https://invalid.myshopify.com").origin,
      );
      return;
    }
    expect(["network", "redirect_blocked"]).toContain(result.category);
  });
});

function readCurrency(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const currency = (value as Record<string, unknown>).currency;
  return typeof currency === "string" ? currency : undefined;
}

function firstProduct(
  value: unknown,
): { handle: string; value: unknown } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const products = (value as Record<string, unknown>).products;
  if (!Array.isArray(products) || products.length === 0) return undefined;
  const candidate = products[0];
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return undefined;
  }
  const handle = (candidate as Record<string, unknown>).handle;
  return typeof handle === "string" && handle.length > 0
    ? { handle, value: candidate }
    : undefined;
}
