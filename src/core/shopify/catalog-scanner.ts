import type {
  EndpointExecutionResult,
  EndpointFailureCategory,
  EndpointRequest,
} from "../network/request-policy";
import type { CollectorPageProduct } from "../../content/probes";

export const DEFAULT_PRODUCT_LIMIT = 1_000;
export const DEFAULT_PRODUCTS_PAGE_SIZE = 250;
export const DEFAULT_AJAX_SUPPLEMENT_LIMIT = 20;
export const DEFAULT_COLLECTION_PAGE_LIMIT = 20;

export type CapabilityProbeStatus =
  | "ok"
  | "unavailable"
  | "challenge"
  | "not_json";

export type CoverageSource =
  | "products-json"
  | "sitemap"
  | "collection-html"
  | "product-ajax-js"
  | "canonical"
  | "dom"
  | "json-ld";

export type CoverageInfo = Readonly<{
  productsFetched: number;
  estimatedTotal?: number;
  truncated: boolean;
  sources: CoverageSource[];
  capabilityProbes: Record<string, CapabilityProbeStatus>;
}>;

export type CatalogVariant = Readonly<{
  id: string;
  title?: string;
  sku?: string;
  price?: string | number;
  compareAtPrice?: string | number;
  available?: boolean;
  priceSource?: Extract<
    CoverageSource,
    "products-json" | "product-ajax-js"
  >;
}>;

export type CatalogProduct = Readonly<{
  id?: string;
  handle?: string;
  title?: string;
  vendor?: string;
  productType?: string;
  tags: string[];
  createdAt?: string;
  publishedAt?: string;
  updatedAt?: string;
  canonicalUrl?: string;
  sitemapLastmod?: string;
  variants: CatalogVariant[];
  images: string[];
  sources: CoverageSource[];
}>;

export type PaginationTermination =
  | "empty-page"
  | "short-page"
  | "repeated-page-signature"
  | "no-progress"
  | "product-limit"
  | "endpoint-failure"
  | "page-bound"
  | "aborted";

export type CatalogTermination =
  | PaginationTermination
  | "products-json-complete"
  | "fallback-sitemap"
  | "fallback-collection"
  | "fallback-exhausted"
  | "terminal-access-gate"
  | "generic-sitemap"
  | "generic-public-sources";

export type CatalogError = Readonly<{
  source: string;
  category: EndpointFailureCategory | "invalid_payload";
  message: string;
  page?: number;
}>;

export type EndpointExecutorOptions = Readonly<{
  routeRoot?: string;
  signal?: AbortSignal;
}>;

export type EndpointExecutor = (
  request: EndpointRequest,
  options?: EndpointExecutorOptions,
) => Promise<EndpointExecutionResult>;

export type ProductCheckpoint = (
  products: readonly CatalogProduct[],
) => void | Promise<void>;

export type CatalogProgress = Readonly<{
  phase:
    | "products-probe"
    | "products-page"
    | "sitemap"
    | "collection-html"
    | "product-ajax-js";
  productsFetched: number;
  page?: number;
  detail?: string;
}>;

export type CatalogScanOptions = Readonly<{
  origin: string;
  routeRoot?: string;
  productLimit?: number;
  pageSize?: number;
  ajaxSupplementLimit?: number;
  maxSitemapFiles?: number;
  maxCollectionPages?: number;
  pageProducts?: readonly CollectorPageProduct[];
  collectionHandles?: readonly string[];
  signal?: AbortSignal;
  onProducts?: ProductCheckpoint;
  onProgress?: (progress: CatalogProgress) => void;
}>;

export type PaginationResult = Readonly<{
  products: CatalogProduct[];
  termination: PaginationTermination;
  complete: boolean;
  truncated: boolean;
  pagesRequested: number;
  errors: CatalogError[];
}>;

export type CatalogScanResult = Readonly<{
  products: CatalogProduct[];
  coverage: CoverageInfo;
  termination: CatalogTermination;
  complete: boolean;
  errors: CatalogError[];
}>;

export type CapabilityProbeResult = Readonly<{
  status: CapabilityProbeStatus;
  result: EndpointExecutionResult;
  terminal: boolean;
}>;

export type ProductSitemapReference = Readonly<{
  index: number;
  from?: string;
  to?: string;
}>;

/** Executes the required small-sample B-grade capability probe. */
export async function probeProductsJsonCapability(
  execute: EndpointExecutor,
  options: Pick<CatalogScanOptions, "signal"> = {},
): Promise<CapabilityProbeResult> {
  throwIfAborted(options.signal);
  const result = await execute(
    { kind: "products-page", page: 1, limit: 1 },
    signalOptions(options.signal),
  );
  return {
    status: capabilityStatus(result),
    result,
    terminal: isTerminalAccessResult(result),
  };
}

/**
 * Fetches products.json with monotonic pages and all five DESIGN §12.4 stop
 * conditions. The capability probe is intentionally separate and must run
 * before this function.
 */
