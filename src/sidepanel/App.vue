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
import {
  productFacets,
  queryProducts,
  type ProductAvailabilityFilter,
  type ProductSortField,
} from "../core/analysis/product-view";
import type { StorefrontAnalysisResult } from "../core/analysis/storefront-analysis";
import {
  createFullJsonExport,
  createProductCsvExport,
} from "../core/export/snapshot-export";
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
import UiIcon from "./UiIcon.vue";

import type {
  CatalogProgress,
  EndpointExecutor,
  EndpointExecutorOptions,
} from "../core/shopify/catalog-scanner";
import type { EndpointRequest } from "../core/network/request-policy";
import type {
  CancelScanResponse,
  EndpointResponse,
  EstablishSessionResponse,
  M0ActionAuthorizedNotice,
  M0Request,
  M0Response,
  ProbeResponse,
  RevokeResponse,
  SessionHandle,
} from "../shared/messages";

type ViewName = "overview" | "products" | "diagnostics";
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
const busy = ref(false);
const scanController = ref<AbortController>();
const activeScanId = ref<string>();
const activeView = ref<ViewName>("overview");
// Committed snapshots are immutable, atomically replaced values. Keeping the
// bundle shallow prevents Vue from proxying IndexedDB records: structuredClone
// (used by the product view and export path) rejects reactive Proxy objects.
const currentBundle = createCommittedBundleState();
const search = ref("");
const vendorFilter = ref("");
const productTypeFilter = ref("");
const tagFilter = ref("");
const availabilityFilter = ref<ProductAvailabilityFilter>("all");
const productSort = ref<ProductSortField>("createdAt");
const sortDirection = ref<"asc" | "desc">("desc");
const productPage = ref(1);
const productPageSize = 20;
const panelInstanceId = crypto.randomUUID();
const stagingStore = new StagingStore();

const products = computed(() => catalogProducts(currentBundle.value));
const facets = computed(() => productFacets(products.value));
const productResult = computed(() =>
  queryProducts(products.value, {
    search: search.value,
    vendors: vendorFilter.value === "" ? [] : [vendorFilter.value],
    productTypes:
      productTypeFilter.value === "" ? [] : [productTypeFilter.value],
    tags: tagFilter.value === "" ? [] : [tagFilter.value],
    availability: availabilityFilter.value,
    sortBy: productSort.value,
    sortDirection: sortDirection.value,
    offset: (productPage.value - 1) * productPageSize,
    limit: productPageSize,
  }),
);
const productPageCount = computed(() =>
  Math.max(1, Math.ceil(productResult.value.total / productPageSize)),
);
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

watch(
  [
    search,
    vendorFilter,
    productTypeFilter,
    tagFilter,
    availabilityFilter,
    productSort,
    sortDirection,
  ],
  () => {
    productPage.value = 1;
  },
);

watch(activeView, () => {
  globalThis.requestAnimationFrame(() => {
    globalThis.scrollTo({ top: 0, behavior: "auto" });
  });
});

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
  void retryForActionWindow(message.windowId);
  return false;
}

async function retryForActionWindow(actionWindowId: number): Promise<void> {
  const currentWindow = await chrome.windows.getCurrent();
  if (currentWindow.id !== actionWindowId) return;
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
    routeRoot.value = "/";
    const latest = await stagingStore.getLatestCommittedSnapshot(
      response.session.origin,
    );
    currentBundle.value = latest;
    status.value =
      latest === undefined
        ? "ScanSession 已建立，可以开始 M2 扫描"
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

async function scanM2(): Promise<void> {
  const sessionHandle = handle.value;
  const origin = sessionOrigin.value;
  if (sessionHandle === undefined || origin.length === 0 || busy.value) return;

  busy.value = true;
  const controller = new AbortController();
  const scanId = crypto.randomUUID();
  scanController.value = controller;
  activeScanId.value = scanId;
  try {
    status.value = "M2：正在重新采集页面信号…";
    detail.value = "分类会重新运行 MAIN / ISOLATED 探针，不复用旧页面结果。";
    const probeResponse = await send<ProbeResponse>({
      type: "M0_RUN_PROBES",
      handle: sessionHandle,
      panelInstanceId,
    });
    bootId.value = probeResponse.bootId;
    if (!probeResponse.ok) {
      resetSession(probeResponse.message, errorDetail(probeResponse));
      return;
    }
    routeRoot.value = routeRootFromShopifyProbe(probeResponse.main);

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
          status.value = `M2：${event.endpointKind} 遇到 ${event.category}，${Math.round(event.delayMs / 1_000)} 秒后有限重试`;
        },
      },
    });

    const committed = await stagingStore.getCommittedSnapshot(
      persisted.snapshotId,
    );
    if (committed === undefined) {
      throw new Error("M2 快照提交后无法从 committed-only 读路径重新打开");
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
      errors: committed.snapshot.errors,
    });
  } catch (error: unknown) {
    if (isAbortError(error) || controller.signal.aborted) {
      status.value = "M2 扫描已取消";
      detail.value = "staging 数据已清理；未发布半成品快照。";
    } else if (error instanceof SessionExecutionError) {
      resetSession(error.message, errorDetail(error.response));
    } else {
      status.value = "M2 扫描失败";
      detail.value = error instanceof Error ? error.message : String(error);
    }
  } finally {
    if (scanController.value === controller) scanController.value = undefined;
    if (activeScanId.value === scanId) activeScanId.value = undefined;
    busy.value = false;
  }
}

