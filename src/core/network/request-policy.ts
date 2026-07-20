/**
 * M0 RequestPolicy spike.
 *
 * Security boundary: callers select a typed endpoint, but never provide a URL,
 * fetch options, headers, credentials mode, or redirect mode. Every core URL is
 * derived from the ScanSession origin and is checked again before dispatch.
 */

export type RequestPolicySession = Readonly<{ origin: string }>;

export type EndpointRequest =
  | { kind: "meta" }
  | { kind: "products-page"; page: number; limit: number }
  | {
      kind: "collection-products-json";
      handle: string;
      page: number;
      limit?: number;
    }
  | { kind: "cart-context" }
  | { kind: "product-ajax-js"; handle: string }
  | {
      kind: "collection-html";
      handle: string;
      sortBy: "best-selling" | "created-descending";
      page?: number;
    }
  | {
      kind: "sitemap";
      index?: number;
      from?: string;
      to?: string;
    }
  | { kind: "page-html"; target: "route-root" | "password" };

export type EndpointKind = EndpointRequest["kind"];
export type EndpointBodyFormat = "json" | "html" | "xml";

export const ENDPOINT_RESPONSE_LIMITS = Object.freeze({
  json: 10 * 1024 * 1024,
  html: 5 * 1024 * 1024,
  xml: 10 * 1024 * 1024,
});

export const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

export type FixedEndpointRequestInit = Readonly<{
  method: "GET";
  credentials: "omit";
  redirect: "error";
  cache: "no-store";
  referrerPolicy: "no-referrer";
  headers: Readonly<Record<string, string>>;
}>;

export type PreparedEndpointRequest = Readonly<{
  kind: EndpointKind;
  url: string;
  init: FixedEndpointRequestInit;
  expectedFormat: EndpointBodyFormat;
  maxBytes: number;
}>;

export type EndpointFailureCategory =
  | "network"
  | "timeout"
  | "http_5xx"
  | "rate_limited"
  | "security_rejected"
  | "forbidden"
  | "not_found"
  | "redirect_blocked"
  | "password_page"
  | "challenge_page"
  | "not_json"
  | "unexpected_content_type"
  | "schema_invalid"
  | "too_large"
  | "aborted"
  | "internal";

type EndpointResultBase = {
  kind: EndpointKind;
  requestUrl: string;
};

export type EndpointSuccess<T = unknown> = EndpointResultBase & {
  ok: true;
  responseUrl: string;
  status: number;
  contentType: string;
  byteLength: number;
  data: T;
};

export type EndpointFailure = EndpointResultBase & {
  ok: false;
  category: EndpointFailureCategory;
  message: string;
  status?: number;
  responseUrl?: string;
  contentType?: string;
  byteLength?: number;
  retryAfterSeconds?: number;
  redirectDetection?: "response" | "unavailable";
};

export type EndpointExecutionResult<T = unknown> =
  | EndpointSuccess<T>
  | EndpointFailure;

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type BuildEndpointOptions = Readonly<{
  routeRoot?: string;
}>;

export type ValidateEndpointOptions = Readonly<{
  requestUrl: string;
  maxBytes?: number;
}>;

export type ExecuteEndpointOptions = BuildEndpointOptions &
  Readonly<{
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    signal?: AbortSignal;
    maxBytes?: number;
  }>;

const JSON_ACCEPT = "application/json, application/*+json;q=0.9";
const HTML_ACCEPT = "text/html, application/xhtml+xml;q=0.9";
const XML_ACCEPT = "application/xml, text/xml;q=0.9";
const MAX_ROUTE_ROOT_LENGTH = 256;
const MAX_HANDLE_LENGTH = 255;
const LOCALE_ROUTE_ROOT = /^\/[a-z]{2,3}(?:-(?:[a-z]{2}|[0-9]{3}))?\/$/u;

