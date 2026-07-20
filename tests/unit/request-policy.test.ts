import { describe, expect, it, vi } from "vitest";

import {
  ENDPOINT_RESPONSE_LIMITS,
  RequestPolicyInputError,
  buildEndpointRequest,
  endpointUrl,
  executeEndpointRequest,
  validateEndpointResponse,
  type EndpointRequest,
  type FetchLike,
} from "../../src/core/network/request-policy";

const session = { origin: "https://store.example" } as const;

describe("RequestPolicy endpoint construction", () => {
  it("constructs every URL from ScanSession.origin and fixed endpoint fields", () => {
    expect(endpointUrl(session, { kind: "meta" })).toBe(
      "https://store.example/meta.json",
    );
    expect(
      endpointUrl(session, { kind: "products-page", page: 2, limit: 250 }),
    ).toBe("https://store.example/products.json?page=2&limit=250");
    expect(
      endpointUrl(session, {
        kind: "collection-products-json",
        handle: "summer-sale",
        page: 3,
        limit: 50,
      }),
    ).toBe(
      "https://store.example/collections/summer-sale/products.json?limit=50&page=3",
    );
    expect(
      endpointUrl(session, { kind: "cart-context" }, { routeRoot: "/fr/" }),
    ).toBe("https://store.example/fr/cart.js");
    expect(
      endpointUrl(
        session,
        { kind: "product-ajax-js", handle: "m0-alpha" },
        { routeRoot: "/en-ca/" },
      ),
    ).toBe("https://store.example/en-ca/products/m0-alpha.js");
    expect(
      endpointUrl(
        session,
        {
          kind: "collection-html",
          handle: "all",
          sortBy: "best-selling",
          page: 2,
        },
        { routeRoot: "/fr/" },
      ),
    ).toBe(
      "https://store.example/fr/collections/all?sort_by=best-selling&page=2",
    );
    expect(endpointUrl(session, { kind: "sitemap" })).toBe(
      "https://store.example/sitemap.xml",
    );
    expect(endpointUrl(session, { kind: "sitemap", index: 7 })).toBe(
      "https://store.example/sitemap_products_7.xml",
    );
    expect(
      endpointUrl(session, {
        kind: "sitemap",
        index: 1,
        from: "1431756177526",
        to: "9399090577627",
      }),
    ).toBe(
      "https://store.example/sitemap_products_1.xml?from=1431756177526&to=9399090577627",
    );
    expect(
      endpointUrl(
        session,
        { kind: "page-html", target: "route-root" },
        { routeRoot: "/fr/" },
      ),
    ).toBe("https://store.example/fr/");
    expect(endpointUrl(session, { kind: "page-html", target: "password" })).toBe(
      "https://store.example/password",
    );
  });

  it("fixes credentials, redirect mode, method and response budgets", () => {
    const jsonRequest = buildEndpointRequest(session, { kind: "cart-context" });
    expect(jsonRequest.init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(jsonRequest.init.headers.Accept).toContain("application/json");
    expect(jsonRequest.expectedFormat).toBe("json");
    expect(jsonRequest.maxBytes).toBe(ENDPOINT_RESPONSE_LIMITS.json);

    const htmlRequest = buildEndpointRequest(session, {
      kind: "page-html",
      target: "route-root",
    });
    expect(htmlRequest.expectedFormat).toBe("html");
    expect(htmlRequest.maxBytes).toBe(ENDPOINT_RESPONSE_LIMITS.html);
    expect(Object.isFrozen(htmlRequest)).toBe(true);
    expect(Object.isFrozen(htmlRequest.init)).toBe(true);
  });

  it.each([
    [{ origin: "javascript:alert(1)" }, { kind: "meta" }],
    [{ origin: "https://user:secret@store.example" }, { kind: "meta" }],
    [{ origin: "https://store.example/account" }, { kind: "meta" }],
  ] as const)("rejects an invalid session origin", (invalidSession, request) => {
    expect(() => buildEndpointRequest(invalidSession, request)).toThrow(
      RequestPolicyInputError,
    );
  });

  it.each([
    "//evil.example/",
    "/../",
    "/%2e%2e/",
    "/%252e%252e/",
    "/fr//",
    "/fr/?x=1",
    "/admin/",
    "/anything/goes/",
    "/EN/",
  ])(
    "rejects unsafe or non-canonical routeRoot %s",
    (routeRoot) => {
      expect(() =>
        buildEndpointRequest(session, { kind: "cart-context" }, { routeRoot }),
      ).toThrow(RequestPolicyInputError);
    },
  );

  it.each([".", "..", "../admin", "a/b", "a\\b", " bad", "bad\u0000"])(
    "rejects unsafe handle %j",
    (handle) => {
      expect(() =>
        buildEndpointRequest(session, { kind: "product-ajax-js", handle }),
      ).toThrow(RequestPolicyInputError);
    },
  );

  it("rejects routeRoot on endpoint kinds that never consume it", () => {
    expect(() =>
      buildEndpointRequest(
        session,
        { kind: "products-page", page: 1, limit: 10 },
        { routeRoot: "/fr/" },
      ),
    ).toThrow(RequestPolicyInputError);
  });

  it.each([
    { kind: "products-page", page: 0, limit: 50 },
    { kind: "products-page", page: 1, limit: 251 },
    { kind: "products-page", page: 1.5, limit: 50 },
    { kind: "sitemap", index: -1 },
    { kind: "sitemap", from: "1", to: "2" },
    { kind: "sitemap", index: 1, from: "1" },
    { kind: "sitemap", index: 1, from: "2", to: "1" },
    { kind: "sitemap", index: 1, from: "1&evil=1", to: "2" },
  ] as EndpointRequest[])("rejects invalid numeric endpoint fields", (request) => {
    expect(() => buildEndpointRequest(session, request)).toThrow(
      RequestPolicyInputError,
    );
  });
});

describe("RequestPolicy execution", () => {
  it("dispatches one fixed request through an injected fetch and returns serializable data", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ input: String(input), init });
      return responseWithUrl(
        {
          currency: "USD",
          token: "must-not-escape",
          items: [{ private: "discarded" }],
        },
        "https://store.example/fr/cart.js",
      );
    };

    const result = await executeEndpointRequest(
      session,
      { kind: "cart-context" },
      { routeRoot: "/fr/", fetchImpl },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://store.example/fr/cart.js");
    expect(calls[0]?.init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(result).toMatchObject({ ok: true, data: { currency: "USD" } });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("supports passing fetchImpl directly", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      responseWithUrl({ name: "fixture" }, "https://store.example/meta.json"),
    );
    const result = await executeEndpointRequest(session, { kind: "meta" }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });

  it("requires a recognizable meta identity and returns only the bounded allowlist", async () => {
    const accepted = await executeEndpointRequest(
      session,
      { kind: "meta" },
      async () =>
        responseWithUrl(
          {
            name: "Fixture",
            domain: "store.example",
            myshopify_domain: "fixture.myshopify.com",
            currency: "USD",
            primary_locale: "en",
            customer_email: "must-not-escape@example.test",
          },
          "https://store.example/meta.json",
        ),
    );
    expect(accepted).toMatchObject({
      ok: true,
      data: {
        name: "Fixture",
        domain: "store.example",
        myshopify_domain: "fixture.myshopify.com",
        currency: "USD",
        primary_locale: "en",
      },
    });
    if (accepted.ok) {
      expect(accepted.data).not.toHaveProperty("customer_email");
    }

    const rejected = await executeEndpointRequest(
      session,
      { kind: "meta" },
      async () =>
        responseWithUrl(
          { arbitrary: true },
          "https://store.example/meta.json",
        ),
    );
    expect(rejected).toMatchObject({
      ok: false,
      category: "schema_invalid",
      message: "invalid_meta_identity",
    });
  });

  it("never follows or retries a visible redirect response", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      responseWithUrl("redirect", "https://store.example/cart.js", {
        status: 302,
        contentType: "text/plain",
      }),
    );
    const result = await executeEndpointRequest(
      session,
      { kind: "cart-context" },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: false,
      category: "redirect_blocked",
      redirectDetection: "response",
    });
  });

  it("rejects a cross-origin or redirected response without a second request", async () => {
    const crossOriginFetch = vi.fn<FetchLike>(async () =>
      responseWithUrl({ currency: "USD" }, "https://evil.example/cart.js"),
    );
    const crossOrigin = await executeEndpointRequest(
      session,
      { kind: "cart-context" },
      crossOriginFetch,
    );
    expect(crossOriginFetch).toHaveBeenCalledOnce();
    expect(crossOrigin).toMatchObject({
      ok: false,
      category: "redirect_blocked",
      message: "response_origin_mismatch",
    });

    const redirectedFetch = vi.fn<FetchLike>(async () => {
      const response = responseWithUrl(
        { currency: "USD" },
        "https://store.example/cart.js",
      );
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    });
    const redirected = await executeEndpointRequest(
      session,
      { kind: "cart-context" },
      redirectedFetch,
    );
    expect(redirectedFetch).toHaveBeenCalledOnce();
    expect(redirected).toMatchObject({
      ok: false,
      category: "redirect_blocked",
      message: "redirected_response_blocked",
    });
  });

  it("reports an opaque fetch failure without attempting to infer or follow Location", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await executeEndpointRequest(
      session,
      { kind: "cart-context" },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: false,
      category: "network",
      redirectDetection: "unavailable",
    });
  });

  it("enforces the request timeout", async () => {
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    const result = await executeEndpointRequest(
      session,
      { kind: "cart-context" },
      { fetchImpl, timeoutMs: 5 },
    );
    expect(result).toMatchObject({ ok: false, category: "timeout" });
  });

  it("classifies an external Service Worker cancellation as aborted", async () => {
    const controller = new AbortController();
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    const pending = executeEndpointRequest(
      session,
      { kind: "cart-context" },
      { fetchImpl, signal: controller.signal, timeoutMs: 10_000 },
    );
    controller.abort(new DOMException("user cancelled", "AbortError"));

    await expect(pending).resolves.toMatchObject({
      ok: false,
      category: "aborted",
      message: "request_aborted",
    });
  });
});