export async function paginateProductsJson(
  execute: EndpointExecutor,
  options: Pick<
    CatalogScanOptions,
    "productLimit" | "pageSize" | "signal" | "onProducts" | "onProgress"
  > = {},
): Promise<PaginationResult> {
  const productLimit = positiveInteger(
    options.productLimit,
    DEFAULT_PRODUCT_LIMIT,
    "productLimit",
    100_000,
  );
  const pageSize = positiveInteger(
    options.pageSize,
    DEFAULT_PRODUCTS_PAGE_SIZE,
    "pageSize",
    250,
  );
  const maximumPages = Math.ceil(productLimit / pageSize) + 2;
  const products = new CatalogAccumulator();
  const pageSignatures = new Set<string>();
  const errors: CatalogError[] = [];
  let pagesRequested = 0;

  for (let page = 1; page <= maximumPages; page += 1) {
    if (options.signal?.aborted === true) {
      return paginationResult(
        products,
        "aborted",
        false,
        false,
        pagesRequested,
        errors,
      );
    }
    pagesRequested += 1;
    options.onProgress?.({
      phase: "products-page",
      productsFetched: products.size,
      page,
    });
    const result = await execute(
      { kind: "products-page", page, limit: pageSize },
      signalOptions(options.signal),
    );
    if (!result.ok) {
      errors.push(endpointError("products-json", result, page));
      return paginationResult(
        products,
        result.category === "aborted" ? "aborted" : "endpoint-failure",
        false,
        false,
        pagesRequested,
        errors,
      );
    }

    const pageEntries = readProductsEnvelope(result.data);
    if (pageEntries === undefined) {
      errors.push({
        source: "products-json",
        category: "invalid_payload",
        message: "products envelope missing after policy validation",
        page,
      });
      return paginationResult(
        products,
        "endpoint-failure",
        false,
        false,
        pagesRequested,
        errors,
      );
    }
    if (pageEntries.length === 0) {
      return paginationResult(
        products,
        "empty-page",
        true,
        false,
        pagesRequested,
        errors,
      );
    }

    const normalized = pageEntries
      .map((entry) => normalizeCatalogProduct(entry, "products-json"))
      .filter((entry): entry is CatalogProduct => entry !== undefined);
    const signature = hashPageKeys(
      normalized.map(productIdentityKey).filter((key): key is string => key !== undefined),
    );
    if (pageSignatures.has(signature)) {
      return paginationResult(
        products,
        "repeated-page-signature",
        false,
        false,
        pagesRequested,
        errors,
      );
    }
    pageSignatures.add(signature);

    const accepted: CatalogProduct[] = [];
    for (const product of normalized) {
      if (products.size >= productLimit) break;
      const outcome = products.add(product);
      if (outcome.added) accepted.push(outcome.product);
    }
    // Defer handle-only identities until the final merged checkpoint. If a
    // later page reveals the stable ID, writing both generations would create
    // separate handle:* and id:* rows in IndexedDB.
    await emitProducts(
      accepted.filter((product) => product.id !== undefined),
      options.onProducts,
    );

    if (products.size >= productLimit) {
      return paginationResult(
        products,
        "product-limit",
        false,
        true,
        pagesRequested,
        errors,
      );
    }
    if (accepted.length === 0) {
      return paginationResult(
        products,
        "no-progress",
        false,
        false,
        pagesRequested,
        errors,
      );
    }
    if (pageEntries.length < pageSize) {
      return paginationResult(
        products,
        "short-page",
        true,
        false,
        pagesRequested,
        errors,
      );
    }
  }

  return paginationResult(
    products,
    "page-bound",
    false,
    false,
    pagesRequested,
    errors,
  );
}

