import type { CatalogProduct } from "../shopify/catalog-scanner";

export type ProductAvailabilityFilter =
  | "all"
  | "available"
  | "unavailable"
  | "unknown";

export type ProductSortField =
  | "title"
  | "vendor"
  | "productType"
  | "createdAt"
  | "publishedAt"
  | "updatedAt"
  | "variantCount";

export type ProductListQuery = Readonly<{
  search?: string;
  vendors?: readonly string[];
  productTypes?: readonly string[];
  tags?: readonly string[];
  availability?: ProductAvailabilityFilter;
  sortBy?: ProductSortField;
  sortDirection?: "asc" | "desc";
  offset?: number;
  limit?: number;
}>;

export type ProductListResult = Readonly<{
  total: number;
  offset: number;
  limit: number;
  rows: readonly CatalogProduct[];
}>;

export type ProductFacets = Readonly<{
  vendors: readonly FacetEntry[];
  productTypes: readonly FacetEntry[];
  tags: readonly FacetEntry[];
}>;

export type FacetEntry = Readonly<{ value: string; count: number }>;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;

export function queryProducts(
  products: readonly CatalogProduct[],
  query: ProductListQuery = {},
): ProductListResult {
  const search = query.search?.trim().toLocaleLowerCase() ?? "";
  const vendors = normalizedSet(query.vendors);
  const productTypes = normalizedSet(query.productTypes);
  const tags = normalizedSet(query.tags);
  const availability = query.availability ?? "all";
  const sortBy = query.sortBy ?? "title";
  const direction = query.sortDirection === "desc" ? -1 : 1;
  const offset = nonNegativeInteger(query.offset, 0, "offset");
  const limit = boundedLimit(query.limit);

  const filtered = products.filter((product) => {
    if (search.length > 0 && !searchableText(product).includes(search)) return false;
    if (vendors.size > 0 && !vendors.has(product.vendor ?? "")) return false;
    if (productTypes.size > 0 && !productTypes.has(product.productType ?? "")) {
      return false;
    }
    if (tags.size > 0 && !product.tags.some((tag) => tags.has(tag))) return false;
    if (availability !== "all" && productAvailability(product) !== availability) {
      return false;
    }
    return true;
  });

  filtered.sort((left, right) => {
    const comparison = compareField(left, right, sortBy);
    if (comparison !== 0) return comparison * direction;
    return identity(left).localeCompare(identity(right));
  });

  return {
    total: filtered.length,
    offset,
    limit,
    rows: filtered.slice(offset, offset + limit),
  };
}

export function productFacets(products: readonly CatalogProduct[]): ProductFacets {
  return {
    vendors: facets(products.map((product) => product.vendor)),
    productTypes: facets(products.map((product) => product.productType)),
    tags: facets(products.flatMap((product) => product.tags)),
  };
}

function searchableText(product: CatalogProduct): string {
  return [
    product.id,
    product.handle,
    product.title,
    product.vendor,
    product.productType,
    ...product.tags,
    ...product.variants.map((variant) => variant.sku),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\u001f")
    .toLocaleLowerCase();
}

function compareField(
  left: CatalogProduct,
  right: CatalogProduct,
  field: ProductSortField,
): number {
  if (field === "variantCount") {
    return left.variants.length - right.variants.length;
  }
  const leftValue = left[field] ?? "";
  const rightValue = right[field] ?? "";
  if (field.endsWith("At")) {
    return dateValue(leftValue) - dateValue(rightValue);
  }
  return leftValue.localeCompare(rightValue, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function productAvailability(
  product: CatalogProduct,
): Exclude<ProductAvailabilityFilter, "all"> {
  if (product.variants.some((variant) => variant.available === true)) {
    return "available";
  }
  if (
    product.variants.length > 0 &&
    product.variants.every((variant) => variant.available === false)
  ) {
    return "unavailable";
  }
  return "unknown";
}

function facets(values: readonly (string | undefined)[]): FacetEntry[] {
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

function normalizedSet(values: readonly string[] | undefined): Set<string> {
  return new Set(
    (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0),
  );
}

function identity(product: CatalogProduct): string {
  return product.id ?? product.handle ?? product.canonicalUrl ?? "";
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return normalized;
}

function boundedLimit(value: number | undefined): number {
  const normalized = value ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > MAX_LIMIT) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return normalized;
}
