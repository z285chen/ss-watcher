export type PanelState =
  | "ready"
  | "partial"
  | "scanning"
  | "unauthorized"
  | "empty"
  | "readonly";

export type PanelView = "overview" | "products" | "technology";

export type PanelSocialLink = Readonly<{
  platform: string;
  label: string;
  url: string;
}>;

export type PanelStore = Readonly<{
  host: string;
  initial: string;
  snapshotLabel: string;
  theme: string;
  market: string;
  storefront: string;
  priceVerified: boolean;
  readOnly: boolean;
  productCount: number;
  variantCount: number;
  discountedProducts: number;
  technologyCount: number;
  pixelCount: number;
  sourceMapCount: number;
  coverageLabel: string;
  sourceLabel: string;
  summaryTitle: string;
  summaryBody: string;
  socials: readonly PanelSocialLink[];
  favicon?: string;
  partialMessage?: string;
}>;

export type PanelVariant = Readonly<{
  key: string;
  title: string;
  price: string;
  availability: "有货" | "售罄" | "未知";
  sku?: string;
}>;

export type PanelProduct = Readonly<{
  key: string;
  title: string;
  handle: string;
  vendor: string;
  type: string;
  tags: readonly string[];
  createdAt: string;
  createdAtEpoch: number;
  price: string;
  priceNote: string;
  availability: "有货" | "售罄" | "未知";
  sourceLabel: string;
  variants: readonly PanelVariant[];
  image?: string;
  url?: string;
}>;

export type PanelFindingKind =
  | "framework"
  | "theme"
  | "api"
  | "performance"
  | "app"
  | "pixel"
  | "source-map";

export type PanelFinding = Readonly<{
  id: string;
  kind: PanelFindingKind;
  label: string;
  confidence: string;
  maturity: "stable" | "experimental";
  summary: string;
  evidence: readonly string[];
  tone: "purple" | "mint" | "amber" | "blue";
}>;

export type PanelResourceStatus =
  | "pending"
  | "analyzed"
  | "metadata-only"
  | "skipped"
  | "failed";

export type PanelResource = Readonly<{
  id: string;
  kind: string;
  host: string;
  path: string;
  status: PanelResourceStatus;
  bytes: string;
  relation: "same-origin" | "cross-origin";
  replayPolicy?: "safe-get" | "observed-only";
  initiator?: string;
  failureReason?: string;
  httpStatus?: number;
  derivedFrom?: string;
}>;

export type PanelTechnologySummary = Readonly<{
  totalResources: number;
  sameOriginResources: number;
  analyzedResources: number;
  metadataOnlyResources: number;
  failedResources: number;
  skippedResources: number;
  analyzedBytes: string;
  failureReasons: readonly Readonly<{ reason: string; count: number }>[];
  resourceBodyLimit: number;
  resourceByteLimit: string;
  coreFailedResources: number;
  coreSkippedResources: number;
  coreBudgetLimitedResources: number;
  coreFailureReasons: readonly Readonly<{ reason: string; count: number }>[];
  sourceMapUnavailableResources: number;
  sourceMapFailureReasons: readonly Readonly<{ reason: string; count: number }>[];
}>;

export function overviewBrief(store: PanelStore): string {
  return [
    `SS Watcher 公开快照：${store.host}`,
    `主题：${store.theme}`,
    `市场：${store.market}`,
    `公开产品：${store.productCount}；变体：${store.variantCount}`,
    `技术发现：${store.technologyCount}；Pixel 代码信号：${store.pixelCount}`,
    `价格状态：${store.priceVerified ? "已通过匿名上下文门控" : "未通过门控，不作比较结论"}`,
    `结论：${store.summaryTitle}`,
    `边界：${store.summaryBody}`,
  ].join("\n");
}

export function productsBrief(
  store: PanelStore,
  products: readonly PanelProduct[],
): string {
  const typeCounts = new Map<string, number>();
  for (const product of products) {
    typeCounts.set(product.type, (typeCounts.get(product.type) ?? 0) + 1);
  }
  const leadingTypes = [...typeCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([type, count]) => `${type} ${count}`)
    .join("；");
  return [
    `SS Watcher 产品目录：${store.host}`,
    `公开产品：${products.length}`,
    `主要类型：${leadingTypes || "未提供 Product Type"}`,
    `来源：${store.sourceLabel}`,
    `价格状态：${store.priceVerified ? "已验证" : "待验证"}`,
    "边界：公开目录字段不代表后台库存、订单或真实销量。",
  ].join("\n");
}

export function productBrief(product: PanelProduct): string {
  return [
    `公开产品：${product.title}`,
    `Handle：${product.handle}`,
    `Vendor：${product.vendor}`,
    `Product Type：${product.type}`,
    `公开价格：${product.price}（${product.priceNote}）`,
    `公开可售状态：${product.availability}`,
    `变体：${product.variants.length}`,
    `标签：${product.tags.join("、") || "无"}`,
    `来源：${product.sourceLabel}`,
    "边界：以上来自已提交的公开快照，不代表后台库存、订单或销量。",
  ].join("\n");
}

export function technologyBrief(
  host: string,
  findings: readonly PanelFinding[],
  summary: PanelTechnologySummary | undefined,
): string {
  const labels = findings.slice(0, 12).map((finding) => finding.label).join("；");
  return [
    `SS Watcher 公开前端证据：${host}`,
    `技术发现：${findings.length}${labels.length === 0 ? "" : `（${labels}）`}`,
    summary === undefined
      ? "资源统计：暂无"
      : `资源统计：总计 ${summary.totalResources}；已分析 ${summary.analyzedResources}；跨源 metadata-only ${summary.metadataOnlyResources}；核心资源不可用 ${summary.coreFailedResources + summary.coreSkippedResources}；安全预算未读取 ${summary.coreBudgetLimitedResources}；Source Map 未读取 ${summary.sourceMapUnavailableResources}`,
    "边界：Pixel 是公开代码信号，不证明流量或事件送达；代码引用不证明接口可访问；跨源正文未读取。",
  ].join("\n");
}
