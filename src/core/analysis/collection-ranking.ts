import type { EndpointFailureCategory } from "../network/request-policy";
import {
  hasNextCollectionPage,
  parseCollectionHandlesFromHtml,
  parseProductLinksFromHtml,
  type CatalogError,
  type CatalogProduct,
  type EndpointExecutor,
} from "../shopify/catalog-scanner";

export type PublicCollectionSort = "best-selling" | "created-descending";

export type PublicRankingItem = Readonly<{
  rank: number;
  id?: string;
  handle: string;
  title?: string;
  canonicalUrl?: string;
  sourceUrl: string;
}>;

export type PublicCollectionScope = Readonly<{
  kind: "all-storefront" | "collection";
  handle: string;
  url: string;
}>;

export type PublicCollectionRanking = Readonly<{
  status: "completed" | "partial" | "unavailable" | "blocked";
  sortBy: PublicCollectionSort;
  scope?: PublicCollectionScope;
  items: readonly PublicRankingItem[];
  pagesScanned: number;
  truncated: boolean;
  termination:
    | "complete"
    | "product-limit"
    | "page-bound"
    | "empty"
    | "unavailable"
    | "terminal-access-gate"
    | "aborted";
  disclaimer: string;
  errors: readonly CatalogError[];
}>;

const DEFAULT_PRODUCT_LIMIT = 1_000;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_FALLBACK_COLLECTIONS = 10;