/** Build a complete, immutable request from a session origin and endpoint enum. */
export function buildEndpointRequest(
  session: RequestPolicySession,
  request: EndpointRequest,
  options: BuildEndpointOptions = {},
): PreparedEndpointRequest {
  const origin = normalizeSessionOrigin(session.origin);
  const usesRouteRoot = endpointUsesRouteRoot(request);
  if (!usesRouteRoot && options.routeRoot !== undefined) {
    throw new RequestPolicyInputError("unexpected_route_root");
  }
  const routeRoot = usesRouteRoot
    ? normalizeRouteRoot(options.routeRoot ?? "/")
    : "/";
  const url = buildEndpointUrl(origin, routeRoot, request);

  if (url.origin !== origin) {
    throw new RequestPolicyInputError("endpoint_origin_mismatch");
  }
  if (url.username !== "" || url.password !== "") {
    throw new RequestPolicyInputError("endpoint_credentials_not_allowed");
  }

  const expectedFormat = expectedFormatFor(request);
  const accept =
    expectedFormat === "json"
      ? JSON_ACCEPT
      : expectedFormat === "html"
        ? HTML_ACCEPT
        : XML_ACCEPT;

  return Object.freeze({
    kind: request.kind,
    url: url.href,
    init: Object.freeze({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: Object.freeze({ Accept: accept }),
    }),
    expectedFormat,
    maxBytes: ENDPOINT_RESPONSE_LIMITS[expectedFormat],
  });
}

/** Convenience helper for tests and call sites that only need the safe URL. */
export function endpointUrl(
  session: RequestPolicySession,
  request: EndpointRequest,
  options: BuildEndpointOptions = {},
): string {
  return buildEndpointRequest(session, request, options).url;
}

/**
 * Execute exactly one fetch. The injected fetch implementation is useful both
 * for unit tests and for selecting the M0 SW/Collector transport adapter. The
 * policy never retries or follows a Location header itself.
 */
