import type { EndpointFailureCategory } from "../network/request-policy";
import type {
  CatalogProduct,
  EndpointExecutor,
} from "./catalog-scanner";
import {
  verifyShopifyVariantPriceConsistency,
  type PriceConsistencyFailureReason,
  type VariantPriceSample,
} from "./price-consistency";

export type ProductsJsonPriceVerification = Readonly<{
  status: "verified" | "unverified" | "not-used";
  checkedProducts: number;
  checkedVariants: number;
  candidateProducts: number;
  reason?:
    | PriceConsistencyFailureReason
    | "no_price_data"
    | "missing_currency"
    | `endpoint_${EndpointFailureCategory}`;
  samples: readonly VariantPriceSample[];
  terminal: boolean;
}>;

const DEFAULT_PRODUCT_SAMPLE_LIMIT = 3;

/**
 * Checks decimal B-grade products.json prices against the official Ajax
 * Product representation for identical product and variant IDs.
 */
export async function verifyProductsJsonPrices(
  execute: EndpointExecutor,
  options: Readonly<{
    products: readonly CatalogProduct[];
    currency?: string;
    routeRoot: string;
    signal?: AbortSignal;
    productSampleLimit?: number;
  }>,
): Promise<ProductsJsonPriceVerification> {
  const candidates = options.products.filter(isProductsJsonPriceCandidate);
  if (candidates.length === 0) {
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
  if (options.currency === undefined) {
    return {
      status: "unverified",
      checkedProducts: 0,
      checkedVariants: 0,
      candidateProducts: candidates.length,
      reason: "missing_currency",
      samples: [],
      terminal: false,
    };
  }

  const sampleLimit = positiveSampleLimit(options.productSampleLimit);
  const samples: VariantPriceSample[] = [];
  let checkedProducts = 0;
  let checkedVariants = 0;

  for (const product of candidates.slice(0, sampleLimit)) {
    throwIfAborted(options.signal);
    const result = await execute(
      { kind: "product-ajax-js", handle: product.handle as string },
      {
        routeRoot: options.routeRoot,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    if (!result.ok) {
      return {
        status: "unverified",
        checkedProducts,
        checkedVariants,
        candidateProducts: candidates.length,
        reason: `endpoint_${result.category}`,
        samples,
        terminal: isTerminalCategory(result.category),
      };
    }

    const verification = verifyShopifyVariantPriceConsistency(
      productsJsonShape(product),
      result.data,
      options.currency,
    );
    checkedProducts += 1;
    checkedVariants += verification.checkedVariants;
    samples.push(...verification.samples);
    if (verification.status !== "verified") {
      return {
        status: "unverified",
        checkedProducts,
        checkedVariants,
        candidateProducts: candidates.length,
        reason: verification.reason,
        samples,
        terminal: false,
      };
    }
  }

  return {
    status: checkedProducts > 0 ? "verified" : "unverified",
    checkedProducts,
    checkedVariants,
    candidateProducts: candidates.length,
    ...(checkedProducts > 0 ? {} : { reason: "no_price_data" as const }),
    samples,
    terminal: false,
  };
}

function isProductsJsonPriceCandidate(
  product: CatalogProduct,
): product is CatalogProduct & { id: string; handle: string } {
  return (
    product.sources.includes("products-json") &&
    typeof product.id === "string" &&
    typeof product.handle === "string" &&
    product.variants.some((variant) => variant.price !== undefined)
  );
}

function productsJsonShape(product: CatalogProduct): unknown {
  return {
    id: product.id,
    handle: product.handle,
    variants: product.variants
      .filter((variant) => variant.price !== undefined)
      .map((variant) => ({ id: variant.id, price: variant.price })),
  };
}

function positiveSampleLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PRODUCT_SAMPLE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) {
    throw new TypeError("productSampleLimit must be an integer from 1 to 20");
  }
  return value;
}

function isTerminalCategory(category: EndpointFailureCategory): boolean {
  return (
    category === "challenge_page" ||
    category === "security_rejected" ||
    category === "password_page"
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Scan cancelled", "AbortError");
}
