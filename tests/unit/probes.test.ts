import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectorProbe,
  isShopifyProbeResult,
  mainWorldShopifyProbe,
  routeRootFromShopifyProbe,
} from "../../src/content/probes";

type GlobalWithShopify = typeof globalThis & { Shopify?: unknown };

afterEach(() => {
  delete (globalThis as GlobalWithShopify).Shopify;
  vi.unstubAllGlobals();
});

describe("mainWorldShopifyProbe", () => {
  it("returns only the explicit flattened allowlist", () => {
    (globalThis as GlobalWithShopify).Shopify = {
      shop: "fixture.myshopify.com",
      locale: "en",
      country: "SG",
      routes: { root: "/en/", secret: "do-not-return" },
      currency: { active: "SGD", rate: 1.35 },
      theme: { name: "Dawn", id: 123, schema_name: "Dawn" },
      customer: { email: "private@example.test" },
    };

    expect(mainWorldShopifyProbe()).toEqual({
      shop: "fixture.myshopify.com",
      locale: "en",
      country: "SG",
      routeRoot: "/en/",
      currencyActive: "SGD",
      currencyRate: 1.35,
      themeName: "Dawn",
      themeId: 123,
      themeSchemaName: "Dawn",
    });
  });

  it("clips strings and rejects unsupported value types", () => {
    (globalThis as GlobalWithShopify).Shopify = {
      shop: "x".repeat(300),
      locale: { unexpected: true },
      currency: { rate: Number.POSITIVE_INFINITY },
    };

    expect(mainWorldShopifyProbe()).toEqual({ shop: "x".repeat(256) });
  });

  it("fails closed when a page getter throws", () => {
    const shopify = {} as Record<string, unknown>;
    Object.defineProperty(shopify, "routes", {
      get() {
        throw new Error("page interference");
      },
    });
    (globalThis as GlobalWithShopify).Shopify = shopify;

    expect(mainWorldShopifyProbe()).toBeNull();
  });

  it("rejects an unsafe page-owned routeRoot at the SW schema boundary", () => {
    expect(isShopifyProbeResult({ routeRoot: "/fr/", locale: "fr" })).toBe(true);
    expect(isShopifyProbeResult({ routeRoot: "/admin/" })).toBe(false);
    expect(isShopifyProbeResult({ routeRoot: "evil" })).toBe(false);
    expect(isShopifyProbeResult({ routeRoot: "/%252e%252e/" })).toBe(false);
  });

  it("resets a previously observed locale root when MAIN later degrades", () => {
    let routeRoot = routeRootFromShopifyProbe({ routeRoot: "/fr/" });
    expect(routeRoot).toBe("/fr/");
    routeRoot = routeRootFromShopifyProbe(null);
    expect(routeRoot).toBe("/");
  });
});

describe("collectorProbe", () => {
  it("normalizes the bound path and strips URL query, fragment, and credentials", () => {
    vi.stubGlobal("location", {
      origin: "https://store.example",
      pathname: "/Products//Widget",
      href: "https://store.example/Products//Widget?customer=secret#x",
    });
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector.includes("canonical")
          ? { href: "https://store.example/products/widget?variant=private#buy" }
          : { content: "Shopify" },
      scripts: [
        { src: "https://cdn.shopify.com/theme.js?v=private#hash" },
        { src: "javascript:alert(1)" },
        { src: "https://user:secret@assets.example/private.js" },
      ],
      querySelectorAll: (selector: string) => {
        if (selector === "link[href]") {
          return [
            {
              href: "https://cdn.shopify.com/s/files/1/0000/t/1/assets/theme.css?v=secret",
            },
          ];
        }
        if (selector === "a[href]") {
          return [
            {
              href: "https://fixture.myshopify.com/checkouts/cn/example?key=secret",
            },
            { href: "https://store.example/products/widget?variant=1" },
          ];
        }
        return { length: 2 };
      },
    });

    expect(
      collectorProbe({
        expectedOrigin: "https://store.example",
        expectedPathname: "/products/widget",
      }),
    ).toEqual({
      ok: true,
      canonical: "https://store.example/products/widget",
      generator: "Shopify",
      scriptUrls: ["https://cdn.shopify.com/theme.js"],
      linkUrls: [
        "https://cdn.shopify.com/s/files/1/0000/t/1/assets/theme.css",
      ],
      checkoutUrls: [
        "https://fixture.myshopify.com/checkouts/cn/example",
      ],
      jsonLdCount: 2,
      pageProducts: [
        {
          canonicalUrl: "https://store.example/products/widget",
          images: [],
          sources: ["canonical", "dom"],
        },
      ],
      collectionHandles: [],
    });
  });

  it("returns only bounded product fields from DOM, canonical, and JSON-LD", () => {
    vi.stubGlobal("location", {
      origin: "https://store.example",
      pathname: "/items/widget",
      href: "https://store.example/items/widget?customer=secret",
    });
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector.includes("canonical")
          ? { href: "https://store.example/items/widget?variant=secret" }
          : undefined,
      scripts: [],
      querySelectorAll: (selector: string) => {
        if (selector === "link[href]") return [];
        if (selector === "a[href]") {
          return [
            { href: "https://store.example/products/from-dom?variant=1" },
            { href: "https://store.example/collections/cats?page=2" },
          ];
        }
        return [
          {
            textContent: JSON.stringify({
              "@graph": [
                {
                  "@type": "Product",
                  url: "/items/widget?tracking=private",
                  name: "Widget",
                  image: [
                    "https://cdn.example/widget.jpg?v=1",
                    { contentUrl: "javascript:alert(1)" },
                  ],
                  offers: { price: "99.00", customer: "must-not-return" },
                },
                {
                  "@type": "Product",
                  url: "https://evil.example/items/stolen",
                  name: "Cross origin",
                },
              ],
            }),
          },
        ];
      },
    });

    const result = collectorProbe({
      expectedOrigin: "https://store.example",
      expectedPathname: "/items/widget",
    });

    expect(result).toMatchObject({
      ok: true,
      jsonLdCount: 1,
      collectionHandles: ["cats"],
      pageProducts: expect.arrayContaining([
        {
          canonicalUrl: "https://store.example/products/from-dom",
          images: [],
          sources: ["dom"],
        },
        {
          canonicalUrl: "https://store.example/items/widget",
          title: "Widget",
          images: ["https://cdn.example/widget.jpg"],
          sources: ["json-ld"],
        },
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("99.00");
    expect(JSON.stringify(result)).not.toContain("customer");
  });

  it("rejects locale-prefixed sensitive and ambiguous paths before DOM access", () => {
    const documentTrap = new Proxy(
      {},
      {
        get() {
          throw new Error("DOM must not be read");
        },
      },
    );
    vi.stubGlobal("document", documentTrap);
    vi.stubGlobal("location", {
      origin: "https://store.example",
      pathname: "/eng/%61ccount",
      href: "https://store.example/eng/%61ccount",
    });
    expect(
      collectorProbe({
        expectedOrigin: "https://store.example",
        expectedPathname: "/eng/account",
      }),
    ).toEqual({ ok: false, reason: "sensitive_path" });

    vi.stubGlobal("location", {
      origin: "https://store.example",
      pathname: "/products/%252e%252e",
      href: "https://store.example/products/%252e%252e",
    });
    expect(
      collectorProbe({
        expectedOrigin: "https://store.example",
        expectedPathname: "/products/%2e%2e",
      }),
    ).toEqual({ ok: false, reason: "path_changed" });
  });
});
