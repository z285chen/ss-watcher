import { describe, expect, it } from "vitest";

import { verifyShopifyVariantPriceConsistency } from "../../src/core/shopify/price-consistency";

describe("Shopify B-grade price consistency", () => {
  it("normalizes decimal products.json prices to Ajax minor units", () => {
    const result = verifyShopifyVariantPriceConsistency(
      product("34.99", "49.00"),
      product(3499, 4900),
      "USD",
    );

    expect(result).toEqual({
      status: "verified",
      currency: "USD",
      fractionDigits: 2,
      checkedVariants: 2,
      samples: [
        {
          variantId: "101",
          productsJsonDecimal: "34.99",
          productsJsonMinor: "3499",
          productAjaxMinor: "3499",
          matches: true,
        },
        {
          variantId: "102",
          productsJsonDecimal: "49.00",
          productsJsonMinor: "4900",
          productAjaxMinor: "4900",
          matches: true,
        },
      ],
    });
  });

  it("uses ISO currency fraction digits without floating-point conversion", () => {
    expect(
      verifyShopifyVariantPriceConsistency(product("3499"), product(3499), "JPY"),
    ).toMatchObject({ status: "verified", fractionDigits: 0 });
    expect(
      verifyShopifyVariantPriceConsistency(
        product("34.999"),
        product(34999),
        "KWD",
      ),
    ).toMatchObject({ status: "verified", fractionDigits: 3 });
  });

  it("fails closed on a normalized price mismatch", () => {
    const result = verifyShopifyVariantPriceConsistency(
      product("34.99"),
      product(3498),
      "USD",
    );

    expect(result).toMatchObject({
      status: "unverified",
      reason: "price_mismatch",
      checkedVariants: 1,
      samples: [{ matches: false }],
    });
  });

  it.each([
    ["product identity", product("1.00"), product(100, undefined, "other"), "product_identity_mismatch"],
    ["shared variant", product("1.00"), product(100, undefined, "m0-alpha", 999), "no_shared_variant"],
    ["decimal price", product("1.001"), product(100), "invalid_price"],
    ["Ajax price", product("1.00"), product(100.5), "invalid_product_schema"],
  ])("rejects invalid %s evidence", (_label, productsJson, ajax, reason) => {
    expect(
      verifyShopifyVariantPriceConsistency(productsJson, ajax, "USD"),
    ).toMatchObject({ status: "unverified", reason });
  });

  it("rejects invalid currency and sample bounds", () => {
    expect(
      verifyShopifyVariantPriceConsistency(product("1.00"), product(100), "usd"),
    ).toMatchObject({ status: "unverified", reason: "invalid_currency" });
    expect(
      verifyShopifyVariantPriceConsistency(product("1.00"), product(100), "USD", 0),
    ).toMatchObject({ status: "unverified", reason: "invalid_sample_limit" });
  });
});

function product(
  firstPrice: string | number,
  secondPrice?: string | number,
  handle = "m0-alpha",
  firstVariantId = 101,
) {
  return {
    id: 1001,
    handle,
    variants: [
      { id: firstVariantId, price: firstPrice },
      ...(secondPrice === undefined ? [] : [{ id: 102, price: secondPrice }]),
    ],
  };
}
