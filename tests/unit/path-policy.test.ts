import { describe, expect, it } from "vitest";

import { checkPublicPath, isPublicPath } from "../../src/core/security/path-policy";

describe("checkPublicPath", () => {
  it("normalizes case, duplicate slashes, suffixes, and one locale prefix", () => {
    expect(checkPublicPath("//EN-ca///Collections/Summer/?preview=1#top")).toEqual({
      ok: true,
      normalizedPathname: "/en-ca/collections/summer",
      effectiveSegments: ["collections", "summer"],
    });
  });

  it.each([
    "/admin",
    "/account/profile",
    "/checkout",
    "/checkouts/123",
    "/orders/123",
    "/cart",
    "/fr/account",
    "/EN-ca/cart/",
    "/%61ccount",
    "/fr/%61ccount",
    "/%EF%BC%A1ccount",
  ])("rejects a sensitive first effective segment: %s", (pathname) => {
    const decision = checkPublicPath(pathname);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("sensitive_path");
  });

  it("does not treat a sensitive-looking product handle as a protected route", () => {
    expect(checkPublicPath("/products/account")).toEqual({
      ok: true,
      normalizedPathname: "/products/account",
      effectiveSegments: ["products", "account"],
    });
    expect(isPublicPath("/collections/cart")).toBe(true);
  });

  it.each([
    "account",
    "/bad%escape",
    "/%c0%afaccount",
    "/fr%2faccount",
    "/fr%5caccount",
    "/%2561ccount",
    "/products/%2e%2e/account",
    "/products\\account",
    `/${"a".repeat(8_192)}`,
  ])("fails closed for an invalid or ambiguous path: %s", (pathname) => {
    expect(checkPublicPath(pathname)).toEqual({ ok: false, reason: "invalid_path" });
  });

  it("allows the public root and removes query or fragment before evaluation", () => {
    expect(checkPublicPath("/?next=/account")).toEqual({
      ok: true,
      normalizedPathname: "/",
      effectiveSegments: [],
    });
    expect(checkPublicPath("/products/widget#account")).toMatchObject({ ok: true });
  });
});