function cancelScan(): void {
  cancelActiveScan(new DOMException("用户取消扫描", "AbortError"));
  status.value = "正在取消 M2 扫描…";
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
    "meta-probe": "M2：探测 meta.json 能力…",
    classification: "M2：计算 Shopify / storefrontKind…",
    "cart-probe": "M2：验证匿名 cart currency…",
    "anonymous-context": "M2：验证匿名 country / market…",
    catalog: "M2：扫描产品目录…",
    "price-verification": "M2：核对产品价格来源…",
    statistics: "M2：计算店铺与产品统计…",
    "best-selling": "M2：读取公开 best-selling 排序…",
    "newness-order": "M2：读取 created-descending 排序…",
    newness: "M2：生成 A–D 上新证据…",
  };
  status.value = labels[stage];
}

function updateCatalogProgress(progress: CatalogProgress): void {
  const page = progress.page === undefined ? "" : `，第 ${progress.page} 页`;
  status.value = `M2：${progress.phase}${page}，已发现 ${progress.productsFetched} 个产品`;
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
  if (busy.value) return;
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
  scanController.value = undefined;
  activeScanId.value = undefined;
  handle.value = undefined;
  sessionOrigin.value = "";
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
    return "M2 扫描完成（部分覆盖），快照已原子提交";
  }
  return "M2 扫描与分析完成，快照已原子提交";
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