export async function scanHostedCatalog(
  execute: EndpointExecutor,
  options: CatalogScanOptions,
): Promise<CatalogScanResult> {
  const normalized = normalizeScanOptions(options);
  const products = new CatalogAccumulator();
  const capabilityProbes: Record<string, CapabilityProbeStatus> = {};
  const sources: CoverageSource[] = [];
  const errors: CatalogError[] = [];
  let estimatedTotal: number | undefined;
  let truncated = false;

  normalized.onProgress?.({ phase: "products-probe", productsFetched: 0 });
  const probe = await probeProductsJsonCapability(execute, {
    ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
  });
  capabilityProbes["products-json"] = probe.status;
  if (probe.terminal) {
    if (!probe.result.ok) errors.push(endpointError("products-json", probe.result));
    return catalogResult(
      products,
      capabilityProbes,
      sources,
      false,
      false,
      "terminal-access-gate",
      errors,
    );
  }

  let pagination: PaginationResult | undefined;
  if (probe.status === "ok") {
    pagination = await paginateProductsJson(execute, {
      productLimit: normalized.productLimit,
      pageSize: normalized.pageSize,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      ...(normalized.onProducts === undefined
        ? {}
        : { onProducts: normalized.onProducts }),
      ...(normalized.onProgress === undefined
        ? {}
        : { onProgress: normalized.onProgress }),
    });
    for (const product of pagination.products) products.add(product);
    errors.push(...pagination.errors);
    const paginationFailure = pagination.errors.at(-1);
    if (
      pagination.termination === "endpoint-failure" &&
      paginationFailure !== undefined
    ) {
      capabilityProbes["products-json"] = capabilityStatusFromCategory(
        paginationFailure.category,
      );
    }
    if (pagination.products.length > 0) sources.push("products-json");
    truncated = pagination.truncated;
    if (
      pagination.termination === "aborted" ||
      pagination.errors.some(isTerminalCatalogError)
    ) {
      if (pagination.termination !== "aborted") {
        await emitProducts(products.values(), normalized.onProducts);
      }
      return catalogResult(
        products,
        capabilityProbes,
        sources,
        false,
        truncated,
        pagination.termination === "aborted"
          ? "aborted"
          : "terminal-access-gate",
        errors,
      );
    }
    if (pagination.complete || pagination.truncated) {
      await emitProducts(products.values(), normalized.onProducts);
      return catalogResult(
        products,
        capabilityProbes,
        sources,
        pagination.complete,
        truncated,
        "products-json-complete",
        errors,
      );
    }
  } else if (!probe.result.ok) {
    errors.push(endpointError("products-json", probe.result));
  }

  const remainingAfterProducts = normalized.productLimit - products.size;
  if (remainingAfterProducts <= 0) {
    return catalogResult(
      products,
      capabilityProbes,
      sources,
      false,
      true,
      pagination?.termination ?? "product-limit",
      errors,
    );
  }

  const sitemap = await discoverSitemapProducts(execute, {
    origin: normalized.origin,
    productLimit: remainingAfterProducts,
    maxSitemapFiles: normalized.maxSitemapFiles,
    ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    ...(normalized.onProgress === undefined
      ? {}
      : { onProgress: normalized.onProgress }),
  });
  capabilityProbes.sitemap = sitemap.status;
  errors.push(...sitemap.errors);
  const sitemapAccepted = products.addAll(sitemap.products);
  if (sitemapAccepted.length > 0) sources.push("sitemap");
  if (sitemap.estimatedTotal !== undefined) {
    estimatedTotal = sitemap.estimatedTotal +
      Math.max(0, products.size - sitemapAccepted.length);
  }
  truncated ||= sitemap.truncated || products.size >= normalized.productLimit;
  if (sitemap.terminal) {
    await emitProducts(products.values(), normalized.onProducts);
    return catalogResult(
      products,
      capabilityProbes,
      sources,
      false,
      truncated,
      "terminal-access-gate",
      errors,
      estimatedTotal,
    );
  }

  let fallbackTermination: CatalogTermination = "fallback-sitemap";
  if (sitemapAccepted.length === 0 && products.size < normalized.productLimit) {
    const collection = await discoverCollectionProducts(execute, {
      origin: normalized.origin,
      routeRoot: normalized.routeRoot,
      productLimit: normalized.productLimit - products.size,
      maxPagesPerCollection: normalized.maxCollectionPages,
      collectionHandles: normalized.collectionHandles,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      ...(normalized.onProgress === undefined
        ? {}
        : { onProgress: normalized.onProgress }),
    });
    capabilityProbes["collection-html"] = collection.status;
    errors.push(...collection.errors);
    const collectionAccepted = products.addAll(collection.products);
    if (collectionAccepted.length > 0) sources.push("collection-html");
    truncated ||= collection.truncated || products.size >= normalized.productLimit;
    fallbackTermination =
      collectionAccepted.length > 0 ? "fallback-collection" : "fallback-exhausted";
    if (collection.terminal) {
      await emitProducts(products.values(), normalized.onProducts);
      return catalogResult(
        products,
        capabilityProbes,
        sources,
        false,
        truncated,
        "terminal-access-gate",
        errors,
        estimatedTotal,
      );
    }
  }

  const supplementCandidates = products.values().filter(
    (product) =>
      product.handle !== undefined &&
      !product.sources.includes("products-json") &&
      product.variants.length === 0,
  );
  if (supplementCandidates.length > 0 && normalized.ajaxSupplementLimit > 0) {
    const supplement = await supplementProductsWithAjax(execute, {
      candidates: supplementCandidates,
      routeRoot: normalized.routeRoot,
      limit: normalized.ajaxSupplementLimit,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      ...(normalized.onProgress === undefined
        ? {}
        : { onProgress: normalized.onProgress }),
    });
    capabilityProbes["product-ajax-js"] = supplement.status;
    errors.push(...supplement.errors);
    products.addAll(supplement.products);
    if (supplement.products.length > 0) sources.push("product-ajax-js");
    if (supplement.terminal) {
      await emitProducts(products.values(), normalized.onProducts);
      return catalogResult(
        products,
        capabilityProbes,
        sources,
        false,
        truncated,
        "terminal-access-gate",
        errors,
        estimatedTotal,
      );
    }
  }

  // Fallback discovery can migrate identity from handle-only (sitemap/HTML)
  // to a stable product ID after Ajax enrichment. Persist only the final
  // merged records so IndexedDB never retains both handle:* and id:* keys.
  await emitProducts(products.values(), normalized.onProducts);
  return catalogResult(
    products,
    capabilityProbes,
    sources,
    false,
    truncated,
    fallbackTermination,
    errors,
    estimatedTotal,
  );
}

/** Generic path for custom/uncertain storefronts: public page signals + sitemap, never Ajax. */
export async function scanGenericCatalog(
  execute: EndpointExecutor,
  options: CatalogScanOptions,
): Promise<CatalogScanResult> {
  const normalized = normalizeScanOptions(options);
  const products = new CatalogAccumulator();
  const pageProducts = normalizeCollectorPageProducts(
    normalized.pageProducts,
    normalized.origin,
  );
  let truncated = false;
  for (const product of pageProducts) {
    if (products.size >= normalized.productLimit) {
      truncated = true;
      break;
    }
    products.add(product);
  }
  const sources = unique(products.values().flatMap((product) => product.sources));
  if (products.size >= normalized.productLimit) {
    await emitProducts(products.values(), normalized.onProducts);
    return catalogResult(
      products,
      {},
      sources,
      false,
      true,
      "generic-public-sources",
      [],
    );
  }

  const sitemap = await discoverSitemapProducts(execute, {
    origin: normalized.origin,
    productLimit: normalized.productLimit - products.size,
    maxSitemapFiles: normalized.maxSitemapFiles,
    ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    ...(normalized.onProgress === undefined
      ? {}
      : { onProgress: normalized.onProgress }),
  });
  products.addAll(sitemap.products);
  if (sitemap.products.length > 0) sources.push("sitemap");
  truncated ||= sitemap.truncated || products.size >= normalized.productLimit;
  await emitProducts(products.values(), normalized.onProducts);
  const estimatedTotal =
    sitemap.estimatedTotal === undefined
      ? undefined
      : Math.max(sitemap.estimatedTotal, products.size);
  return catalogResult(
    products,
    { sitemap: sitemap.status },
    sources,
    false,
    truncated,
    sitemap.terminal
      ? "terminal-access-gate"
      : pageProducts.length > 0 && sitemap.products.length === 0
        ? "generic-public-sources"
        : "generic-sitemap",
    sitemap.errors,
    estimatedTotal,
  );
}