describe("RequestPolicy response validation", () => {
  it("classifies 429 and parses Retry-After without reading a body", async () => {
    const response = responseWithUrl(
      { error: "rate_limited" },
      "https://store.example/products.json?page=1&limit=50",
      { status: 429, headers: { "Retry-After": "3" } },
    );
    const result = await validateEndpointResponse(
      { kind: "products-page", page: 1, limit: 50 },
      response,
      { requestUrl: "https://store.example/products.json?page=1&limit=50" },
    );
    expect(result).toMatchObject({
      ok: false,
      category: "rate_limited",
      retryAfterSeconds: 3,
    });
  });

  it("classifies 430 as terminal security rejection", async () => {
    const response = responseWithUrl(
      { error: "security_rejected" },
      "https://store.example/products.json?page=1&limit=50",
      { status: 430 },
    );
    const result = await validateEndpointResponse(
      { kind: "products-page", page: 1, limit: 50 },
      response,
      { requestUrl: "https://store.example/products.json?page=1&limit=50" },
    );
    expect(result).toMatchObject({ ok: false, category: "security_rejected" });
  });

  it("rejects HTML masquerading as JSON", async () => {
    const response = responseWithUrl(
      "<!doctype html><h1>Not JSON</h1>",
      "https://store.example/products.json?page=1&limit=50",
      { contentType: "text/html" },
    );
    const result = await validateEndpointResponse(
      { kind: "products-page", page: 1, limit: 50 },
      response,
      { requestUrl: "https://store.example/products.json?page=1&limit=50" },
    );
    expect(result).toMatchObject({ ok: false, category: "not_json" });
  });

  it("accepts JSON from Shopify Ajax .js endpoints with text/javascript", async () => {
    const request = { kind: "cart-context" } as const;
    const requestUrl = endpointUrl(session, request);
    const result = await validateEndpointResponse(
      request,
      responseWithUrl(
        { currency: "USD", items: [{ id: 1 }], token: "discard-me" },
        requestUrl,
        { contentType: "text/javascript; charset=utf-8" },
      ),
      { requestUrl },
    );

    expect(result).toMatchObject({
      ok: true,
      contentType: "text/javascript",
      data: { currency: "USD" },
    });
    if (result.ok) {
      expect(result.data).toEqual({ currency: "USD" });
    }
  });

  it("does not allow text/javascript for products.json", async () => {
    const request = { kind: "products-page", page: 1, limit: 3 } as const;
    const requestUrl = endpointUrl(session, request);
    const result = await validateEndpointResponse(
      request,
      responseWithUrl({ products: [] }, requestUrl, {
        contentType: "text/javascript; charset=utf-8",
      }),
      { requestUrl },
    );

    expect(result).toMatchObject({ ok: false, category: "not_json" });
  });

  it.each([
    [
      '<form action="/password"><input name="password"></form>',
      "https://store.example/products.json?page=1&limit=50",
      "password_page",
    ],
    [
      '<form id="challenge-form"><h1>Checking your browser</h1></form>',
      "https://store.example/products.json?page=1&limit=50",
      "challenge_page",
    ],
  ])("detects terminal special pages", async (body, url, category) => {
    const response = responseWithUrl(body, url, { contentType: "text/html" });
    const result = await validateEndpointResponse(
      { kind: "products-page", page: 1, limit: 50 },
      response,
      { requestUrl: "https://store.example/products.json?page=1&limit=50" },
    );
    expect(result).toMatchObject({ ok: false, category });
  });

  it("stops at the byte limit", async () => {
    const response = responseWithUrl(
      { products: [] },
      "https://store.example/products.json?page=1&limit=50",
      { headers: { "Content-Length": "1000" } },
    );
    const result = await validateEndpointResponse(
      { kind: "products-page", page: 1, limit: 50 },
      response,
      {
        requestUrl: "https://store.example/products.json?page=1&limit=50",
        maxBytes: 10,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      category: "too_large",
      byteLength: 1000,
    });
  });

  it.each([
    [
      { kind: "products-page", page: 1, limit: 50 } as EndpointRequest,
      { products: "bad" },
      "invalid_products_envelope",
    ],
    [
      { kind: "cart-context" } as EndpointRequest,
      { currency: "usd" },
      "invalid_cart_context_schema",
    ],
    [
      { kind: "product-ajax-js", handle: "m0-alpha" } as EndpointRequest,
      { id: 1, handle: "m0-alpha" },
      "invalid_product_ajax_schema",
    ],
  ])("rejects invalid JSON schema", async (request, body, message) => {
    const requestUrl = endpointUrl(session, request);
    const result = await validateEndpointResponse(
      request,
      responseWithUrl(body, requestUrl),
      { requestUrl },
    );
    expect(result).toMatchObject({ ok: false, category: "schema_invalid", message });
  });

  it("accepts basic product, HTML and sitemap schemas", async () => {
    const productRequest = {
      kind: "product-ajax-js",
      handle: "m0-alpha",
    } as const;
    const productUrl = endpointUrl(session, productRequest);
    const product = await validateEndpointResponse(
      productRequest,
      responseWithUrl(
        { id: 1, handle: "m0-alpha", variants: [{ id: 2 }] },
        productUrl,
      ),
      { requestUrl: productUrl },
    );
    expect(product.ok).toBe(true);

    const pageRequest = { kind: "page-html", target: "route-root" } as const;
    const pageUrl = endpointUrl(session, pageRequest);
    const page = await validateEndpointResponse(
      pageRequest,
      responseWithUrl("<!doctype html><main>Store</main>", pageUrl, {
        contentType: "text/html",
      }),
      { requestUrl: pageUrl },
    );
    expect(page.ok).toBe(true);

    const sitemapRequest = { kind: "sitemap" } as const;
    const sitemapUrl = endpointUrl(session, sitemapRequest);
    const sitemap = await validateEndpointResponse(
      sitemapRequest,
      responseWithUrl("<?xml version=\"1.0\"?><urlset></urlset>", sitemapUrl, {
        contentType: "application/xml",
      }),
      { requestUrl: sitemapUrl },
    );
    expect(sitemap.ok).toBe(true);
  });
});

type ResponseFixtureOptions = {
  status?: number;
  contentType?: string;
  headers?: Record<string, string>;
};

function responseWithUrl(
  value: unknown,
  url: string,
  options: ResponseFixtureOptions = {},
): Response {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", options.contentType ?? "application/json");
  }
  const body =
    typeof value === "string" ? value : JSON.stringify(value);
  const response = new Response(body, {
    status: options.status ?? 200,
    headers,
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