function hideBrokenImage(event: Event): void {
  const target = event.currentTarget;
  if (target instanceof HTMLImageElement) target.hidden = true;
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

function productInitial(product: CatalogProduct): string {
  return (product.title ?? product.handle ?? product.id ?? "P")[0]?.toUpperCase() ?? "P";
}

function productImage(product: CatalogProduct | undefined): string | undefined {
  return product?.images.find((image) => image.trim().length > 0);
}

function productImageForReference(
  reference: Readonly<{ id?: string; handle?: string }>,
): string | undefined {
  const product = products.value.find(
    (candidate) =>
      (reference.handle !== undefined && candidate.handle === reference.handle) ||
      (reference.id !== undefined && candidate.id === reference.id),
  );
  return productImage(product);
}

function productInitialForReference(
  reference: Readonly<{ id?: string; handle?: string; title?: string }>,
): string {
  return (
    reference.title ??
    reference.handle ??
    reference.id ??
    "P"
  )[0]?.toUpperCase() ?? "P";
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

function distributionWidth(count: number, maximum: number | undefined): string {
  if (maximum === undefined || maximum < 1) return "0%";
  return `${Math.max(6, Math.round((count / maximum) * 100))}%`;
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
  void stagingStore.close();
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <span class="brand-mark">
          <img src="/icons/ss-watcher-48.png" alt="" />
        </span>
        <div>
          <strong>SS Watcher</strong>
          <small>STOREFRONT SIGNALS · M2</small>
        </div>
      </div>

      <div class="topbar-actions">
        <button
          v-if="currentBundle"
          type="button"
          class="mini-action"
          title="导出产品 CSV"
          aria-label="导出产品 CSV"
          @click="exportCsv"
        >
          <UiIcon name="download" :size="15" />
          <span>CSV</span>
        </button>
        <button
          v-if="currentBundle"
          type="button"
          class="mini-action"
          title="导出完整 JSON"
          aria-label="导出完整 JSON"
          @click="exportJson"
        >
          <UiIcon name="file" :size="15" />
          <span>JSON</span>
        </button>
        <button
          type="button"
          class="scan-action"
          data-testid="scan-m2"
          :disabled="busy || !handle"
          @click="scanM2"
        >
          <UiIcon name="refresh" :size="15" />
          <span>{{ busy ? "扫描中" : currentBundle ? "重新扫描" : "开始扫描" }}</span>
        </button>
        <button
          v-if="scanController"
          type="button"
          class="icon-action danger"
          data-testid="cancel-m2"
          title="取消扫描"
          aria-label="取消扫描"
          @click="cancelScan"
        >
          <UiIcon name="cancel" :size="16" />
        </button>
      </div>
    </header>

    <section
      class="status-strip"
      :class="{ busy, offline: !handle, ready: currentBundle && !busy }"
      data-testid="session-status"
    >
      <span class="status-dot" aria-hidden="true" />
      <strong>{{ status }}</strong>
      <span v-if="coverage" class="status-count">
        {{ coverage.productsFetched }} products
      </span>
    </section>

    <section v-if="currentBundle && context" class="store-summary">
      <div class="store-identity">
        <span class="store-avatar">
          {{ storeInitial }}
          <img
            v-if="storeProfile?.favicon"
            :src="storeProfile.favicon"
            alt=""
            referrerpolicy="no-referrer"
            @error="hideBrokenImage"
          />
        </span>
        <div>
          <strong>{{ storeHost }}</strong>
          <small>上次扫描 {{ snapshotTime }}</small>
          <span class="theme-detail" :title="themeLabel">
            <UiIcon name="layers" :size="12" />
            主题 · {{ themeLabel }}
          </span>
        </div>
      </div>
      <span
        class="trust-badge"
        :class="{ warning: !handle || !context.priceContextVerified }"
      >
        <UiIcon name="shield" :size="14" />
        {{ !handle ? "只读快照" : context.priceContextVerified ? "价格已验证" : "价格待验证" }}
      </span>
      <div class="context-summary">
        <span class="context-market">
          市场 · {{ context.country ?? "未知" }} · {{ context.currency ?? "未知" }}
        </span>
        <span v-if="coverage?.truncated" class="context-warning">结果已截断</span>
      </div>
      <div class="social-list">
        <span class="social-caption">社交媒体</span>
        <template v-if="socialLinks.length > 0">
          <a
            v-for="social in socialLinks"
            :key="social.platform"
            :href="social.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="social.url"
          >
            {{ socialLabel(social.platform) }}
          </a>
        </template>
        <span v-else class="social-empty">未发现公开账号</span>
      </div>
    </section>

    <nav v-if="currentBundle" class="app-nav" aria-label="结果页面">
      <button
        type="button"
        :class="{ active: activeView === 'overview' }"
        :aria-current="activeView === 'overview' ? 'page' : undefined"
        @click="activeView = 'overview'"
      >
        <UiIcon name="overview" />
        <span>店铺概览</span>
      </button>
      <button
        type="button"
        :class="{ active: activeView === 'products' }"
        :aria-current="activeView === 'products' ? 'page' : undefined"
        @click="activeView = 'products'"
      >
        <UiIcon name="products" />
        <span>产品</span>
        <b>{{ products.length }}</b>
      </button>
      <button
        type="button"
        :class="{ active: activeView === 'diagnostics' }"
        :aria-current="activeView === 'diagnostics' ? 'page' : undefined"
        @click="activeView = 'diagnostics'"
      >
        <UiIcon name="diagnostics" />
        <span>诊断</span>
      </button>
    </nav>

    <p
      v-if="currentBundle && context && (!context.priceContextVerified || context.contextMismatch)"
      class="warning-banner"
    >
      匿名 market/currency 或价格来源尚未全部通过门控；仅展示公开原始字段，不生成价格比较结论。
    </p>

    <section v-if="!currentBundle" class="empty-state">
      <span class="empty-illustration"><UiIcon name="radar" :size="34" /></span>
      <div>
        <p class="eyebrow">READY TO INSPECT</p>
        <h1>{{ handle ? "扫描当前 Shopify 店铺" : "先授权当前店铺" }}</h1>
        <p>
          {{ handle
            ? "读取公开产品目录，并生成畅销排序、上新证据和店铺统计。"
            : "回到公开店铺标签页点击扩展图标。面板不会自行获取新的 activeTab 授权。" }}
        </p>
      </div>
      <button
        type="button"
        class="empty-scan-action"
        :disabled="busy || !handle"
        @click="scanM2"
      >
        <UiIcon name="refresh" :size="16" />
        {{ handle ? "开始分析" : "等待授权" }}
      </button>
      <div class="privacy-row">
        <UiIcon name="shield" :size="15" />
        仅访问公开页面 · omit credentials · 不跟随重定向
      </div>
    </section>

    <section
      v-else-if="activeView === 'overview'"
      class="view-content overview-view"
    >
      <header class="view-heading">
        <div>
          <p class="eyebrow">STORE OVERVIEW</p>
          <h1>店铺概览</h1>
        </div>
        <button type="button" class="text-action" @click="activeView = 'products'">
          查看全部产品 <UiIcon name="chevron-right" :size="14" />
        </button>
      </header>

      <div v-if="analysis" class="metric-grid">
        <article>
          <span class="metric-icon purple"><UiIcon name="box" /></span>
          <div><small>产品总数</small><strong>{{ analysis.statistics.productCount }}</strong></div>
        </article>
        <article>
          <span class="metric-icon blue"><UiIcon name="layers" /></span>
          <div><small>变体数量</small><strong>{{ analysis.statistics.variantCount }}</strong></div>
        </article>
        <article>
          <span class="metric-icon amber"><UiIcon name="tag" /></span>
          <div><small>折扣产品</small><strong>{{ analysis.statistics.discount.discountedProducts }}</strong></div>
        </article>
        <article class="price-metric">
          <span class="metric-icon green"><UiIcon name="trend" /></span>
          <div>
            <small>价格区间</small>
            <strong>
              {{ displayMinor(analysis.statistics.price.minMinor) }}
              <span>–</span>
              {{ displayMinor(analysis.statistics.price.maxMinor) }}
            </strong>
          </div>
        </article>
      </div>

      <div v-if="coverage" class="coverage-line">
        <span><UiIcon name="database" :size="14" /> {{ coverage.productsFetched }} 个公开产品</span>
        <span>来源：{{ coverage.sources.join(' + ') || '无' }}</span>
      </div>

      <section v-if="analysis" class="content-card">
        <header class="card-heading">
          <div>
            <span class="section-icon purple"><UiIcon name="trend" /></span>
            <div>
              <h2>公开畅销排序</h2>
              <p>{{ analysis.bestSelling.scope?.handle ?? "无可用 scope" }}</p>
            </div>
          </div>
          <span class="data-pill">TOP {{ Math.min(6, analysis.bestSelling.items.length) }}</span>
        </header>
        <p class="disclaimer">{{ analysis.bestSelling.disclaimer }}</p>
        <ol v-if="analysis.bestSelling.items.length > 0" class="insight-list rank-list">
          <li v-for="item in analysis.bestSelling.items.slice(0, 6)" :key="item.handle">
            <span class="rank-number">{{ item.rank }}</span>
            <span class="insight-thumb">
              <img
                v-if="productImageForReference(item)"
                :src="productImageForReference(item)"
                alt=""
                crossorigin="anonymous"
                referrerpolicy="no-referrer"
                loading="lazy"
              />
              <span v-else>{{ productInitialForReference(item) }}</span>
            </span>
            <div>
              <a v-if="item.canonicalUrl" :href="item.canonicalUrl" target="_blank" rel="noreferrer">
                {{ item.title ?? item.handle }}
              </a>
              <strong v-else>{{ item.title ?? item.handle }}</strong>
              <small>{{ item.handle }}</small>
            </div>
            <UiIcon name="chevron-right" :size="14" />
          </li>
        </ol>
        <p v-else class="empty-copy">未取得可验证的公开 Collection 顺序。</p>
      </section>

      <section v-if="analysis" class="content-card">
        <header class="card-heading">
          <div>
            <span class="section-icon amber"><UiIcon name="clock" /></span>
            <div>
              <h2>上新候选</h2>
              <p>A–D 证据等级</p>
            </div>
          </div>
          <span class="data-pill">{{ analysis.newness.status }}</span>
        </header>
        <p class="disclaimer">{{ analysis.newness.disclaimer }}</p>
        <ul v-if="analysis.newness.candidates.length > 0" class="insight-list newness-list">
          <li
            v-for="candidate in analysis.newness.candidates.slice(0, 6)"
            :key="candidate.id ?? candidate.handle"
          >
            <span class="grade">{{ candidate.primaryGrade }}</span>
            <span class="insight-thumb">
              <img
                v-if="productImageForReference(candidate)"
                :src="productImageForReference(candidate)"
                alt=""
                crossorigin="anonymous"
                referrerpolicy="no-referrer"
                loading="lazy"
              />
              <span v-else>{{ productInitialForReference(candidate) }}</span>
            </span>
            <div>
              <strong>{{ candidate.title ?? candidate.handle ?? candidate.id }}</strong>
              <small>
                {{ candidate.primaryTimestamp
                  ? displayDate(candidate.primaryTimestamp)
                  : `公开相对排名 #${candidate.collectionRank ?? '—'}` }}
              </small>
            </div>
          </li>
        </ul>
        <p v-else class="empty-copy">无可用上新证据。</p>
      </section>

      <section v-if="analysis" class="content-card distribution-card">
        <header class="card-heading">
          <div>
            <span class="section-icon blue"><UiIcon name="layers" /></span>
            <div><h2>商品结构</h2><p>Vendor、类型与标签分布</p></div>
          </div>
        </header>
        <div class="distribution-grid">
          <div class="distribution-column">
            <h3>Vendor</h3>
            <div
              v-for="entry in analysis.statistics.vendors.slice(0, 6)"
              :key="entry.value"
              class="distribution-item"
            >
              <p><span>{{ entry.value }}</span><strong>{{ entry.count }}</strong></p>
              <i><span :style="{ width: distributionWidth(entry.count, analysis.statistics.vendors[0]?.count) }" /></i>
            </div>
          </div>
          <div class="distribution-column">
            <h3>Product Type</h3>
            <div
              v-for="entry in analysis.statistics.productTypes.slice(0, 6)"
              :key="entry.value"
              class="distribution-item"
            >
              <p><span>{{ entry.value }}</span><strong>{{ entry.count }}</strong></p>
              <i><span :style="{ width: distributionWidth(entry.count, analysis.statistics.productTypes[0]?.count) }" /></i>
            </div>
          </div>
        </div>
        <div v-if="analysis.statistics.tags.length > 0" class="tag-cloud">
          <span v-for="entry in analysis.statistics.tags.slice(0, 12)" :key="entry.value">
            {{ entry.value }} <b>{{ entry.count }}</b>
          </span>
        </div>
      </section>
    </section>

    <section v-else-if="activeView === 'products'" class="view-content products-view">
      <header class="view-heading">
        <div>
          <p class="eyebrow">PRODUCT EXPLORER</p>
          <h1>产品目录</h1>
        </div>
        <span class="result-count">{{ productResult.total }} / {{ products.length }}</span>
      </header>

      <div class="search-box">
        <UiIcon name="search" :size="17" />
        <input v-model="search" type="search" placeholder="搜索标题、handle、SKU 或 Tag" />
      </div>

      <div class="filter-grid">
        <select v-model="vendorFilter" aria-label="Vendor 筛选">
          <option value="">全部 Vendor</option>
          <option v-for="entry in facets.vendors" :key="entry.value" :value="entry.value">
            {{ entry.value }} ({{ entry.count }})
          </option>
        </select>
        <select v-model="productTypeFilter" aria-label="Product Type 筛选">
          <option value="">全部 Product Type</option>
          <option v-for="entry in facets.productTypes" :key="entry.value" :value="entry.value">
            {{ entry.value }} ({{ entry.count }})
          </option>
        </select>
        <select v-model="tagFilter" aria-label="Tag 筛选">
          <option value="">全部 Tag</option>
          <option v-for="entry in facets.tags" :key="entry.value" :value="entry.value">
            {{ entry.value }} ({{ entry.count }})
          </option>
        </select>
        <select v-model="availabilityFilter" aria-label="库存状态筛选">
          <option value="all">全部库存状态</option>
          <option value="available">有货</option>
          <option value="unavailable">售罄</option>
          <option value="unknown">未知</option>
        </select>
      </div>

      <div class="sort-row">
        <span><UiIcon name="sort" :size="15" /> 排序</span>
        <select v-model="productSort" aria-label="产品排序字段">
          <option value="createdAt">创建时间</option>
          <option value="publishedAt">发布时间</option>
          <option value="updatedAt">更新时间</option>
          <option value="title">标题</option>
          <option value="vendor">Vendor</option>
          <option value="productType">Product Type</option>
          <option value="variantCount">变体数</option>
        </select>
        <button
          type="button"
          class="direction-action"
          @click="sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'"
        >
          {{ sortDirection === "asc" ? "升序 ↑" : "降序 ↓" }}
        </button>
      </div>

      <div v-if="productResult.rows.length > 0" class="product-list">
        <article
          v-for="product in productResult.rows"
          :key="product.id ?? product.handle ?? product.canonicalUrl"
          class="product-row"
        >
          <span class="product-avatar" :class="{ 'has-image': productImage(product) }">
            <img
              v-if="productImage(product)"
              :src="productImage(product)"
              alt=""
              crossorigin="anonymous"
              referrerpolicy="no-referrer"
              loading="lazy"
            />
            <span v-else>{{ productInitial(product) }}</span>
          </span>
          <div class="product-copy">
            <a
              v-if="productUrl(product)"
              :href="productUrl(product)"
              target="_blank"
              rel="noreferrer"
            >
              {{ product.title ?? product.handle ?? product.id }}
            </a>
            <strong v-else>{{ product.title ?? product.handle ?? product.id }}</strong>
            <small>{{ product.handle ?? product.id }}</small>
            <div class="product-badges">
              <span v-if="product.vendor">{{ product.vendor }}</span>
              <span v-if="product.productType">{{ product.productType }}</span>
              <span v-for="tag in product.tags.slice(0, 2)" :key="tag">#{{ tag }}</span>
            </div>
          </div>
          <div class="product-facts">
            <span class="stock-badge" :class="productAvailabilityState(product)">
              {{ productAvailabilityLabel(product) }}
            </span>
            <strong>{{ product.variants.length }} <small>变体</small></strong>
            <time>{{ displayDate(product.createdAt) }}</time>
          </div>
        </article>
      </div>
      <div v-else class="empty-results">
        <UiIcon name="search" :size="26" />
        <strong>没有匹配的产品</strong>
        <span>调整搜索词或筛选条件后重试。</span>
      </div>

      <div class="pager">
        <button
          type="button"
          class="page-action"
          :disabled="productPage <= 1"
          aria-label="上一页"
          @click="productPage -= 1"
        >
          <UiIcon name="chevron-left" :size="16" /> 上一页
        </button>
        <span>第 <strong>{{ productPage }}</strong> / {{ productPageCount }} 页</span>
        <button
          type="button"
          class="page-action"
          :disabled="productPage >= productPageCount"
          aria-label="下一页"
          @click="productPage += 1"
        >
          下一页 <UiIcon name="chevron-right" :size="16" />
        </button>
      </div>
    </section>

    <section v-else class="view-content diagnostics-view">
      <header class="view-heading">
        <div>
          <p class="eyebrow">TECHNICAL DIAGNOSTICS</p>
          <h1>诊断工具</h1>
        </div>
        <span class="result-count" :class="{ offline: !handle }">
          {{ handle ? "SESSION OK" : "NO SESSION" }}
        </span>
      </header>

      <section class="diagnostic-card">
        <header><h2>会话与探针</h2><p>常规使用无需操作这些项目。</p></header>
        <div class="diagnostic-actions">
          <button type="button" :disabled="busy" @click="establish">
            <UiIcon name="shield" /> <span>检查授权<small>重建当前会话</small></span>
          </button>
          <button type="button" :disabled="busy || !handle" @click="runProbes">
            <UiIcon name="code" /> <span>双探针<small>MAIN / ISOLATED</small></span>
          </button>
          <button type="button" :disabled="busy || !handle" @click="fetchCart">
            <UiIcon name="database" /> <span>cart.js<small>匿名上下文</small></span>
          </button>
          <button type="button" :disabled="busy || !handle" @click="fetchProducts">
            <UiIcon name="products" /> <span>products.json<small>能力探测</small></span>
          </button>
          <button type="button" :disabled="busy" @click="runStorageSmoke">
            <UiIcon name="database" /> <span>IndexedDB<small>事务自检</small></span>
          </button>
          <button type="button" class="danger" :disabled="busy || !handle" @click="revoke">
            <UiIcon name="revoke" /> <span>吊销会话<small>清除当前句柄</small></span>
          </button>
        </div>
      </section>

      <section class="diagnostic-output">
        <header>
          <div><h2>运行输出</h2><p v-if="bootId">SW boot · {{ bootId }}</p></div>
          <span>{{ status }}</span>
        </header>
        <pre v-if="detail">{{ detail }}</pre>
        <p v-else class="empty-copy">尚无诊断输出。</p>
      </section>
    </section>

    <footer class="privacy-footer">
      <UiIcon name="shield" :size="14" />
      <span>仅分析公开店铺数据 · 不携带登录凭证</span>
    </footer>
  </main>
</template>
