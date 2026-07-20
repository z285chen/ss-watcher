import { describe, expect, it } from "vitest";

import { parseAnonymousShopifyContext } from "../../src/core/shopify/anonymous-context";

describe("anonymous Shopify page context", () => {
  it("extracts direct Shopify localization assignments", () => {
    expect(
      parseAnonymousShopifyContext(`
        <script>
          Shopify.locale = "en";
          Shopify.currency = {"active":"USD","rate":"1.0"};
          Shopify.country = "US";
        </script>
      `),
    ).toEqual({
      country: "US",
      locale: "en",
      currency: "USD",
      evidence: [
        {
          field: "country",
          source: "shopify-direct-assignment",
          value: "US",
        },
        {
          field: "locale",
          source: "shopify-direct-assignment",
          value: "en",
        },
        {
          field: "currency",
          source: "shopify-direct-assignment",
          value: "USD",
        },
      ],
    });
  });

  it("supports a bounded window.Shopify object without evaluating it", () => {
    expect(
      parseAnonymousShopifyContext(`
        <script>window.Shopify = {
          shop: "fixture.myshopify.com",
          locale: "fr",
          country: "FR",
          currency: { active: "EUR", rate: "1.0" },
          theme: { name: "Fixture" }
        };</script>
      `),
    ).toMatchObject({ country: "FR", locale: "fr", currency: "EUR" });
  });

  it("ignores unrelated, invalid and executable-looking values", () => {
    const result = parseAnonymousShopifyContext(`
      <script>
        const unrelated = { country: "US", currency: { active: "USD" } };
        Shopify.country = getCountry();
        Shopify.locale = "../../admin";
        Shopify.currency = { active: alert(1) };
      </script>
    `);
    expect(result).toEqual({ evidence: [] });
  });

  it("does not scan an unbounded response tail", () => {
    const result = parseAnonymousShopifyContext(
      `${"x".repeat(2 * 1024 * 1024)}Shopify.country = "US"`,
    );
    expect(result).toEqual({ evidence: [] });
  });
});