export async function executeEndpointRequest(
  session: RequestPolicySession,
  request: EndpointRequest,
  optionsOrFetch: ExecuteEndpointOptions | FetchLike = {},
): Promise<EndpointExecutionResult> {
  const options: ExecuteEndpointOptions =
    typeof optionsOrFetch === "function"
      ? { fetchImpl: optionsOrFetch }
      : optionsOrFetch;
  const prepared = buildEndpointRequest(session, request, options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  validatePositiveInteger(timeoutMs, "timeoutMs", 300_000);
  if (options.maxBytes !== undefined) {
    validatePositiveInteger(options.maxBytes, "maxBytes", 100 * 1024 * 1024);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);

  const externalSignal = options.signal;
  const abortFromExternal = (): void => {
    controller.abort(externalSignal?.reason);
  };
  if (externalSignal?.aborted === true) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  try {
    if (controller.signal.aborted) {
      return failure(prepared, timedOut ? "timeout" : "aborted", {
        message: timedOut ? "request_timeout" : "request_aborted",
      });
    }
    const response = await fetchImpl(prepared.url, {
      ...prepared.init,
      headers: { ...prepared.init.headers },
      signal: controller.signal,
    });
    return await validateEndpointResponse(request, response, {
      requestUrl: prepared.url,
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    });
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      return failure(prepared, timedOut ? "timeout" : "aborted", {
        message: timedOut ? "request_timeout" : "request_aborted",
      });
    }

    // With redirect:"error", Chromium commonly exposes a blocked redirect as
    // an indistinguishable TypeError. Never infer a Location or issue a retry.
    return failure(prepared, "network", {
      message: safeErrorMessage(error),
      redirectDetection: "unavailable",
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

/** Validate status, redirect invariants, size, MIME type and basic schema. */
export async function validateEndpointResponse(
  request: EndpointRequest,
  response: Response,
  options: ValidateEndpointOptions,
): Promise<EndpointExecutionResult> {
  const expectedFormat = expectedFormatFor(request);
  const requestUrl = new URL(options.requestUrl);
  const responseUrl = response.url === "" ? requestUrl.href : response.url;
  const base: PreparedEndpointRequest = {
    kind: request.kind,
    url: requestUrl.href,
    init: {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: {},
    },
    expectedFormat,
    maxBytes: options.maxBytes ?? ENDPOINT_RESPONSE_LIMITS[expectedFormat],
  };

  if (options.maxBytes !== undefined) {
    validatePositiveInteger(options.maxBytes, "maxBytes", 100 * 1024 * 1024);
  }

  if (response.status >= 300 && response.status < 400) {
    return failure(base, "redirect_blocked", {
      message: "redirect_response_blocked",
      status: response.status,
      responseUrl,
      redirectDetection: "response",
    });
  }

  let parsedResponseUrl: URL;
  try {
    parsedResponseUrl = new URL(responseUrl);
  } catch {
    return failure(base, "internal", {
      message: "invalid_response_url",
      status: response.status,
    });
  }

  if (
    response.redirected ||
    parsedResponseUrl.origin !== requestUrl.origin ||
    parsedResponseUrl.href !== requestUrl.href
  ) {
    return failure(base, "redirect_blocked", {
      message: response.redirected
        ? "redirected_response_blocked"
        : parsedResponseUrl.origin !== requestUrl.origin
          ? "response_origin_mismatch"
          : "response_url_mismatch",
      status: response.status,
      responseUrl,
      redirectDetection: "response",
    });
  }

  const statusFailure = classifyHttpStatus(response.status);
  if (statusFailure !== null) {
    return failure(base, statusFailure.category, {
      message: statusFailure.message,
      status: response.status,
      responseUrl,
      ...retryAfterFields(response),
    });
  }

  const contentType = normalizeContentType(response.headers.get("content-type"));
  const body = await readBodyWithinLimit(response, base.maxBytes);
  if (!body.ok) {
    return failure(base, "too_large", {
      message: "response_body_too_large",
      status: response.status,
      responseUrl,
      contentType,
      byteLength: body.byteLength,
    });
  }

  const specialPage = detectSpecialPage(body.text, parsedResponseUrl);
  if (specialPage !== null) {
    return failure(base, specialPage, {
      message: specialPage,
      status: response.status,
      responseUrl,
      contentType,
      byteLength: body.byteLength,
    });
  }

  if (!contentTypeMatches(request, expectedFormat, contentType)) {
    return failure(
      base,
      expectedFormat === "json" ? "not_json" : "unexpected_content_type",
      {
        message: `expected_${expectedFormat}_content_type`,
        status: response.status,
        responseUrl,
        contentType,
        byteLength: body.byteLength,
      },
    );
  }

  const parsed = parseAndValidateBody(request, expectedFormat, body.text);
  if (!parsed.ok) {
    return failure(base, "schema_invalid", {
      message: parsed.message,
      status: response.status,
      responseUrl,
      contentType,
      byteLength: body.byteLength,
    });
  }

  return {
    ok: true,
    kind: request.kind,
    requestUrl: requestUrl.href,
    responseUrl,
    status: response.status,
    contentType,
    byteLength: body.byteLength,
    data: parsed.data,
  };
}

export class RequestPolicyInputError extends Error {
  override readonly name = "RequestPolicyInputError";
}

function normalizeSessionOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RequestPolicyInputError("invalid_session_origin");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RequestPolicyInputError("unsupported_session_origin_scheme");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new RequestPolicyInputError("session_origin_credentials_not_allowed");
  }
  if (
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new RequestPolicyInputError("session_origin_must_not_include_path");
  }
  return parsed.origin;
}

function normalizeRouteRoot(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_ROUTE_ROOT_LENGTH ||
    !value.startsWith("/") ||
    !value.endsWith("/") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\") ||
    value.startsWith("//")
  ) {
    throw new RequestPolicyInputError("invalid_route_root");
  }

  // A storefront route root is either "/" or exactly one locale segment.
  // This keeps a page-owned global or panel message from widening the fixed
  // endpoint set into an arbitrary path-prefix capability.
  if (value !== "/" && !LOCALE_ROUTE_ROOT.test(value)) {
    throw new RequestPolicyInputError("unsupported_route_root");
  }

  const segments = value.split("/").filter((segment) => segment !== "");
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new RequestPolicyInputError("invalid_route_root_encoding");
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      containsControlCharacter(decoded)
    ) {
      throw new RequestPolicyInputError("unsafe_route_root_segment");
    }
  }

  // URL normalization must not silently rewrite dot segments or encoded paths.
  const canonical = `/${segments.join("/")}${segments.length === 0 ? "" : "/"}`;
  if (canonical !== value) {
    throw new RequestPolicyInputError("route_root_must_be_canonical");
  }
  return canonical;
}

