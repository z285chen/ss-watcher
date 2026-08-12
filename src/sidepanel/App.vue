<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import {
  routeRootFromShopifyProbe,
  type CollectorSocialPlatform,
} from "../content/probes";
import type { StorefrontAnalysisResult } from "../core/analysis/storefront-analysis";
import {
  collectFrontendIntelligence,
  MAX_FRONTEND_RESOURCE_BODIES,
  MAX_FRONTEND_TOTAL_BYTES,
  type FrontendFinding,
  type FrontendFindingCategory,
  type FrontendIntelligenceResult,
} from "../core/frontend/frontend-intelligence";
import {
  createFullJsonExport,
  createProductCsvExport,
} from "../core/export/snapshot-export";
import {
  collectPublicSourceBundle,
  selectSourceBundleCandidates,
} from "../core/export/source-bundle-export";
import {
  StagingStore,
  type CommittedSnapshotBundle,
} from "../core/storage/staging-store";
import type { CatalogProduct } from "../core/shopify/catalog-scanner";
import {
  runPersistedStorefrontScan,
  type PersistedScanStage,
} from "../core/shopify/persisted-scan";
import type { StorefrontScanContext } from "../core/shopify/storefront-scanner";
import { runIndexedDbSmoke } from "./indexeddb-smoke";
import { createCommittedBundleState } from "./committed-bundle-state";
import { shouldRetryActionAuthorization } from "./action-authorization-policy";
import PanelDiagnostics from "./PanelDiagnostics.vue";
import PanelEmptyState from "./PanelEmptyState.vue";
import PanelHeader from "./PanelHeader.vue";
import PanelNavigation from "./PanelNavigation.vue";
import PanelOverview from "./PanelOverview.vue";
import PanelProductDrawer from "./PanelProductDrawer.vue";
import PanelProducts from "./PanelProducts.vue";
import PanelScanning from "./PanelScanning.vue";
import PanelTechnology from "./PanelTechnology.vue";
import UiIcon from "./UiIcon.vue";
import type {
  PanelFinding,
  PanelFindingKind,
  PanelProduct,
  PanelResource,
  PanelState,
  PanelStore,
  PanelTechnologySummary,
  PanelView,
} from "./panel-view-model";

import type {
  CatalogProgress,
  EndpointExecutor,
  EndpointExecutorOptions,
} from "../core/shopify/catalog-scanner";
import type { EndpointRequest } from "../core/network/request-policy";
import type { ResourceDescriptor } from "../core/frontend/resource-types";
import type {
  CancelScanResponse,
  EndpointResponse,
  EstablishSessionResponse,
  M0ActionAuthorizedNotice,
  M0Request,
  M0Response,
  ProbeResponse,
  ResourceResponse,
  RevokeResponse,
  SessionHandle,
  ValidateSessionResponse,
} from "../shared/messages";

type ViewName = "overview" | "products" | "technology" | "diagnostics";
type SnapshotStoreProfile = Readonly<{ favicon?: string }>;
type SnapshotTheme = Readonly<{
  name?: string;
  schemaName?: string;
  id?: string;
}>;
type SnapshotSocialLink = Readonly<{
  platform: CollectorSocialPlatform;
  url: string;
}>;

const status = ref("等待当前标签页授权…");
const detail = ref("");
const handle = ref<SessionHandle>();
const bootId = ref("");
const routeRoot = ref("/");
const sessionOrigin = ref("");
const sessionTabId = ref<number>();
const busy = ref(false);
const scanController = ref<AbortController>();
const activeScanId = ref<string>();
const sourceExportBusy = ref(false);
const sourceExportController = ref<AbortController>();
const activeSourceExportId = ref<string>();
const sourceExportProgress = ref("");
const activeView = ref<ViewName>("overview");
const selectedProduct = ref<PanelProduct>();
const toolsOpen = ref(false);
// Committed snapshots are immutable, atomically replaced values. Keeping the
// bundle shallow prevents Vue from proxying IndexedDB records: structuredClone
// (used by the product view and export path) rejects reactive Proxy objects.
const currentBundle = createCommittedBundleState();
const panelInstanceId = crypto.randomUUID();
const stagingStore = new StagingStore();

const products = computed(() => catalogProducts(currentBundle.value));
const analysis = computed(() => analysisFromBundle(currentBundle.value));
const context = computed(() => contextFromBundle(currentBundle.value));
const coverage = computed(() => coverageFromBundle(currentBundle.value));
const storeHost = computed(() =>
  displayStoreHost(currentBundle.value?.snapshot.storeKey ?? sessionOrigin.value),
);
const storeInitial = computed(() => (storeHost.value[0] ?? "S").toUpperCase());
const snapshotTime = computed(() =>
  displaySnapshotTime(currentBundle.value?.snapshot.scannedAt),
);
const storeProfile = computed(() => storeProfileFromBundle(currentBundle.value));
const theme = computed(() => themeFromBundle(currentBundle.value));
const themeLabel = computed(() => displayTheme(theme.value));
const socialLinks = computed(() => socialsFromBundle(currentBundle.value));
const frontend = computed(() => frontendFromBundle(currentBundle.value));
const frontendResources = computed(() => frontend.value?.resources ?? []);
const visibleFrontendResources = computed(() => {
  const all = frontendResources.value;
  const degradedCore = all.filter(
    (resource) =>
      resource.kind !== "source-map" &&
      (resource.fetchStatus === "failed" || resource.fetchStatus === "skipped"),
  );
  const sourceMaps = all.filter(
    (resource) =>
      resource.kind === "source-map" ||
      resource.derivedFromResourceId !== undefined,
  );
  const prioritizedIds = new Set(
    [...degradedCore, ...sourceMaps].map((resource) => resource.resourceId),
  );
  return [
    ...degradedCore,
    ...sourceMaps,
    ...all.filter((resource) => !prioritizedIds.has(resource.resourceId)),
  ].slice(0, 100);
});
const frontendDegradation = computed(() => {
  const degraded = (frontend.value?.resources ?? []).filter(
    (resource) =>
      resource.kind !== "source-map" &&
      (resource.fetchStatus === "failed" ||
        (resource.fetchStatus === "skipped" &&
          resource.failureReason !== "budget_exceeded")),
  );
  if (degraded.length === 0) return undefined;
  const failed = degraded.filter((resource) => resource.fetchStatus === "failed").length;
  const skipped = degraded.length - failed;
  const reasons = failureReasonEntries(degraded)
    .map(({ reason, count }) => `${reason} ${count}`)
    .join(" · ");
  return `核心资源不可用：失败 ${failed}，其他跳过 ${skipped}${reasons.length === 0 ? "" : `；${reasons}`}`;
});
const frontendCoverageLimit = computed(() => {
  const limited = (frontend.value?.resources ?? []).filter(
    (resource) =>
      resource.kind !== "source-map" &&
      resource.fetchStatus === "skipped" &&
      resource.failureReason === "budget_exceeded",
  );
  if (limited.length === 0) return undefined;
  return `前端分析达到安全预算：${limited.length} 个核心资源仅保留描述符`;
});
const frontendResourceErrorIds = computed(
  () =>
    new Set(
      (frontend.value?.resources ?? [])
        .filter(
          (resource) =>
            (resource.fetchStatus === "failed" || resource.fetchStatus === "skipped"),
        )
        .map((resource) => resource.resourceId),
    ),
);
const sourceBundleCandidates = computed(() => {
  const bundle = currentBundle.value;
  if (bundle === undefined) return [];
  return selectSourceBundleCandidates(
    frontendResources.value,
    bundle.snapshot.storeKey,
  );
});

