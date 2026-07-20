import { describe, expect, it, vi } from "vitest";

import {
  paginateProductsJson,
  parseCollectionHandlesFromHtml,
  parseProductLinksFromHtml,
  parseSitemapDocument,
  probeProductsJsonCapability,
  scanGenericCatalog,
  scanHostedCatalog,
  type EndpointExecutor,
} from "../../src/core/shopify/catalog-scanner";
import type {
  EndpointExecutionResult,
  EndpointFailureCategory,
  EndpointRequest,
} from "../../src/core/network/request-policy";

const origin = "https://store.example";

describe("products.json capability probing", () => {
  it("always probes page 1 with limit 1 and maps a valid envelope to ok", async () => {
    const execute = vi.fn<EndpointExecutor>(async (request) =>
      success(request, { products: [product(1)] }),
    );

    await expect(probeProductsJsonCapability(execute)).resolves.toMatchObject({
      status: "ok",
      terminal: false,
    });
    expect(execute).toHaveBeenCalledWith(
      { kind: "products-page", page: 1, limit: 1 },
      {},
    );
  });

  it.each([
    ["not_json", "not_json", false],
    ["challenge_page", "challenge", true],
    ["not_found", "unavailable", false],
  ] as const)(
    "maps %s to capability status %s",
    async (category, expectedStatus, terminal) => {
      const execute: EndpointExecutor = async (request) =>
        failure(request, category);
      await expect(probeProductsJsonCapability(execute)).resolves.toMatchObject({
        status: expectedStatus,
        terminal,
      });
    },
  );
});

