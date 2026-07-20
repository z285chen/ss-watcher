import type {
  CollectorProbeResult,
  ShopifyProbeResult,
} from "../../content/probes";
import type { EndpointExecutionResult } from "../network/request-policy";
import {
  parseAnonymousShopifyContext,
  type AnonymousShopifyContext,
} from "./anonymous-context";
import {
  createRetryingEndpointExecutor,
  type RetryExecutionSummary,
  type RetryingEndpointOptions,
  type RetryingEndpointExecutor,
} from "../network/retry-executor";
import {
  scanGenericCatalog,
  scanHostedCatalog,
  type CapabilityProbeStatus,
  type CatalogError,
  type CatalogProgress,
  type CatalogScanOptions,
  type CatalogScanResult,
  type EndpointExecutor,
} from "./catalog-scanner";
import {
  classifyShopifyStorefront,
  type ShopifyDetectionResult,
  type StorefrontKind,
} from "./detection";
import {
  verifyProductsJsonPrices,
  type ProductsJsonPriceVerification,
} from "./price-source-verification";

export type StorefrontScanStatus =
  | "completed"
  | "partial"
  | "not-shopify"
  | "blocked";

export type StorefrontScanStage =
  | "meta-probe"
  | "classification"
  | "cart-probe"
  | "anonymous-context"
  | "catalog"
  | "price-verification";

export type StorefrontScanContext = Readonly<{
  routeRoot: string;
  routeRootSource: "probe" | "fallback";
  locale?: string;
  localeSource: "route-root" | "endpoint" | "unknown";
  country?: string;
  countrySource: "anonymous-page" | "endpoint" | "unknown";
  currency?: string;
  currencySource: "cart-js" | "unknown";
  priceSourceStatus: Readonly<
    Partial<
      Record<
        "product-ajax-js" | "products-json" | "collection-products-json" | "dom",
        "verified" | "unverified" | "not-used"
      >
    >
  >;
  priceContextVerified: boolean;
  credentialMode: "omit";
  transport: "service-worker";
  storefrontKind: StorefrontKind;
  page?: Readonly<{
    routeRoot?: string;
    locale?: string;
    country?: string;
    currency?: string;
  }>;
  contextMismatch?: boolean;
}>;

export type StorefrontScanInput = Readonly<{
  origin: string;
  main: ShopifyProbeResult | null;
  collector: CollectorProbeResult;
  execute: EndpointExecutor;
  productLimit?: number;
  pageSize?: number;
  ajaxSupplementLimit?: number;
  maxSitemapFiles?: number;
  maxCollectionPages?: number;
  priceSampleLimit?: number;
  signal?: AbortSignal;
  onProducts?: CatalogScanOptions["onProducts"];
  onProgress?: (progress: CatalogProgress) => void;
  onStage?: (stage: StorefrontScanStage) => void;
  retry?: RetryingEndpointOptions;
  retrying?: RetryingEndpointExecutor;
}>;

export type StorefrontScanResult = Readonly<{
  status: StorefrontScanStatus;
  detection: ShopifyDetectionResult;
  context: StorefrontScanContext;
  catalog: CatalogScanResult;
  anonymousContext: AnonymousShopifyContext;
  priceVerification: ProductsJsonPriceVerification;
  runtimeDiagnostics: Readonly<{
    retry: RetryExecutionSummary;
  }>;
}>;

