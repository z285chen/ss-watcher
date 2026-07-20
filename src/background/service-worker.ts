import {
  SessionManager,
  type AuthorizationProbeInjectionResult,
  type MessageSenderLike,
  type SessionHandle,
  type SessionManagerChromeApi,
  type TabLike,
  type WindowLike,
} from "./session-manager";
import {
  executeEndpointRequest,
  RequestPolicyInputError,
  type EndpointExecutionResult,
  type EndpointRequest,
} from "../core/network/request-policy";
import {
  collectorProbe,
  isShopifyProbeResult,
  mainWorldShopifyProbe,
  type CollectorProbeResult,
  type ShopifyProbeResult,
} from "../content/probes";
import type {
  M0ActionAuthorizedNotice,
  M0ErrorResponse,
  M0Request,
  M0Response,
  SessionSummary,
} from "../shared/messages";
import { InFlightRequestRegistry } from "./in-flight-requests";

const bootId = crypto.randomUUID();
const sessionManager = new SessionManager(createSessionApi());
const inFlightRequests = new InFlightRequestRegistry();

void configureExtension();

chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  const windowId = tab.windowId;
  if (
    tabId === undefined ||
    !Number.isSafeInteger(tabId) ||
    tabId < 0 ||
    windowId === undefined ||
    !Number.isSafeInteger(windowId) ||
    windowId < 0
  ) {
    return;
  }

  // Keep sidePanel.open() directly inside the action event turn. Chrome grants
  // activeTab for this explicit action invocation; the panel then performs the
  // minimal probe and binds its own nonce before any privileged operation.
  void openPanelFromAction(tabId, windowId);
});

chrome.runtime.onInstalled.addListener(() => {
  void configureExtension();
});

chrome.runtime.onStartup.addListener(() => {
  void configureExtension();
  void sessionManager.purgeExpired();
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  inFlightRequests.cancelInactiveForWindow(windowId, tabId);
  void sessionManager.revokeInactiveForWindow(windowId, tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.status === "loading") {
    inFlightRequests.cancelTab(tabId);
    void sessionManager.revokeByTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  inFlightRequests.cancelTab(tabId);
  void sessionManager.revokeByTab(tabId);
});

chrome.windows.onRemoved.addListener((windowId) => {
  inFlightRequests.cancelWindow(windowId);
  void sessionManager.revokeByWindow(windowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    inFlightRequests.cancelAll();
    void sessionManager.revokeAll();
  } else {
    inFlightRequests.cancelOutsideWindow(windowId);
    void sessionManager.revokeOutsideWindow(windowId);
  }
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isM0Message(message)) return false;

  void handleMessage(message, toMessageSender(sender))
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse(
        fail(
          "internal_error",
          error instanceof Error ? error.message : "Service Worker 请求执行失败",
        ),
      );
    });
  return true;
});

