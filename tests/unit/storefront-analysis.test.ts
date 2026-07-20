import { describe, expect, it } from "vitest";

import { analyzeStorefront } from "../../src/core/analysis/storefront-analysis";
import type { StorefrontScanResult } from "../../src/core/shopify/storefront-scanner";

const origin = "https://store.example";

describe("M2 storefront analysis coordinator", () => {
  it("computes statistics and both documented Collection orders", async () => {
    const calls: string[] = [];
    const result = await analyzeStorefront(
      async (request) => {
        if (request.kind !== "collection-html") throw new Error("unexpected");
        calls.push(request.sortBy);
        const handle = request.sortBy === "best-selling" ? "beta" : "alpha";
        const url = `${origin}/collections/all?sort_by=${request.sortBy}&page=1`;
        return {
          ok: true,
          kind: request.kind,
          requestUrl: url,
          responseUrl: url,
          status: 200,
          contentType: "text/html",
          byteLength: 1,
          data: `<a href="/products/${handle}">${handle}</a>`,
        };
      },
      scanResult(),
      { origin },
    );

    expect(calls).toEqual(["best-selling", "created-descending"]);
    expect(result).toMatchObject({
      status: "completed",
      statistics: { productCount: 2, variantCount: 2 },
      bestSelling: { items: [{ rank: 1, handle: "beta" }] },
      createdDescending: { items: [{ rank: 1, handle: "alpha" }] },
      newness: { status: "completed" },
    });
  });

  it("never uses Shopify Collection Ajax behavior for custom storefronts", async () => {
    let called = false;
    const scan = scanResult();
    const result = await analyzeStorefront(
      async () => {
        called = true;
        throw new Error("not expected");
      },
      {
        ...scan,
        detection: { ...scan.detection, storefrontKind: "custom-storefront" },
        context: { ...scan.context, storefrontKind: "custom-storefront" },
      },
      { origin },
    );
    expect(called).toBe(false);
    expect(result.status).toBe("skipped");
  });
});

function scanResult(): StorefrontScanResult {
  return {
    status: "completed",
    detection: {
      isShopify: true,
      confidence: 0.99,
      storefrontKind: "hosted-theme",
      cartProbeEligible: false,
      strongSignalCount: 3,
      weakSignalCount: 0,
      independentSignalGroups: [],
      evidence: [],
      reasons: [],
    },
    context: {
      routeRoot: "/",
      routeRootSource: "probe",
      locale: "en",
      localeSource: "endpoint",
      country: "US",
      countrySource: "anonymous-page",
      currency: "USD",
      currencySource: "cart-js",
      priceSourceStatus: { "products-json": "verified" },
      priceContextVerified: true,
      credentialMode: "omit",
      transport: "service-worker",
      storefrontKind: "hosted-theme",
    },
    catalog: {
      products: [product("1", "alpha", "2026-07-01T00:00:00Z"), product("2", "beta", "2026-06-01T00:00:00Z")],
      coverage: {
        productsFetched: 2,
        truncated: false,
        sources: ["products-json"],
        capabilityProbes: { "products-json": "ok" },
      },
      termination: "products-json-complete",
      complete: true,
      errors: [],
    },
    anonymousContext: { country: "US", currency: "USD", evidence: [] },
    priceVerification: {
      status: "verified",
      checkedProducts: 1,
      checkedVariants: 1,
      candidateProducts: 2,
      samples: [],
      terminal: false,
    },
    runtimeDiagnostics: {
      retry: {
        retryCount: 0,
        scanWaitedMs: 0,
        concurrency: 4,
        concurrencyReductionCount: 0,
        events: [],
        eventsDropped: 0,
      },
    },
  };
}

function product(id: string, handle: string, createdAt: string) {
  return {
    id,
    handle,
    title: handle,
    createdAt,
    tags: [],
    variants: [{ id: `${id}0`, price: "10.00", priceSource: "products-json" as const }],
    images: [],
    sources: ["products-json" as const],
  };
}