/** Coordinates detection and catalog strategy while SW remains a one-request executor. */
export async function scanStorefront(
  input: StorefrontScanInput,
): Promise<StorefrontScanResult> {
  const origin = new URL(input.origin).origin;
  if (origin !== input.origin) throw new TypeError("origin must be canonical");
  const routeRoot = input.main?.routeRoot ?? "/";
  const retrying =
    input.retrying ?? createRetryingEndpointExecutor(input.execute, input.retry);
  const execute = retrying.execute;

  input.onStage?.("meta-probe");
  const meta = await execute(
    { kind: "meta" },
    signalOptions(input.signal),
  );
  let detection = classifyShopifyStorefront({
    origin,
    main: input.main,
    collector: input.collector,
    meta,
  });
  const metaStatus = capabilityStatus(meta);
  if (isTerminalAccessResult(meta)) {
    return resultWithEmptyCatalog(
      "blocked",
      detection,
      contextFor(input.main, detection.storefrontKind, undefined),
      { meta: metaStatus },
      "terminal-access-gate",
      [endpointCatalogError("meta", meta)],
      retrying.getSummary(),
    );
  }

  input.onStage?.("classification");
  if (!detection.isShopify) {
    return resultWithEmptyCatalog(
      "not-shopify",
      detection,
      contextFor(input.main, detection.storefrontKind, undefined),
      { meta: metaStatus },
      "fallback-exhausted",
      [],
      retrying.getSummary(),
    );
  }

  let cartContext: EndpointExecutionResult | undefined;
  let cartStatus: CapabilityProbeStatus | undefined;
  if (detection.cartProbeEligible) {
    input.onStage?.("cart-probe");
    cartContext = await execute(
      { kind: "cart-context" },
      routeOptions(routeRoot, input.signal),
    );
    cartStatus = capabilityStatus(cartContext);
    detection = classifyShopifyStorefront({
      origin,
      main: input.main,
      collector: input.collector,
      meta,
      cartContext,
    });
    if (isTerminalAccessResult(cartContext)) {
      return resultWithEmptyCatalog(
        "blocked",
        detection,
        contextFor(input.main, detection.storefrontKind, cartContext),
        { meta: metaStatus, "cart-context": cartStatus },
        "terminal-access-gate",
        [endpointCatalogError("cart-context", cartContext)],
        retrying.getSummary(),
      );
    }
  }

  let anonymousContext: AnonymousShopifyContext = { evidence: [] };
  let anonymousContextStatus: CapabilityProbeStatus | undefined;
  if (detection.storefrontKind === "hosted-theme") {
    input.onStage?.("anonymous-context");
    const anonymousPage = await execute(
      { kind: "page-html", target: "route-root" },
      routeOptions(routeRoot, input.signal),
    );
    anonymousContextStatus = capabilityStatus(anonymousPage);
    if (isTerminalAccessResult(anonymousPage)) {
      return resultWithEmptyCatalog(
        "blocked",
        detection,
        contextFor(
          input.main,
          detection.storefrontKind,
          cartContext,
          anonymousContext,
        ),
        {
          meta: metaStatus,
          ...(cartStatus === undefined ? {} : { "cart-context": cartStatus }),
          "anonymous-context": anonymousContextStatus,
        },
        "terminal-access-gate",
        [endpointCatalogError("anonymous-context", anonymousPage)],
        retrying.getSummary(),
      );
    }
    if (anonymousPage.ok) {
      anonymousContext = parseAnonymousShopifyContext(anonymousPage.data);
    }
  }

  input.onStage?.("catalog");
  const catalogOptions: CatalogScanOptions = {
    origin,
    routeRoot,
    ...(input.productLimit === undefined
      ? {}
      : { productLimit: input.productLimit }),
    ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
    ...(input.ajaxSupplementLimit === undefined
      ? {}
      : { ajaxSupplementLimit: input.ajaxSupplementLimit }),
    ...(input.maxSitemapFiles === undefined
      ? {}
      : { maxSitemapFiles: input.maxSitemapFiles }),
    ...(input.maxCollectionPages === undefined
      ? {}
      : { maxCollectionPages: input.maxCollectionPages }),
    pageProducts: input.collector.ok ? input.collector.pageProducts : [],
    collectionHandles: input.collector.ok
      ? input.collector.collectionHandles
      : [],
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.onProducts === undefined ? {} : { onProducts: input.onProducts }),
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
  };
  const catalog =
    detection.storefrontKind === "hosted-theme"
      ? await scanHostedCatalog(execute, catalogOptions)
      : await scanGenericCatalog(execute, catalogOptions);
  const mergedCatalog: CatalogScanResult = {
    ...catalog,
    coverage: {
      ...catalog.coverage,
      capabilityProbes: {
        meta: metaStatus,
        ...(cartStatus === undefined ? {} : { "cart-context": cartStatus }),
        ...(anonymousContextStatus === undefined
          ? {}
          : { "anonymous-context": anonymousContextStatus }),
        ...catalog.coverage.capabilityProbes,
      },
    },
  };

  input.onStage?.("price-verification");
  const verifiedCartCurrency = cartCurrency(cartContext);
  const priceVerification = await verifyProductsJsonPrices(execute, {
    products: mergedCatalog.products,
    routeRoot,
    ...(verifiedCartCurrency === undefined
      ? {}
      : { currency: verifiedCartCurrency }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.priceSampleLimit === undefined
      ? {}
      : { productSampleLimit: input.priceSampleLimit }),
  });
  const status: StorefrontScanStatus =
    mergedCatalog.termination === "terminal-access-gate"
      ? "blocked"
      : priceVerification.terminal
        ? "partial"
      : detection.storefrontKind === "hosted-theme" && mergedCatalog.complete
        ? "completed"
        : "partial";

  const context = contextWithCatalog(
    contextFor(
      input.main,
      detection.storefrontKind,
      cartContext,
      anonymousContext,
    ),
    mergedCatalog,
    priceVerification,
  );

  return {
    status,
    detection,
    context,
    catalog: mergedCatalog,
    anonymousContext,
    priceVerification,
    runtimeDiagnostics: { retry: retrying.getSummary() },
  };
}