async function configureExtension(): Promise<void> {
  await Promise.allSettled([
    // An explicit action handler is required so the activeTab grant and panel
    // opening share the same trusted user gesture on every supported Chrome.
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}

async function openPanelFromAction(
  tabId: number,
  windowId: number,
): Promise<void> {
  try {
    await chrome.sidePanel.open({ windowId });
  } catch {
    return;
  }

  const notice: M0ActionAuthorizedNotice = {
    type: "M0_ACTION_AUTHORIZED",
    windowId,
    tabId,
  };
  try {
    // A newly mounted panel also calls establish() on mount. This notice is for
    // an already-open panel whose earlier attempt failed before the action grant.
    await chrome.runtime.sendMessage(notice);
  } catch {
    // No receiver is expected when the panel is still mounting. Its onMounted
    // handshake covers that race without weakening authorization.
  }
}

async function handleMessage(
  message: M0Request,
  sender: MessageSenderLike,
): Promise<M0Response> {
  if (message.type === "M0_GET_BOOT_ID") {
    return { ok: true, bootId };
  }

  if (message.type === "M0_ESTABLISH_SESSION") {
    const established = await sessionManager.establishSession(
      {
        windowId: message.windowId,
        panelInstanceId: message.panelInstanceId,
      },
      sender,
    );
    if (!established.ok) {
      return fail(
        established.reason,
        sessionFailureMessage(established.reason),
        established.reason === "invalid_panel_sender"
          ? panelSenderDiagnostic(sender)
          : undefined,
      );
    }
    return {
      ok: true,
      bootId,
      session: {
        ...established.handle,
        ...sessionSummary(established.session),
      },
    };
  }

  const handle = validHandle(message.handle);
  if (handle === undefined) {
    return fail("invalid_request", "会话句柄格式无效");
  }

  const panelValidation = await sessionManager.validatePanelMessage(
    handle,
    sender,
    message.panelInstanceId,
  );
  if (!panelValidation.ok) {
    return fail(
      panelValidation.reason,
      sessionFailureMessage(panelValidation.reason),
    );
  }

  if (message.type === "M0_REVOKE_SESSION") {
    inFlightRequests.cancelRun(handle.runId);
    const revoked = await sessionManager.revoke(handle.runId);
    return revoked
      ? { ok: true, bootId, revoked: true }
      : fail("storage_error", "无法确认会话已经吊销");
  }

  if (message.type === "M1_CANCEL_SCAN") {
    if (!isValidScanId(message.scanId)) {
      return fail("invalid_request", "scanId 格式无效");
    }
    return {
      ok: true,
      bootId,
      cancelled: inFlightRequests.cancel(handle.runId, message.scanId),
    };
  }

  const executionValidation = await sessionManager.validateForExecution(handle);
  if (!executionValidation.ok) {
    return fail(
      executionValidation.reason,
      sessionFailureMessage(executionValidation.reason),
    );
  }
  const { session } = executionValidation;

  if (message.type === "M0_RUN_PROBES") {
    const [mainAttempt, collectorAttempt] = await Promise.allSettled([
      chrome.scripting.executeScript<[], ShopifyProbeResult | null>({
        target: { tabId: session.tabId, frameIds: [0] },
        world: "MAIN",
        func: mainWorldShopifyProbe,
      }),
      chrome.scripting.executeScript<
        [{ expectedOrigin: string; expectedPathname: string }],
        CollectorProbeResult
      >({
        target: { tabId: session.tabId, frameIds: [0] },
        world: "ISOLATED",
        func: collectorProbe,
        args: [
          {
            expectedOrigin: session.origin,
            expectedPathname: session.pathname,
          },
        ],
      }),
    ]);

    if (collectorAttempt.status === "rejected") {
      await sessionManager.revoke(session.runId);
      return fail("authorization_probe_failed", "ISOLATED Collector 注入失败");
    }
    const collector = readInjectionResult(
      collectorAttempt.value,
      session.documentId,
    );
    if (collector === undefined || !isCollectorProbeResult(collector)) {
      await sessionManager.revoke(session.runId);
      return fail("authorization_race", "Collector 返回通道或页面文档已发生变化");
    }

    // MAIN is page-owned and therefore best-effort. A hostile getter, page
    // CSP/environment issue, or an invalid payload degrades to null while the
    // independently validated Collector and endpoint flow remain usable.
    let main: ShopifyProbeResult | null = null;
    if (mainAttempt.status === "fulfilled") {
      const candidate = readInjectionResult(mainAttempt.value, session.documentId);
      if (candidate !== undefined && isShopifyProbeResult(candidate)) {
        main = candidate;
      }
    }

    const afterProbe = await sessionManager.validateForExecution(handle);
    if (!afterProbe.ok) {
      return fail(afterProbe.reason, sessionFailureMessage(afterProbe.reason));
    }
    return {
      ok: true,
      bootId,
      session: sessionSummary(session),
      main,
      collector,
    };
  }

  if (!isEndpointRequest(message.endpoint)) {
    return fail("invalid_request", "端点请求不在固定 allowlist 中");
  }
  if (message.routeRoot !== undefined && typeof message.routeRoot !== "string") {
    return fail("invalid_request", "routeRoot 格式无效");
  }
  if (message.scanId !== undefined && !isValidScanId(message.scanId)) {
    return fail("invalid_request", "scanId 格式无效");
  }

  let result: EndpointExecutionResult;
  const lease =
    message.scanId === undefined
      ? undefined
      : inFlightRequests.acquire({
          runId: handle.runId,
          scanId: message.scanId,
          tabId: session.tabId,
          windowId: session.windowId,
        });
  try {
    result = await executeEndpointRequest(
      { origin: session.origin },
      message.endpoint,
      {
        ...(message.routeRoot === undefined ? {} : { routeRoot: message.routeRoot }),
        ...(lease === undefined ? {} : { signal: lease.signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof RequestPolicyInputError) {
      return fail("invalid_request", error.message);
    }
    throw error;
  } finally {
    lease?.release();
  }
  const afterFetch = await sessionManager.validateForExecution(handle);
  if (!afterFetch.ok) {
    return fail(afterFetch.reason, sessionFailureMessage(afterFetch.reason));
  }
  return { ok: true, bootId, result };
}

function createSessionApi(): SessionManagerChromeApi {
  return {
    runtime: {
      id: chrome.runtime.id,
      getURL: (path) => chrome.runtime.getURL(path),
    },
    storage: {
      session: {
        get: async (keys) => chrome.storage.session.get(keys),
        set: async (items) => chrome.storage.session.set(items),
        remove: async (keys) => chrome.storage.session.remove(keys),
      },
    },
    tabs: {
      query: async (queryInfo) =>
        (await chrome.tabs.query(queryInfo)).map(toTabLike),
      get: async (tabId) => toTabLike(await chrome.tabs.get(tabId)),
    },
    windows: {
      get: async (windowId) => toWindowLike(await chrome.windows.get(windowId)),
    },
    scripting: {
      executeScript: async (injection) => {
        const results = await chrome.scripting.executeScript<
          [],
          AuthorizationProbeInjectionResult["result"]
        >(injection);
        return results.map((result) => ({
          frameId: result.frameId,
          ...(result.documentId === undefined ? {} : { documentId: result.documentId }),
          ...(result.result === undefined ? {} : { result: result.result }),
        }));
      },
    },
  };
}

function toMessageSender(sender: chrome.runtime.MessageSender): MessageSenderLike {
  return {
    ...(sender.id === undefined ? {} : { id: sender.id }),
    ...(sender.url === undefined ? {} : { url: sender.url }),
    ...(sender.origin === undefined ? {} : { origin: sender.origin }),
    ...(sender.documentId === undefined ? {} : { documentId: sender.documentId }),
    ...(sender.frameId === undefined ? {} : { frameId: sender.frameId }),
    ...(sender.tab === undefined ? {} : { tab: toTabLike(sender.tab) }),
  };
}

function toTabLike(tab: chrome.tabs.Tab): TabLike {
  return {
    ...(tab.id === undefined ? {} : { id: tab.id }),
    ...(tab.windowId === undefined ? {} : { windowId: tab.windowId }),
    ...(tab.active === undefined ? {} : { active: tab.active }),
    ...(tab.url === undefined ? {} : { url: tab.url }),
  };
}

function toWindowLike(window: chrome.windows.Window): WindowLike {
  return {
    ...(window.id === undefined ? {} : { id: window.id }),
    ...(window.focused === undefined ? {} : { focused: window.focused }),
  };
}

function readInjectionResult<T>(
  results: chrome.scripting.InjectionResult<T>[],
  documentId: string,
): T | undefined {
  if (results.length !== 1) return undefined;
  const result = results[0];
  if (
    result === undefined ||
    result.frameId !== 0 ||
    result.documentId !== documentId ||
    result.result === undefined
  ) {
    return undefined;
  }
  return result.result;
}

function validHandle(value: unknown): SessionHandle | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.runId !== "string" ||
    !/^[a-zA-Z0-9._~-]{1,128}$/u.test(value.runId) ||
    typeof value.sessionToken !== "string" ||
    !/^[a-zA-Z0-9_-]{43}$/u.test(value.sessionToken)
  ) {
    return undefined;
  }
  return { runId: value.runId, sessionToken: value.sessionToken };
}

function isM0Message(value: unknown): value is M0Request {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  return [
    "M0_ESTABLISH_SESSION",
    "M0_RUN_PROBES",
    "M0_FETCH_ENDPOINT",
    "M1_CANCEL_SCAN",
    "M0_REVOKE_SESSION",
    "M0_GET_BOOT_ID",
  ].includes(value.type);
}

function isValidScanId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9._~-]{1,128}$/u.test(value)
  );
}

