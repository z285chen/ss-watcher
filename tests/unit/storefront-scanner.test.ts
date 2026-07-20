import { describe, expect, it } from "vitest";

import { scanStorefront } from "../../src/core/shopify/storefront-scanner";
import type { CollectorProbeResult } from "../../src/content/probes";
import type {
  EndpointExecutionResult,
  EndpointFailureCategory,
  EndpointRequest,
} from "../../src/core/network/request-policy";
import type { EndpointExecutor } from "../../src/core/shopify/catalog-scanner";

const origin = "https://store.example";

describe("M1 storefront scan coordinator", () => {
  it("runs meta -> cart classification -> products capability -> pagination for hosted themes", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind === "meta") {
        return success(request, { myshopify_domain: "fixture.myshopify.com" });
      }
      if (request.kind === "cart-context") {
        return success(request, { currency: "USD" });
      }
      if (request.kind === "page-html") {
        return success(
          request,
          '<script>Shopify.locale = "en"; Shopify.country = "US"; Shopify.currency = {"active":"USD"};</script>',
          "text/html",
        );
      }
      if (request.kind === "products-page") {
        return success(request, {
          products:
            request.limit === 1
              ? [product(1)]
              : [product(1), product(2), product(3)],
        });
      }
      if (request.kind === "product-ajax-js") {
        const id = Number(request.handle.replace("product-", ""));
        return success(request, {
          id,
          handle: request.handle,
          variants: [{ id: id * 10, price: 1_000 }],
        });
      }
      return failure(request, "not_found");
    };

    const result = await scanStorefront({
      origin,
      main: {
        shop: "fixture.myshopify.com",
        routeRoot: "/",
        locale: "en",
        country: "US",
        currencyActive: "USD",
        themeId: 1,
      },
      collector: collector({
        generator: "Shopify",
        linkUrls: [
          "https://cdn.shopify.com/s/files/1/0000/t/1/assets/theme.css",
        ],
      }),
      execute,
    });

    expect(calls.map((request) => request.kind)).toEqual([
      "meta",
      "cart-context",
      "page-html",
      "products-page",
      "products-page",
      "product-ajax-js",
      "product-ajax-js",
      "product-ajax-js",
    ]);
    expect(result).toMatchObject({
      status: "completed",
      detection: { isShopify: true, storefrontKind: "hosted-theme" },
      context: {
        routeRoot: "/",
        routeRootSource: "probe",
        currency: "USD",
        currencySource: "cart-js",
        country: "US",
        countrySource: "anonymous-page",
        priceSourceStatus: { "products-json": "verified" },
        priceContextVerified: true,
        credentialMode: "omit",
        transport: "service-worker",
      },
      catalog: {
        complete: true,
        coverage: {
          productsFetched: 3,
          sources: ["products-json"],
          capabilityProbes: {
            meta: "ok",
            "cart-context": "ok",
            "products-json": "ok",
          },
        },
      },
    });
  });

  it("routes a custom storefront to the generic public-source scanner", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind === "meta") {
        return success(request, { myshopify_domain: "fixture.myshopify.com" });
      }
      if (request.kind === "cart-context") {
        return success(request, { currency: "USD" });
      }
      if (request.kind === "sitemap") {
        return success(
          request,
          `<urlset><url><loc>${origin}/products/alpha</loc></url></urlset>`,
          "application/xml",
        );
      }
      throw new Error(`Ajax must not be called for custom storefront: ${request.kind}`);
    };

    const result = await scanStorefront({
      origin,
      main: null,
      collector: collector({
        linkUrls: ["https://cdn.shopify.com/shopifycloud/storefront/app.js"],
        checkoutUrls: ["https://fixture.myshopify.com/checkouts/cn/example"],
      }),
      execute,
    });

    expect(calls.map((request) => request.kind)).toEqual([
      "meta",
      "cart-context",
      "sitemap",
    ]);
    expect(result).toMatchObject({
      status: "partial",
      detection: { storefrontKind: "custom-storefront" },
      context: { currencySource: "unknown", priceContextVerified: false },
      catalog: {
        complete: false,
        coverage: { sources: ["sitemap"], productsFetched: 1 },
      },
    });
  });

  it("stops after meta when Shopify detection threshold is not met", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      return failure(request, "not_found");
    };

    const result = await scanStorefront({
      origin,
      main: null,
      collector: collector(),
      execute,
    });

    expect(calls).toEqual([{ kind: "meta" }]);
    expect(result).toMatchObject({
      status: "not-shopify",
      detection: { isShopify: false, storefrontKind: "uncertain" },
      catalog: { products: [] },
    });
  });

  it("allows uncertain Shopify evidence to use sitemap but not cart or Ajax", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind === "meta") return failure(request, "not_found");
      if (request.kind === "sitemap") {
        return success(request, "<urlset></urlset>", "application/xml");
      }
      throw new Error(`Unexpected request ${request.kind}`);
    };
    const result = await scanStorefront({
      origin,
      main: { shop: "fixture.myshopify.com" },
      collector: collector(),
      execute,
    });

    expect(calls.map((request) => request.kind)).toEqual(["meta", "sitemap"]);
    expect(result).toMatchObject({
      status: "partial",
      detection: {
        isShopify: true,
        storefrontKind: "uncertain",
        cartProbeEligible: false,
      },
    });
  });

  it("treats a terminal cart classification response as an origin-wide stop", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind === "meta") {
        return success(request, { myshopify_domain: "fixture.myshopify.com" });
      }
      return failure(request, "challenge_page");
    };
    const result = await scanStorefront({
      origin,
      main: { routeRoot: "/", themeId: 1 },
      collector: collector({
        linkUrls: [
          "https://cdn.shopify.com/s/files/1/0000/t/1/assets/theme.css",
        ],
      }),
      execute,
    });

    expect(calls.map((request) => request.kind)).toEqual([
      "meta",
      "cart-context",
    ]);
    expect(result).toMatchObject({
      status: "blocked",
      catalog: {
        termination: "terminal-access-gate",
        errors: [
          {
            source: "cart-context",
            category: "challenge_page",
            message: "challenge_page",
          },
        ],
        coverage: {
          capabilityProbes: { meta: "ok", "cart-context": "challenge" },
        },
      },
    });
  });

  it("returns bounded retry diagnostics with the completed scan", async () => {
    let metaAttempts = 0;
    const execute: EndpointExecutor = async (request) => {
      if (request.kind === "meta") {
        metaAttempts += 1;
        return metaAttempts === 1
          ? failure(request, "http_5xx")
          : success(request, { myshopify_domain: "fixture.myshopify.com" });
      }
      if (request.kind === "cart-context") {
        return success(request, { currency: "USD" });
      }
      if (request.kind === "page-html") {
        return success(
          request,
          '<script>Shopify.country = "US"; Shopify.currency = {"active":"USD"};</script>',
          "text/html",
        );
      }
      if (request.kind === "products-page") {
        return success(request, {
          products: request.limit === 1 ? [product(1)] : [product(1)],
        });
      }
      if (request.kind === "product-ajax-js") {
        return success(request, {
          id: 1,
          handle: "product-1",
          variants: [{ id: 10, price: 1_000 }],
        });
      }
      return failure(request, "not_found");
    };

    const result = await scanStorefront({
      origin,
      main: {
        shop: "fixture.myshopify.com",
        routeRoot: "/",
        themeId: 1,
      },
      collector: collector({
        linkUrls: [
          "https://cdn.shopify.com/s/files/1/0000/t/1/assets/theme.css",
        ],
      }),
      execute,
      retry: { sleep: async () => undefined },
    });

    expect(result.runtimeDiagnostics).toEqual({
      retry: {
        retryCount: 1,
        scanWaitedMs: 2_000,
        concurrency: 4,
        concurrencyReductionCount: 0,
        eventsDropped: 0,
        events: [
          {
            retryNumber: 1,
            endpointKind: "meta",
            delayMs: 2_000,
            category: "http_5xx",
            concurrencyBefore: 4,
            concurrency: 4,
          },
        ],
      },
    });
  });
});

function collector(
  overrides: Partial<Extract<CollectorProbeResult, { ok: true }>> = {},
): Extract<CollectorProbeResult, { ok: true }> {
  return {
    ok: true,
    scriptUrls: [],
    linkUrls: [],
    checkoutUrls: [],
    jsonLdCount: 0,
    pageProducts: [],
    collectionHandles: [],
    ...overrides,
  };
}

function product(id: number): Record<string, unknown> {
  return {
    id,
    handle: `product-${id}`,
    title: `Product ${id}`,
    variants: [{ id: id * 10, price: "10.00" }],
  };
}

function success(
  request: EndpointRequest,
  data: unknown,
  contentType = "application/json",
): EndpointExecutionResult {
  return {
    ok: true,
    kind: request.kind,
    requestUrl: `${origin}/${request.kind}`,
    responseUrl: `${origin}/${request.kind}`,
    status: 200,
    contentType,
    byteLength: JSON.stringify(data).length,
    data,
  };
}

function failure(
  request: EndpointRequest,
  category: EndpointFailureCategory,
): EndpointExecutionResult {
  return {
    ok: false,
    kind: request.kind,
    requestUrl: `${origin}/${request.kind}`,
    category,
    message: category,
  };
}