function resultWithEmptyCatalog(
  status: StorefrontScanStatus,
  detection: ShopifyDetectionResult,
  context: StorefrontScanContext,
  capabilityProbes: Record<string, CapabilityProbeStatus>,
  termination: CatalogScanResult["termination"],
  errors: CatalogError[],
  retry: RetryExecutionSummary,
): StorefrontScanResult {
  return {
    status,
    detection,
    context,
    catalog: {
      products: [],
      coverage: {
        productsFetched: 0,
        truncated: false,
        sources: [],
        capabilityProbes,
      },
      termination,
      complete: false,
      errors,
    },
    anonymousContext: { evidence: [] },
    priceVerification: emptyPriceVerification(),
    runtimeDiagnostics: { retry },
  };
}

function endpointCatalogError(
  source: string,
  result: Extract<EndpointExecutionResult, { ok: false }>,
): CatalogError {
  return {
    source,
    category: result.category,
    message: result.message.slice(0, 256),
  };
}

function contextFor(
  main: ShopifyProbeResult | null,
  storefrontKind: StorefrontKind,
  cartContext: EndpointExecutionResult | undefined,
  anonymousContext: AnonymousShopifyContext = { evidence: [] },
): StorefrontScanContext {
  const routeRoot = main?.routeRoot ?? "/";
  // A successful cart request used only for classification does not grant
  // custom/uncertain storefronts a trusted Ajax price context.
  const currency =
    storefrontKind === "hosted-theme" ? cartCurrency(cartContext) : undefined;
  const page =
    main === null
      ? undefined
      : {
          ...(main.routeRoot === undefined ? {} : { routeRoot: main.routeRoot }),
          ...(main.locale === undefined ? {} : { locale: main.locale }),
          ...(main.country === undefined ? {} : { country: main.country }),
          ...(main.currencyActive === undefined
            ? {}
            : { currency: main.currencyActive }),
        };
  const locale = anonymousContext.locale ?? main?.locale;
  const contextMismatch = contextsMismatch(page, anonymousContext, currency);
  return {
    routeRoot,
    routeRootSource: main?.routeRoot === undefined ? "fallback" : "probe",
    ...(locale === undefined ? {} : { locale }),
    localeSource:
      anonymousContext.locale !== undefined
        ? "endpoint"
        : main?.routeRoot === undefined
          ? "unknown"
          : "route-root",
    ...(anonymousContext.country === undefined
      ? {}
      : { country: anonymousContext.country }),
    countrySource:
      anonymousContext.country === undefined ? "unknown" : "anonymous-page",
    ...(currency === undefined ? {} : { currency }),
    currencySource: currency === undefined ? "unknown" : "cart-js",
    priceSourceStatus: {},
    // M0 deliberately did not claim anonymous country/market evidence. Keep the
    // price gate false until that independent condition is implemented.
    priceContextVerified: false,
    credentialMode: "omit",
    transport: "service-worker",
    storefrontKind,
    ...(page === undefined ? {} : { page }),
    ...(contextMismatch ? { contextMismatch: true } : {}),
  };
}

