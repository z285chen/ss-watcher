import type { EndpointExecutor } from "../shopify/catalog-scanner";
import type { StorefrontScanResult } from "../shopify/storefront-scanner";
import {
  scanPublicCollectionRanking,
  type PublicCollectionRanking,
} from "./collection-ranking";
import { analyzeProductNewness, type NewnessAnalysis } from "./newness";
import {
  computeProductStatistics,
  type ProductStatistics,
} from "./product-statistics";

export type StorefrontAnalysisStage =
  | "statistics"
  | "best-selling"
  | "newness-order"
  | "newness";

export type StorefrontAnalysisResult = Readonly<{
  status: "completed" | "partial" | "blocked" | "skipped";
  statistics: ProductStatistics;
  bestSelling: PublicCollectionRanking;
  createdDescending: PublicCollectionRanking;
  newness: NewnessAnalysis;
}>;

export async function analyzeStorefront(
  execute: EndpointExecutor,
  scan: StorefrontScanResult,
  options: Readonly<{
    origin: string;
    collectionHandles?: readonly string[];
    productLimit?: number;
    maxCollectionPages?: number;
    signal?: AbortSignal;
    onStage?: (stage: StorefrontAnalysisStage) => void;
  }>,
): Promise<StorefrontAnalysisResult> {
  options.onStage?.("statistics");
  const statistics = computeProductStatistics(scan.catalog.products, scan.context);
  const canUseCollectionSort =
    scan.detection.storefrontKind === "hosted-theme" &&
    scan.status !== "blocked" &&
    !scan.priceVerification.terminal;

  if (!canUseCollectionSort) {
    const unavailable = unavailableRanking("best-selling", scan.status === "blocked");
    const unavailableCreated = unavailableRanking(
      "created-descending",
      scan.status === "blocked",
    );
    options.onStage?.("newness");
    return {
      status: scan.status === "blocked" ? "blocked" : "skipped",
      statistics,
      bestSelling: unavailable,
      createdDescending: unavailableCreated,
      newness: analyzeProductNewness(scan.catalog.products),
    };
  }

  options.onStage?.("best-selling");
  const bestSelling = await scanPublicCollectionRanking(execute, {
    origin: options.origin,
    routeRoot: scan.context.routeRoot,
    sortBy: "best-selling",
    catalogProducts: scan.catalog.products,
    ...(options.collectionHandles === undefined
      ? {}
      : { collectionHandles: options.collectionHandles }),
    ...(options.productLimit === undefined
      ? {}
      : { productLimit: options.productLimit }),
    ...(options.maxCollectionPages === undefined
      ? {}
      : { maxPages: options.maxCollectionPages }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (bestSelling.status === "blocked") {
    const unavailableCreated = unavailableRanking("created-descending", true);
    options.onStage?.("newness");
    return {
      status: "blocked",
      statistics,
      bestSelling,
      createdDescending: unavailableCreated,
      newness: analyzeProductNewness(scan.catalog.products),
    };
  }

  options.onStage?.("newness-order");
  const createdDescending = await scanPublicCollectionRanking(execute, {
    origin: options.origin,
    routeRoot: scan.context.routeRoot,
    sortBy: "created-descending",
    catalogProducts: scan.catalog.products,
    ...(options.collectionHandles === undefined
      ? {}
      : { collectionHandles: options.collectionHandles }),
    ...(options.productLimit === undefined
      ? {}
      : { productLimit: options.productLimit }),
    ...(options.maxCollectionPages === undefined
      ? {}
      : { maxPages: options.maxCollectionPages }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  options.onStage?.("newness");
  const newness = analyzeProductNewness(scan.catalog.products, createdDescending);
  const status =
    createdDescending.status === "blocked"
      ? "blocked" as const
      : bestSelling.status === "completed" &&
          createdDescending.status === "completed" &&
          newness.status !== "unavailable"
        ? "completed" as const
        : "partial" as const;

  return { status, statistics, bestSelling, createdDescending, newness };
}

function unavailableRanking(
  sortBy: "best-selling" | "created-descending",
  blocked: boolean,
): PublicCollectionRanking {
  return {
    status: blocked ? "blocked" : "unavailable",
    sortBy,
    items: [],
    pagesScanned: 0,
    truncated: false,
    termination: blocked ? "terminal-access-gate" : "unavailable",
    disclaimer:
      sortBy === "best-selling"
        ? "Shopify 公开 Collection 排序，不等于真实销量。"
        : "created-descending 仅表示公开 Collection 的相对新旧顺序。",
    errors: [],
  };
}
