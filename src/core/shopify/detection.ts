import type {
  CollectorProbeResult,
  ShopifyProbeResult,
} from "../../content/probes";
import type { EndpointExecutionResult } from "../network/request-policy";

export type StorefrontKind =
  | "hosted-theme"
  | "custom-storefront"
  | "uncertain";

export type ShopifySignalStrength = "strong" | "weak";

export type ShopifySignalGroup =
  | "shop-domain"
  | "theme-runtime"
  | "theme-asset"
  | "generator"
  | "commerce-cdn"
  | "checkout-handoff"
  | "meta-endpoint"
  | "cart-endpoint";

export type ShopifyEvidence = Readonly<{
  id: string;
  source: "main-probe" | "collector" | "meta-endpoint" | "cart-endpoint";
  group: ShopifySignalGroup;
  strength: ShopifySignalStrength;
  effect: "shopify" | "hosted" | "custom" | "against-hosted";
  detail: string;
}>;

export type ShopifyDetectionInput = Readonly<{
  origin: string;
  main: ShopifyProbeResult | null;
  collector: CollectorProbeResult;
  meta?: EndpointExecutionResult;
  cartContext?: EndpointExecutionResult;
}>;

export type ShopifyDetectionResult = Readonly<{
  isShopify: boolean;
  confidence: number;
  storefrontKind: StorefrontKind;
  cartProbeEligible: boolean;
  strongSignalCount: number;
  weakSignalCount: number;
  independentSignalGroups: ShopifySignalGroup[];
  evidence: ShopifyEvidence[];
  reasons: string[];
}>;

/**
 * Classifies a storefront from bounded, independently collected observations.
 * No individual page-owned global is sufficient to claim a hosted theme.
 */
export function classifyShopifyStorefront(
  input: ShopifyDetectionInput,
): ShopifyDetectionResult {
  const origin = normalizeOrigin(input.origin);
  const evidence: ShopifyEvidence[] = [];
  const add = (item: ShopifyEvidence): void => {
    if (!evidence.some((current) => current.id === item.id)) evidence.push(item);
  };

  const main = input.main;
  if (main !== null) {
    if (isMyshopifyDomain(main.shop)) {
      add({
        id: "main-myshopify-domain",
        source: "main-probe",
        group: "shop-domain",
        strength: "strong",
        effect: "shopify",
        detail: clip(main.shop ?? ""),
      });
    }

    const hasTheme =
      main.themeId !== undefined ||
      nonEmpty(main.themeName) ||
      nonEmpty(main.themeSchemaName);
    if (nonEmpty(main.routeRoot) && hasTheme) {
      add({
        id: "main-theme-runtime",
        source: "main-probe",
        group: "theme-runtime",
        strength: "strong",
        effect: "hosted",
        detail: `routeRoot=${clip(main.routeRoot ?? "")} theme=${clip(
          String(main.themeSchemaName ?? main.themeName ?? main.themeId ?? "present"),
        )}`,
      });
    } else if (nonEmpty(main.routeRoot) || hasTheme) {
      add({
        id: "main-partial-runtime",
        source: "main-probe",
        group: "theme-runtime",
        strength: "weak",
        effect: "shopify",
        detail: nonEmpty(main.routeRoot) ? "routeRoot present" : "theme present",
      });
    }
  }

  if (input.collector.ok) {
    if (/shopify/iu.test(input.collector.generator ?? "")) {
      add({
        id: "collector-generator",
        source: "collector",
        group: "generator",
        strength: "strong",
        effect: "shopify",
        detail: clip(input.collector.generator ?? "Shopify"),
      });
    }

    const publicUrls = [
      ...input.collector.scriptUrls,
      ...input.collector.linkUrls,
    ];
    const hostedAsset = publicUrls.find((value) =>
      isHostedThemeAssetUrl(value, origin),
    );
    if (hostedAsset !== undefined) {
      add({
        id: "collector-hosted-theme-asset",
        source: "collector",
        group: "theme-asset",
        strength: "strong",
        effect: "hosted",
        detail: safeUrlDetail(hostedAsset),
      });
    } else {
      const commerceAsset = publicUrls.find(isShopifyCdnUrl);
      if (commerceAsset !== undefined) {
        add({
          id: "collector-shopify-cdn",
          source: "collector",
          group: "commerce-cdn",
          strength: "weak",
          effect: "shopify",
          detail: safeUrlDetail(commerceAsset),
        });
      }
    }

    if (input.collector.canonical !== undefined) {
      const canonical = safeUrl(input.collector.canonical);
      if (canonical !== undefined && isMyshopifyDomain(canonical.hostname)) {
        add({
          id: "collector-canonical-myshopify",
          source: "collector",
          group: "shop-domain",
          strength: "strong",
          effect: "shopify",
          detail: `${canonical.origin}${canonical.pathname}`,
        });
      }
    }

    const checkout = input.collector.checkoutUrls
      .map(safeUrl)
      .find((value): value is URL => value !== undefined);
    if (checkout !== undefined) {
      add({
        id: "collector-checkout-handoff",
        source: "collector",
        group: "checkout-handoff",
        strength: "strong",
        effect: checkout.origin === origin ? "shopify" : "custom",
        detail: `${checkout.origin}${checkout.pathname}`,
      });
    }
  }

  const metaData = successfulData(input.meta, "meta");
  if (isRecord(metaData)) {
    const myshopifyDomain = readString(metaData.myshopify_domain);
    if (isMyshopifyDomain(myshopifyDomain)) {
      add({
        id: "meta-myshopify-domain",
        source: "meta-endpoint",
        group: "meta-endpoint",
        strength: "strong",
        effect: "shopify",
        detail: clip(myshopifyDomain ?? ""),
      });
    }
  }

  const cartData = successfulData(input.cartContext, "cart-context");
  const cartSucceeded =
    isRecord(cartData) && /^[A-Z]{3}$/u.test(readString(cartData.currency) ?? "");
  if (cartSucceeded) {
    add({
      id: "cart-context-schema",
      source: "cart-endpoint",
      group: "cart-endpoint",
      strength: "strong",
      effect: "hosted",
      detail: `currency=${readString((cartData as Record<string, unknown>).currency) ?? ""}`,
    });
  } else if (input.cartContext !== undefined) {
    add({
      id: "cart-context-unavailable",
      source: "cart-endpoint",
      group: "cart-endpoint",
      strength: "weak",
      effect: "against-hosted",
      detail: endpointFailureDetail(input.cartContext),
    });
  }

  const positive = evidence.filter((item) => item.effect !== "against-hosted");
  const strongSignalCount = positive.filter(
    (item) => item.strength === "strong",
  ).length;
  const weakSignalCount = positive.filter((item) => item.strength === "weak").length;
  const independentSignalGroups = unique(
    positive.map((item) => item.group),
  );
  const isShopify =
    strongSignalCount >= 1 ||
    unique(
      positive
        .filter((item) => item.strength === "weak")
        .map((item) => item.group),
    ).length >= 2;

  const cartProbeGroups = independentSignalGroups.filter(
    (group) => group !== "cart-endpoint",
  );
  const cartProbeEligible = isShopify && cartProbeGroups.length >= 2;
  const hasCompleteRuntime = evidence.some(
    (item) => item.id === "main-theme-runtime",
  );
  const hasHostedAsset = evidence.some(
    (item) => item.id === "collector-hosted-theme-asset",
  );
  const hasCustomHandoff = evidence.some(
    (item) => item.id === "collector-checkout-handoff" && item.effect === "custom",
  );

  let storefrontKind: StorefrontKind = "uncertain";
  const reasons: string[] = [];
  if (!isShopify) {
    reasons.push("未达到一项强信号或两项独立弱信号的 Shopify 判定阈值");
  } else if (hasCompleteRuntime && hasHostedAsset && cartSucceeded) {
    storefrontKind = "hosted-theme";
    reasons.push("theme runtime、托管主题资产与匿名 cart-context 三方一致");
  } else if (hasCustomHandoff && !hasCompleteRuntime && !hasHostedAsset) {
    storefrontKind = "custom-storefront";
    reasons.push("存在跨 origin Shopify checkout hand-off，但无托管主题 runtime/asset 组合");
  } else {
    reasons.push("Shopify 已识别，但 hosted-theme 的三项门控未同时满足");
    if (input.cartContext === undefined && cartProbeEligible) {
      reasons.push("允许执行一次受限 cart-context 分类探测");
    } else if (input.cartContext !== undefined && !cartSucceeded) {
      reasons.push("cart-context 未通过，禁止进入其他 Ajax Product/Cart API");
    }
  }

  const confidence = confidenceFor({
    isShopify,
    storefrontKind,
    strongSignalCount,
    weakSignalCount,
  });

  return {
    isShopify,
    confidence,
    storefrontKind,
    cartProbeEligible,
    strongSignalCount,
    weakSignalCount,
    independentSignalGroups,
    evidence,
    reasons,
  };
}