function cartCurrency(result: EndpointExecutionResult | undefined): string | undefined {
  if (!result?.ok || result.kind !== "cart-context" || !isRecord(result.data)) {
    return undefined;
  }
  const currency = result.data.currency;
  return typeof currency === "string" && /^[A-Z]{3}$/u.test(currency)
    ? currency
    : undefined;
}

function contextWithCatalog(
  context: StorefrontScanContext,
  catalog: CatalogScanResult,
  verification: ProductsJsonPriceVerification,
): StorefrontScanContext {
  const anonymousGatePassed =
    context.storefrontKind === "hosted-theme" &&
    context.countrySource !== "unknown" &&
    context.currencySource === "cart-js" &&
    context.contextMismatch !== true;
  const productsJsonPricesUsed = catalog.products.some(
    (product) =>
      product.sources.includes("products-json") &&
      product.variants.some((variant) => variant.price !== undefined),
  );
  const productAjaxPricesUsed = catalog.products.some(
    (product) =>
      product.sources.includes("product-ajax-js") &&
      product.variants.some((variant) => variant.price !== undefined),
  );
  const priceSourceStatus: StorefrontScanContext["priceSourceStatus"] = {
    ...(productsJsonPricesUsed
      ? {
          "products-json":
            anonymousGatePassed && verification.status === "verified"
              ? ("verified" as const)
              : ("unverified" as const),
        }
      : {}),
    ...(productAjaxPricesUsed
      ? {
          "product-ajax-js": anonymousGatePassed
            ? ("verified" as const)
            : ("unverified" as const),
        }
      : {}),
  };
  const usedStatuses = Object.values(priceSourceStatus);
  return {
    ...context,
    priceSourceStatus,
    priceContextVerified:
      anonymousGatePassed &&
      usedStatuses.length > 0 &&
      usedStatuses.every((status) => status === "verified"),
  };
}

function contextsMismatch(
  page: StorefrontScanContext["page"],
  anonymousContext: AnonymousShopifyContext,
  cartCurrencyValue: string | undefined,
): boolean {
  return (
    differs(page?.country, anonymousContext.country) ||
    differs(page?.locale, anonymousContext.locale) ||
    differs(page?.currency, cartCurrencyValue) ||
    differs(anonymousContext.currency, cartCurrencyValue)
  );
}

function differs(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left !== right;
}

function emptyPriceVerification(): ProductsJsonPriceVerification {
  return {
    status: "not-used",
    checkedProducts: 0,
    checkedVariants: 0,
    candidateProducts: 0,
    reason: "no_price_data",
    samples: [],
    terminal: false,
  };
}

function capabilityStatus(result: EndpointExecutionResult): CapabilityProbeStatus {
  if (result.ok) return "ok";
  if (
    result.category === "challenge_page" ||
    result.category === "security_rejected"
  ) {
    return "challenge";
  }
  if (
    result.category === "not_json" ||
    result.category === "unexpected_content_type"
  ) {
    return "not_json";
  }
  return "unavailable";
}

function isTerminalAccessResult(
  result: EndpointExecutionResult,
): result is Extract<EndpointExecutionResult, { ok: false }> {
  return (
    !result.ok &&
    (result.category === "challenge_page" ||
      result.category === "security_rejected" ||
      result.category === "password_page")
  );
}

function signalOptions(signal: AbortSignal | undefined): {
  signal?: AbortSignal;
} {
  return signal === undefined ? {} : { signal };
}

function routeOptions(
  routeRoot: string,
  signal: AbortSignal | undefined,
): { routeRoot: string; signal?: AbortSignal } {
  return {
    routeRoot,
    ...(signal === undefined ? {} : { signal }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