function isEndpointRequest(value: unknown): value is EndpointRequest {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "meta":
    case "cart-context":
      return true;
    case "products-page":
      return typeof value.page === "number" && typeof value.limit === "number";
    case "collection-products-json":
      return (
        typeof value.handle === "string" &&
        typeof value.page === "number" &&
        (value.limit === undefined || typeof value.limit === "number")
      );
    case "product-ajax-js":
      return typeof value.handle === "string";
    case "collection-html":
      return (
        typeof value.handle === "string" &&
        (value.sortBy === "best-selling" || value.sortBy === "created-descending") &&
        (value.page === undefined || typeof value.page === "number")
      );
    case "sitemap":
      return (
        (value.index === undefined || typeof value.index === "number") &&
        (value.from === undefined || typeof value.from === "string") &&
        (value.to === undefined || typeof value.to === "string")
      );
    case "page-html":
      return value.target === "route-root" || value.target === "password";
    default:
      return false;
  }
}

function isCollectorProbeResult(value: unknown): value is CollectorProbeResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) {
    return ["origin_changed", "path_changed", "sensitive_path"].includes(
      String(value.reason),
    );
  }
  return (
    (value.canonical === undefined ||
      (typeof value.canonical === "string" &&
        value.canonical.length <= 2_048 &&
        !value.canonical.includes("?") &&
        !value.canonical.includes("#"))) &&
    (value.generator === undefined ||
      (typeof value.generator === "string" && value.generator.length <= 256)) &&
    Array.isArray(value.scriptUrls) &&
    value.scriptUrls.length <= 100 &&
    value.scriptUrls.every(
      (item) =>
        typeof item === "string" &&
        item.length <= 2_048 &&
        !item.includes("?") &&
        !item.includes("#"),
    ) &&
    Array.isArray(value.linkUrls) &&
    value.linkUrls.length <= 100 &&
    value.linkUrls.every(
      (item) =>
        typeof item === "string" &&
        item.length <= 2_048 &&
        !item.includes("?") &&
        !item.includes("#"),
    ) &&
    Array.isArray(value.checkoutUrls) &&
    value.checkoutUrls.length <= 20 &&
    value.checkoutUrls.every(
      (item) =>
        typeof item === "string" &&
        item.length <= 2_048 &&
        !item.includes("?") &&
        !item.includes("#"),
    ) &&
    Number.isSafeInteger(value.jsonLdCount) &&
    Number(value.jsonLdCount) >= 0 &&
    Number(value.jsonLdCount) <= 10_000 &&
    Array.isArray(value.pageProducts) &&
    value.pageProducts.length <= 100 &&
    value.pageProducts.every(isCollectorPageProduct) &&
    collectorPageProductBytes(value.pageProducts) <= 512 * 1_024 &&
    Array.isArray(value.collectionHandles) &&
    value.collectionHandles.length <= 50 &&
    value.collectionHandles.every(
      (item) =>
        typeof item === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,254}$/u.test(item),
    )
  );
}