export async function scanPublicCollectionRanking(
  execute: EndpointExecutor,
  options: Readonly<{
    origin: string;
    routeRoot: string;
    sortBy: PublicCollectionSort;
    catalogProducts: readonly CatalogProduct[];
    collectionHandles?: readonly string[];
    productLimit?: number;
    maxPages?: number;
    signal?: AbortSignal;
    onProgress?: (progress: Readonly<{
      sortBy: PublicCollectionSort;
      handle: string;
      page: number;
      productsFetched: number;
    }>) => void;
  }>,
): Promise<PublicCollectionRanking> {
  const origin = new URL(options.origin).origin;
  if (origin !== options.origin) throw new TypeError("origin must be canonical");
  const productLimit = positiveInteger(
    options.productLimit,
    DEFAULT_PRODUCT_LIMIT,
    "productLimit",
    100_000,
  );
  const maxPages = positiveInteger(
    options.maxPages,
    DEFAULT_PAGE_LIMIT,
    "maxPages",
    100,
  );
  const fallbackHandles = new Set(
    (options.collectionHandles ?? [])
      .filter((handle) => validHandle(handle) && handle !== "all")
      .slice(0, MAX_FALLBACK_COLLECTIONS),
  );
  const errors: CatalogError[] = [];

  const allAttempt = await scanHandle("all");
  errors.push(...allAttempt.errors);
  if (allAttempt.terminal || allAttempt.items.length > 0) {
    return finish(allAttempt, errors);
  }
  for (const handle of allAttempt.discoveredHandles) {
    if (fallbackHandles.size >= MAX_FALLBACK_COLLECTIONS) break;
    if (handle !== "all" && validHandle(handle)) fallbackHandles.add(handle);
  }

  for (const handle of fallbackHandles) {
    const attempt = await scanHandle(handle);
    errors.push(...attempt.errors);
    if (attempt.terminal || attempt.items.length > 0) {
      return finish(attempt, errors);
    }
  }

  return {
    status: "unavailable",
    sortBy: options.sortBy,
    items: [],
    pagesScanned: allAttempt.pagesScanned,
    truncated: false,
    termination: "unavailable",
    disclaimer: disclaimerFor(options.sortBy),
    errors,
  };

  async function scanHandle(handle: string): Promise<RankingAttempt> {
    const seen = new Set<string>();
    const signatures = new Set<string>();
    const items: PublicRankingItem[] = [];
    const attemptErrors: CatalogError[] = [];
    const discoveredHandles = new Set<string>();
    let pagesScanned = 0;
    let firstResponseUrl: string | undefined;

    for (let page = 1; page <= maxPages; page += 1) {
      throwIfAborted(options.signal);
      options.onProgress?.({
        sortBy: options.sortBy,
        handle,
        page,
        productsFetched: items.length,
      });
      const result = await execute(
        { kind: "collection-html", handle, sortBy: options.sortBy, page },
        {
          routeRoot: options.routeRoot,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
      pagesScanned += 1;
      if (!result.ok) {
        attemptErrors.push(endpointError(result.category, result.message, page));
        return {
          handle,
          items,
          pagesScanned,
          truncated: false,
          termination: isTerminalCategory(result.category)
            ? "terminal-access-gate"
            : "unavailable",
          terminal: isTerminalCategory(result.category),
          errors: attemptErrors,
          discoveredHandles: [...discoveredHandles],
          ...(firstResponseUrl === undefined ? {} : { firstResponseUrl }),
        };
      }
      if (typeof result.data !== "string") {
        attemptErrors.push({
          source: `collection-${options.sortBy}`,
          category: "invalid_payload",
          message: "collection body is not text",
          page,
        });
        return {
          handle,
          items,
          pagesScanned,
          truncated: false,
          termination: "unavailable",
          terminal: false,
          errors: attemptErrors,
          discoveredHandles: [...discoveredHandles],
          ...(firstResponseUrl === undefined ? {} : { firstResponseUrl }),
        };
      }

      firstResponseUrl ??= result.responseUrl;
      for (const discovered of parseCollectionHandlesFromHtml(
        result.data,
        origin,
      )) {
        if (discoveredHandles.size >= 50) break;
        discoveredHandles.add(discovered);
      }
      const pageProducts = parseProductLinksFromHtml(result.data, origin);
      const pageKeys = pageProducts
        .map((product) => product.handle ?? product.canonicalUrl)
        .filter((key): key is string => key !== undefined);
      const signature = pageKeys.join("\u001f");
      if (pageKeys.length === 0 || signatures.has(signature)) {
        return {
          handle,
          items,
          pagesScanned,
          truncated: false,
          termination: items.length === 0 ? "empty" : "complete",
          terminal: false,
          errors: attemptErrors,
          discoveredHandles: [...discoveredHandles],
          ...(firstResponseUrl === undefined ? {} : { firstResponseUrl }),
        };
      }
      signatures.add(signature);

      const sizeBefore = items.length;
      for (const discovered of pageProducts) {
        const discoveredHandle = discovered.handle;
        if (discoveredHandle === undefined || seen.has(discoveredHandle)) continue;
        seen.add(discoveredHandle);
        const catalogProduct = findCatalogProduct(
          options.catalogProducts,
          discoveredHandle,
          discovered.canonicalUrl,
        );
        const canonicalUrl =
          catalogProduct?.canonicalUrl ?? discovered.canonicalUrl;
        items.push({
          rank: items.length + 1,
          ...(catalogProduct?.id === undefined ? {} : { id: catalogProduct.id }),
          handle: discoveredHandle,
          ...(catalogProduct?.title === undefined
            ? {}
            : { title: catalogProduct.title }),
          ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
          sourceUrl: result.responseUrl,
        });
        if (items.length >= productLimit) {
          return {
            handle,
            items,
            pagesScanned,
            truncated: true,
            termination: "product-limit",
            terminal: false,
            errors: attemptErrors,
            discoveredHandles: [...discoveredHandles],
            firstResponseUrl,
          };
        }
      }
      if (items.length === sizeBefore) {
        return {
          handle,
          items,
          pagesScanned,
          truncated: false,
          termination: items.length === 0 ? "empty" : "complete",
          terminal: false,
          errors: attemptErrors,
          discoveredHandles: [...discoveredHandles],
          firstResponseUrl,
        };
      }
      if (
        !hasNextCollectionPage(
          result.data,
          origin,
          options.routeRoot,
          handle,
          page,
          options.sortBy,
        )
      ) {
        return {
          handle,
          items,
          pagesScanned,
          truncated: false,
          termination: "complete",
          terminal: false,
          errors: attemptErrors,
          discoveredHandles: [...discoveredHandles],
          firstResponseUrl,
        };
      }
    }

    return {
      handle,
      items,
      pagesScanned,
      truncated: true,
      termination: "page-bound",
      terminal: false,
      errors: attemptErrors,
      discoveredHandles: [...discoveredHandles],
      ...(firstResponseUrl === undefined ? {} : { firstResponseUrl }),
    };
  }

  function finish(
    attempt: RankingAttempt,
    allErrors: readonly CatalogError[],
  ): PublicCollectionRanking {
    const scope =
      attempt.firstResponseUrl === undefined
        ? undefined
        : {
            kind: attempt.handle === "all" ? "all-storefront" as const : "collection" as const,
            handle: attempt.handle,
            url: attempt.firstResponseUrl,
          };
    return {
      status: attempt.terminal
        ? "blocked"
        : attempt.truncated || allErrors.length > 0
          ? "partial"
          : "completed",
      sortBy: options.sortBy,
      ...(scope === undefined ? {} : { scope }),
      items: attempt.items,
      pagesScanned: attempt.pagesScanned,
      truncated: attempt.truncated,
      termination: attempt.termination,
      disclaimer: disclaimerFor(options.sortBy),
      errors: allErrors,
    };
  }
}

type RankingAttempt = Readonly<{
  handle: string;
  items: readonly PublicRankingItem[];
  pagesScanned: number;
  truncated: boolean;
  termination: PublicCollectionRanking["termination"];
  terminal: boolean;
  errors: readonly CatalogError[];
  discoveredHandles: readonly string[];
  firstResponseUrl?: string;
}>;

function findCatalogProduct(
  products: readonly CatalogProduct[],
  handle: string,
  canonicalUrl: string | undefined,
): CatalogProduct | undefined {
  return products.find(
    (product) =>
      product.handle === handle ||
      (canonicalUrl !== undefined && product.canonicalUrl === canonicalUrl),
  );
}

function disclaimerFor(sortBy: PublicCollectionSort): string {
  return sortBy === "best-selling"
    ? "Shopify 公开 Collection 排序，不等于真实销量。"
    : "created-descending 仅表示公开 Collection 的相对新旧顺序。";
}

function endpointError(
  category: EndpointFailureCategory,
  message: string,
  page: number,
): CatalogError {
  return {
    source: "collection-ranking",
    category,
    message: message.slice(0, 256),
    page,
  };
}

function isTerminalCategory(category: EndpointFailureCategory): boolean {
  return (
    category === "challenge_page" ||
    category === "security_rejected" ||
    category === "password_page"
  );
}

function validHandle(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    value.trim() === value &&
    value !== "." &&
    value !== ".." &&
    !/[\\/?#\u0000-\u001f\u007f]/u.test(value)
  );
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new TypeError(`${name} must be a positive safe integer <= ${maximum}`);
  }
  return normalized;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Scan cancelled", "AbortError");
}
