import type { StorefrontScanContext } from "../shopify/storefront-scanner";
import type {
  CatalogProduct,
  CatalogVariant,
} from "../shopify/catalog-scanner";
import {
  currencyFractionDigits,
  decimalToMinorUnits,
} from "../shopify/price-consistency";

export type DistributionEntry = Readonly<{ value: string; count: number }>;

export type ProductStatistics = Readonly<{
  productCount: number;
  variantCount: number;
  availability: Readonly<{
    availableProducts: number;
    unavailableProducts: number;
    unknownProducts: number;
  }>;
  price: Readonly<{
    status: "verified" | "unverified" | "not-available";
    currency?: string;
    fractionDigits?: number;
    pricedVariantCount: number;
    minMinor?: string;
    maxMinor?: string;
    averageMinor?: string;
  }>;
  discount: Readonly<{
    discountedProducts: number;
    discountedVariants: number;
    comparableVariants: number;
  }>;
  vendors: readonly DistributionEntry[];
  productTypes: readonly DistributionEntry[];
  tags: readonly DistributionEntry[];
  timestamps: Readonly<{
    earliestCreatedAt?: string;
    latestCreatedAt?: string;
    earliestPublishedAt?: string;
    latestPublishedAt?: string;
  }>;
}>;

export function computeProductStatistics(
  products: readonly CatalogProduct[],
  context: StorefrontScanContext,
): ProductStatistics {
  let variantCount = 0;
  let availableProducts = 0;
  let unavailableProducts = 0;
  let unknownProducts = 0;
  let discountedProducts = 0;
  let discountedVariants = 0;
  let comparableVariants = 0;
  const verifiedPrices: bigint[] = [];
  const fractionDigits =
    context.currency === undefined
      ? undefined
      : currencyFractionDigits(context.currency);

  for (const product of products) {
    variantCount += product.variants.length;
    const availability = productAvailability(product.variants);
    if (availability === "available") availableProducts += 1;
    else if (availability === "unavailable") unavailableProducts += 1;
    else unknownProducts += 1;

    let productDiscounted = false;
    for (const variant of product.variants) {
      const price = normalizedMinorPrice(variant.price, variant.priceSource, fractionDigits);
      const compareAt = normalizedMinorPrice(
        variant.compareAtPrice,
        variant.priceSource,
        fractionDigits,
      );
      const sourceVerified =
        variant.priceSource !== undefined &&
        context.priceSourceStatus[variant.priceSource] === "verified";
      if (sourceVerified && price !== undefined) verifiedPrices.push(price);
      if (price !== undefined && compareAt !== undefined) {
        comparableVariants += 1;
        if (compareAt > price) {
          discountedVariants += 1;
          productDiscounted = true;
        }
      }
    }
    if (productDiscounted) discountedProducts += 1;
  }

  const publishablePrices = context.priceContextVerified ? verifiedPrices : [];
  const priceStatus =
    publishablePrices.length > 0
      ? "verified" as const
      : hasAnyRawPrice(products)
        ? "unverified" as const
        : "not-available" as const;
  const priceSummary = summarizePrices(publishablePrices);

  return {
    productCount: products.length,
    variantCount,
    availability: {
      availableProducts,
      unavailableProducts,
      unknownProducts,
    },
    price: {
      status: priceStatus,
      ...(context.currency === undefined ? {} : { currency: context.currency }),
      ...(fractionDigits === undefined ? {} : { fractionDigits }),
      pricedVariantCount: publishablePrices.length,
      ...priceSummary,
    },
    discount: {
      discountedProducts,
      discountedVariants,
      comparableVariants,
    },
    vendors: distribution(products.map((product) => product.vendor)),
    productTypes: distribution(products.map((product) => product.productType)),
    tags: distribution(products.flatMap((product) => product.tags)),
    timestamps: {
      ...timestampRange(products.map((product) => product.createdAt), "CreatedAt"),
      ...timestampRange(products.map((product) => product.publishedAt), "PublishedAt"),
    },
  };
}

function productAvailability(
  variants: readonly CatalogVariant[],
): "available" | "unavailable" | "unknown" {
  if (variants.some((variant) => variant.available === true)) return "available";
  if (variants.length > 0 && variants.every((variant) => variant.available === false)) {
    return "unavailable";
  }
  return "unknown";
}

function normalizedMinorPrice(
  value: string | number | undefined,
  source: CatalogVariant["priceSource"],
  fractionDigits: number | undefined,
): bigint | undefined {
  if (value === undefined || source === undefined) return undefined;
  if (source === "products-json") {
    if (fractionDigits === undefined) return undefined;
    const minor = decimalToMinorUnits(String(value), fractionDigits);
    return minor === undefined ? undefined : BigInt(minor);
  }
  const normalized = typeof value === "number" ? String(value) : value;
  return /^(?:0|[1-9]\d*)$/u.test(normalized) ? BigInt(normalized) : undefined;
}

function summarizePrices(
  values: readonly bigint[],
): { minMinor?: string; maxMinor?: string; averageMinor?: string } {
  if (values.length === 0) return {};
  let min = values[0] as bigint;
  let max = values[0] as bigint;
  let sum = 0n;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  const average = (sum + BigInt(Math.floor(values.length / 2))) /
    BigInt(values.length);
  return {
    minMinor: String(min),
    maxMinor: String(max),
    averageMinor: String(average),
  };
}

function distribution(values: readonly (string | undefined)[]): DistributionEntry[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw?.trim();
    if (value === undefined || value.length === 0) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function timestampRange<K extends "CreatedAt" | "PublishedAt">(
  values: readonly (string | undefined)[],
  suffix: K,
): K extends "CreatedAt"
  ? { earliestCreatedAt?: string; latestCreatedAt?: string }
  : { earliestPublishedAt?: string; latestPublishedAt?: string } {
  const valid = values
    .filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  if (valid.length === 0) return {} as never;
  return (suffix === "CreatedAt"
    ? { earliestCreatedAt: valid[0], latestCreatedAt: valid.at(-1) }
    : { earliestPublishedAt: valid[0], latestPublishedAt: valid.at(-1) }) as never;
}

function hasAnyRawPrice(products: readonly CatalogProduct[]): boolean {
  return products.some((product) =>
    product.variants.some((variant) => variant.price !== undefined),
  );
}