export function isAllowedRouteRoot(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_ROUTE_ROOT_LENGTH) {
    return false;
  }
  return value === "/" || LOCALE_ROUTE_ROOT.test(value);
}

function endpointUsesRouteRoot(request: EndpointRequest): boolean {
  return (
    request.kind === "cart-context" ||
    request.kind === "product-ajax-js" ||
    request.kind === "collection-html" ||
    (request.kind === "page-html" && request.target === "route-root")
  );
}

function buildEndpointUrl(
  origin: string,
  routeRoot: string,
  request: EndpointRequest,
): URL {
  let pathname: string;
  const params = new URLSearchParams();

  switch (request.kind) {
    case "meta":
      pathname = "/meta.json";
      break;
    case "products-page":
      validatePositiveInteger(request.page, "page", 100_000);
      validatePositiveInteger(request.limit, "limit", 250);
      pathname = "/products.json";
      params.set("page", String(request.page));
      params.set("limit", String(request.limit));
      break;
    case "collection-products-json":
      validatePositiveInteger(request.page, "page", 100_000);
      if (request.limit !== undefined) {
        validatePositiveInteger(request.limit, "limit", 250);
        params.set("limit", String(request.limit));
      }
      pathname = `/collections/${encodeHandle(request.handle)}/products.json`;
      params.set("page", String(request.page));
      break;
    case "cart-context":
      pathname = `${routeRoot}cart.js`;
      break;
    case "product-ajax-js":
      pathname = `${routeRoot}products/${encodeHandle(request.handle)}.js`;
      break;
    case "collection-html":
      pathname = `${routeRoot}collections/${encodeHandle(request.handle)}`;
      params.set("sort_by", request.sortBy);
      if (request.page !== undefined) {
        validatePositiveInteger(request.page, "page", 100_000);
        params.set("page", String(request.page));
      }
      break;
    case "sitemap":
      if (request.index === undefined) {
        if (request.from !== undefined || request.to !== undefined) {
          throw new RequestPolicyInputError("sitemap_bounds_require_index");
        }
        pathname = "/sitemap.xml";
      } else {
        validatePositiveInteger(request.index, "index", 100_000);
        if ((request.from === undefined) !== (request.to === undefined)) {
          throw new RequestPolicyInputError("incomplete_sitemap_bounds");
        }
        if (request.from !== undefined && request.to !== undefined) {
          validateSitemapBound(request.from, "from");
          validateSitemapBound(request.to, "to");
          if (BigInt(request.from) > BigInt(request.to)) {
            throw new RequestPolicyInputError("invalid_sitemap_bound_order");
          }
          params.set("from", request.from);
          params.set("to", request.to);
        }
        pathname = `/sitemap_products_${request.index}.xml`;
      }
      break;
    case "page-html":
      pathname = request.target === "route-root" ? routeRoot : "/password";
      break;
  }

  const url = new URL(pathname, `${origin}/`);
  url.search = params.toString();
  return url;
}

function encodeHandle(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_HANDLE_LENGTH ||
    value === "." ||
    value === ".." ||
    value.trim() !== value ||
    value.includes("/") ||
    value.includes("\\") ||
    containsControlCharacter(value)
  ) {
    throw new RequestPolicyInputError("invalid_handle");
  }
  return encodeURIComponent(value);
}

function containsControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function validatePositiveInteger(
  value: number,
  field: string,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RequestPolicyInputError(`invalid_${field}`);
  }
}

function validateSitemapBound(value: string, field: "from" | "to"): void {
  if (!/^(?:0|[1-9]\d{0,19})$/u.test(value)) {
    throw new RequestPolicyInputError(`invalid_sitemap_${field}`);
  }
}

function expectedFormatFor(request: EndpointRequest): EndpointBodyFormat {
  switch (request.kind) {
    case "meta":
    case "products-page":
    case "collection-products-json":
    case "cart-context":
    case "product-ajax-js":
      return "json";
    case "collection-html":
    case "page-html":
      return "html";
    case "sitemap":
      return "xml";
  }
}