type DiscoveryResult = Readonly<{
  products: CatalogProduct[];
  status: CapabilityProbeStatus;
  terminal: boolean;
  truncated: boolean;
  estimatedTotal?: number;
  errors: CatalogError[];
}>;

async function discoverSitemapProducts(
  execute: EndpointExecutor,
  options: Readonly<{
    origin: string;
    productLimit: number;
    maxSitemapFiles: number;
    signal?: AbortSignal;
    onProgress?: (progress: CatalogProgress) => void;
  }>,
): Promise<DiscoveryResult> {
  throwIfAborted(options.signal);
  options.onProgress?.({ phase: "sitemap", productsFetched: 0 });
  const root = await execute({ kind: "sitemap" }, signalOptions(options.signal));
  const status = capabilityStatus(root);
  if (!root.ok) {
    return {
      products: [],
      status,
      terminal: isTerminalAccessResult(root),
      truncated: false,
      errors: [endpointError("sitemap", root)],
    };
  }
  if (typeof root.data !== "string") {
    return {
      products: [],
      status: "unavailable",
      terminal: false,
      truncated: false,
      errors: [
        {
          source: "sitemap",
          category: "invalid_payload",
          message: "sitemap body is not text",
        },
      ],
    };
  }

  const products = new CatalogAccumulator();
  const errors: CatalogError[] = [];
  let truncated = false;
  const rootParsed = parseSitemapDocument(root.data, options.origin);
  for (const product of rootParsed.products) {
    if (products.size >= options.productLimit) {
      truncated = true;
      break;
    }
    products.add(product);
  }

  const productSitemaps = rootParsed.productSitemaps.slice(
    0,
    options.maxSitemapFiles,
  );
  if (rootParsed.productSitemaps.length > productSitemaps.length) truncated = true;
  for (const sitemap of productSitemaps) {
    if (products.size >= options.productLimit || options.signal?.aborted === true) {
      truncated = true;
      break;
    }
    options.onProgress?.({
      phase: "sitemap",
      productsFetched: products.size,
      detail: `index=${sitemap.index}`,
    });
    const result = await execute(
      {
        kind: "sitemap",
        index: sitemap.index,
        ...(sitemap.from === undefined ? {} : { from: sitemap.from }),
        ...(sitemap.to === undefined ? {} : { to: sitemap.to }),
      },
      signalOptions(options.signal),
    );
    if (!result.ok) {
      errors.push(endpointError("sitemap", result));
      if (isTerminalAccessResult(result)) {
        return {
          products: products.values(),
          status: capabilityStatus(result),
          terminal: true,
          truncated,
          errors,
        };
      }
      continue;
    }
    if (typeof result.data !== "string") continue;
    const parsed = parseSitemapDocument(result.data, options.origin);
    for (const product of parsed.products) {
      if (products.size >= options.productLimit) {
        truncated = true;
        break;
      }
      products.add(product);
    }
  }

  const values = products.values();
  return {
    products: values,
    status: "ok",
    terminal: false,
    truncated,
    ...(!truncated && errors.length === 0 ? { estimatedTotal: values.length } : {}),
    errors,
  };
}

async function discoverCollectionProducts(
  execute: EndpointExecutor,
  options: Readonly<{
    origin: string;
    routeRoot: string;
    productLimit: number;
    maxPagesPerCollection: number;
    collectionHandles: readonly string[];
    signal?: AbortSignal;
    onProgress?: (progress: CatalogProgress) => void;
  }>,
): Promise<DiscoveryResult> {
  throwIfAborted(options.signal);
  const products = new CatalogAccumulator();
  const errors: CatalogError[] = [];
  const fallbackHandles = new Set(
    options.collectionHandles.filter((handle) => validHandle(handle)),
  );
  fallbackHandles.delete("all");
  let usableResponseSeen = false;
  let truncated = false;
  let terminalStatus: CapabilityProbeStatus | undefined;

  const scanHandle = async (handle: string): Promise<void> => {
    const signatures = new Set<string>();
    for (let page = 1; page <= options.maxPagesPerCollection; page += 1) {
      if (options.signal?.aborted === true || products.size >= options.productLimit) {
        truncated ||= products.size >= options.productLimit;
        return;
      }
      options.onProgress?.({
        phase: "collection-html",
        productsFetched: products.size,
        page,
        detail: handle,
      });
      const result = await execute(
        {
          kind: "collection-html",
          handle,
          sortBy: "best-selling",
          page,
        },
        routeOptions(options.routeRoot, options.signal),
      );
      if (!result.ok) {
        errors.push(endpointError("collection-html", result, page));
        if (isTerminalAccessResult(result)) {
          terminalStatus = capabilityStatus(result);
        }
        return;
      }
      if (typeof result.data !== "string") {
        errors.push({
          source: "collection-html",
          category: "invalid_payload",
          message: "collection body is not text",
          page,
        });
        return;
      }
      usableResponseSeen = true;
      for (const discovered of parseCollectionHandlesFromHtml(
        result.data,
        options.origin,
      )) {
        if (fallbackHandles.size >= 50) break;
        if (discovered !== "all") fallbackHandles.add(discovered);
      }

      const pageProducts = parseProductLinksFromHtml(result.data, options.origin);
      const signature = hashPageKeys(
        pageProducts.map(
          (product) =>
            productIdentityKey(product) ?? product.canonicalUrl ?? "unknown",
        ),
      );
      if (pageProducts.length === 0 || signatures.has(signature)) return;
      signatures.add(signature);
      const sizeBeforePage = products.size;
      for (const product of pageProducts) {
        if (products.size >= options.productLimit) {
          truncated = true;
          return;
        }
        products.add(product);
      }
      if (products.size === sizeBeforePage) return;
      const hasNext = hasNextCollectionPage(
        result.data,
        options.origin,
        options.routeRoot,
        handle,
        page,
      );
      if (!hasNext) return;
      if (page === options.maxPagesPerCollection) truncated = true;
    }
  };

  await scanHandle("all");
  if (terminalStatus === undefined && products.size === 0) {
    for (const handle of [...fallbackHandles].slice(0, 10)) {
      await scanHandle(handle);
      if (
        terminalStatus !== undefined ||
        options.signal?.aborted === true ||
        products.size >= options.productLimit
      ) {
        break;
      }
    }
    if (fallbackHandles.size > 10) truncated = true;
  }

  return {
    products: products.values(),
    status: terminalStatus ?? (usableResponseSeen ? "ok" : "unavailable"),
    terminal: terminalStatus !== undefined,
    truncated,
    errors,
  };
}