const activePanelView = computed<PanelView>({
  get: () =>
    activeView.value === "diagnostics" ? "overview" : activeView.value,
  set: (view) => {
    activeView.value = view;
  },
});
const hasSnapshot = computed(() => currentBundle.value !== undefined);
const scanActive = computed(() => activeScanId.value !== undefined);
const partialMessage = computed(() => buildPartialMessage());
const productPartialMessage = computed(() => buildProductPartialMessage());
const technologyPartialMessage = computed(() => buildTechnologyPartialMessage());
const panelState = computed<PanelState>(() => {
  if (scanActive.value) return "scanning";
  if (!hasSnapshot.value) return handle.value === undefined ? "unauthorized" : "empty";
  if (handle.value === undefined) return "readonly";
  return partialMessage.value === undefined ? "ready" : "partial";
});
const panelFindings = computed<PanelFinding[]>(() =>
  (frontend.value?.findings ?? []).map(toPanelFinding),
);
const panelResources = computed<PanelResource[]>(() =>
  visibleFrontendResources.value.map(toPanelResource),
);
const panelTechnologySummary = computed<PanelTechnologySummary | undefined>(
  () => toPanelTechnologySummary(frontend.value),
);
const panelProducts = computed<PanelProduct[]>(() =>
  products.value.map(toPanelProduct),
);
const panelStore = computed<PanelStore>(() => toPanelStore());

watch(activeView, () => {
  selectedProduct.value = undefined;
  toolsOpen.value = false;
  globalThis.requestAnimationFrame(() => {
    globalThis.scrollTo({ top: 0, behavior: "auto" });
  });
});

function buildPartialMessage(): string | undefined {
  const bundle = currentBundle.value;
  if (bundle === undefined) return undefined;
  const messages: string[] = [];
  if (bundle.snapshot.scanStatus === "blocked") {
    messages.push("扫描遇到密码、挑战或安全拒绝，已保留可用结果");
  } else if (bundle.snapshot.scanStatus === "partial") {
    messages.push("产品或上下文扫描为部分覆盖");
  }
  if (
    analysis.value?.status === "partial" ||
    analysis.value?.status === "blocked"
  ) {
    messages.push(`分析状态为 ${analysis.value.status}`);
  }
  if (coverage.value?.truncated === true) {
    messages.push("公开产品目录达到上限，结果已截断");
  }
  if (frontendDegradation.value !== undefined) {
    messages.push(frontendDegradation.value);
  } else if (
    frontend.value?.status === "failed" &&
    frontend.value.errors.some(
      (error) => !isFrontendResourceError(error, frontendResourceErrorIds.value),
    )
  ) {
    messages.push("公开前端分析失败，资源描述符仍保留");
  }
  if (frontendCoverageLimit.value !== undefined) {
    messages.push(frontendCoverageLimit.value);
  }
  const snapshotErrors = bundle.snapshot.errors;
  const criticalSnapshotErrors = Array.isArray(snapshotErrors)
    ? snapshotErrors.filter(
        (error) =>
          !isFrontendResourceError(error, frontendResourceErrorIds.value),
      )
    : [];
  if (criticalSnapshotErrors.length > 0) {
    messages.push(`快照记录 ${criticalSnapshotErrors.length} 条模块错误`);
  }
  const unique = [...new Set(messages)];
  return unique.length === 0 ? undefined : unique.join("；");
}

function buildProductPartialMessage(): string | undefined {
  const bundle = currentBundle.value;
  if (bundle === undefined) return undefined;
  const messages: string[] = [];
  if (bundle.snapshot.scanStatus === "blocked") {
    messages.push("产品扫描遇到密码、挑战或安全拒绝，当前仅展示已提交的可用目录");
  } else if (bundle.snapshot.scanStatus === "partial") {
    messages.push("产品或公开上下文为部分覆盖");
  }
  if (coverage.value?.truncated === true) {
    messages.push("公开产品目录达到上限，列表已截断");
  }
  const unique = [...new Set(messages)];
  return unique.length === 0 ? undefined : unique.join("；");
}

function buildTechnologyPartialMessage(): string | undefined {
  const messages = [frontendDegradation.value, frontendCoverageLimit.value].filter(
    (value): value is string => value !== undefined,
  );
  if (
    frontend.value?.status === "failed" &&
    frontend.value.errors.some(
      (error) => !isFrontendResourceError(error, frontendResourceErrorIds.value),
    )
  ) {
    messages.push("公开前端分析失败，资源描述符仍保留");
  }
  const unique = [...new Set(messages)];
  return unique.length === 0 ? undefined : unique.join("；");
}

function toPanelStore(): PanelStore {
  const productCount = analysis.value?.statistics.productCount ?? products.value.length;
  const variantCount =
    analysis.value?.statistics.variantCount ??
    products.value.reduce((total, product) => total + product.variants.length, 0);
  const discountedProducts =
    analysis.value?.statistics.discount.discountedProducts ?? 0;
  const technologyCount = frontend.value?.findings.length ?? 0;
  const pixelCount =
    frontend.value?.findings.filter((finding) => finding.category === "pixel")
      .length ?? 0;
  const sourceMapCount = frontendResources.value.filter(
    (resource) => resource.kind === "source-map",
  ).length;
  const sources = coverage.value?.sources ?? [];
  const sourceLabel = sources.length === 0 ? "未记录目录来源" : sources.join(" + ");
  const marketParts = [context.value?.country, context.value?.currency].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  const priceVerified = context.value?.priceContextVerified === true;
  const scanStatus = currentBundle.value?.snapshot.scanStatus;
  const summaryTitle =
    scanStatus === "not-shopify"
      ? "当前公开信号未达到 Shopify 识别阈值"
      : partialMessage.value !== undefined
        ? "公开目录已提交，部分模块存在明确降级"
        : priceVerified
          ? "公开目录、价格口径与主题信号均可核查"
          : "公开目录与主题信号可核查，价格仍待验证";
  const partial = partialMessage.value;
  const favicon = storeProfile.value?.favicon;

  return {
    host: storeHost.value,
    initial: storeInitial.value,
    snapshotLabel:
      currentBundle.value === undefined
        ? "尚无 committed 快照"
        : `上次扫描 ${snapshotTime.value}${handle.value === undefined ? " · 只读" : ""}`,
    theme: themeLabel.value,
    market: marketParts.length === 0 ? "市场未知" : marketParts.join(" · "),
    storefront: context.value?.storefrontKind ?? "类型未知",
    priceVerified,
    readOnly: handle.value === undefined,
    productCount,
    variantCount,
    discountedProducts,
    technologyCount,
    pixelCount,
    sourceMapCount,
    coverageLabel: `${coverage.value?.productsFetched ?? productCount} 个公开产品 · ${sourceLabel}`,
    sourceLabel,
    summaryTitle,
    summaryBody:
      "先从公开产品结构判断品类，再用可回溯证据核查前端栈；公开排序不是销量，Pixel 代码信号也不是流量证明。",
    socials: socialLinks.value.map((social) => ({
      platform: social.platform,
      label: socialLabel(social.platform),
      url: social.url,
    })),
    ...(favicon === undefined ? {} : { favicon }),
    ...(partial === undefined ? {} : { partialMessage: partial }),
  };
}