function isCollectorPageProduct(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const allowedSources = new Set(["canonical", "dom", "json-ld"]);
  return (
    isCleanPublicUrl(value.canonicalUrl) &&
    (value.title === undefined ||
      (typeof value.title === "string" && value.title.length <= 512)) &&
    Array.isArray(value.images) &&
    value.images.length <= 20 &&
    value.images.every(isCleanPublicUrl) &&
    Array.isArray(value.sources) &&
    value.sources.length >= 1 &&
    value.sources.length <= 3 &&
    value.sources.every(
      (source) => typeof source === "string" && allowedSources.has(source),
    )
  );
}

function isCleanPublicUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function collectorPageProductBytes(values: readonly unknown[]): number {
  let bytes = 0;
  for (const value of values) {
    if (!isRecord(value)) return Number.POSITIVE_INFINITY;
    const strings = [
      value.canonicalUrl,
      value.title,
      ...(Array.isArray(value.images) ? value.images : []),
      ...(Array.isArray(value.sources) ? value.sources : []),
    ];
    for (const item of strings) {
      if (typeof item === "string") bytes += new TextEncoder().encode(item).byteLength;
    }
  }
  return bytes;
}

function sessionSummary(session: {
  origin: string;
  pathname: string;
  tabId: number;
  documentId: string;
}): SessionSummary {
  return {
    origin: session.origin,
    pathname: session.pathname,
    tabId: session.tabId,
    documentId: session.documentId,
  };
}

function sessionFailureMessage(reason: string): string {
  switch (reason) {
    case "sensitive_path":
      return "当前页面属于敏感路径，请切换到公开店铺页面";
    case "authorization_probe_failed":
    case "session_not_found":
    case "session_expired":
      return "当前标签页没有有效授权，请重新点击扩展图标";
    case "authorization_race":
    case "invalid_tab":
    case "invalid_window":
    case "session_mismatch":
      return "页面或标签页已经变化，会话已吊销，请重新授权";
    case "invalid_panel_sender":
      return "请求不是来自已授权的 Side Panel 文档";
    default:
      return "安全校验未通过";
  }
}

function fail(
  reason: string,
  message: string,
  diagnostic?: Record<string, unknown>,
): M0ErrorResponse {
  return {
    ok: false,
    bootId,
    reason,
    ...(diagnostic === undefined ? {} : { diagnostic }),
    message,
  };
}

function panelSenderDiagnostic(sender: MessageSenderLike): Record<string, unknown> {
  let senderUrl: URL | undefined;
  try {
    senderUrl = sender.url === undefined ? undefined : new URL(sender.url);
  } catch {
    senderUrl = undefined;
  }
  const extensionRoot = new URL(chrome.runtime.getURL("/"));
  return {
    idMatches: sender.id === chrome.runtime.id,
    urlPresent: sender.url !== undefined,
    urlProtocol: senderUrl?.protocol ?? null,
    urlHostMatches: senderUrl?.host === extensionRoot.host,
    urlPathname: senderUrl?.pathname ?? null,
    origin: sender.origin ?? null,
    documentIdPresent:
      typeof sender.documentId === "string" && sender.documentId.length > 0,
    hasTab: sender.tab !== undefined,
    frameId: sender.frameId ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