async function supplementProductsWithAjax(
  execute: EndpointExecutor,
  options: Readonly<{
    candidates: readonly CatalogProduct[];
    routeRoot: string;
    limit: number;
    signal?: AbortSignal;
    onProgress?: (progress: CatalogProgress) => void;
  }>,
): Promise<Readonly<{
  products: CatalogProduct[];
  status: CapabilityProbeStatus;
  terminal: boolean;
  errors: CatalogError[];
}>> {
  const products: CatalogProduct[] = [];
  const errors: CatalogError[] = [];
  let terminalStatus: CapabilityProbeStatus | undefined;
  const candidates = options.candidates.slice(0, options.limit);
  for (const candidate of candidates) {
    if (candidate.handle === undefined || options.signal?.aborted === true) break;
    options.onProgress?.({
      phase: "product-ajax-js",
      productsFetched: products.length,
      detail: candidate.handle,
    });
    const result = await execute(
      { kind: "product-ajax-js", handle: candidate.handle },
      routeOptions(options.routeRoot, options.signal),
    );
    if (!result.ok) {
      errors.push(endpointError("product-ajax-js", result));
      if (isTerminalAccessResult(result)) {
        terminalStatus = capabilityStatus(result);
        break;
      }
      continue;
    }
    const normalized = normalizeCatalogProduct(result.data, "product-ajax-js");
    if (normalized !== undefined) products.push(normalized);
  }
  return {
    products,
    status:
      products.length > 0
        ? "ok"
        : terminalStatus ??
          (errors.some((error) => error.category === "not_json")
            ? "not_json"
            : "unavailable"),
    terminal: terminalStatus !== undefined,
    errors,
  };
}

export function parseSitemapDocument(
  xml: string,
  origin: string,
): Readonly<{
  products: CatalogProduct[];
  productSitemaps: ProductSitemapReference[];
  productSitemapIndexes: number[];
}> {
  const normalizedOrigin = new URL(origin).origin;
  const products = new CatalogAccumulator();
  const productSitemaps = new Map<string, ProductSitemapReference>();
  const urlBlocks = xml.match(/<url\b[^>]*>[\s\S]*?<\/url>/giu) ?? [];
  for (const block of urlBlocks) {
    const loc = firstXmlTag(block, "loc");
    if (loc === undefined) continue;
    const product = productFromPublicUrl(loc, normalizedOrigin, "sitemap");
    if (product === undefined) continue;
    const lastmod = firstXmlTag(block, "lastmod");
    products.add({
      ...product,
      ...(lastmod === undefined ? {} : { sitemapLastmod: clip(lastmod, 128) }),
    });
  }

  const locs = xml.match(/<loc\b[^>]*>[\s\S]*?<\/loc>/giu) ?? [];
  for (const locBlock of locs) {
    const value = firstXmlTag(locBlock, "loc");
    if (value === undefined) continue;
    const url = safePublicUrl(value);
    if (url === undefined || url.origin !== normalizedOrigin) continue;
    const match = /^\/sitemap_products_(\d+)\.xml$/u.exec(url.pathname);
    if (match === null) continue;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 1 || index > 100_000) continue;
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    if ((from === undefined) !== (to === undefined)) continue;
    if (
      from !== undefined &&
      to !== undefined &&
      (!validSitemapBound(from) ||
        !validSitemapBound(to) ||
        BigInt(from) > BigInt(to))
    ) {
      continue;
    }
    const reference: ProductSitemapReference = {
      index,
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    };
    productSitemaps.set(`${index}:${from ?? ""}:${to ?? ""}`, reference);
  }
  const references = [...productSitemaps.values()].sort(
    (left, right) => left.index - right.index,
  );
  return {
    products: products.values(),
    productSitemaps: references,
    productSitemapIndexes: unique(references.map((reference) => reference.index)),
  };
}

export function parseProductLinksFromHtml(
  html: string,
  origin: string,
): CatalogProduct[] {
  const products = new CatalogAccumulator();
  for (const href of htmlHrefs(html)) {
    const product = productFromPublicUrl(href, origin, "collection-html");
    if (product !== undefined) products.add(product);
  }
  return products.values();
}

export function parseCollectionHandlesFromHtml(
  html: string,
  origin: string,
): string[] {
  const normalizedOrigin = new URL(origin).origin;
  const handles = new Set<string>();
  for (const href of htmlHrefs(html)) {
    const url = safePublicUrl(href, `${normalizedOrigin}/`);
    if (url === undefined || url.origin !== normalizedOrigin) continue;
    const handle = routeHandleFromPath(url.pathname, "collections");
    if (handle !== undefined && handles.size < 50) handles.add(handle);
  }
  return [...handles];
}