describe("products.json pagination stop conditions", () => {
  it("stops on an empty page", async () => {
    const result = await paginateProductsJson(
      executorForPages([[]]),
      { pageSize: 2, productLimit: 10 },
    );
    expect(result).toMatchObject({
      termination: "empty-page",
      complete: true,
      truncated: false,
      pagesRequested: 1,
    });
  });

  it("stops on a short page", async () => {
    const result = await paginateProductsJson(
      executorForPages([[product(1), product(2)]]),
      { pageSize: 3, productLimit: 10 },
    );
    expect(result).toMatchObject({
      termination: "short-page",
      complete: true,
      truncated: false,
      pagesRequested: 1,
    });
    expect(result.products).toHaveLength(2);
  });

  it("stops when an ordered page signature repeats", async () => {
    const result = await paginateProductsJson(
      executorForPages([
        [product(1), product(2)],
        [product(1), product(2)],
      ]),
      { pageSize: 2, productLimit: 10 },
    );
    expect(result).toMatchObject({
      termination: "repeated-page-signature",
      complete: false,
      pagesRequested: 2,
    });
    expect(result.products).toHaveLength(2);
  });

  it("stops on no progress even when duplicate order changes the signature", async () => {
    const result = await paginateProductsJson(
      executorForPages([
        [product(1), product(2)],
        [product(2), product(1)],
      ]),
      { pageSize: 2, productLimit: 10 },
    );
    expect(result).toMatchObject({
      termination: "no-progress",
      complete: false,
      pagesRequested: 2,
    });
    expect(result.products).toHaveLength(2);
  });

  it("stops and marks truncated at the configured product limit", async () => {
    const result = await paginateProductsJson(
      executorForPages([
        [product(1), product(2)],
        [product(3), product(4)],
      ]),
      { pageSize: 2, productLimit: 3 },
    );
    expect(result).toMatchObject({
      termination: "product-limit",
      complete: false,
      truncated: true,
      pagesRequested: 2,
    });
    expect(result.products.map((entry) => entry.id)).toEqual(["1", "2", "3"]);
  });

  it("handles 1,000 products with monotonic pages and bounded requests", async () => {
    const pages: unknown[][] = [];
    for (let page = 0; page < 4; page += 1) {
      pages.push(
        Array.from({ length: 250 }, (_unused, index) =>
          product(page * 250 + index + 1),
        ),
      );
    }
    const execute = vi.fn<EndpointExecutor>(executorForPages(pages));
    const result = await paginateProductsJson(execute, {
      pageSize: 250,
      productLimit: 1_000,
    });

    expect(result).toMatchObject({
      termination: "product-limit",
      truncated: true,
      pagesRequested: 4,
    });
    expect(result.products).toHaveLength(1_000);
    expect(
      execute.mock.calls.map(([request]) =>
        request.kind === "products-page" ? request.page : undefined,
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it("reports an endpoint failure without discarding completed pages", async () => {
    const execute: EndpointExecutor = async (request) => {
      if (request.kind === "products-page" && request.page === 2) {
        return failure(request, "not_found");
      }
      return success(request, { products: [product(1), product(2)] });
    };
    const result = await paginateProductsJson(execute, {
      pageSize: 2,
      productLimit: 10,
    });
    expect(result).toMatchObject({
      termination: "endpoint-failure",
      products: [{ id: "1" }, { id: "2" }],
    });
  });

  it("does not enter a fallback after a terminal failure on a later page", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind === "products-page" && request.limit === 1) {
        return success(request, { products: [product(1)] });
      }
      if (request.kind === "products-page" && request.page === 1) {
        return success(request, { products: [product(1), product(2)] });
      }
      return failure(request, "challenge_page");
    };
    const result = await scanHostedCatalog(execute, {
      origin,
      pageSize: 2,
      productLimit: 10,
    });

    expect(calls.map((request) => request.kind)).toEqual([
      "products-page",
      "products-page",
      "products-page",
    ]);
    expect(result.termination).toBe("terminal-access-gate");
    expect(result.coverage.capabilityProbes["products-json"]).toBe("challenge");
  });
});

describe("catalog fallback chain", () => {
  it("uses products.json after the capability probe when pagination completes", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind !== "products-page") return failure(request, "not_found");
      if (request.limit === 1) return success(request, { products: [product(1)] });
      return success(request, { products: [product(1), product(2), product(3)] });
    };
    const result = await scanHostedCatalog(execute, {
      origin,
      pageSize: 250,
    });

    expect(calls).toEqual([
      { kind: "products-page", page: 1, limit: 1 },
      { kind: "products-page", page: 1, limit: 250 },
    ]);
    expect(result).toMatchObject({
      complete: true,
      termination: "products-json-complete",
      coverage: {
        productsFetched: 3,
        truncated: false,
        sources: ["products-json"],
        capabilityProbes: { "products-json": "ok" },
      },
    });
  });

  it("falls from unavailable products.json to sitemap and limited product Ajax", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind === "products-page") return failure(request, "not_found");
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
          `<urlset><url><loc>${origin}/products/alpha</loc></url><url><loc>${origin}/products/beta</loc></url></urlset>`,
          "application/xml",
        );
      }
      if (request.kind === "product-ajax-js") {
        return success(request, {
          id: request.handle === "alpha" ? 1 : 2,
          handle: request.handle,
          title: request.handle,
          variants: [{ id: request.handle === "alpha" ? 11 : 22, price: 1000 }],
        });
      }
      return failure(request, "not_found");
    };
    const result = await scanHostedCatalog(execute, { origin });

    expect(calls.map((request) => request.kind)).toEqual([
      "products-page",
      "sitemap",
      "sitemap",
      "product-ajax-js",
      "product-ajax-js",
    ]);
    expect(result.coverage).toMatchObject({
      productsFetched: 2,
      sources: ["sitemap", "product-ajax-js"],
      capabilityProbes: {
        "products-json": "unavailable",
        sitemap: "ok",
        "product-ajax-js": "ok",
      },
    });
    expect(result.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "1",
          handle: "alpha",
          sources: ["sitemap", "product-ajax-js"],
        }),
      ]),
    );
  });

  it("falls from sitemap to Collection HTML before limited product Ajax", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind === "products-page" || request.kind === "sitemap") {
        return failure(request, "not_found");
      }
      if (request.kind === "collection-html") {
        return success(
          request,
          `<main><a href="/products/alpha?variant=1">Alpha</a><a href="https://evil.example/products/stolen">No</a></main>`,
          "text/html",
        );
      }
      if (request.kind === "product-ajax-js") {
        return success(request, {
          id: 1,
          handle: request.handle,
          variants: [{ id: 11, price: 1000 }],
        });
      }
      return failure(request, "not_found");
    };
    const result = await scanHostedCatalog(execute, { origin });

    expect(calls.map((request) => request.kind)).toEqual([
      "products-page",
      "sitemap",
      "collection-html",
      "product-ajax-js",
    ]);
    expect(result).toMatchObject({
      termination: "fallback-collection",
      coverage: {
        productsFetched: 1,
        sources: ["collection-html", "product-ajax-js"],
      },
    });
  });

  it("stops the entire origin on a terminal capability response", async () => {
    const execute = vi.fn<EndpointExecutor>(async (request) =>
      failure(request, "challenge_page"),
    );
    const result = await scanHostedCatalog(execute, { origin });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      termination: "terminal-access-gate",
      coverage: {
        capabilityProbes: { "products-json": "challenge" },
      },
    });
  });

  it("keeps custom/uncertain scanning on sitemap and never enters Ajax", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      return success(
        request,
        `<urlset><url><loc>${origin}/products/alpha</loc></url></urlset>`,
        "application/xml",
      );
    };
    const result = await scanGenericCatalog(execute, { origin });

    expect(calls).toEqual([{ kind: "sitemap" }]);
    expect(result).toMatchObject({
      complete: false,
      termination: "generic-sitemap",
      coverage: { sources: ["sitemap"], productsFetched: 1 },
    });
  });

  it("merges sanitized current-page signals with sitemap without calling Ajax", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind !== "sitemap") {
        throw new Error(`Generic scan must not call ${request.kind}`);
      }
      return success(
        request,
        `<urlset><url><loc>${origin}/products/alpha</loc></url></urlset>`,
        "application/xml",
      );
    };
    const result = await scanGenericCatalog(execute, {
      origin,
      pageProducts: [
        {
          canonicalUrl: `${origin}/items/widget`,
          title: "Widget",
          images: ["https://cdn.example/widget.jpg"],
          sources: ["json-ld"],
        },
      ],
    });

    expect(calls).toEqual([{ kind: "sitemap" }]);
    expect(result).toMatchObject({
      complete: false,
      coverage: {
        productsFetched: 2,
        sources: ["json-ld", "sitemap"],
      },
    });
    expect(result.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalUrl: `${origin}/items/widget`,
          title: "Widget",
          sources: ["json-ld"],
        }),
        expect.objectContaining({ handle: "alpha", sources: ["sitemap"] }),
      ]),
    );
  });

  it("falls from an empty all collection to discovered handles and follows bounded next pages", async () => {
    const calls: EndpointRequest[] = [];
    const execute: EndpointExecutor = async (request) => {
      calls.push(request);
      if (request.kind === "products-page" || request.kind === "sitemap") {
        return failure(request, "not_found");
      }
      if (request.kind === "collection-html" && request.handle === "all") {
        return success(
          request,
          `<nav><a href="/collections/cats">Cats</a></nav>`,
          "text/html",
        );
      }
      if (
        request.kind === "collection-html" &&
        request.handle === "cats" &&
        request.page === 1
      ) {
        return success(
          request,
          `<a href="/products/alpha">Alpha</a><a href="?sort_by=best-selling&amp;page=2">Next</a>`,
          "text/html",
        );
      }
      if (request.kind === "collection-html" && request.handle === "cats") {
        return success(
          request,
          `<a href="/products/beta">Beta</a>`,
          "text/html",
        );
      }
      throw new Error(`Unexpected request ${request.kind}`);
    };
    const result = await scanHostedCatalog(execute, {
      origin,
      ajaxSupplementLimit: 0,
      maxCollectionPages: 5,
    });

    expect(calls).toEqual([
      { kind: "products-page", page: 1, limit: 1 },
      { kind: "sitemap" },
      {
        kind: "collection-html",
        handle: "all",
        sortBy: "best-selling",
        page: 1,
      },
      {
        kind: "collection-html",
        handle: "cats",
        sortBy: "best-selling",
        page: 1,
      },
      {
        kind: "collection-html",
        handle: "cats",
        sortBy: "best-selling",
        page: 2,
      },
    ]);
    expect(result).toMatchObject({
      termination: "fallback-collection",
      coverage: {
        productsFetched: 2,
        truncated: false,
        sources: ["collection-html"],
        capabilityProbes: { "collection-html": "ok" },
      },
    });
  });
});

