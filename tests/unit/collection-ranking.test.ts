import { describe, expect, it } from "vitest";

import { scanPublicCollectionRanking } from "../../src/core/analysis/collection-ranking";
import type { EndpointExecutor } from "../../src/core/shopify/catalog-scanner";

const origin = "https://store.example";

describe("public Collection rankings", () => {
  it("preserves public order, scope and the non-sales disclaimer", async () => {
    const ranking = await scanPublicCollectionRanking(executor({
      all: `
        <a href="/products/beta">Beta</a>
        <a href="/products/alpha">Alpha</a>
      `,
    }), {
      origin,
      routeRoot: "/",
      sortBy: "best-selling",
      catalogProducts: [
        product("1", "alpha", "Alpha"),
        product("2", "beta", "Beta"),
      ],
    });

    expect(ranking).toMatchObject({
      status: "completed",
      sortBy: "best-selling",
      scope: { kind: "all-storefront", handle: "all" },
      items: [
        { rank: 1, id: "2", handle: "beta", title: "Beta" },
        { rank: 2, id: "1", handle: "alpha", title: "Alpha" },
      ],
      truncated: false,
      termination: "complete",
    });
    expect(ranking.disclaimer).toContain("不等于真实销量");
  });

  it("falls back to an explicitly discovered Collection and labels its scope", async () => {
    const ranking = await scanPublicCollectionRanking(executor({
      all: '<a href="/collections/cats">Cats</a>',
      cats: '<a href="/products/alpha">Alpha</a>',
    }), {
      origin,
      routeRoot: "/",
      sortBy: "best-selling",
      catalogProducts: [product("1", "alpha", "Alpha")],
    });

    expect(ranking).toMatchObject({
      status: "completed",
      scope: { kind: "collection", handle: "cats" },
      items: [{ rank: 1, handle: "alpha" }],
    });
  });

  it("follows only an exact n+1 link that preserves the requested sort", async () => {
    const calls: number[] = [];
    const execute: EndpointExecutor = async (request) => {
      if (request.kind !== "collection-html") throw new Error("unexpected");
      const page = request.page ?? 1;
      calls.push(page);
      const body =
        page === 1
          ? `<a href="/products/alpha">Alpha</a><a href="/collections/all?sort_by=created-descending&page=2">Next</a>`
          : '<a href="/products/beta">Beta</a>';
      return success(request.handle, request.sortBy, page, body);
    };

    const ranking = await scanPublicCollectionRanking(execute, {
      origin,
      routeRoot: "/",
      sortBy: "created-descending",
      catalogProducts: [],
    });
    expect(calls).toEqual([1, 2]);
    expect(ranking.items.map((item) => item.handle)).toEqual(["alpha", "beta"]);
  });

  it("stops at the product limit and marks the result truncated", async () => {
    const ranking = await scanPublicCollectionRanking(executor({
      all: '<a href="/products/a">A</a><a href="/products/b">B</a>',
    }), {
      origin,
      routeRoot: "/",
      sortBy: "best-selling",
      catalogProducts: [],
      productLimit: 1,
    });
    expect(ranking).toMatchObject({
      status: "partial",
      truncated: true,
      termination: "product-limit",
      items: [{ rank: 1, handle: "a" }],
    });
  });
});

function executor(pages: Record<string, string>): EndpointExecutor {
  return async (request) => {
    if (request.kind !== "collection-html") throw new Error("unexpected endpoint");
    const body = pages[request.handle];
    if (body === undefined) {
      return {
        ok: false,
        kind: request.kind,
        requestUrl: `${origin}/missing`,
        category: "not_found",
        message: "not_found",
      };
    }
    return success(request.handle, request.sortBy, request.page ?? 1, body);
  };
}

function success(
  handle: string,
  sortBy: "best-selling" | "created-descending",
  page: number,
  data: string,
) {
  const url = `${origin}/collections/${handle}?sort_by=${sortBy}&page=${page}`;
  return {
    ok: true as const,
    kind: "collection-html" as const,
    requestUrl: url,
    responseUrl: url,
    status: 200,
    contentType: "text/html",
    byteLength: data.length,
    data,
  };
}

function product(id: string, handle: string, title: string) {
  return {
    id,
    handle,
    title,
    tags: [],
    variants: [],
    images: [],
    sources: ["products-json" as const],
  };
}