function confidenceFor(input: {
  isShopify: boolean;
  storefrontKind: StorefrontKind;
  strongSignalCount: number;
  weakSignalCount: number;
}): number {
  if (!input.isShopify) return Math.min(0.49, input.weakSignalCount * 0.2);
  if (input.storefrontKind === "hosted-theme") return 0.99;
  if (input.storefrontKind === "custom-storefront") return 0.92;
  return Math.min(0.89, 0.62 + input.strongSignalCount * 0.08 + input.weakSignalCount * 0.03);
}

function successfulData(
  result: EndpointExecutionResult | undefined,
  kind: "meta" | "cart-context",
): unknown {
  return result?.ok === true && result.kind === kind ? result.data : undefined;
}

function endpointFailureDetail(result: EndpointExecutionResult): string {
  return result.ok ? "unexpected_success_schema" : result.category;
}

function isHostedThemeAssetUrl(value: string, storefrontOrigin: string): boolean {
  const url = safeUrl(value);
  if (url === undefined) return false;
  const legacyCdnThemeAsset =
    isShopifyCdnHost(url.hostname) &&
    /\/s\/files\/.+\/t\/\d+\/assets\//iu.test(url.pathname);
  const storefrontCdnThemeAsset =
    url.origin === storefrontOrigin &&
    /^\/cdn\/shop\/t\/\d+\/assets\//iu.test(url.pathname);
  return legacyCdnThemeAsset || storefrontCdnThemeAsset;
}

function isShopifyCdnUrl(value: string): boolean {
  const url = safeUrl(value);
  return url !== undefined && isShopifyCdnHost(url.hostname);
}

function isShopifyCdnHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "cdn.shopify.com" ||
    normalized.endsWith(".shopifycdn.com") ||
    normalized.endsWith(".shopifycdn.net")
  );
}

function isMyshopifyDomain(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  return (
    normalized.length > ".myshopify.com".length &&
    normalized.endsWith(".myshopify.com") &&
    !normalized.includes("/") &&
    !normalized.includes("@")
  );
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== value
  ) {
    throw new TypeError("origin must be a canonical HTTP(S) origin");
  }
  return url.origin;
}

function safeUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function safeUrlDetail(value: string): string {
  const url = safeUrl(value);
  return url === undefined ? "invalid-url" : clip(`${url.origin}${url.pathname}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function clip(value: string): string {
  return value.slice(0, 512);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