function toPanelProduct(product: CatalogProduct, index: number): PanelProduct {
  const key = product.id ?? product.handle ?? `product-${index}`;
  const publicUrl = productUrl(product);
  const image = productImage(product);
  const verified = context.value?.priceContextVerified === true;
  const variants = product.variants.map((variant, variantIndex) => {
    const sku = variant.sku?.trim();
    return {
      key: variant.id || `${key}-variant-${variantIndex}`,
      title: variant.title?.trim() || `变体 ${variantIndex + 1}`,
      price: displayVariantPrice(variant),
      availability:
        variant.available === true
          ? "有货" as const
          : variant.available === false
            ? "售罄" as const
            : "未知" as const,
      ...(sku === undefined || sku.length === 0 ? {} : { sku }),
    };
  });
  const firstVerifiedPrice = variants.find((variant) => variant.price !== "—")?.price;
  return {
    key,
    title: product.title?.trim() || product.handle || "未命名产品",
    handle: product.handle ?? "无 handle",
    vendor: product.vendor?.trim() || "未提供",
    type: product.productType?.trim() || "未提供",
    tags: product.tags,
    createdAt: displayDate(product.createdAt),
    createdAtEpoch:
      product.createdAt !== undefined && Number.isFinite(Date.parse(product.createdAt))
        ? Date.parse(product.createdAt)
        : 0,
    price: firstVerifiedPrice ?? "—",
    priceNote: verified
      ? firstVerifiedPrice === undefined
        ? "公开变体未提供可验证价格"
        : "首个已验证公开变体"
      : "价格上下文未通过门控",
    availability: productAvailabilityLabel(product),
    sourceLabel:
      product.sources.length === 0 ? "未记录" : product.sources.join(" + "),
    variants,
    ...(image === undefined ? {} : { image }),
    ...(publicUrl === undefined ? {} : { url: publicUrl }),
  };
}

function displayVariantPrice(
  variant: CatalogProduct["variants"][number],
): string {
  const scanContext = context.value;
  if (
    scanContext?.priceContextVerified !== true ||
    variant.price === undefined ||
    variant.priceSource === undefined ||
    scanContext.priceSourceStatus[variant.priceSource] !== "verified"
  ) {
    return "—";
  }
  if (variant.priceSource === "product-ajax-js") {
    return displayMinor(String(variant.price));
  }
  const numeric = Number(variant.price);
  const currency = scanContext.currency;
  if (!Number.isFinite(numeric) || currency === undefined) return "—";
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      currencyDisplay: "code",
    }).format(numeric);
  } catch {
    return `${currency} ${numeric}`;
  }
}

function toPanelFinding(finding: FrontendFinding): PanelFinding {
  const kind = panelFindingKind(finding.category);
  return {
    id: finding.findingId,
    kind,
    label: finding.label,
    confidence: `${Math.round(Math.max(0, Math.min(1, finding.confidence)) * 100)}%`,
    maturity: finding.maturity,
    summary: findingSummary(finding),
    evidence: finding.evidence.slice(0, 8).map((evidence) => {
      const resource = frontendResources.value.find(
        (candidate) => candidate.resourceId === evidence.resourceId,
      );
      const source =
        resource === undefined
          ? evidence.resourceId.slice(0, 12)
          : `${resourceHost(resource)}${resourcePath(resource)}`;
      return `${source} · ${evidence.excerpt}`;
    }),
    tone:
      kind === "pixel" || kind === "app"
        ? "mint"
        : kind === "performance"
          ? "amber"
          : kind === "source-map" || kind === "api"
            ? "blue"
            : "purple",
  };
}

function panelFindingKind(
  category: FrontendFindingCategory,
): PanelFindingKind {
  return category === "api-reference" ? "api" : category;
}

function findingSummary(finding: FrontendFinding): string {
  switch (finding.category) {
    case "pixel":
      return "在当前公开代码或资源 URL 中检测到 Pixel 规则命中；这不证明实际流量、事件触发或投放效果。";
    case "app":
      return "在公开前端资源中检测到 App 相关规则命中；仅表示代码信号存在。";
    case "api-reference":
      return "公开代码出现 API 字符串或 operation 引用；不表示接口可匿名访问。";
    case "source-map":
      return "已验证同源 source map 证据；正文仅在受限会话中短暂分析，不写入快照。";
    case "performance":
      return "Resource Timing 或静态资源规则出现性能信号；不是实验室或真实用户性能评分。";
    case "theme":
      return "公开主题运行时或资源路径与该主题规则一致。";
    case "framework":
      return "公开前端资源中的框架特征达到当前规则阈值。";
  }
}

function toPanelResource(resource: ResourceDescriptor): PanelResource {
  return {
    id: resource.resourceId,
    kind: resource.kind,
    host: resourceHost(resource),
    path: resourcePath(resource),
    status: resource.fetchStatus,
    bytes: displayBytes(resource.byteLength ?? resource.transferSize),
    relation: resource.originRelation,
    ...(resource.replayPolicy === undefined
      ? {}
      : { replayPolicy: resource.replayPolicy }),
    ...(resource.initiator === undefined
      ? {}
      : { initiator: resource.initiator }),
    ...(resource.failureReason === undefined
      ? {}
      : { failureReason: resource.failureReason }),
    ...(resource.httpStatus === undefined
      ? {}
      : { httpStatus: resource.httpStatus }),
    ...(resource.derivedFromResourceId === undefined
      ? {}
      : { derivedFrom: resource.derivedFromResourceId }),
  };
}

