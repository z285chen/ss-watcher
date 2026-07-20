import { isAllowedRouteRoot } from "../core/network/request-policy";

export type AuthorizationProbeResult = {
  href: string;
  origin: string;
  pathname: string;
};

export type ShopifyProbeResult = {
  shop?: string;
  locale?: string;
  country?: string;
  currencyActive?: string;
  currencyRate?: number;
  routeRoot?: string;
  themeName?: string;
  themeId?: string | number;
  themeSchemaName?: string;
};

/** Must remain self-contained: Chrome serializes this function for injection. */
export function authorizationProbe(): AuthorizationProbeResult {
  return {
    href: location.href,
    origin: location.origin,
    pathname: location.pathname,
  };
}

/** Must remain self-contained and closure-free for world: "MAIN" injection. */
export function mainWorldShopifyProbe(): ShopifyProbeResult | null {
  try {
    const root = globalThis as typeof globalThis & { Shopify?: unknown };
    const shopify = root.Shopify;
    if (typeof shopify !== "object" || shopify === null) return null;

    const record = shopify as Record<string, unknown>;
    const routes = asRecord(record.routes);
    const currency = asRecord(record.currency);
    const theme = asRecord(record.theme);

    const result: ShopifyProbeResult = {};
    putString(result, "shop", record.shop);
    putString(result, "locale", record.locale);
    putString(result, "country", record.country);
    putString(result, "routeRoot", routes?.root);
    putString(result, "currencyActive", currency?.active);
    putNumber(result, "currencyRate", currency?.rate);
    putString(result, "themeName", theme?.name);
    putStringOrNumber(result, "themeId", theme?.id);
    putString(result, "themeSchemaName", theme?.schema_name);
    return result;
  } catch {
    return null;
  }

  function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  }

  function clipped(value: string): string {
    return value.slice(0, 256);
  }

  function putString(
    target: ShopifyProbeResult,
    key: keyof ShopifyProbeResult,
    value: unknown,
  ): void {
    if (typeof value === "string") {
      (target as Record<string, unknown>)[key] = clipped(value);
    }
  }

  function putNumber(
    target: ShopifyProbeResult,
    key: keyof ShopifyProbeResult,
    value: unknown,
  ): void {
    if (typeof value === "number" && Number.isFinite(value)) {
      (target as Record<string, unknown>)[key] = value;
    }
  }

  function putStringOrNumber(
    target: ShopifyProbeResult,
    key: keyof ShopifyProbeResult,
    value: unknown,
  ): void {
    if (typeof value === "string") {
      (target as Record<string, unknown>)[key] = clipped(value);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

/** Validates the structured-clone payload after it returns from page-owned MAIN. */
export function isShopifyProbeResult(
  value: unknown,
): value is ShopifyProbeResult | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "shop",
    "locale",
    "country",
    "currencyActive",
    "currencyRate",
    "routeRoot",
    "themeName",
    "themeId",
    "themeSchemaName",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return false;

  for (const [key, item] of Object.entries(record)) {
    if (key === "currencyRate") {
      if (typeof item !== "number" || !Number.isFinite(item)) return false;
    } else if (key === "themeId") {
      if (
        !(
          (typeof item === "string" && item.length <= 256) ||
          (typeof item === "number" && Number.isFinite(item))
        )
      ) {
        return false;
      }
    } else if (key === "routeRoot") {
      if (!isAllowedRouteRoot(item)) return false;
    } else if (typeof item !== "string" || item.length > 256) {
      return false;
    }
  }
  return true;
}

export function routeRootFromShopifyProbe(
  value: ShopifyProbeResult | null,
): string {
  return value?.routeRoot ?? "/";
}

export type CollectorProbeResult =
  | { ok: false; reason: "origin_changed" | "path_changed" | "sensitive_path" }
  | {
      ok: true;
      canonical?: string;
      generator?: string;
      scriptUrls: string[];
      linkUrls: string[];
      checkoutUrls: string[];
      jsonLdCount: number;
      pageProducts: CollectorPageProduct[];
      collectionHandles: string[];
    };

export type CollectorPageProductSource = "canonical" | "dom" | "json-ld";

/** Sanitized public product evidence; raw page JSON/HTML never crosses the probe. */
export type CollectorPageProduct = Readonly<{
  canonicalUrl: string;
  title?: string;
  images: string[];
  sources: CollectorPageProductSource[];
}>;

/** Must remain self-contained and closure-free for ISOLATED injection. */
export function collectorProbe(input: {
  expectedOrigin: string;
  expectedPathname: string;
}): CollectorProbeResult {
  if (location.origin !== input.expectedOrigin) {
    return { ok: false, reason: "origin_changed" };
  }
  const path = inspectPath(location.pathname);
  if (!path.ok) {
    return { ok: false, reason: path.reason };
  }
  if (path.normalizedPathname !== input.expectedPathname) {
    return { ok: false, reason: "path_changed" };
  }

  const canonical = cleanPublicUrl(
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
  );
  const generator = document.querySelector<HTMLMetaElement>('meta[name="generator"]')
    ?.content;
  const scriptUrls: string[] = [];
  let scriptUrlBytes = 0;
  const scripts = document.scripts;
  for (let index = 0; index < Math.min(scripts.length, 200); index += 1) {
    const script = scripts[index];
    if (script === undefined) continue;
    const cleaned = cleanPublicUrl(script.src);
    if (cleaned === undefined) continue;
    const bytes = new TextEncoder().encode(cleaned).byteLength;
    if (scriptUrlBytes + bytes > 24 * 1_024 || scriptUrls.length >= 100) break;
    scriptUrls.push(cleaned);
    scriptUrlBytes += bytes;
  }

  const linkUrls: string[] = [];
  let linkUrlBytes = 0;
  const links = document.querySelectorAll<HTMLLinkElement>("link[href]");
  for (let index = 0; index < Math.min(links.length, 200); index += 1) {
    const link = links[index];
    if (link === undefined) continue;
    const cleaned = cleanPublicUrl(link.href);
    if (cleaned === undefined) continue;
    const bytes = new TextEncoder().encode(cleaned).byteLength;
    if (linkUrlBytes + bytes > 24 * 1_024 || linkUrls.length >= 100) break;
    linkUrls.push(cleaned);
    linkUrlBytes += bytes;
  }

  // Checkout hand-offs are useful for distinguishing a Shopify commerce
  // backend from a Shopify-hosted theme. Keep only the narrow public URL
  // signal; never return arbitrary anchors or their query strings.
  const checkoutUrls: string[] = [];
  const collectionHandles = new Set<string>();
  const pageProductMap = new Map<string, CollectorPageProduct>();
  let returnedImageCount = 0;
  let returnedImageBytes = 0;
  const canonicalProductUrl =
    canonical !== undefined && isSameOriginProductUrl(canonical)
      ? canonical
      : undefined;
  if (canonicalProductUrl !== undefined) {
    addPageProduct(canonicalProductUrl, "canonical");
  }
  let checkoutUrlBytes = 0;
  const anchors = document.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (let index = 0; index < Math.min(anchors.length, 500); index += 1) {
    const anchor = anchors[index];
    if (anchor === undefined) continue;
    const cleaned = cleanPublicUrl(anchor.href);
    if (cleaned === undefined) continue;
    if (isShopifyCheckoutUrl(cleaned)) {
      const bytes = new TextEncoder().encode(cleaned).byteLength;
      if (checkoutUrlBytes + bytes <= 8 * 1_024 && checkoutUrls.length < 20) {
        checkoutUrls.push(cleaned);
        checkoutUrlBytes += bytes;
      }
    }
    if (isSameOriginProductUrl(cleaned)) {
      addPageProduct(cleaned, "dom");
    }
    const collectionHandle = sameOriginCollectionHandle(cleaned);
    if (collectionHandle !== undefined && collectionHandles.size < 50) {
      collectionHandles.add(collectionHandle);
    }
  }
  const jsonLdScripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  );
  const jsonLdCount = Math.min(jsonLdScripts.length, 10_000);
  let jsonLdBytes = 0;
  for (let index = 0; index < Math.min(jsonLdScripts.length, 20); index += 1) {
    const script = jsonLdScripts[index];
    if (script === undefined) continue;
    const text = script.textContent ?? "";
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes === 0 || bytes > 64 * 1_024 || jsonLdBytes + bytes > 256 * 1_024) {
      continue;
    }
    jsonLdBytes += bytes;
    try {
      collectJsonLdProducts(JSON.parse(text));
    } catch {
      // Malformed public JSON-LD is a skipped signal, never a probe failure.
    }
  }

  return {
    ok: true,
    ...(canonical ? { canonical } : {}),
    ...(generator ? { generator: generator.slice(0, 256) } : {}),
    scriptUrls,
    linkUrls,
    checkoutUrls,
    jsonLdCount,
    pageProducts: [...pageProductMap.values()],
    collectionHandles: [...collectionHandles],
  };

  function addPageProduct(
    rawUrl: string,
    source: CollectorPageProductSource,
    title?: unknown,
    images: readonly unknown[] = [],
  ): void {
    const canonicalUrl = cleanSameOriginUrl(rawUrl);
    if (canonicalUrl === undefined) return;
    const existing = pageProductMap.get(canonicalUrl);
    if (existing === undefined && pageProductMap.size >= 100) return;

    const acceptedImages = existing === undefined ? [] : [...existing.images];
    for (const rawImage of images.slice(0, 20)) {
      if (returnedImageCount >= 200 || returnedImageBytes >= 128 * 1_024) break;
      const imageUrl = imageUrlFromJsonLd(rawImage);
      if (imageUrl === undefined || acceptedImages.includes(imageUrl)) continue;
      const imageBytes = new TextEncoder().encode(imageUrl).byteLength;
      if (returnedImageBytes + imageBytes > 128 * 1_024) break;
      acceptedImages.push(imageUrl);
      returnedImageCount += 1;
      returnedImageBytes += imageBytes;
    }

    const normalizedTitle =
      typeof title === "string" && title.trim().length > 0
        ? title.trim().slice(0, 512)
        : undefined;
    pageProductMap.set(canonicalUrl, {
      canonicalUrl,
      ...(existing?.title !== undefined
        ? { title: existing.title }
        : normalizedTitle === undefined
          ? {}
          : { title: normalizedTitle }),
      images: acceptedImages,
      sources: uniqueSources([...(existing?.sources ?? []), source]),
    });
  }

  function collectJsonLdProducts(root: unknown): void {
    const pending: Array<{ value: unknown; depth: number }> = [
      { value: root, depth: 0 },
    ];
    let visited = 0;
    while (pending.length > 0 && visited < 500) {
      const current = pending.pop();
      if (current === undefined) break;
      visited += 1;
      if (Array.isArray(current.value)) {
        if (current.depth >= 8) continue;
        for (const item of current.value.slice(0, 100)) {
          pending.push({ value: item, depth: current.depth + 1 });
        }
        continue;
      }
      if (typeof current.value !== "object" || current.value === null) continue;
      const record = current.value as Record<string, unknown>;
      if (isJsonLdProductType(record["@type"])) {
        const rawUrl = jsonLdUrl(record.url) ?? jsonLdUrl(record["@id"]);
        const productUrl =
          rawUrl === undefined ? canonical ?? location.href : rawUrl;
        const cleaned = cleanSameOriginUrl(productUrl);
        if (cleaned !== undefined) {
          const rawImages = Array.isArray(record.image)
            ? record.image
            : record.image === undefined
              ? []
              : [record.image];
          addPageProduct(cleaned, "json-ld", record.name, rawImages);
        }
      }
      if (current.depth >= 8) continue;
      for (const value of Object.values(record).slice(0, 100)) {
        pending.push({ value, depth: current.depth + 1 });
      }
    }
  }

  function isJsonLdProductType(value: unknown): boolean {
    const values = Array.isArray(value) ? value : [value];
    return values.some(
      (entry) =>
        typeof entry === "string" &&
        entry.split(/[\/#:]/u).at(-1)?.toLowerCase() === "product",
    );
  }

  function jsonLdUrl(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    return typeof record["@id"] === "string"
      ? record["@id"]
      : typeof record.url === "string"
        ? record.url
        : undefined;
  }

  function imageUrlFromJsonLd(value: unknown): string | undefined {
    const raw =
      typeof value === "string"
        ? value
        : typeof value === "object" && value !== null
          ? jsonLdUrl(value) ??
            (typeof (value as Record<string, unknown>).contentUrl === "string"
              ? ((value as Record<string, unknown>).contentUrl as string)
              : undefined)
          : undefined;
    return raw === undefined ? undefined : cleanPublicUrl(raw);
  }

  function uniqueSources(
    values: readonly CollectorPageProductSource[],
  ): CollectorPageProductSource[] {
    return [...new Set(values)];
  }

  function cleanSameOriginUrl(value: string): string | undefined {
    const cleaned = cleanPublicUrl(value);
    if (cleaned === undefined) return undefined;
    try {
      return new URL(cleaned).origin === location.origin ? cleaned : undefined;
    } catch {
      return undefined;
    }
  }

  function isSameOriginProductUrl(value: string): boolean {
    const url = sameOriginUrl(value);
    return url !== undefined && routeHandle(url.pathname, "products") !== undefined;
  }

  function sameOriginCollectionHandle(value: string): string | undefined {
    const url = sameOriginUrl(value);
    return url === undefined ? undefined : routeHandle(url.pathname, "collections");
  }

  function sameOriginUrl(value: string): URL | undefined {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin ? url : undefined;
    } catch {
      return undefined;
    }
  }

  function routeHandle(pathname: string, route: "products" | "collections"):
    | string
    | undefined {
    const segments = pathname.split("/").filter(Boolean);
    const index = segments.findIndex(
      (segment) => segment.toLowerCase() === route,
    );
    const raw = index < 0 ? undefined : segments[index + 1];
    if (raw === undefined) return undefined;
    try {
      const decoded = decodeURIComponent(raw);
      return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,254}$/u.test(decoded)
        ? decoded
        : undefined;
    } catch {
      return undefined;
    }
  }

  function isShopifyCheckoutUrl(value: string): boolean {
    try {
      const url = new URL(value);
      const checkoutPath = /\/(?:checkout|checkouts)(?:\/|$)/iu.test(
        url.pathname,
      );
      return (
        checkoutPath &&
        (url.origin === location.origin ||
          url.hostname.toLowerCase().endsWith(".myshopify.com"))
      );
    } catch {
      return false;
    }
  }

  function cleanPublicUrl(value: string | undefined): string | undefined {
    if (value === undefined || value.length === 0) return undefined;
    try {
      const url = new URL(value, location.href);
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username.length > 0 ||
        url.password.length > 0
      ) {
        return undefined;
      }
      url.search = "";
      url.hash = "";
      const cleaned = url.href;
      return cleaned.length <= 2_048 ? cleaned : undefined;
    } catch {
      return undefined;
    }
  }

  function inspectPath(pathname: string):
    | { ok: true; normalizedPathname: string }
    | { ok: false; reason: "path_changed" | "sensitive_path" } {
    if (
      pathname.length === 0 ||
      pathname.length > 8_192 ||
      !pathname.startsWith("/") ||
      pathname.includes("\\")
    ) {
      return { ok: false, reason: "path_changed" };
    }

    const decoded: string[] = [];
    try {
      for (const raw of pathname.split("/")) {
        if (raw.length === 0) continue;
        if (/%(?![0-9a-f]{2})/iu.test(raw)) {
          return { ok: false, reason: "path_changed" };
        }
        const part = decodeURIComponent(raw).normalize("NFKC");
        if (
          part.length === 0 ||
          part === "." ||
          part === ".." ||
          /[\u0000-\u001f\u007f\\/?#]/u.test(part) ||
          /%[0-9a-f]{2}/iu.test(part)
        ) {
          return { ok: false, reason: "path_changed" };
        }
        decoded.push(part.toLocaleLowerCase("en-US"));
      }
    } catch {
      return { ok: false, reason: "path_changed" };
    }

    const effective = [...decoded];
    if (/^[a-z]{2,3}(?:-(?:[a-z]{2}|[0-9]{3}))?$/u.test(effective[0] ?? "")) {
      effective.shift();
    }
    if (
      ["admin", "account", "checkout", "checkouts", "orders", "cart"].includes(
        effective[0] ?? "",
      )
    ) {
      return { ok: false, reason: "sensitive_path" };
    }
    return {
      ok: true,
      normalizedPathname: decoded.length === 0 ? "/" : `/${decoded.join("/")}`,
    };
  }
}
