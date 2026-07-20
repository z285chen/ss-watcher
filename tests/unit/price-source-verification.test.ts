import { describe, expect, it } from "vitest";

import { verifyProductsJsonPrices } from "../../src/core/shopify/price-source-verification";
import type { CatalogProduct } from "../../src/core/shopify/catalog-scanner";

const product: CatalogProduct = {
  id: "1",
  handle: "alpha",
  title: "Alpha",
  tags: [],
  variants: [{ id: "10", price: "12.00" }],
  images: [],
  sources: ["products-json"],
};

describe("catalog price source verification", () => {
  it("verifies sampled products against Ajax minor units", async () => {
    const result = await verifyProductsJsonPrices(
      async (request) => ({
        ok: true,
        kind: request.kind,
        requestUrl: `https://store.example/products/${request.kind}`,
        responseUrl: `https://store.example/products/${request.kind}`,
        status: 200,
        contentType: "application/json",
        byteLength: 1,
        data: {
          id: 1,
          handle: "alpha",
          variants: [{ id: 10, price: 1200 }],
        },
      }),
      { products: [product], currency: "USD", routeRoot: "/" },
    );

    expect(result).toMatchObject({
      status: "verified",
      checkedProducts: 1,
      checkedVariants: 1,
      candidateProducts: 1,
      terminal: false,
    });
  });

  it("fails closed on a mismatched price", async () => {
    const result = await verifyProductsJsonPrices(
      async (request) => ({
        ok: true,
        kind: request.kind,
        requestUrl: "https://store.example/product.js",
        responseUrl: "https://store.example/product.js",
        status: 200,
        contentType: "application/json",
        byteLength: 1,
        data: {
          id: 1,
          handle: "alpha",
          variants: [{ id: 10, price: 1300 }],
        },
      }),
      { products: [product], currency: "USD", routeRoot: "/" },
    );

    expect(result).toMatchObject({
      status: "unverified",
      reason: "price_mismatch",
      terminal: false,
    });
  });

  it("does not call Ajax when products.json contributed no prices", async () => {
    let called = false;
    const result = await verifyProductsJsonPrices(
      async () => {
        called = true;
        throw new Error("not expected");
      },
      {
        products: [{ ...product, variants: [] }],
        currency: "USD",
        routeRoot: "/",
      },
    );
    expect(called).toBe(false);
    expect(result).toMatchObject({ status: "not-used", reason: "no_price_data" });
  });

  it("records terminal endpoint failures", async () => {
    const result = await verifyProductsJsonPrices(
      async (request) => ({
        ok: false,
        kind: request.kind,
        requestUrl: "https://store.example/product.js",
        category: "challenge_page",
        message: "challenge_page",
      }),
      { products: [product], currency: "USD", routeRoot: "/" },
    );
    expect(result).toMatchObject({
      status: "unverified",
      reason: "endpoint_challenge_page",
      terminal: true,
    });
  });
});