export function hasNextCollectionPage(
  html: string,
  origin: string,
  routeRoot: string,
  handle: string,
  page: number,
  sortBy: "best-selling" | "created-descending" = "best-selling",
): boolean {
  const normalizedOrigin = new URL(origin).origin;
  const base = `${normalizedOrigin}${routeRoot}collections/${encodeURIComponent(handle)}?sort_by=${sortBy}&page=${page}`;
  for (const href of htmlHrefs(html)) {
    const url = safePublicUrl(href, base);
    if (
      url === undefined ||
      url.origin !== normalizedOrigin ||
      routeHandleFromPath(url.pathname, "collections") !== handle ||
      url.searchParams.get("sort_by") !== sortBy
    ) {
      continue;
    }
    const candidate = Number(url.searchParams.get("page"));
    if (Number.isSafeInteger(candidate) && candidate === page + 1) return true;
  }
  return false;
}

function htmlHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const hrefPattern = /\bhref\s*=\s*(?:"([^"]{1,2048})"|'([^']{1,2048})')/giu;
  for (const match of html.matchAll(hrefPattern)) {
    hrefs.push(decodeBasicEntities(match[1] ?? match[2] ?? ""));
    if (hrefs.length >= 10_000) break;
  }
  return hrefs;
}

function productFromPublicUrl(
  value: string,
  origin: string,
  source: CoverageSource,
): CatalogProduct | undefined {
  let url: URL;
  try {
    url = new URL(decodeBasicEntities(value), `${new URL(origin).origin}/`);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== new URL(origin).origin
  ) {
    return undefined;
  }
  const handle = routeHandleFromPath(url.pathname, "products");
  if (handle === undefined) return undefined;
  url.search = "";
  url.hash = "";
  return {
    handle,
    tags: [],
    variants: [],
    images: [],
    canonicalUrl: url.href,
    sources: [source],
  };
}

function normalizeCollectorPageProducts(
  candidates: readonly CollectorPageProduct[],
  origin: string,
): CatalogProduct[] {
  const normalizedOrigin = new URL(origin).origin;
  const products = new CatalogAccumulator();
  for (const candidate of candidates.slice(0, 100)) {
    const url = safePublicUrl(candidate.canonicalUrl);
    if (url === undefined || url.origin !== normalizedOrigin) continue;
    url.search = "";
    url.hash = "";
    const handle = routeHandleFromPath(url.pathname, "products");
    const sources = candidate.sources.filter(
      (source): source is Extract<CoverageSource, "canonical" | "dom" | "json-ld"> =>
        source === "canonical" || source === "dom" || source === "json-ld",
    );
    if (sources.length === 0) continue;
    const images = unique(
      candidate.images
        .slice(0, 20)
        .map((image) => safePublicUrl(image)?.href)
        .filter((image): image is string => image !== undefined),
    );
    products.add({
      ...(handle === undefined ? {} : { handle }),
      ...(candidate.title === undefined
        ? {}
        : { title: clip(candidate.title.trim(), 512) }),
      tags: [],
      variants: [],
      images,
      canonicalUrl: url.href,
      sources: unique(sources),
    });
  }
  return products.values();
}

function routeHandleFromPath(
  pathname: string,
  route: "products" | "collections",
): string | undefined {
  const rawSegments = pathname.split("/").filter(Boolean);
  const routeIndex = rawSegments.findIndex(
    (segment) => segment.toLowerCase() === route,
  );
  const rawHandle = routeIndex < 0 ? undefined : rawSegments[routeIndex + 1];
  if (rawHandle === undefined) return undefined;
  try {
    const handle = decodeURIComponent(rawHandle);
    return validHandle(handle) ? handle : undefined;
  } catch {
    return undefined;
  }
}

function normalizeCatalogProduct(
  value: unknown,
  source: CoverageSource,
): CatalogProduct | undefined {
  if (!isRecord(value)) return undefined;
  const id = scalarId(value.id);
  const handle = validHandleValue(value.handle);
  if (id === undefined && handle === undefined) return undefined;

  const variants = Array.isArray(value.variants)
    ? value.variants
        .map((variant) => normalizeVariant(variant, source))
        .filter((variant): variant is CatalogVariant => variant !== undefined)
        .slice(0, 250)
    : [];
  const images = normalizeImages(value.images);
  const tags = normalizeTags(value.tags);
  return {
    ...(id === undefined ? {} : { id }),
    ...(handle === undefined ? {} : { handle }),
    ...stringField(value.title, "title"),
    ...stringField(value.vendor, "vendor"),
    ...stringField(value.product_type, "productType"),
    tags,
    ...stringField(value.created_at, "createdAt"),
    ...stringField(value.published_at, "publishedAt"),
    ...stringField(value.updated_at, "updatedAt"),
    variants,
    images,
    sources: [source],
  };
}

function normalizeVariant(
  value: unknown,
  source: CoverageSource,
): CatalogVariant | undefined {
  if (!isRecord(value)) return undefined;
  const id = scalarId(value.id);
  if (id === undefined) return undefined;
  const price = scalarPrice(value.price);
  const compareAtPrice = scalarPrice(value.compare_at_price);
  return {
    id,
    ...stringField(value.title, "title"),
    ...stringField(value.sku, "sku"),
    ...(price === undefined ? {} : { price }),
    ...(compareAtPrice === undefined ? {} : { compareAtPrice }),
    ...(typeof value.available === "boolean" ? { available: value.available } : {}),
    ...(price === undefined ||
    (source !== "products-json" && source !== "product-ajax-js")
      ? {}
      : { priceSource: source }),
  };
}

function normalizeImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const images: string[] = [];
  for (const entry of value.slice(0, 250)) {
    const raw =
      typeof entry === "string"
        ? entry
        : isRecord(entry) && typeof entry.src === "string"
          ? entry.src
          : undefined;
    if (raw === undefined) continue;
    const url = safePublicUrl(raw);
    if (url !== undefined) images.push(clip(url.href, 2_048));
  }
  return unique(images);
}

function normalizeTags(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return unique(
    values
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => clip(entry.trim(), 256))
      .filter(Boolean),
  ).slice(0, 250);
}

class CatalogAccumulator {
  private readonly records = new Map<string, CatalogProduct>();
  private readonly idKeys = new Map<string, string>();
  private readonly handleKeys = new Map<string, string>();
  private readonly canonicalKeys = new Map<string, string>();
  private syntheticCounter = 0;

  get size(): number {
    return this.records.size;
  }

  add(product: CatalogProduct): { added: boolean; product: CatalogProduct } {
    const idKey = product.id === undefined ? undefined : this.idKeys.get(product.id);
    const handleKey =
      product.handle === undefined ? undefined : this.handleKeys.get(product.handle);
    const canonicalKey =
      product.canonicalUrl === undefined
        ? undefined
        : this.canonicalKeys.get(product.canonicalUrl);
    const existingKey = idKey ?? handleKey ?? canonicalKey;
    if (existingKey !== undefined) {
      const merged = mergeProducts(this.records.get(existingKey) as CatalogProduct, product);
      this.records.set(existingKey, merged);
      if (merged.id !== undefined) this.idKeys.set(merged.id, existingKey);
      if (merged.handle !== undefined) this.handleKeys.set(merged.handle, existingKey);
      if (merged.canonicalUrl !== undefined) {
        this.canonicalKeys.set(merged.canonicalUrl, existingKey);
      }
      return { added: false, product: merged };
    }
    const key =
      product.id !== undefined
        ? `id:${product.id}`
        : product.handle !== undefined
          ? `handle:${product.handle}`
          : product.canonicalUrl !== undefined
            ? `canonical:${product.canonicalUrl}`
            : `synthetic:${this.syntheticCounter++}`;
    this.records.set(key, product);
    if (product.id !== undefined) this.idKeys.set(product.id, key);
    if (product.handle !== undefined) this.handleKeys.set(product.handle, key);
    if (product.canonicalUrl !== undefined) {
      this.canonicalKeys.set(product.canonicalUrl, key);
    }
    return { added: true, product };
  }

  addAll(products: readonly CatalogProduct[]): CatalogProduct[] {
    return products.map((product) => this.add(product).product);
  }

  values(): CatalogProduct[] {
    return [...this.records.values()];
  }
}

function mergeProducts(
  existing: CatalogProduct,
  incoming: CatalogProduct,
): CatalogProduct {
  return {
    ...(existing.id === undefined && incoming.id !== undefined
      ? { id: incoming.id }
      : existing.id === undefined
        ? {}
        : { id: existing.id }),
    ...(existing.handle === undefined && incoming.handle !== undefined
      ? { handle: incoming.handle }
      : existing.handle === undefined
        ? {}
        : { handle: existing.handle }),
    ...preferString(existing.title, incoming.title, "title"),
    ...preferString(existing.vendor, incoming.vendor, "vendor"),
    ...preferString(existing.productType, incoming.productType, "productType"),
    tags: unique([...existing.tags, ...incoming.tags]),
    ...preferString(existing.createdAt, incoming.createdAt, "createdAt"),
    ...preferString(existing.publishedAt, incoming.publishedAt, "publishedAt"),
    ...preferString(existing.updatedAt, incoming.updatedAt, "updatedAt"),
    ...preferString(existing.canonicalUrl, incoming.canonicalUrl, "canonicalUrl"),
    ...preferString(existing.sitemapLastmod, incoming.sitemapLastmod, "sitemapLastmod"),
    variants: incoming.variants.length > 0 ? incoming.variants : existing.variants,
    images: unique([...existing.images, ...incoming.images]),
    sources: unique([...existing.sources, ...incoming.sources]),
  };
}

function paginationResult(
  products: CatalogAccumulator,
  termination: PaginationTermination,
  complete: boolean,
  truncated: boolean,
  pagesRequested: number,
  errors: CatalogError[],
): PaginationResult {
  return {
    products: products.values(),
    termination,
    complete,
    truncated,
    pagesRequested,
    errors,
  };
}

function catalogResult(
  products: CatalogAccumulator,
  capabilityProbes: Record<string, CapabilityProbeStatus>,
  sources: readonly CoverageSource[],
  complete: boolean,
  truncated: boolean,
  termination: CatalogTermination,
  errors: CatalogError[],
  estimatedTotal?: number,
): CatalogScanResult {
  return {
    products: products.values(),
    coverage: {
      productsFetched: products.size,
      ...(estimatedTotal === undefined ? {} : { estimatedTotal }),
      truncated,
      sources: unique(sources),
      capabilityProbes: { ...capabilityProbes },
    },
    termination,
    complete,
    errors,
  };
}

function capabilityStatus(result: EndpointExecutionResult): CapabilityProbeStatus {
  if (result.ok) return "ok";
  return capabilityStatusFromCategory(result.category);
}

function capabilityStatusFromCategory(
  category: CatalogError["category"],
): CapabilityProbeStatus {
  if (category === "challenge_page" || category === "security_rejected") {
    return "challenge";
  }
  if (category === "not_json" || category === "unexpected_content_type") {
    return "not_json";
  }
  return "unavailable";
}