function classifyHttpStatus(
  status: number,
): { category: EndpointFailureCategory; message: string } | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429) {
    return { category: "rate_limited", message: "http_429" };
  }
  if (status === 430) {
    return { category: "security_rejected", message: "http_430" };
  }
  if (status === 401 || status === 403) {
    return { category: "forbidden", message: `http_${status}` };
  }
  if (status === 404) {
    return { category: "not_found", message: "http_404" };
  }
  if (status >= 500 && status < 600) {
    return { category: "http_5xx", message: `http_${status}` };
  }
  return { category: "network", message: `http_${status}` };
}

function retryAfterFields(response: Response): { retryAfterSeconds?: number } {
  if (response.status !== 429) return {};
  const value = response.headers.get("retry-after");
  if (value === null) return {};

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return { retryAfterSeconds: seconds };
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) return {};
  return { retryAfterSeconds: Math.max(0, Math.ceil((date - Date.now()) / 1_000)) };
}

function normalizeContentType(value: string | null): string {
  return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function contentTypeMatches(
  request: EndpointRequest,
  expected: EndpointBodyFormat,
  contentType: string,
): boolean {
  if (expected === "json") {
    return (
      contentType === "application/json" ||
      (contentType.startsWith("application/") && contentType.endsWith("+json")) ||
      // Shopify's legacy Ajax `.js` endpoints can return a JSON body as
      // `text/javascript`. Keep this compatibility exception endpoint-scoped;
      // JSON endpoints such as products.json still require a JSON MIME type.
      ((request.kind === "cart-context" ||
        request.kind === "product-ajax-js") &&
        contentType === "text/javascript")
    );
  }
  if (expected === "html") {
    return contentType === "text/html" || contentType === "application/xhtml+xml";
  }
  return (
    contentType === "application/xml" ||
    contentType === "text/xml" ||
    contentType === "application/rss+xml" ||
    contentType === "application/sitemap+xml"
  );
}

type ReadBodyResult =
  | { ok: true; text: string; byteLength: number }
  | { ok: false; byteLength: number };

async function readBodyWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<ReadBodyResult> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      void response.body?.cancel("response_body_too_large").catch(() => undefined);
      return { ok: false, byteLength: declaredBytes };
    }
  }

  if (response.body === null) {
    return { ok: true, text: "", byteLength: 0 };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("response_body_too_large").catch(() => undefined);
        return { ok: false, byteLength };
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    ok: true,
    text: new TextDecoder().decode(combined),
    byteLength,
  };
}

function detectSpecialPage(
  text: string,
  responseUrl: URL,
): "password_page" | "challenge_page" | null {
  const pathSegments = responseUrl.pathname.toLowerCase().split("/");
  const lower = text.slice(0, 512 * 1024).toLowerCase();

  if (
    pathSegments.includes("password") ||
    /<form[^>]+(?:action=["'][^"']*\/password|id=["'][^"']*storefront-password)/u.test(
      lower,
    ) ||
    lower.includes("shopify-section-main-password") ||
    lower.includes("storefront_password")
  ) {
    return "password_page";
  }

  if (
    lower.includes("checking your browser") ||
    lower.includes("cf-chl-") ||
    lower.includes("/cdn-cgi/challenge-platform") ||
    lower.includes("challenges.cloudflare.com/turnstile") ||
    lower.includes("hcaptcha.com/1/api.js") ||
    lower.includes("id=\"challenge-form\"") ||
    lower.includes("id='challenge-form'")
  ) {
    return "challenge_page";
  }
  return null;
}

type ParsedBody =
  | { ok: true; data: unknown }
  | { ok: false; message: string };

function parseAndValidateBody(
  request: EndpointRequest,
  format: EndpointBodyFormat,
  text: string,
): ParsedBody {
  if (format === "html") {
    return text.trim() === ""
      ? { ok: false, message: "empty_html" }
      : { ok: true, data: text };
  }
  if (format === "xml") {
    const normalized = text.toLowerCase();
    return normalized.includes("<urlset") || normalized.includes("<sitemapindex")
      ? { ok: true, data: text }
      : { ok: false, message: "invalid_sitemap_schema" };
  }

  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: "invalid_json" };
  }

  switch (request.kind) {
    case "meta":
      return validateMetaEnvelope(data);
    case "cart-context": {
      if (!isRecord(data) || !isIsoCurrency(data.currency)) {
        return { ok: false, message: "invalid_cart_context_schema" };
      }
      // Deliberately discard cart items, token, attributes, note and all other
      // fields at the policy boundary.
      return { ok: true, data: { currency: data.currency } };
    }
    case "products-page":
    case "collection-products-json":
      return validateProductsEnvelope(data);
    case "product-ajax-js":
      if (
        !isRecord(data) ||
        !isScalarId(data.id) ||
        typeof data.handle !== "string" ||
        data.handle.length === 0 ||
        !Array.isArray(data.variants)
      ) {
        return { ok: false, message: "invalid_product_ajax_schema" };
      }
      return { ok: true, data };
    case "collection-html":
    case "sitemap":
    case "page-html":
      return { ok: false, message: "unexpected_parser_state" };
  }
}