describe("bounded fallback parsers", () => {
  it("extracts only same-origin product URLs and fixed sitemap indexes", () => {
    const parsed = parseSitemapDocument(
      `<sitemapindex><loc>${origin}/sitemap_products_2.xml?from=1&amp;to=9</loc><loc>https://evil.example/sitemap_products_3.xml</loc></sitemapindex>
       <urlset><url><loc>${origin}/fr/products/alpha?variant=1</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://evil.example/products/stolen</loc></url></urlset>`,
      origin,
    );
    expect(parsed.productSitemapIndexes).toEqual([2]);
    expect(parsed.productSitemaps).toEqual([
      { index: 2, from: "1", to: "9" },
    ]);
    expect(parsed.products).toEqual([
      expect.objectContaining({
        handle: "alpha",
        canonicalUrl: `${origin}/fr/products/alpha`,
        sitemapLastmod: "2026-01-01",
      }),
    ]);
  });

  it("deduplicates Collection links and rejects cross-origin and unsafe handles", () => {
    expect(
      parseProductLinksFromHtml(
        `<a href="/products/alpha">A</a><a href="/products/alpha?x=1">A2</a><a href="https://evil.example/products/beta">B</a><a href="/products/%2e%2e">bad</a>`,
        origin,
      ).map((entry) => entry.handle),
    ).toEqual(["alpha"]);
  });

  it("extracts only bounded same-origin collection handles", () => {
    expect(
      parseCollectionHandlesFromHtml(
        `<a href="/collections/cats?page=2">Cats</a><a href="${origin}/fr/collections/dogs">Dogs</a><a href="https://evil.example/collections/stolen">No</a>`,
        origin,
      ),
    ).toEqual(["cats", "dogs"]);
  });
});

function executorForPages(pages: readonly unknown[][]): EndpointExecutor {
  return async (request) => {
    if (request.kind !== "products-page") return failure(request, "not_found");
    return success(request, { products: pages[request.page - 1] ?? [] });
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
  const requestUrl = `${origin}/${request.kind}`;
  return {
    ok: true,
    kind: request.kind,
    requestUrl,
    responseUrl: requestUrl,
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