function isTerminalAccessResult(result: EndpointExecutionResult): boolean {
  return (
    !result.ok &&
    (result.category === "challenge_page" ||
      result.category === "security_rejected" ||
      result.category === "password_page")
  );
}

function isTerminalCatalogError(error: CatalogError): boolean {
  return (
    error.category === "challenge_page" ||
    error.category === "security_rejected" ||
    error.category === "password_page"
  );
}

function endpointError(
  source: string,
  result: Extract<EndpointExecutionResult, { ok: false }>,
  page?: number,
): CatalogError {
  return {
    source,
    category: result.category,
    message: clip(result.message, 256),
    ...(page === undefined ? {} : { page }),
  };
}

function readProductsEnvelope(value: unknown): unknown[] | undefined {
  return isRecord(value) && Array.isArray(value.products)
    ? value.products
    : undefined;
}

function productIdentityKey(product: CatalogProduct): string | undefined {
  if (product.id !== undefined) return `id:${product.id}`;
  if (product.handle !== undefined) return `handle:${product.handle}`;
  return product.canonicalUrl === undefined
    ? undefined
    : `canonical:${product.canonicalUrl}`;
}

function hashPageKeys(keys: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const character of keys.join("\u001f")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${keys.length}:${hash.toString(16).padStart(8, "0")}`;
}

async function emitProducts(
  products: readonly CatalogProduct[],
  checkpoint: ProductCheckpoint | undefined,
): Promise<void> {
  if (checkpoint === undefined || products.length === 0) return;
  for (let index = 0; index < products.length; index += 100) {
    await checkpoint(products.slice(index, index + 100));
  }
}

function normalizeScanOptions(options: CatalogScanOptions): Required<
  Pick<
    CatalogScanOptions,
    | "origin"
    | "routeRoot"
    | "productLimit"
    | "pageSize"
    | "ajaxSupplementLimit"
    | "maxSitemapFiles"
    | "maxCollectionPages"
    | "pageProducts"
    | "collectionHandles"
  >
> &
  Pick<CatalogScanOptions, "signal" | "onProducts" | "onProgress"> {
  const origin = new URL(options.origin).origin;
  if (origin !== options.origin) throw new TypeError("origin must be canonical");
  const routeRoot = options.routeRoot ?? "/";
  if (!/^\/(?:[a-z]{2,3}(?:-(?:[a-z]{2}|[0-9]{3}))?\/)?$/u.test(routeRoot)) {
    throw new TypeError("invalid routeRoot");
  }
  return {
    origin,
    routeRoot,
    productLimit: positiveInteger(
      options.productLimit,
      DEFAULT_PRODUCT_LIMIT,
      "productLimit",
      100_000,
    ),
    pageSize: positiveInteger(
      options.pageSize,
      DEFAULT_PRODUCTS_PAGE_SIZE,
      "pageSize",
      250,
    ),
    ajaxSupplementLimit: nonNegativeInteger(
      options.ajaxSupplementLimit,
      DEFAULT_AJAX_SUPPLEMENT_LIMIT,
      "ajaxSupplementLimit",
      250,
    ),
    maxSitemapFiles: positiveInteger(
      options.maxSitemapFiles,
      20,
      "maxSitemapFiles",
      100,
    ),
    maxCollectionPages: positiveInteger(
      options.maxCollectionPages,
      DEFAULT_COLLECTION_PAGE_LIMIT,
      "maxCollectionPages",
      100,
    ),
    pageProducts: (options.pageProducts ?? []).slice(0, 100),
    collectionHandles: unique(
      (options.collectionHandles ?? []).filter((handle) => validHandle(handle)),
    ).slice(0, 50),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProducts === undefined ? {} : { onProducts: options.onProducts }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  };
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

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > maximum) {
    throw new TypeError(`${name} must be a non-negative safe integer <= ${maximum}`);
  }
  return normalized;
}

function signalOptions(signal: AbortSignal | undefined): EndpointExecutorOptions {
  return signal === undefined ? {} : { signal };
}

function routeOptions(
  routeRoot: string,
  signal: AbortSignal | undefined,
): EndpointExecutorOptions {
  return {
    routeRoot,
    ...(signal === undefined ? {} : { signal }),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Scan aborted", "AbortError");
  }
}

function scalarId(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= 128
      ? normalized
      : undefined;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : undefined;
}

function scalarPrice(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.length <= 128) return value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validHandleValue(value: unknown): string | undefined {
  return typeof value === "string" && validHandle(value) ? value : undefined;
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

function validSitemapBound(value: string): boolean {
  return /^(?:0|[1-9]\d{0,19})$/u.test(value);
}

function stringField<K extends string>(
  value: unknown,
  key: K,
): { [P in K]?: string } {
  return typeof value === "string" && value.length > 0
    ? ({ [key]: clip(value, 4_096) } as { [P in K]: string })
    : {};
}

function preferString<K extends string>(
  existing: string | undefined,
  incoming: string | undefined,
  key: K,
): { [P in K]?: string } {
  const value = incoming ?? existing;
  return value === undefined ? {} : ({ [key]: value } as { [P in K]: string });
}

function firstXmlTag(block: string, tag: string): string | undefined {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "iu");
  const match = pattern.exec(block);
  if (match?.[1] === undefined) return undefined;
  const value = decodeBasicEntities(match[1].trim());
  return value.length > 0 ? value : undefined;
}

function decodeBasicEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function safePublicUrl(value: string, base?: string): URL | undefined {
  try {
    const url = base === undefined ? new URL(value) : new URL(value, base);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clip(value: string, length: number): string {
  return value.slice(0, length);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
