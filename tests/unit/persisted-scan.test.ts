import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { runPersistedStorefrontScan } from "../../src/core/shopify/persisted-scan";
import { StagingStore } from "../../src/core/storage/staging-store";
import type { CollectorProbeResult } from "../../src/content/probes";
import type {
  EndpointExecutionResult,
  EndpointRequest,
} from "../../src/core/network/request-policy";
import type { EndpointExecutor } from "../../src/core/shopify/catalog-scanner";

const stores: StagingStore[] = [];
const origin = "https://store.example";

afterEach(async () => {
  const names = stores.map((store) => store.databaseName);
  await Promise.all(stores.map((store) => store.close()));
  stores.length = 0;
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    ),
  );
});

describe("persisted M1+M2 storefront scan", () => {
  it("publishes detection, analysis, and products through one committed manifest", async () => {
    const store = new StagingStore({
      databaseName: `persisted-scan-${crypto.randomUUID()}`,
    });
    stores.push(store);
    const execute: EndpointExecutor = async (request) => {
      if (request.kind === "meta") {
        return success(request, { myshopify_domain: "fixture.myshopify.com" });
      }
      if (request.kind === "cart-context") {
        return success(request, { currency: "USD" });
      }
      if (request.kind === "page-html") {
        return success(request, anonymousPage(), "text/html");
      }
      if (request.kind === "products-page") {
        return success(request, {
          products:
            request.limit === 1
              ? [product(1)]
              : [product(1), product(2)],
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
      if (request.kind === "collection-html") {
        return success(
          request,
          '<a href="/products/product-1">One</a><a href="/products/product-2">Two</a>',
          "text/html",
        );
      }
      throw new Error(`Unexpected endpoint ${request.kind}`);
    };

    const result = await runPersistedStorefrontScan({
      store,
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
    });

    expect(result.scan).toMatchObject({
      status: "completed",
      detection: { storefrontKind: "hosted-theme" },
      catalog: { coverage: { productsFetched: 2 } },
    });
    expect(result.committed.snapshot).toMatchObject({
      snapshotId: result.snapshotId,
      storeKey: origin,
      committed: true,
      scanStatus: "completed",
      runtimeDiagnostics: {
        retry: {
          retryCount: 0,
          scanWaitedMs: 0,
          concurrency: 4,
          concurrencyReductionCount: 0,
          eventsDropped: 0,
          events: [],
        },
      },
      analysisStatus: "completed",
      statistics: { productCount: 2, variantCount: 2 },
      rankings: [
        expect.objectContaining({
          rank: 1,
          handle: "product-1",
          disclaimer: expect.stringContaining("不等于真实销量"),
        }),
        expect.objectContaining({ rank: 2, handle: "product-2" }),
      ],
      newness: expect.any(Array),
    });
    expect(result.committed.products).toHaveLength(2);
    expect(result.committed.moduleResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ moduleId: "detection", status: "completed" }),
        expect.objectContaining({
          moduleId: "catalog",
          status: "completed",
          result: expect.objectContaining({
            runtimeDiagnostics: {
              retry: expect.objectContaining({ retryCount: 0 }),
            },
          }),
        }),
        expect.objectContaining({ moduleId: "price-context", status: "completed" }),
        expect.objectContaining({ moduleId: "statistics", status: "completed" }),
        expect.objectContaining({ moduleId: "rankings", status: "completed" }),
        expect.objectContaining({ moduleId: "newness", status: "partial" }),
      ]),
    );
    await expect(store.getRun(result.scanRunId)).resolves.toMatchObject({
      status: "completed",
      staging: false,
      writeManifest: {
        products: {
          writtenProductCount: 2,
          expectedProductCount: 2,
          checkpointProductCount: 2,
          sealed: true,
        },
      },
    });

    await store.close();
    const reopened = new StagingStore({ databaseName: store.databaseName });
    stores.push(reopened);
    await expect(reopened.getLatestCommittedSnapshot(origin)).resolves.toMatchObject({
      snapshot: { snapshotId: result.snapshotId, committed: true },
      products: [{ snapshotId: result.snapshotId }, { snapshotId: result.snapshotId }],
    });
  });

  it("commits one record when fallback identity upgrades from handle to product ID", async () => {
    const store = new StagingStore({
      databaseName: `persisted-fallback-${crypto.randomUUID()}`,
    });
    stores.push(store);
    const execute: EndpointExecutor = async (request) => {
      if (request.kind === "meta") {
        return success(request, { myshopify_domain: "fixture.myshopify.com" });
      }
      if (request.kind === "cart-context") {
        return success(request, { currency: "USD" });
      }
      if (request.kind === "page-html") {
        return success(request, anonymousPage(), "text/html");
      }
      if (request.kind === "products-page") {
        return failure(request, "not_found");
      }
      if (request.kind === "sitemap" && request.index === undefined) {
        return success(
          request,
          `<sitemapindex><sitemap><loc>${origin}/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
          "application/xml",
        );
      }
      if (request.kind === "sitemap" && request.index === 1) {
        return success(
          request,
          `<urlset><url><loc>${origin}/products/alpha</loc></url></urlset>`,
          "application/xml",
        );
      }
      if (request.kind === "product-ajax-js") {
        return success(request, {
          id: 101,
          handle: request.handle,
          title: "Alpha",
          variants: [{ id: 1001, price: 1200 }],
        });
      }
      if (request.kind === "collection-html") {
        return success(
          request,
          '<a href="/products/alpha">Alpha</a>',
          "text/html",
        );
      }
      throw new Error(`Unexpected endpoint ${request.kind}`);
    };

    const result = await runPersistedStorefrontScan({
      store,
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
    });

    expect(result.scan.catalog.products).toEqual([
      expect.objectContaining({ id: "101", handle: "alpha" }),
    ]);
    expect(result.committed.products).toHaveLength(1);
    expect(result.committed.products[0]).toMatchObject({
      productKey: "101",
      value: { id: "101", handle: "alpha" },
    });
  });

  it("defers a products.json handle-only identity until a later page reveals its ID", async () => {
    const store = new StagingStore({
      databaseName: `persisted-pagination-identity-${crypto.randomUUID()}`,
    });
    stores.push(store);
    const execute: EndpointExecutor = async (request) => {
      if (request.kind === "meta") {
        return success(request, { myshopify_domain: "fixture.myshopify.com" });
      }
      if (request.kind === "cart-context") {
        return success(request, { currency: "USD" });
      }
      if (request.kind === "page-html") {
        return success(request, anonymousPage(), "text/html");
      }
      if (request.kind === "products-page" && request.limit === 1) {
        return success(request, { products: [{ handle: "alpha" }] });
      }
      if (request.kind === "products-page" && request.page === 1) {
        return success(request, {
          products: [{ handle: "alpha" }, product(2)],
        });
      }
      if (request.kind === "products-page" && request.page === 2) {
        return success(request, {
          products: [{ id: 101, handle: "alpha" }, product(2)],
        });
      }
      if (request.kind === "sitemap") {
        return success(request, "<urlset></urlset>", "application/xml");
      }
      if (request.kind === "collection-html") {
        return failure(request, "not_found");
      }
      if (request.kind === "product-ajax-js") {
        return success(request, {
          id: 2,
          handle: "product-2",
          variants: [{ id: 20, price: 1_000 }],
        });
      }
      throw new Error(`Unexpected endpoint ${request.kind}`);
    };

    const result = await runPersistedStorefrontScan({
      store,
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
      pageSize: 2,
      ajaxSupplementLimit: 0,
    });

    expect(result.scan.catalog.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "101", handle: "alpha" }),
        expect.objectContaining({ id: "2", handle: "product-2" }),
      ]),
    );
    expect(result.committed.products).toHaveLength(2);
    expect(result.committed.products.map((entry) => entry.productKey).sort()).toEqual([
      "101",
      "2",
    ]);
  });

  it("persists a custom-storefront JSON-LD product by canonical URL identity", async () => {
    const store = new StagingStore({
      databaseName: `persisted-custom-canonical-${crypto.randomUUID()}`,
    });
    stores.push(store);
    const execute: EndpointExecutor = async (request) => {
      if (request.kind === "meta") {
        return success(request, { myshopify_domain: "fixture.myshopify.com" });
      }
      if (request.kind === "cart-context") {
        return success(request, { currency: "USD" });
      }
      if (request.kind === "sitemap") return failure(request, "not_found");
      throw new Error(`Custom storefront must not call ${request.kind}`);
    };

    const result = await runPersistedStorefrontScan({
      store,
      origin,
      main: null,
      collector: collector({
        linkUrls: ["https://cdn.shopify.com/shopifycloud/storefront/app.js"],
        checkoutUrls: ["https://fixture.myshopify.com/checkouts/cn/example"],
        pageProducts: [
          {
            canonicalUrl: `${origin}/items/widget`,
            title: "Widget",
            images: [],
            sources: ["json-ld"],
          },
        ],
      }),
      execute,
    });

    expect(result.scan).toMatchObject({
      status: "partial",
      detection: { storefrontKind: "custom-storefront" },
      catalog: {
        coverage: { productsFetched: 1, sources: ["json-ld"] },
      },
    });
    expect(result.committed.products).toEqual([
      expect.objectContaining({
        productKey: `url:${origin}/items/widget`,
        value: expect.objectContaining({
          canonicalUrl: `${origin}/items/widget`,
          title: "Widget",
        }),
      }),
    ]);
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

function anonymousPage(): string {
  return '<script>Shopify.locale = "en"; Shopify.country = "US"; Shopify.currency = {"active":"USD"};</script>';
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
  category: "not_found",
): EndpointExecutionResult {
  return {
    ok: false,
    kind: request.kind,
    requestUrl: `${origin}/${request.kind}`,
    category,
    message: category,
  };
}