function toPanelTechnologySummary(
  result: FrontendIntelligenceResult | undefined,
): PanelTechnologySummary | undefined {
  if (result === undefined) return undefined;
  const unavailable = result.resources.filter(
    (resource) =>
      resource.fetchStatus === "failed" || resource.fetchStatus === "skipped",
  );
  const coreUnavailable = unavailable.filter(
    (resource) => resource.kind !== "source-map",
  );
  const sourceMapUnavailable = unavailable.filter(
    (resource) => resource.kind === "source-map",
  );
  const coreFailed = coreUnavailable.filter(
    (resource) => resource.fetchStatus === "failed",
  );
  const coreBudgetLimited = coreUnavailable.filter(
    (resource) =>
      resource.fetchStatus === "skipped" &&
      resource.failureReason === "budget_exceeded",
  );
  const coreOtherSkipped = coreUnavailable.filter(
    (resource) =>
      resource.fetchStatus === "skipped" &&
      resource.failureReason !== "budget_exceeded",
  );
  const coreDegraded = [...coreFailed, ...coreOtherSkipped];
  return {
    totalResources: result.summary.totalResources,
    sameOriginResources: result.summary.sameOriginResources,
    analyzedResources: result.summary.analyzedResources,
    metadataOnlyResources: result.summary.metadataOnlyResources,
    failedResources: result.summary.failedResources,
    skippedResources: result.summary.skippedResources,
    analyzedBytes: displayBytes(result.summary.analyzedBytes),
    failureReasons: failureReasonEntries(unavailable),
    resourceBodyLimit: MAX_FRONTEND_RESOURCE_BODIES,
    resourceByteLimit: displayBytes(MAX_FRONTEND_TOTAL_BYTES),
    coreFailedResources: coreFailed.length,
    coreSkippedResources: coreOtherSkipped.length,
    coreBudgetLimitedResources: coreBudgetLimited.length,
    coreFailureReasons: failureReasonEntries(coreDegraded),
    sourceMapUnavailableResources: sourceMapUnavailable.length,
    sourceMapFailureReasons: failureReasonEntries(sourceMapUnavailable),
  };
}

