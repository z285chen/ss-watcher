import { describe, expect, it } from "vitest";

import { computeProductStatistics } from "../../src/core/analysis/product-statistics";
import type { StorefrontScanContext } from "../../src/core/shopify/storefront-scanner";

describe("product statistics", () => {
  it("computes verified minor-unit price, discount and distributions", () => {
    const statistics = computeProductStatistics(
      [
        {
          id: "1",
          handle: "alpha",
          vendor: "Acme",
          productType: "Toy",
          tags: ["cat", "smart"],
          createdAt: "2026-06-01T00:00:00Z",
          publishedAt: "2026-06-02T00:00:00Z",
          variants: [
            {
              id: "10",
              price: "12.00",
              compareAtPrice: "15.00",
              available: true,
              priceSource: "products-json",
            },
          ],
          images: [],
          sources: ["products-json"],
        },
        {
          id: "2",
          handle: "beta",
          vendor: "Acme",
          productType: "Feeder",
          tags: ["cat"],
          variants: [
            {
              id: "20",
              price: "18.00",
              available: false,
              priceSource: "products-json",
            },
          ],
          images: [],
          sources: ["products-json"],
        },
      ],
      verifiedContext(),
    );

    expect(statistics).toMatchObject({
      productCount: 2,
      variantCount: 2,
      availability: { availableProducts: 1, unavailableProducts: 1 },
      price: {
        status: "verified",
        currency: "USD",
        pricedVariantCount: 2,
        minMinor: "1200",
        maxMinor: "1800",
        averageMinor: "1500",
      },
      discount: {
        discountedProducts: 1,
        discountedVariants: 1,
        comparableVariants: 1,
      },
      vendors: [{ value: "Acme", count: 2 }],
      tags: [
        { value: "cat", count: 2 },
        { value: "smart", count: 1 },
      ],
    });
  });

  it("does not emit price range when the source gate is unverified", () => {
    const statistics = computeProductStatistics(
      [
        {
          id: "1",
          handle: "alpha",
          tags: [],
          variants: [{ id: "10", price: "12.00", priceSource: "products-json" }],
          images: [],
          sources: ["products-json"],
        },
      ],
      { ...verifiedContext(), priceContextVerified: false, priceSourceStatus: { "products-json": "unverified" } },
    );
    expect(statistics.price).toEqual({
      status: "unverified",
      currency: "USD",
      fractionDigits: 2,
      pricedVariantCount: 0,
    });
  });

  it("does not publish a range when the source passed but anonymous context did not", () => {
    const statistics = computeProductStatistics(
      [
        {
          id: "1",
          handle: "alpha",
          tags: [],
          variants: [
            { id: "10", price: "12.00", priceSource: "products-json" },
          ],
          images: [],
          sources: ["products-json"],
        },
      ],
      { ...verifiedContext(), countrySource: "unknown", priceContextVerified: false },
    );

    expect(statistics.price).toEqual({
      status: "unverified",
      currency: "USD",
      fractionDigits: 2,
      pricedVariantCount: 0,
    });
  });
});

function verifiedContext(): StorefrontScanContext {
  return {
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
  };
}
