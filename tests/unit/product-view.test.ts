import { describe, expect, it } from "vitest";

import { productFacets, queryProducts } from "../../src/core/analysis/product-view";

const products = [
  product("1", "Alpha", "Acme", "Toy", ["cat", "smart"], true, "2026-07-01T00:00:00Z", 2),
  product("2", "Beta", "Bravo", "Feeder", ["dog"], false, "2026-06-01T00:00:00Z", 1),
  product("3", "Gamma", "Acme", "Toy", ["cat"], undefined, "2026-05-01T00:00:00Z", 3),
];

describe("formal product list query", () => {
  it("searches public fields and applies facet groups", () => {
    expect(
      queryProducts(products, {
        search: "cat",
        vendors: ["Acme"],
        productTypes: ["Toy"],
        availability: "available",
      }).rows.map((product) => product.title),
    ).toEqual(["Alpha"]);
  });

  it("sorts deterministically and paginates", () => {
    const result = queryProducts(products, {
      sortBy: "createdAt",
      sortDirection: "desc",
      offset: 1,
      limit: 1,
    });
    expect(result).toMatchObject({ total: 3, offset: 1, limit: 1 });
    expect(result.rows[0]?.title).toBe("Beta");
  });

  it("builds Vendor, product type and tag facets", () => {
    expect(productFacets(products)).toEqual({
      vendors: [
        { value: "Acme", count: 2 },
        { value: "Bravo", count: 1 },
      ],
      productTypes: [
        { value: "Toy", count: 2 },
        { value: "Feeder", count: 1 },
      ],
      tags: [
        { value: "cat", count: 2 },
        { value: "dog", count: 1 },
        { value: "smart", count: 1 },
      ],
    });
  });
});

function product(
  id: string,
  title: string,
  vendor: string,
  productType: string,
  tags: string[],
  available: boolean | undefined,
  createdAt: string,
  variantCount: number,
) {
  return {
    id,
    handle: title.toLowerCase(),
    title,
    vendor,
    productType,
    tags,
    createdAt,
    variants: Array.from({ length: variantCount }, (_, index) => ({
      id: `${id}-${index}`,
      ...(available === undefined ? {} : { available }),
    })),
    images: [],
    sources: ["products-json" as const],
  };
}
