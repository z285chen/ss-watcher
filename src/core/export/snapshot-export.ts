import type {
  CommittedSnapshotBundle,
  ProductRecord,
  StagedProductInput,
} from "../storage/staging-store";

export type ExportMeta = Readonly<{
  schemaVersion: number;
  snapshotId: string;
  storeKey: string;
  context: unknown;
  coverage: unknown;
  truncated: boolean;
  rowCount: number;
  generatedAt: string;
  fieldsSanitized: boolean;
  csvFormulaDefense: "apostrophe-prefix" | "none";
}>;

export type JsonSnapshotExport = Readonly<{
  meta: ExportMeta;
  snapshot: CommittedSnapshotBundle["snapshot"];
  products: readonly ProductRecord[];
  moduleResults: Readonly<CommittedSnapshotBundle["moduleResults"]>;
}>;

export type CsvProductExport = Readonly<{
  csv: string;
  meta: ExportMeta;
  metaJson: string;
  sanitizedCellCount: number;
}>;

const CSV_COLUMNS = [
  "id",
  "handle",
  "title",
  "url",
  "vendor",
  "productType",
  "tags",
  "createdAt",
  "publishedAt",
  "updatedAt",
  "variantCount",
  "variantIds",
  "skus",
  "prices",
  "compareAtPrices",
  "availability",
  "images",
  "sources",
  "productKey",
  "productJson",
] as const;

const FORMULA_PREFIX = /^[=+\-@\t\r]/u;

export function createFullJsonExport(
  bundle: CommittedSnapshotBundle,
  generatedAt = new Date().toISOString(),
): { value: JsonSnapshotExport; json: string } {
  const value: JsonSnapshotExport = {
    meta: exportMeta(bundle, bundle.products.length, generatedAt, false, false),
    snapshot: structuredClone(bundle.snapshot),
    products: structuredClone(bundle.products),
    moduleResults: structuredClone(bundle.moduleResults),
  };
  return { value, json: JSON.stringify(value, null, 2) };
}

export function createProductCsvExport(
  bundle: CommittedSnapshotBundle,
  options: Readonly<{
    products?: readonly ProductRecord[];
    generatedAt?: string;
    formulaDefense?: boolean;
  }> = {},
): CsvProductExport {
  const products = options.products ?? bundle.products;
  const formulaDefense = options.formulaDefense ?? true;
  let sanitizedCellCount = 0;
  const rows = [CSV_COLUMNS.map(csvEscape).join(",")];

  for (const record of products) {
    const row = productCsvRow(record);
    const cells = CSV_COLUMNS.map((column) => {
      const raw = row[column];
      const protectedValue = formulaDefense ? protectFormula(raw) : raw;
      if (protectedValue !== raw) sanitizedCellCount += 1;
      return csvEscape(protectedValue);
    });
    rows.push(cells.join(","));
  }
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const meta = exportMeta(
    bundle,
    products.length,
    generatedAt,
    sanitizedCellCount > 0,
    formulaDefense,
  );
  return {
    csv: `${rows.join("\r\n")}\r\n`,
    meta,
    metaJson: JSON.stringify(meta, null, 2),
    sanitizedCellCount,
  };
}

/** Re-import helper used by acceptance tests and future local restore tools. */
export function parseProductCsvProducts(csv: string): StagedProductInput[] {
  const rows = parseCsvRows(csv);
  const header = rows[0];
  if (header === undefined) return [];
  const productJsonIndex = header.indexOf("productJson");
  if (productJsonIndex < 0) throw new TypeError("productJson column is missing");
  const products: StagedProductInput[] = [];
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0] === "") continue;
    const value = row[productJsonIndex];
    if (value === undefined) throw new TypeError("productJson cell is missing");
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) throw new TypeError("productJson must contain an object");
    products.push(parsed);
  }
  return products;
}

export function protectFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function exportMeta(
  bundle: CommittedSnapshotBundle,
  rowCount: number,
  generatedAt: string,
  fieldsSanitized: boolean,
  formulaDefense: boolean,
): ExportMeta {
  const coverage = bundle.snapshot.coverage;
  return {
    schemaVersion: bundle.snapshot.schemaVersion,
    snapshotId: bundle.snapshot.snapshotId,
    storeKey: bundle.snapshot.storeKey,
    context: structuredClone(bundle.snapshot.context),
    coverage: structuredClone(coverage),
    truncated:
      isRecord(coverage) && typeof coverage.truncated === "boolean"
        ? coverage.truncated
        : false,
    rowCount,
    generatedAt: validIsoTimestamp(generatedAt),
    fieldsSanitized,
    csvFormulaDefense: formulaDefense ? "apostrophe-prefix" : "none",
  };
}

function productCsvRow(record: ProductRecord): Record<(typeof CSV_COLUMNS)[number], string> {
  const product = record.value;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const tags = stringArray(product.tags);
  const images = stringArray(product.images);
  const sources = stringArray(product.sources);
  return {
    id: scalarString(product.id),
    handle: scalarString(product.handle),
    title: scalarString(product.title),
    url: scalarString(product.canonicalUrl),
    vendor: scalarString(product.vendor),
    productType: scalarString(product.productType),
    tags: tags.join(" | "),
    createdAt: scalarString(product.createdAt),
    publishedAt: scalarString(product.publishedAt),
    updatedAt: scalarString(product.updatedAt),
    variantCount: String(variants.length),
    variantIds: variants.map((variant) => recordString(variant, "id")).filter(Boolean).join(" | "),
    skus: variants.map((variant) => recordString(variant, "sku")).filter(Boolean).join(" | "),
    prices: variants.map((variant) => recordString(variant, "price")).filter(Boolean).join(" | "),
    compareAtPrices: variants
      .map((variant) => recordString(variant, "compareAtPrice"))
      .filter(Boolean)
      .join(" | "),
    availability: variants
      .map((variant) => recordString(variant, "available"))
      .filter(Boolean)
      .join(" | "),
    images: images.join(" | "),
    sources: sources.join(" | "),
    productKey: record.productKey,
    productJson: JSON.stringify(product),
  };
}

function csvEscape(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index] as string;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\r" && csv[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function scalarString(value: unknown): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function recordString(value: unknown, field: string): string {
  if (!isRecord(value)) return "";
  return scalarString(value[field]);
}

function validIsoTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError("generatedAt must be an ISO-compatible timestamp");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
