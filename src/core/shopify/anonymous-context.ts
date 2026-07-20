export type AnonymousShopifyContext = Readonly<{
  country?: string;
  locale?: string;
  currency?: string;
  evidence: readonly AnonymousContextEvidence[];
}>;

export type AnonymousContextEvidence = Readonly<{
  field: "country" | "locale" | "currency";
  source: "shopify-direct-assignment" | "shopify-object-assignment";
  value: string;
}>;

const MAX_HTML_SCAN_LENGTH = 2 * 1024 * 1024;
const MAX_SHOPIFY_OBJECT_LENGTH = 64 * 1024;
const JSON_STRING = '"(?:\\\\.|[^"\\\\])*"';
const COUNTRY = /^[A-Z]{2}$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u;

/**
 * Extracts only public Shopify localization globals from an anonymous HTML
 * response. The parser is intentionally not a JavaScript evaluator: it accepts
 * JSON string literals in a small allowlist of assignment shapes and discards
 * the HTML immediately after extraction.
 */
export function parseAnonymousShopifyContext(
  value: unknown,
): AnonymousShopifyContext {
  if (typeof value !== "string") return { evidence: [] };
  const html = value.slice(0, MAX_HTML_SCAN_LENGTH);
  const evidence: AnonymousContextEvidence[] = [];

  const directCountry = readDirectString(html, "country", COUNTRY);
  const directLocale = readDirectString(html, "locale", LOCALE);
  const directCurrency = readDirectCurrency(html);

  const object = shopifyObjectAssignment(html);
  const objectCountry =
    directCountry === undefined && object !== undefined
      ? readObjectString(object, "country", COUNTRY)
      : undefined;
  const objectLocale =
    directLocale === undefined && object !== undefined
      ? readObjectString(object, "locale", LOCALE)
      : undefined;
  const objectCurrency =
    directCurrency === undefined && object !== undefined
      ? readObjectCurrency(object)
      : undefined;

  const country = directCountry ?? objectCountry;
  const locale = directLocale ?? objectLocale;
  const currency = directCurrency ?? objectCurrency;

  if (country !== undefined) {
    evidence.push({
      field: "country",
      source:
        directCountry === undefined
          ? "shopify-object-assignment"
          : "shopify-direct-assignment",
      value: country,
    });
  }
  if (locale !== undefined) {
    evidence.push({
      field: "locale",
      source:
        directLocale === undefined
          ? "shopify-object-assignment"
          : "shopify-direct-assignment",
      value: locale,
    });
  }
  if (currency !== undefined) {
    evidence.push({
      field: "currency",
      source:
        directCurrency === undefined
          ? "shopify-object-assignment"
          : "shopify-direct-assignment",
      value: currency,
    });
  }

  return {
    ...(country === undefined ? {} : { country }),
    ...(locale === undefined ? {} : { locale }),
    ...(currency === undefined ? {} : { currency }),
    evidence,
  };
}

function readDirectString(
  html: string,
  field: "country" | "locale",
  validator: RegExp,
): string | undefined {
  const expression = new RegExp(
    `(?:window\\s*\\.\\s*)?Shopify\\s*\\.\\s*${field}\\s*=\\s*(${JSON_STRING})`,
    "u",
  );
  return readJsonString(expression.exec(html)?.[1], validator);
}

function readDirectCurrency(html: string): string | undefined {
  const expression = new RegExp(
    `(?:window\\s*\\.\\s*)?Shopify\\s*\\.\\s*currency\\s*=\\s*\\{[\\s\\S]{0,1024}?(?:"active"|active)\\s*:\\s*(${JSON_STRING})`,
    "u",
  );
  return readJsonString(expression.exec(html)?.[1], CURRENCY);
}

function shopifyObjectAssignment(html: string): string | undefined {
  const start = /(?:window\s*\.\s*)?Shopify\s*=\s*\{/u.exec(html);
  if (start === null || start.index === undefined) return undefined;
  return html.slice(
    start.index,
    Math.min(html.length, start.index + MAX_SHOPIFY_OBJECT_LENGTH),
  );
}

function readObjectString(
  object: string,
  field: "country" | "locale",
  validator: RegExp,
): string | undefined {
  const expression = new RegExp(`\\b${field}\\s*:\\s*(${JSON_STRING})`, "u");
  return readJsonString(expression.exec(object)?.[1], validator);
}

function readObjectCurrency(object: string): string | undefined {
  const expression = new RegExp(
    `\\bcurrency\\s*:\\s*\\{[\\s\\S]{0,1024}?(?:"active"|active)\\s*:\\s*(${JSON_STRING})`,
    "u",
  );
  return readJsonString(expression.exec(object)?.[1], CURRENCY);
}

function readJsonString(
  value: string | undefined,
  validator: RegExp,
): string | undefined {
  if (value === undefined || value.length > 128) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" && validator.test(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