function failureReasonEntries(
  resources: readonly ResourceDescriptor[],
): readonly Readonly<{ reason: string; count: number }>[] {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    if (resource.failureReason === undefined) continue;
    counts.set(
      resource.failureReason,
      (counts.get(resource.failureReason) ?? 0) + 1,
    );
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

function isFrontendResourceError(
  error: string,
  resourceErrorIds: ReadonlySet<string>,
): boolean {
  if (!error.startsWith("frontend: ")) return false;
  const resourceError = error.slice("frontend: ".length);
  return [...resourceErrorIds].some((resourceId) =>
    resourceError.startsWith(`${resourceId}:`),
  );
}

function handlePrimaryAction(): void {
  toolsOpen.value = false;
  if (handle.value === undefined) {
    void establish();
    return;
  }
  void scanM3();
}

function openDiagnostics(): void {
  toolsOpen.value = false;
  selectedProduct.value = undefined;
  activeView.value = "diagnostics";
}

function handleExportCsv(): void {
  toolsOpen.value = false;
  exportCsv();
}

function handleExportJson(): void {
  toolsOpen.value = false;
  exportJson();
}

function handleExportSources(): void {
  toolsOpen.value = false;
  void exportPublicSources();
}

function handleRevoke(): void {
  toolsOpen.value = false;
  void revoke();
}

function isActionAuthorizedNotice(
  value: unknown,
): value is M0ActionAuthorizedNotice {
  if (!isRecord(value)) return false;
  return (
    value.type === "M0_ACTION_AUTHORIZED" &&
    Number.isSafeInteger(value.windowId) &&
    Number(value.windowId) >= 0 &&
    Number.isSafeInteger(value.tabId) &&
    Number(value.tabId) >= 0
  );
}

function handleRuntimeNotice(message: unknown): false {
  if (!isActionAuthorizedNotice(message)) return false;
  // A delayed notice for the same healthy document must not replace its
  // resource-bearing session. A toolbar click on another tab (or after a
  // navigation that revoked the stored session) must rebind the open panel.
  if (busy.value || sourceExportBusy.value) {
    return false;
  }
  void retryForActionWindow(message.windowId, message.tabId);
  return false;
}

async function retryForActionWindow(
  actionWindowId: number,
  actionTabId: number,
): Promise<void> {
  if (busy.value || sourceExportBusy.value) return;
  const currentWindow = await chrome.windows.getCurrent();
  if (
    !shouldRetryActionAuthorization({
      actionWindowId,
      currentWindowId: currentWindow.id,
      operationBusy: busy.value || sourceExportBusy.value,
    })
  ) {
    return;
  }

  const currentHandle = handle.value;
  if (currentHandle !== undefined && sessionTabId.value === actionTabId) {
    const validation = await send<ValidateSessionResponse>({
      type: "M0_VALIDATE_SESSION",
      handle: currentHandle,
      panelInstanceId,
    });
    bootId.value = validation.bootId;
    if (validation.ok) return;
  }
  await establish();
}

async function send<T extends M0Response>(message: M0Request): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("Service Worker 15 秒内未应答"));
    }, 15_000);
    void (chrome.runtime.sendMessage(message) as Promise<T>).then(
      (response) => {
        globalThis.clearTimeout(timeoutId);
        resolve(response);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

async function establish(): Promise<void> {
  await runBusy(async () => {
    status.value = "正在执行最小授权探针…";
    const currentWindow = await chrome.windows.getCurrent();
    if (typeof currentWindow.id !== "number") {
      resetSession("无法确认当前窗口");
      return;
    }

    const response = await send<EstablishSessionResponse>({
      type: "M0_ESTABLISH_SESSION",
      windowId: currentWindow.id,
      panelInstanceId,
    });
    bootId.value = response.bootId;
    if (!response.ok) {
      resetSession(response.message, errorDetail(response));
      return;
    }

    handle.value = {
      runId: response.session.runId,
      sessionToken: response.session.sessionToken,
    };
    sessionOrigin.value = response.session.origin;
    sessionTabId.value = response.session.tabId;
    routeRoot.value = "/";
    const latest = await stagingStore.getLatestCommittedSnapshot(
      response.session.origin,
    );
    currentBundle.value = latest;
    status.value =
      latest === undefined
        ? "ScanSession 已建立，可以开始 M3 扫描"
        : "ScanSession 已建立，已载入最近 committed 快照";
    detail.value = pretty({
      origin: response.session.origin,
      pathname: response.session.pathname,
      tabId: response.session.tabId,
      documentId: response.session.documentId,
      runId: response.session.runId,
      loadedSnapshotId: latest?.snapshot.snapshotId,
    });
  });
}

async function scanM3(): Promise<void> {
  const sessionHandle = handle.value;
  const origin = sessionOrigin.value;
  if (
    sessionHandle === undefined ||
    origin.length === 0 ||
    busy.value ||
    sourceExportBusy.value
  ) {
    return;
  }

  busy.value = true;
  selectedProduct.value = undefined;
  toolsOpen.value = false;
  const controller = new AbortController();
  const scanId = crypto.randomUUID();
  scanController.value = controller;
  activeScanId.value = scanId;
  try {
    status.value = "M3：正在重新采集页面与资源信号…";
    detail.value = "分类会重新运行 MAIN / ISOLATED 探针，不复用旧页面结果。";
    const probeResponse = await send<ProbeResponse>({
      type: "M0_RUN_PROBES",
      handle: sessionHandle,
      panelInstanceId,
      scanId,
    });
    throwIfScanAborted(controller.signal);
    bootId.value = probeResponse.bootId;
    if (!probeResponse.ok) {
      resetSession(probeResponse.message, errorDetail(probeResponse));
      return;
    }
    routeRoot.value = routeRootFromShopifyProbe(probeResponse.main);

    const frontendPromise = collectFrontendIntelligence(
      probeResponse.resources,
      async (resourceId) => {
        throwIfScanAborted(controller.signal);
        const response = await send<ResourceResponse>({
          type: "M3_FETCH_RESOURCE",
          handle: sessionHandle,
          panelInstanceId,
          resourceId,
          scanId,
        });
        bootId.value = response.bootId;
        if (!response.ok) {
          throw new SessionExecutionError(response.message, response);
        }
        throwIfScanAborted(controller.signal);
        return response.result;
      },
      { signal: controller.signal },
    );

    const execute: EndpointExecutor = async (
      endpoint: EndpointRequest,
      options: EndpointExecutorOptions = {},
    ) => {
      throwIfScanAborted(controller.signal);
      const response = await send<EndpointResponse>({
        type: "M0_FETCH_ENDPOINT",
        handle: sessionHandle,
        panelInstanceId,
        endpoint,
        scanId,
        ...(options.routeRoot === undefined
          ? {}
          : { routeRoot: options.routeRoot }),
      });
      bootId.value = response.bootId;
      if (!response.ok) {
        throw new SessionExecutionError(response.message, response);
      }
      throwIfScanAborted(controller.signal);
      return response.result;
    };

    const persisted = await runPersistedStorefrontScan({
      store: stagingStore,
      origin,
      main: probeResponse.main,
      collector: probeResponse.collector,
      execute,
      productLimit: 1_000,
      pageSize: 250,
      ajaxSupplementLimit: 20,
      signal: controller.signal,
      onStage: updateScanStage,
      onProgress: updateCatalogProgress,
      retry: {
        onRetry: (event) => {
          status.value = `M3：${event.endpointKind} 遇到 ${event.category}，${Math.round(event.delayMs / 1_000)} 秒后有限重试`;
        },
      },
      frontend: frontendPromise,
    });

    const committed = await stagingStore.getCommittedSnapshot(
      persisted.snapshotId,
    );
    if (committed === undefined) {
      throw new Error("M3 快照提交后无法从 committed-only 读路径重新打开");
    }
    currentBundle.value = committed;
    activeView.value = "overview";
    status.value = scanStatusLabel(
      persisted.scan.status,
      persisted.analysis.status,
    );
    detail.value = pretty({
      snapshotId: persisted.snapshotId,
      scanRunId: persisted.scanRunId,
      committed: committed.snapshot.committed,
      storefrontKind: persisted.scan.detection.storefrontKind,
      isShopify: persisted.scan.detection.isShopify,
      confidence: persisted.scan.detection.confidence,
      context: persisted.scan.context,
      coverage: persisted.scan.catalog.coverage,
      analysisStatus: persisted.analysis.status,
      statistics: persisted.analysis.statistics,
      bestSelling: {
        status: persisted.analysis.bestSelling.status,
        scope: persisted.analysis.bestSelling.scope,
        itemCount: persisted.analysis.bestSelling.items.length,
        disclaimer: persisted.analysis.bestSelling.disclaimer,
      },
      newness: {
        status: persisted.analysis.newness.status,
        candidateCount: persisted.analysis.newness.candidates.length,
      },
      runtimeDiagnostics: persisted.scan.runtimeDiagnostics,
      frontend: frontendFromBundle(committed)?.summary,
      errors: committed.snapshot.errors,
    });
  } catch (error: unknown) {
    const wasCancelled = isAbortError(error) || controller.signal.aborted;
    if (wasCancelled) {
      status.value = "M3 扫描已取消";
      detail.value = "staging 数据已清理；未发布半成品快照。";
    } else if (error instanceof SessionExecutionError) {
      resetSession(error.message, errorDetail(error.response));
    } else {
      cancelActiveScan(new DOMException("M3 扫描失败", "AbortError"));
      status.value = "M3 扫描失败";
      detail.value = error instanceof Error ? error.message : String(error);
    }
  } finally {
    void chrome.runtime
      .sendMessage({
        type: "M3_FINISH_RESOURCE_SCAN",
        handle: sessionHandle,
        panelInstanceId,
        scanId,
      } satisfies M0Request)
      .catch(() => undefined);
    if (scanController.value === controller) scanController.value = undefined;
    if (activeScanId.value === scanId) activeScanId.value = undefined;
    busy.value = false;
  }
}

function cancelScan(): void {
  cancelActiveScan(new DOMException("用户取消扫描", "AbortError"));
  status.value = "正在取消 M3 扫描…";
}

function cancelActiveScan(reason: DOMException): void {
  scanController.value?.abort(reason);
  const sessionHandle = handle.value;
  const scanId = activeScanId.value;
  if (sessionHandle === undefined || scanId === undefined) return;
  void send<CancelScanResponse>({
    type: "M1_CANCEL_SCAN",
    handle: sessionHandle,
    panelInstanceId,
    scanId,
  })
    .then((response) => {
      bootId.value = response.bootId;
    })
    .catch(() => undefined);
}

function updateScanStage(stage: PersistedScanStage): void {
  const labels: Record<PersistedScanStage, string> = {
    "meta-probe": "M3：探测 meta.json 能力…",
    classification: "M3：计算 Shopify / storefrontKind…",
    "cart-probe": "M3：验证匿名 cart currency…",
    "anonymous-context": "M3：验证匿名 country / market…",
    catalog: "M3：扫描产品目录…",
    "price-verification": "M3：核对产品价格来源…",
    statistics: "M3：计算店铺与产品统计…",
    "best-selling": "M3：读取公开 best-selling 排序…",
    "newness-order": "M3：读取 created-descending 排序…",
    newness: "M3：生成 A–D 上新证据…",
  };
  status.value = labels[stage];
}

function updateCatalogProgress(progress: CatalogProgress): void {
  const page = progress.page === undefined ? "" : `，第 ${progress.page} 页`;
  status.value = `M3：${progress.phase}${page}，已发现 ${progress.productsFetched} 个产品`;
}

function exportCsv(): void {
  const bundle = currentBundle.value;
  if (bundle === undefined) return;
  const exported = createProductCsvExport(bundle);
  const base = exportBaseName(bundle);
  downloadText(`${base}.products.csv`, exported.csv, "text/csv;charset=utf-8");
  downloadText(
    `${base}.products.meta.json`,
    exported.metaJson,
    "application/json;charset=utf-8",
  );
  status.value = `已导出 ${exported.meta.rowCount} 行产品 CSV 与 meta sidecar`;
}

function exportJson(): void {
  const bundle = currentBundle.value;
  if (bundle === undefined) return;
  const exported = createFullJsonExport(bundle);
  downloadText(
    `${exportBaseName(bundle)}.scan.json`,
    exported.json,
    "application/json;charset=utf-8",
  );
  status.value = `已导出完整 committed 快照（${exported.value.meta.rowCount} 个产品）`;
}

async function exportPublicSources(): Promise<void> {
  const bundle = currentBundle.value;
  const sessionHandle = handle.value;
  const candidates = sourceBundleCandidates.value;
  if (
    bundle === undefined ||
    sessionHandle === undefined ||
    busy.value ||
    sourceExportBusy.value
  ) {
    return;
  }
  if (candidates.length === 0) {
    status.value = "当前会话没有可导出的同源正文";
    detail.value = "请先重新扫描，建立与当前页面一致的资源 capability。";
    return;
  }

  sourceExportBusy.value = true;
  const controller = new AbortController();
  const exportId = crypto.randomUUID();
  sourceExportController.value = controller;
  activeSourceExportId.value = exportId;
  sourceExportProgress.value = `0 / ${candidates.length}`;
  status.value = "正在重新验证并读取公开同源源码…";
  try {
    const exported = await collectPublicSourceBundle({
      snapshotId: bundle.snapshot.snapshotId,
      storeKey: bundle.snapshot.storeKey,
      resources: candidates,
      signal: controller.signal,
      onProgress: (completed, total) => {
        sourceExportProgress.value = `${completed} / ${total}`;
        status.value = `正在导出公开源码 ${completed} / ${total}`;
      },
      execute: async (resourceId) => {
        if (controller.signal.aborted) {
          throw controller.signal.reason;
        }
        const response = await send<ResourceResponse>({
          type: "M3_FETCH_RESOURCE",
          handle: sessionHandle,
          panelInstanceId,
          resourceId,
          scanId: exportId,
        });
        bootId.value = response.bootId;
        if (!response.ok) {
          throw new SessionExecutionError(response.message, response);
        }
        return response.result;
      },
    });
    const exportedFileCount = exported.value.meta.exportedFileCount;
    const exportedTextBytes = exported.value.meta.exportedTextBytes;
    const exportStatus = exported.value.meta.status;
    const errors = structuredClone(exported.value.errors);
    if (exportedFileCount > 0) {
      const filename = `${exportBaseName(bundle)}.public-sources.json`;
      downloadText(filename, exported.json, "application/json;charset=utf-8");
    }
    exported.value.files.length = 0;
    (exported as { json: string }).json = "";
    status.value =
      exportedFileCount === 0 &&
      errors.some((error) => error.reason === "resource_not_registered")
        ? "当前会话的资源 capability 已失效，请重新扫描"
        : exportedFileCount === 0
          ? "没有通过 ResourcePolicy 的源码文件，未创建下载"
          : `已导出 ${exportedFileCount} 个公开同源源码文件`;
    detail.value = pretty({
      exportStatus,
      exportedFileCount,
      exportedTextBytes,
      credentialMode: "omit",
      redirectMode: "error",
      errors,
    });
  } catch (error: unknown) {
    if (isAbortError(error) || controller.signal.aborted) {
      status.value = "公开源码导出已取消";
      detail.value =
        "已终止在途请求且清空本次会话的资源 capability；没有创建不完整下载。重新导出前请重新扫描。";
    } else if (error instanceof SessionExecutionError) {
      resetSession(error.message, errorDetail(error.response));
    } else {
      status.value = "公开源码导出失败";
      detail.value = error instanceof Error ? error.message : String(error);
    }
  } finally {
    void chrome.runtime
      .sendMessage({
        type: "M3_FINISH_RESOURCE_SCAN",
        handle: sessionHandle,
        panelInstanceId,
        scanId: exportId,
      } satisfies M0Request)
      .catch(() => undefined);
    if (sourceExportController.value === controller) {
      sourceExportController.value = undefined;
    }
    if (activeSourceExportId.value === exportId) {
      activeSourceExportId.value = undefined;
    }
    sourceExportProgress.value = "";
    sourceExportBusy.value = false;
  }
}

function cancelSourceExport(reason = "用户取消源码导出"): void {
  sourceExportController.value?.abort(new DOMException(reason, "AbortError"));
  const sessionHandle = handle.value;
  const exportId = activeSourceExportId.value;
  if (sessionHandle === undefined || exportId === undefined) return;
  void send<CancelScanResponse>({
    type: "M1_CANCEL_SCAN",
    handle: sessionHandle,
    panelInstanceId,
    scanId: exportId,
  }).catch(() => undefined);
}

function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function runProbes(): Promise<void> {
  const sessionHandle = handle.value;
  if (sessionHandle === undefined) return;
  await runBusy(async () => {
    status.value = "正在运行 MAIN / ISOLATED 探针…";
    const response = await send<ProbeResponse>({
      type: "M0_RUN_PROBES",
      handle: sessionHandle,
      panelInstanceId,
    });
    bootId.value = response.bootId;
    if (!response.ok) {
      resetSession(response.message, errorDetail(response));
      return;
    }
    routeRoot.value = routeRootFromShopifyProbe(response.main);
    status.value = "双探针完成";
    detail.value = pretty({
      main: response.main,
      collector: response.collector,
      routeRootForRequests: routeRoot.value,
    });
  });
}

async function fetchCart(): Promise<void> {
  await fetchEndpoint({ kind: "cart-context" });
}

async function fetchProducts(): Promise<void> {
  await fetchEndpoint({ kind: "products-page", page: 1, limit: 3 });
}

async function fetchEndpoint(
  endpoint:
    | { kind: "cart-context" }
    | { kind: "products-page"; page: number; limit: number },
): Promise<void> {
  const sessionHandle = handle.value;
  if (sessionHandle === undefined) return;
  await runBusy(async () => {
    status.value = `正在执行 ${endpoint.kind}…`;
    const response = await send<EndpointResponse>({
      type: "M0_FETCH_ENDPOINT",
      handle: sessionHandle,
      panelInstanceId,
      endpoint,
      ...(endpoint.kind === "cart-context" ? { routeRoot: routeRoot.value } : {}),
    });
    bootId.value = response.bootId;
    if (!response.ok) {
      resetSession(response.message, errorDetail(response));
      return;
    }
    status.value = response.result.ok
      ? `${endpoint.kind} 请求通过策略校验`
      : `${endpoint.kind} 已按策略拒绝/分类`;
    detail.value = pretty(response.result);
  });
}

async function revoke(): Promise<void> {
  const sessionHandle = handle.value;
  if (sessionHandle === undefined) return;
  await runBusy(async () => {
    const response = await send<RevokeResponse>({
      type: "M0_REVOKE_SESSION",
      handle: sessionHandle,
      panelInstanceId,
    });
    bootId.value = response.bootId;
    resetSession(
      response.ok ? "ScanSession 已吊销" : response.message,
      response.ok ? "本次句柄已从 storage.session 删除" : errorDetail(response),
    );
  });
}

async function runStorageSmoke(): Promise<void> {
  await runBusy(async () => {
    status.value = "正在运行原生 IndexedDB 自检…";
    detail.value = "仅使用随机命名的临时自检数据库；完成后自动删除。";
    const result = await runIndexedDbSmoke();
    status.value = "IndexedDB 浏览器自检完成";
    detail.value = pretty(result);
  });
}

async function runBusy(operation: () => Promise<void>): Promise<void> {
  if (busy.value || sourceExportBusy.value) return;
  busy.value = true;
  try {
    await operation();
  } catch (error: unknown) {
    resetSession(
      "诊断请求失败",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    busy.value = false;
  }
}

function resetSession(message: string, reason = ""): void {
  cancelActiveScan(new DOMException("会话已重置", "AbortError"));
  cancelSourceExport("会话已重置");
  scanController.value = undefined;
  activeScanId.value = undefined;
  handle.value = undefined;
  sessionOrigin.value = "";
  sessionTabId.value = undefined;
  routeRoot.value = "/";
  status.value = message;
  detail.value = reason;
}

function scanStatusLabel(scanStatus: string, analysisStatus: string): string {
  if (scanStatus === "not-shopify") return "未达到 Shopify 识别阈值，已停止";
  if (scanStatus === "blocked" || analysisStatus === "blocked") {
    return "扫描遇到密码/挑战/安全拒绝，已提交可用的部分结果";
  }
  if (scanStatus === "partial" || analysisStatus === "partial") {
    return "M3 扫描完成（部分覆盖），快照已原子提交";
  }
  return "M3 扫描与前端分析完成，快照已原子提交";
}

function throwIfScanAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("扫描已取消", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

class SessionExecutionError extends Error {
  readonly response: Extract<EndpointResponse, { ok: false }>;

  constructor(
    message: string,
    response: Extract<EndpointResponse, { ok: false }>,
  ) {
    super(message);
    this.name = "SessionExecutionError";
    this.response = response;
  }
}

function catalogProducts(
  bundle: CommittedSnapshotBundle | undefined,
): CatalogProduct[] {
  if (bundle === undefined) return [];
  return bundle.products
    .map((record) => record.value)
    .filter(isCatalogProduct)
    .map((product) => structuredClone(product));
}

function isCatalogProduct(value: unknown): value is CatalogProduct {
  return (
    isRecord(value) &&
    Array.isArray(value.tags) &&
    Array.isArray(value.variants) &&
    Array.isArray(value.images) &&
    Array.isArray(value.sources)
  );
}

function analysisFromBundle(
  bundle: CommittedSnapshotBundle | undefined,
): StorefrontAnalysisResult | undefined {
  const value = bundle?.snapshot.analysis;
  return isRecord(value) &&
    isRecord(value.statistics) &&
    isRecord(value.bestSelling) &&
    isRecord(value.createdDescending) &&
    isRecord(value.newness)
    ? (value as unknown as StorefrontAnalysisResult)
    : undefined;
}

function frontendFromBundle(
  bundle: CommittedSnapshotBundle | undefined,
): FrontendIntelligenceResult | undefined {
  const value = bundle?.snapshot.frontend;
  return isRecord(value) &&
    isRecord(value.summary) &&
    Array.isArray(value.resources) &&
    Array.isArray(value.findings) &&
    Array.isArray(value.errors)
    ? (value as unknown as FrontendIntelligenceResult)
    : undefined;
}

function resourceHost(resource: ResourceDescriptor): string {
  try {
    return new URL(resource.url).hostname;
  } catch {
    return "invalid";
  }
}

function resourcePath(resource: ResourceDescriptor): string {
  try {
    const url = new URL(resource.url);
    return `${url.pathname}${url.search}`;
  } catch {
    return resource.url;
  }
}

function displayBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function contextFromBundle(
  bundle: CommittedSnapshotBundle | undefined,
): StorefrontScanContext | undefined {
  const value = bundle?.snapshot.context;
  return isRecord(value)
    ? (value as unknown as StorefrontScanContext)
    : undefined;
}

function coverageFromBundle(
  bundle: CommittedSnapshotBundle | undefined,
): { productsFetched: number; truncated: boolean; sources: string[] } | undefined {
  const value = bundle?.snapshot.coverage;
  if (!isRecord(value)) return undefined;
  return {
    productsFetched:
      typeof value.productsFetched === "number" ? value.productsFetched : 0,
    truncated: value.truncated === true,
    sources: Array.isArray(value.sources)
      ? value.sources.filter((source): source is string => typeof source === "string")
      : [],
  };
}

function storeProfileFromBundle(
  bundle: CommittedSnapshotBundle | undefined,
): SnapshotStoreProfile | undefined {
  const value = bundle?.snapshot.store;
  if (!isRecord(value)) return undefined;
  const favicon = cleanSnapshotUrl(value.favicon);
  return favicon === undefined ? {} : { favicon };
}

function themeFromBundle(
  bundle: CommittedSnapshotBundle | undefined,
): SnapshotTheme | undefined {
  const value = bundle?.snapshot.theme;
  if (!isRecord(value)) return undefined;
  const name = clippedText(value.name, 256);
  const schemaName = clippedText(value.schemaName, 256);
  const id = clippedText(value.id, 64);
  return name === undefined && schemaName === undefined && id === undefined
    ? undefined
    : {
        ...(name === undefined ? {} : { name }),
        ...(schemaName === undefined ? {} : { schemaName }),
        ...(id === undefined ? {} : { id }),
      };
}

function socialsFromBundle(
  bundle: CommittedSnapshotBundle | undefined,
): SnapshotSocialLink[] {
  const value = bundle?.snapshot.socials;
  if (!Array.isArray(value)) return [];
  const platforms = new Set<CollectorSocialPlatform>([
    "instagram",
    "facebook",
    "tiktok",
    "youtube",
    "x",
    "pinterest",
    "linkedin",
    "threads",
  ]);
  const seen = new Set<CollectorSocialPlatform>();
  const result: SnapshotSocialLink[] = [];
  for (const entry of value.slice(0, 12)) {
    if (!isRecord(entry) || typeof entry.platform !== "string") continue;
    if (!platforms.has(entry.platform as CollectorSocialPlatform)) continue;
    const platform = entry.platform as CollectorSocialPlatform;
    const url = cleanSnapshotUrl(entry.url);
    if (url === undefined || seen.has(platform)) continue;
    seen.add(platform);
    result.push({ platform, url });
  }
  return result;
}

function cleanSnapshotUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function clippedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized.slice(0, maximum);
}

function displayTheme(value: SnapshotTheme | undefined): string {
  if (value?.name !== undefined && value.schemaName !== undefined) {
    return value.name.localeCompare(value.schemaName, undefined, {
      sensitivity: "accent",
    }) === 0
      ? value.name
      : `${value.name} · ${value.schemaName}`;
  }
  return value?.name ?? value?.schemaName ?? "未识别";
}

function socialLabel(platform: CollectorSocialPlatform): string {
  const labels: Record<CollectorSocialPlatform, string> = {
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    youtube: "YouTube",
    x: "X",
    pinterest: "Pinterest",
    linkedin: "LinkedIn",
    threads: "Threads",
  };
  return labels[platform];
}

function productUrl(product: CatalogProduct): string | undefined {
  if (product.canonicalUrl !== undefined) return product.canonicalUrl;
  return product.handle === undefined || sessionOrigin.value === ""
    ? undefined
    : `${sessionOrigin.value}/products/${encodeURIComponent(product.handle)}`;
}

function exportBaseName(bundle: CommittedSnapshotBundle): string {
  const hostname = new URL(bundle.snapshot.storeKey).hostname.replace(
    /[^a-z0-9.-]+/giu,
    "-",
  );
  const scannedAt =
    typeof bundle.snapshot.scannedAt === "string"
      ? bundle.snapshot.scannedAt
      : new Date().toISOString();
  return `${hostname}-${scannedAt.replace(/[^0-9]+/gu, "-").replace(/-+$/u, "")}`;
}

function displayDate(value: string | undefined): string {
  if (value === undefined || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function displaySnapshotTime(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return "尚无扫描时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function displayStoreHost(value: string): string {
  if (value.length === 0) return "当前店铺";
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return value.replace(/^https?:\/\//u, "").split("/")[0] ?? value;
  }
}

function productImage(product: CatalogProduct | undefined): string | undefined {
  return product?.images.find((image) => image.trim().length > 0);
}

function productAvailabilityState(
  product: CatalogProduct,
): "available" | "unavailable" | "unknown" {
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

function productAvailabilityLabel(product: CatalogProduct): string {
  const availability = productAvailabilityState(product);
  return availability === "available"
    ? "有货"
    : availability === "unavailable"
      ? "售罄"
      : "未知";
}

function displayMinor(value: string | undefined): string {
  const price = analysis.value?.statistics.price;
  if (value === undefined || price?.fractionDigits === undefined) return "—";
  const digits = price.fractionDigits;
  const padded = value.padStart(digits + 1, "0");
  const major = digits === 0 ? padded : padded.slice(0, -digits);
  const fraction = digits === 0 ? "" : `.${padded.slice(-digits)}`;
  return `${price.currency ?? ""} ${major}${fraction}`.trim();
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function errorDetail(response: {
  reason: string;
  diagnostic?: Record<string, unknown>;
}): string {
  return response.diagnostic === undefined
    ? response.reason
    : pretty({ reason: response.reason, ...response.diagnostic });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

onMounted(() => {
  chrome.runtime.onMessage.addListener(handleRuntimeNotice);
  void establish();
});

onBeforeUnmount(() => {
  chrome.runtime.onMessage.removeListener(handleRuntimeNotice);
  cancelActiveScan(new DOMException("Side Panel 已关闭", "AbortError"));
  cancelSourceExport("Side Panel 已关闭");
  void stagingStore.close();
});
</script>

<template>
  <main class="prototype-shell">
    <PanelHeader
      :state="panelState"
      :tools-open="toolsOpen"
      :status="hasSnapshot ? `${panelStore.host} · ${status}` : status"
      :product-count="hasSnapshot ? panelStore.productCount : 0"
      :can-scan="handle !== undefined && !busy && !sourceExportBusy"
      :can-export="hasSnapshot && !busy && !sourceExportBusy"
      :can-export-sources="hasSnapshot && handle !== undefined && sourceBundleCandidates.length > 0 && !busy"
      :operation-busy="busy || sourceExportBusy"
      :source-export-busy="sourceExportBusy"
      :source-export-progress="sourceExportProgress"
      @primary="handlePrimaryAction"
      @cancel-scan="cancelScan"
      @toggle-tools="toolsOpen = !toolsOpen"
      @export-csv="handleExportCsv"
      @export-json="handleExportJson"
      @export-sources="handleExportSources"
      @diagnostics="openDiagnostics"
      @revoke="handleRevoke"
    />

    <PanelNavigation
      v-if="hasSnapshot && !scanActive && activeView !== 'diagnostics'"
      v-model="activePanelView"
      :product-count="panelStore.productCount"
      :finding-count="panelFindings.length"
    />

    <PanelScanning
      v-if="scanActive"
      :status="status"
      :detail="detail"
      :product-count="products.length"
      @cancel="cancelScan"
    />

    <PanelEmptyState
      v-else-if="!hasSnapshot"
      :authorized="handle !== undefined"
      :status="status"
      :detail="detail"
      @primary="handlePrimaryAction"
    />

    <PanelDiagnostics
      v-else-if="activeView === 'diagnostics'"
      :status="status"
      :detail="detail"
      :boot-id="bootId"
      :busy="busy || sourceExportBusy"
      :has-session="handle !== undefined"
      @back="activeView = 'overview'"
      @establish="establish"
      @probes="runProbes"
      @cart="fetchCart"
      @products="fetchProducts"
      @storage="runStorageSmoke"
      @revoke="revoke"
    />

    <PanelOverview
      v-else-if="activeView === 'overview'"
      :store="panelStore"
      @open-products="activeView = 'products'"
      @open-technology="activeView = 'technology'"
    />

    <PanelProducts
      v-else-if="activeView === 'products'"
      :products="panelProducts"
      :store="panelStore"
      :partial-message="productPartialMessage"
      @select="selectedProduct = $event"
      @export-csv="exportCsv"
    />

    <PanelTechnology
      v-else
      :host="panelStore.host"
      :findings="panelFindings"
      :resources="panelResources"
      :summary="panelTechnologySummary"
      :partial-message="technologyPartialMessage"
      :can-export-sources="handle !== undefined && sourceBundleCandidates.length > 0 && !busy"
      :export-busy="sourceExportBusy"
      :export-progress="sourceExportProgress"
      @export-sources="handleExportSources"
    />

    <footer class="prototype-footer">
      <UiIcon name="lock" :size="13" />
      <span>真实 M0–M3 committed 快照 · omit credentials · 不持久化源码正文</span>
    </footer>

    <PanelProductDrawer
      v-if="selectedProduct"
      :product="selectedProduct"
      @close="selectedProduct = undefined"
    />
  </main>
</template>
