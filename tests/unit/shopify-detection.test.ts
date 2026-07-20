import { describe, expect, it } from "vitest";

import { classifyShopifyStorefront } from "../../src/core/shopify/detection";
import type { CollectorProbeResult } from "../../src/content/probes";
import type { EndpointExecutionResult } from "../../src/core/network/request-policy";

const origin = "https://store.example";

describe("Shopify multi-signal detection", () => {
  it("classifies a hosted theme only when runtime, theme asset, and cart schema agree", () => {
    const detection = classifyShopifyStorefront({
      origin,
      main: {
        shop: "fixture.myshopify.com",
        routeRoot: "/",
        themeId: 42,
        themeSchemaName: "Dawn",
      },
      collector: collector({
        generator: "Shopify",
        linkUrls: [
          "https://store.example/cdn/shop/t/42/assets/theme.css",
        ],
      }),
      cartContext: success("cart-context", { currency: "USD" }),
    });

    expect(detection).toMatchObject({
      isShopify: true,
      storefrontKind: "hosted-theme",
      cartProbeEligible: true,
      confidence: 0.99,
    });
    expect(detection.evidence.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "main-theme-runtime",
        "collector-hosted-theme-asset",
        "cart-context-schema",
      ]),
    );
  });

  it("keeps an apparent hosted theme uncertain before the cart classification probe", () => {
    const detection = classifyShopifyStorefront({
      origin,
      main: { routeRoot: "/", themeName: "Dawn" },
      collector: collector({
        linkUrls: [
          "https://cdn.shopify.com/s/files/1/0000/t/2/assets/theme.css",
        ],
      }),
    });

    expect(detection).toMatchObject({
      isShopify: true,
      storefrontKind: "uncertain",
      cartProbeEligible: true,
    });
    expect(detection.reasons).toContain("允许执行一次受限 cart-context 分类探测");
  });

  it("classifies a cross-origin Shopify checkout hand-off without hosted runtime as custom", () => {
    const detection = classifyShopifyStorefront({
      origin,
      main: null,
      collector: collector({
        linkUrls: ["https://cdn.shopify.com/shopifycloud/storefront/assets/app.js"],
        checkoutUrls: [
          "https://fixture.myshopify.com/checkouts/cn/example",
        ],
      }),
      cartContext: success("cart-context", { currency: "USD" }),
    });

    expect(detection).toMatchObject({
      isShopify: true,
      storefrontKind: "custom-storefront",
      cartProbeEligible: true,
    });
  });

  it("does not treat a single generic CDN reference as Shopify", () => {
    const detection = classifyShopifyStorefront({
      origin,
      main: null,
      collector: collector({
        scriptUrls: ["https://cdn.shopify.com/some-library.js"],
      }),
    });

    expect(detection).toMatchObject({
      isShopify: false,
      storefrontKind: "uncertain",
      cartProbeEligible: false,
    });
  });

  it("accepts two independent weak groups for detection but not hosted classification", () => {
    const detection = classifyShopifyStorefront({
      origin,
      main: { routeRoot: "/" },
      collector: collector({
        scriptUrls: ["https://cdn.shopify.com/shopifycloud/app.js"],
      }),
    });

    expect(detection).toMatchObject({
      isShopify: true,
      storefrontKind: "uncertain",
      strongSignalCount: 0,
      weakSignalCount: 2,
      cartProbeEligible: true,
    });
  });

  it("uses recognized meta data as evidence but never as hosted-theme proof", () => {
    const detection = classifyShopifyStorefront({
      origin,
      main: null,
      collector: collector(),
      meta: success("meta", {
        name: "Fixture",
        myshopify_domain: "fixture.myshopify.com",
      }),
    });

    expect(detection).toMatchObject({
      isShopify: true,
      storefrontKind: "uncertain",
      cartProbeEligible: false,
    });
  });

  it("fails closed when cart is unavailable despite hosted-looking page evidence", () => {
    const detection = classifyShopifyStorefront({
      origin,
      main: { routeRoot: "/", themeId: 9 },
      collector: collector({
        linkUrls: [
          "https://cdn.shopify.com/s/files/1/0000/t/9/assets/theme.css",
        ],
      }),
      cartContext: failure("cart-context", "not_found"),
    });

    expect(detection).toMatchObject({
      isShopify: true,
      storefrontKind: "uncertain",
    });
    expect(detection.evidence).toContainEqual(
      expect.objectContaining({
        id: "cart-context-unavailable",
        effect: "against-hosted",
      }),
    );
  });

  it("does not accept another origin's storefront CDN path as a hosted theme asset", () => {
    const detection = classifyShopifyStorefront({
      origin,
      main: { routeRoot: "/", themeId: 9 },
      collector: collector({
        linkUrls: ["https://evil.example/cdn/shop/t/9/assets/theme.css"],
      }),
      cartContext: success("cart-context", { currency: "USD" }),
    });

    expect(detection).toMatchObject({
      isShopify: true,
      storefrontKind: "uncertain",
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
    socials: [],
    ...overrides,
  };
}

function success(
  kind: "meta" | "cart-context",
  data: unknown,
): EndpointExecutionResult {
  return {
    ok: true,
    kind,
    requestUrl: `https://store.example/${kind}`,
    responseUrl: `https://store.example/${kind}`,
    status: 200,
    contentType: "application/json",
    byteLength: 2,
    data,
  };
}

function failure(
  kind: "meta" | "cart-context",
  category: "not_found" | "not_json",
): EndpointExecutionResult {
  return {
    ok: false,
    kind,
    requestUrl: `https://store.example/${kind}`,
    category,
    message: category,
  };
}
