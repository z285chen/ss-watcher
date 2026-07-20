export type PriceConsistencyFailureReason =
  | "invalid_currency"
  | "invalid_sample_limit"
  | "invalid_product_schema"
  | "product_identity_mismatch"
  | "no_shared_variant"
  | "invalid_price"
  | "price_mismatch";

export type VariantPriceSample = Readonly<{
  variantId: string;
  productsJsonDecimal: string;
  productsJsonMinor: string;
  productAjaxMinor: string;
  matches: boolean;
}>;

export type PriceConsistencyResult =
  | Readonly<{
      status: "verified";
      currency: string;
      fractionDigits: number;
      checkedVariants: number;
      samples: readonly VariantPriceSample[];
    }>
  | Readonly<{
      status: "unverified";
      currency: string;
      reason: PriceConsistencyFailureReason;
      fractionDigits?: number;
      checkedVariants: number;
      samples: readonly VariantPriceSample[];
    }>;

type ProductPriceSample = Readonly<{
  id: string;
  handle: string;
  variants: ReadonlyMap<string, unknown>;
}>;

const ISO_CURRENCY = /^[A-Z]{3}$/u;
const DECIMAL_PRICE = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/u;
const INTEGER_PRICE = /^(?:0|[1-9]\d*)$/u;
const DEFAULT_SAMPLE_LIMIT = 5;
const MAX_SAMPLE_LIMIT = 20;

/**
 * Verifies the B-grade products.json price representation against Shopify's
 * Ajax Product API representation for the exact same product and variant IDs.
 *
 * products.json exposes decimal major-unit strings (for example "34.99"),
 * while products/{handle}.js exposes integer minor units (for example 3499).
 * Conversion is string based so no floating-point rounding enters the gate.
 */
export function verifyShopifyVariantPriceConsistency(
  productsJsonProduct: unknown,
  productAjaxProduct: unknown,
  currency: string,
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
): PriceConsistencyResult {
  if (!ISO_CURRENCY.test(currency)) {
    return unverified(currency, "invalid_currency");
  }
  if (
    !Number.isSafeInteger(sampleLimit) ||
    sampleLimit < 1 ||
    sampleLimit > MAX_SAMPLE_LIMIT
  ) {
    return unverified(currency, "invalid_sample_limit");
  }

  const fractionDigits = currencyFractionDigits(currency);
  if (fractionDigits === undefined) {
    return unverified(currency, "invalid_currency");
  }

  const productsJson = readProduct(productsJsonProduct, "decimal");
  const productAjax = readProduct(productAjaxProduct, "minor");
  if (productsJson === undefined || productAjax === undefined) {
    return unverified(currency, "invalid_product_schema", fractionDigits);
  }
  if (
    productsJson.id !== productAjax.id ||
    productsJson.handle !== productAjax.handle
  ) {
    return unverified(currency, "product_identity_mismatch", fractionDigits);
  }

  const sharedVariantIds = [...productsJson.variants.keys()].filter((variantId) =>
    productAjax.variants.has(variantId),
  );
  if (sharedVariantIds.length === 0) {
    return unverified(currency, "no_shared_variant", fractionDigits);
  }

  const samples: VariantPriceSample[] = [];
  for (const variantId of sharedVariantIds.slice(0, sampleLimit)) {
    const decimal = normalizeDecimalPrice(productsJson.variants.get(variantId));
    const ajaxMinor = normalizeMinorPrice(productAjax.variants.get(variantId));
    if (decimal === undefined || ajaxMinor === undefined) {
      return unverified(
        currency,
        "invalid_price",
        fractionDigits,
        samples,
      );
    }
    const decimalMinor = decimalToMinorUnits(decimal, fractionDigits);
    if (decimalMinor === undefined) {
      return unverified(
        currency,
        "invalid_price",
        fractionDigits,
        samples,
      );
    }

    samples.push({
      variantId,
      productsJsonDecimal: decimal,
      productsJsonMinor: decimalMinor,
      productAjaxMinor: ajaxMinor,
      matches: decimalMinor === ajaxMinor,
    });
  }

  if (samples.some((sample) => !sample.matches)) {
    return unverified(
      currency,
      "price_mismatch",
      fractionDigits,
      samples,
    );
  }
  return {
    status: "verified",
    currency,
    fractionDigits,
    checkedVariants: samples.length,
    samples,
  };
}

function readProduct(
  value: unknown,
  priceRepresentation: "decimal" | "minor",
): ProductPriceSample | undefined {
  if (
    !isRecord(value) ||
    typeof value.handle !== "string" ||
    value.handle.length === 0 ||
    !Array.isArray(value.variants)
  ) {
    return undefined;
  }
  const id = normalizeId(value.id);
  if (id === undefined) return undefined;

  const variants = new Map<string, unknown>();
  for (const variant of value.variants) {
    if (!isRecord(variant)) return undefined;
    const variantId = normalizeId(variant.id);
    if (variantId === undefined || variants.has(variantId)) return undefined;
    const price =
      priceRepresentation === "decimal"
        ? normalizeDecimalPrice(variant.price)
        : normalizeMinorPrice(variant.price);
    if (price === undefined) return undefined;
    variants.set(variantId, price);
  }
  if (variants.size === 0) return undefined;
  return { id, handle: value.handle, variants };
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

function normalizeDecimalPrice(value: unknown): string | undefined {
  if (typeof value !== "string" || !DECIMAL_PRICE.test(value)) return undefined;
  return value;
}

function normalizeMinorPrice(value: unknown): string | undefined {
  if (typeof value === "string" && INTEGER_PRICE.test(value)) {
    return stripLeadingZeroes(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

export function decimalToMinorUnits(
  decimal: string,
  fractionDigits: number,
): string | undefined {
  const match = DECIMAL_PRICE.exec(decimal);
  if (match === null) return undefined;
  const [whole = "", fraction = ""] = decimal.split(".");
  if (fraction.length > fractionDigits) return undefined;
  const minor = `${whole}${fraction.padEnd(fractionDigits, "0")}`;
  return stripLeadingZeroes(minor);
}

export function currencyFractionDigits(currency: string): number | undefined {
  try {
    const options = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions();
    return options.maximumFractionDigits;
  } catch {
    return undefined;
  }
}

function stripLeadingZeroes(value: string): string {
  return value.replace(/^0+(?=\d)/u, "");
}

function unverified(
  currency: string,
  reason: PriceConsistencyFailureReason,
  fractionDigits?: number,
  samples: readonly VariantPriceSample[] = [],
): PriceConsistencyResult {
  return {
    status: "unverified",
    currency,
    reason,
    ...(fractionDigits === undefined ? {} : { fractionDigits }),
    checkedVariants: samples.length,
    samples,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