function validateMetaEnvelope(data: unknown): ParsedBody {
  if (!isRecord(data)) {
    return { ok: false, message: "invalid_meta_schema" };
  }
  const name = boundedString(data.name, 4_096);
  const domain = boundedString(data.domain, 255);
  const myshopifyDomain = boundedString(data.myshopify_domain, 255);
  if (data.name !== undefined && name === undefined) {
    return { ok: false, message: "invalid_meta_name" };
  }
  if (data.domain !== undefined && domain === undefined) {
    return { ok: false, message: "invalid_meta_domain" };
  }
  if (data.myshopify_domain !== undefined && myshopifyDomain === undefined) {
    return { ok: false, message: "invalid_meta_myshopify_domain" };
  }
  if (name === undefined && domain === undefined && myshopifyDomain === undefined) {
    return { ok: false, message: "invalid_meta_identity" };
  }
  if (data.currency !== undefined && !isIsoCurrency(data.currency)) {
    return { ok: false, message: "invalid_meta_currency" };
  }
  if (data.shop_id !== undefined && !isScalarId(data.shop_id)) {
    return { ok: false, message: "invalid_meta_shop_id" };
  }
  const primaryLocale = boundedString(data.primary_locale, 32);
  if (
    data.primary_locale !== undefined &&
    (primaryLocale === undefined ||
      !/^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$/u.test(primaryLocale))
  ) {
    return { ok: false, message: "invalid_meta_locale" };
  }
  return {
    ok: true,
    data: {
      ...(name === undefined ? {} : { name }),
      ...(domain === undefined ? {} : { domain }),
      ...(myshopifyDomain === undefined
        ? {}
        : { myshopify_domain: myshopifyDomain }),
      ...(data.currency === undefined ? {} : { currency: data.currency }),
      ...(data.shop_id === undefined ? {} : { shop_id: data.shop_id }),
      ...(primaryLocale === undefined ? {} : { primary_locale: primaryLocale }),
    },
  };
}

function validateProductsEnvelope(data: unknown): ParsedBody {
  if (!isRecord(data) || !Array.isArray(data.products)) {
    return { ok: false, message: "invalid_products_envelope" };
  }
  for (const product of data.products) {
    if (
      !isRecord(product) ||
      (!isScalarId(product.id) &&
        !(typeof product.handle === "string" && product.handle.length > 0))
    ) {
      return { ok: false, message: "invalid_product_entry" };
    }
  }
  return { ok: true, data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalarId(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isIsoCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/u.test(value);
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 256);
  return String(error).slice(0, 256);
}

function failure(
  prepared: Pick<PreparedEndpointRequest, "kind" | "url">,
  category: EndpointFailureCategory,
  details: Omit<EndpointFailure, "ok" | "kind" | "requestUrl" | "category">,
): EndpointFailure {
  return {
    ok: false,
    kind: prepared.kind,
    requestUrl: prepared.url,
    category,
    ...details,
  };
}
