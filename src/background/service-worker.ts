import {
  SessionManager,
  type AuthorizationProbeInjectionResult,
  type MessageSenderLike,
  type ScanSession,
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
import {
  designIntelligenceProbe,
  type DesignProbeResult,
} from "../content/design-probe";
import {
  redactedComponentGraphProbe,
  readCaptureScrollPosition,
  readSettledCaptureCheckpoint,
  scrollCaptureCheckpoint,
  type RedactedComponentProbeResult,
} from "../content/redacted-component-probe";
import type {
  M0ActionAuthorizedNotice,
  M0ErrorResponse,
  M0Request,
  M0Response,
  SessionSummary,
} from "../shared/messages";
import { InFlightRequestRegistry } from "./in-flight-requests";
import {
  deriveSourceMapCapability,
  executeRegisteredResourceRequest,
  registerResourceCandidates,
} from "../core/frontend/resource-policy";
import type {
  CollectorResourceCandidate,
  ResourceFetchResult,
} from "../core/frontend/resource-types";
import { ResourceScanBudgetRegistry } from "./resource-scan-budget";
import { SidePanelBindingController } from "./side-panel-binding";
import {
  emptyDesignIntelligence,
  isDesignIntelligenceResult,
  type DesignIntelligenceResult,
} from "../core/design/design-intelligence";
import {
  compareCaptureMetrics,
  DesignDebuggerCapture,
} from "./design-debugger-capture";

const bootId = crypto.randomUUID();
const sessionManager = new SessionManager(createSessionApi());
const inFlightRequests = new InFlightRequestRegistry();
const resourceBudgets = new ResourceScanBudgetRegistry();
const sidePanelBinding = new SidePanelBindingController({
  sidePanel: chrome.sidePanel,
  tabs: {
    query: async () =>
      (await chrome.tabs.query({})).map((tab) => ({ id: tab.id })),
  },
  storage: chrome.storage.session,
});
const designDebuggerCapture = new DesignDebuggerCapture(chrome.debugger);
const DESIGN_CONTROLLER_PORT_PREFIX = "design-controller:";

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

  // openForTab() dispatches setOptions() and sidePanel.open() before its first
  // await, preserving this explicit action's user gesture and activeTab grant.
  void openPanelFromAction(tabId, windowId, tab.url);
});

chrome.runtime.onInstalled.addListener(() => {
  void configureExtension();
  void sidePanelBinding.disableAllTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void configureExtension();
  void sidePanelBinding.disableAllTabs();
  void sessionManager.purgeExpired();
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  inFlightRequests.cancelInactiveForWindow(windowId, tabId);
  resourceBudgets.cancelInactiveForWindow(windowId, tabId);
  void sessionManager.revokeInactiveForWindow(
    windowId,
    tabId,
    cleanupDesignSessionBeforeRevoke,
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.status === "loading") {
    inFlightRequests.cancelTab(tabId);
    resourceBudgets.cancelTab(tabId);
    void sessionManager.revokeByTab(tabId, cleanupDesignSessionBeforeRevoke);
  }
  if (changeInfo.url !== undefined) {
    void sidePanelBinding.handleNavigation(tabId, changeInfo.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  inFlightRequests.cancelTab(tabId);
  resourceBudgets.cancelTab(tabId);
  void sessionManager.revokeByTab(tabId, cleanupDesignSessionBeforeRevoke);
  void sidePanelBinding.disableTab(tabId);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) designDebuggerCapture.noteDetached(source.tabId);
});

chrome.runtime.onSuspend.addListener(() => {
  void designDebuggerCapture.cancelAll().catch(() => undefined);
});

chrome.windows.onRemoved.addListener((windowId) => {
  inFlightRequests.cancelWindow(windowId);
  resourceBudgets.cancelWindow(windowId);
  void sessionManager.revokeByWindow(windowId, cleanupDesignSessionBeforeRevoke);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    inFlightRequests.cancelAll();
    resourceBudgets.clear();
    void sessionManager.revokeOnFocusLoss(cleanupDesignSessionBeforeRevoke);
  } else {
    inFlightRequests.cancelOutsideWindow(windowId);
    resourceBudgets.cancelOutsideWindow(windowId);
    void sessionManager.revokeOutsideWindow(
      windowId,
      cleanupDesignSessionBeforeRevoke,
    );
  }
});

chrome.runtime.onConnect.addListener((port) => {
  const panelInstanceId = validDesignControllerPort(port);
  if (panelInstanceId === undefined) return;
  port.onDisconnect.addListener(() => {
    void sessionManager.revokeByPanelInstance(
      panelInstanceId,
      cleanupDesignSessionBeforeRevoke,
    );
  });
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
    sidePanelBinding.disableGlobalPanel(),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}

async function cleanupDesignSessionBeforeRevoke(session: Readonly<ScanSession>): Promise<void> {
  inFlightRequests.cancelRun(session.runId);
  resourceBudgets.cancelRun(session.runId);
  await designDebuggerCapture.cancelRun(session.runId);
}

function validDesignControllerPort(port: chrome.runtime.Port): string | undefined {
  if (!port.name.startsWith(DESIGN_CONTROLLER_PORT_PREFIX)) return undefined;
  const panelInstanceId = port.name.slice(DESIGN_CONTROLLER_PORT_PREFIX.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(panelInstanceId)) {
    return undefined;
  }
  const sender = port.sender;
  if (sender?.id !== chrome.runtime.id || sender.url === undefined) return undefined;
  try {
    const senderUrl = new URL(sender.url);
    const sidePanelRoot = new URL("sidepanel/", chrome.runtime.getURL("/"));
    if (
      senderUrl.protocol !== sidePanelRoot.protocol ||
      senderUrl.host !== sidePanelRoot.host ||
      !senderUrl.pathname.startsWith(sidePanelRoot.pathname)
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return panelInstanceId;
}

async function openPanelFromAction(
  tabId: number,
  windowId: number,
  url: string | undefined,
): Promise<void> {
  const opened = await sidePanelBinding.openForTab(tabId, url);
  if (!opened) return;

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
        ...(message.targetTabId === undefined ? {} : { tabId: message.targetTabId }),
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
    resourceBudgets.cancelRun(handle.runId);
    await designDebuggerCapture.cancelRun(handle.runId);
    const revoked = await sessionManager.revoke(handle.runId);
    return revoked
      ? { ok: true, bootId, revoked: true }
      : fail("storage_error", "无法确认会话已经吊销");
  }

  if (message.type === "M1_CANCEL_SCAN") {
    if (!isValidScanId(message.scanId)) {
      return fail("invalid_request", "scanId 格式无效");
    }
    resourceBudgets.finish(handle.runId, message.scanId);
    const cancelled = inFlightRequests.cancel(handle.runId, message.scanId);
    // A cancelled scan/export must not leave page-observed or SW-derived URL
    // capabilities usable against an older committed snapshot. This mutation
    // is serialized with late source-map registration, so cleanup wins both
    // sides of the cancellation race while the non-resource session remains.
    const cleared = await sessionManager.replaceRegisteredResources(handle, []);
    if (!cleared.ok) {
      return fail(cleared.reason, sessionFailureMessage(cleared.reason));
    }
    return {
      ok: true,
      bootId,
      cancelled,
      capabilitiesCleared: true,
    };
  }

  if (message.type === "M3_FINISH_RESOURCE_SCAN") {
    if (!isValidScanId(message.scanId)) {
      return fail("invalid_request", "scanId 格式无效");
    }
    return {
      ok: true,
      bootId,
      finished: resourceBudgets.finish(handle.runId, message.scanId),
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

  if (message.type === "M0_VALIDATE_SESSION") {
    return {
      ok: true,
      bootId,
      session: sessionSummary(session),
    };
  }

  if (message.type === "DESIGN_V2_BEGIN_VIEWPORT_CAPTURE") {
    try {
      const positionInjection = await chrome.scripting.executeScript<
        [{ expectedOrigin: string; expectedPathname: string }],
        ReturnType<typeof readCaptureScrollPosition>
      >({
        target: { tabId: session.tabId, frameIds: [0] },
        world: "ISOLATED",
        func: readCaptureScrollPosition,
        args: [{ expectedOrigin: session.origin, expectedPathname: session.pathname }],
      });
      const position = readInjectionResult(positionInjection, session.documentId);
      if (position === undefined || !position.ok) {
        return fail("authorization_race", "无法在模拟视口前保存原滚动位置");
      }
      const viewport = await designDebuggerCapture.begin(
        session.tabId,
        handle.runId,
        message.viewportName,
      );
      const afterAttach = await sessionManager.validateForExecution(handle);
      if (!afterAttach.ok) {
        await designDebuggerCapture.cancelTab(session.tabId);
        return fail(afterAttach.reason, sessionFailureMessage(afterAttach.reason));
      }
      return {
        ok: true,
        bootId,
        session: sessionSummary(afterAttach.session),
        viewport: {
          width: viewport.width,
          height: viewport.height,
          devicePixelRatio: viewport.deviceScaleFactor,
        },
        originalScrollY: position.scrollY,
      };
    } catch (error: unknown) {
      return fail(
        "debugger_attach_failed",
        `无法启动统一视口采集：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (message.type === "DESIGN_V2_END_VIEWPORT_CAPTURE") {
    try {
      await designDebuggerCapture.end(session.tabId, handle.runId);
    } catch (error: unknown) {
      return fail(
        "debugger_detach_failed",
        `无法恢复浏览器视口：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      ok: true,
      bootId,
      session: sessionSummary(session),
    };
  }

  if (message.type === "DESIGN_V2_PREPARE_CAPTURE") {
    await waitForMs(650);
    const graphInjection = await chrome.scripting.executeScript<
      [{ expectedOrigin: string; expectedPathname: string }],
      RedactedComponentProbeResult
    >({
      target: { tabId: session.tabId, frameIds: [0] },
      world: "ISOLATED",
      func: redactedComponentGraphProbe,
      args: [{ expectedOrigin: session.origin, expectedPathname: session.pathname }],
    });
    const graph = readInjectionResult(graphInjection, session.documentId);
    if (graph === undefined || !graph.ok) {
      return fail("invalid_probe_result", "脱敏组件图未通过页面身份校验");
    }
    const afterGraph = await sessionManager.validateForExecution(handle);
    if (!afterGraph.ok) return fail(afterGraph.reason, sessionFailureMessage(afterGraph.reason));
    return {
      ok: true,
      bootId,
      session: sessionSummary(afterGraph.session),
      graph,
    };
  }

  if (
    message.type === "DESIGN_V2_CAPTURE_CHECKPOINT" ||
    message.type === "DESIGN_V2_RESTORE_SCROLL"
  ) {
    if (
      !Number.isFinite(message.scrollY) ||
      message.scrollY < 0 ||
      message.scrollY > 200_000
    ) {
      return fail("invalid_request", "滚动检查点超出安全范围");
    }
    const settleMs =
      message.type === "DESIGN_V2_CAPTURE_CHECKPOINT" ? message.settleMs : 0;
    if (!Number.isFinite(settleMs) || settleMs < 0 || settleMs > 2_000) {
      return fail("invalid_request", "稳定等待时间超出安全范围");
    }
    const checkpointInjection = await chrome.scripting.executeScript<
      [{ expectedOrigin: string; expectedPathname: string; scrollY: number; settleMs: number }],
      ReturnType<typeof scrollCaptureCheckpoint>
    >({
      target: { tabId: session.tabId, frameIds: [0] },
      world: "ISOLATED",
      func: scrollCaptureCheckpoint,
      args: [{
        expectedOrigin: session.origin,
        expectedPathname: session.pathname,
        scrollY: message.scrollY,
        settleMs,
      }],
    });
    const checkpoint = readInjectionResult(checkpointInjection, session.documentId);
    if (checkpoint === undefined || !checkpoint.ok) {
      return fail("authorization_race", "页面在滚动检查点期间发生变化");
    }
    if (settleMs > 0) await waitForMs(settleMs);
    const afterScroll = await sessionManager.validateForExecution(handle);
    if (!afterScroll.ok) return fail(afterScroll.reason, sessionFailureMessage(afterScroll.reason));

    if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
      return {
        ok: true,
        bootId,
        session: sessionSummary(afterScroll.session),
        restoredScrollY: checkpoint.scrollY,
      };
    }

    const settledCheckpointInjection = await chrome.scripting.executeScript<
      [{ expectedOrigin: string; expectedPathname: string }],
      ReturnType<typeof readSettledCaptureCheckpoint>
    >({
      target: { tabId: session.tabId, frameIds: [0] },
      world: "ISOLATED",
      func: readSettledCaptureCheckpoint,
      args: [{ expectedOrigin: session.origin, expectedPathname: session.pathname }],
    });
    const settledCheckpoint = readInjectionResult(
      settledCheckpointInjection,
      session.documentId,
    );
    if (settledCheckpoint === undefined || !settledCheckpoint.ok) {
      return fail("authorization_race", "页面在截图稳定检查期间发生变化");
    }

    let graph: RedactedComponentProbeResult | undefined;
    if (message.includeGraph) {
      const graphInjection = await chrome.scripting.executeScript<
        [{ expectedOrigin: string; expectedPathname: string }],
        RedactedComponentProbeResult
      >({
        target: { tabId: session.tabId, frameIds: [0] },
        world: "ISOLATED",
        func: redactedComponentGraphProbe,
        args: [{ expectedOrigin: session.origin, expectedPathname: session.pathname }],
      });
      graph = readInjectionResult(graphInjection, session.documentId);
      if (graph === undefined || !graph.ok) {
        return fail("invalid_probe_result", "脱敏组件图未通过页面身份校验");
      }
    }
    const screenshotDataUrl = await designDebuggerCapture.capturePngDataUrl(
      session.tabId,
      handle.runId,
    );
    if (!screenshotDataUrl.startsWith("data:image/png;base64,")) {
      return fail("capture_failed", "可见区域截图返回格式无效");
    }
    const postScreenshotCheckpointInjection = await chrome.scripting.executeScript<
      [{ expectedOrigin: string; expectedPathname: string }],
      ReturnType<typeof readSettledCaptureCheckpoint>
    >({
      target: { tabId: session.tabId, frameIds: [0] },
      world: "ISOLATED",
      func: readSettledCaptureCheckpoint,
      args: [{ expectedOrigin: session.origin, expectedPathname: session.pathname }],
    });
    const postScreenshotCheckpoint = readInjectionResult(
      postScreenshotCheckpointInjection,
      session.documentId,
    );
    if (postScreenshotCheckpoint === undefined || !postScreenshotCheckpoint.ok) {
      return fail("authorization_race", "页面在截图后身份校验期间发生变化");
    }
    const captureStability = compareCaptureMetrics(
      settledCheckpoint,
      postScreenshotCheckpoint,
    );
    if (!captureStability.ok) {
      return captureStability.reason === "capture_drift"
        ? fail("capture_drift", `页面在截图期间发生视口或滚动漂移（${captureStability.changedMetrics.join("、")}）`)
        : fail("coverage_drift", `页面在截图期间发生内容高度变化（${captureStability.changedMetrics.join("、")}）`);
    }
    const afterCapture = await sessionManager.validateForExecution(handle);
    if (!afterCapture.ok) return fail(afterCapture.reason, sessionFailureMessage(afterCapture.reason));
    return {
      ok: true,
      bootId,
      session: sessionSummary(afterCapture.session),
      checkpoint: captureStability.checkpoint,
      screenshotDataUrl,
      ...(graph === undefined ? {} : { graph }),
    };
  }

  if (message.type === "M0_RUN_PROBES") {
    if (message.scanId !== undefined && !isValidScanId(message.scanId)) {
      return fail("invalid_request", "scanId 格式无效");
    }
    const probeLease =
      message.scanId === undefined
        ? undefined
        : inFlightRequests.acquire({
            runId: handle.runId,
            scanId: message.scanId,
            tabId: session.tabId,
            windowId: session.windowId,
          });
    try {
      const [mainAttempt, collectorAttempt, designAttempt] = await Promise.allSettled([
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
        chrome.scripting.executeScript<
          [{ expectedOrigin: string; expectedPathname: string }],
          DesignProbeResult
        >({
          target: { tabId: session.tabId, frameIds: [0] },
          world: "ISOLATED",
          func: designIntelligenceProbe,
          args: [
            {
              expectedOrigin: session.origin,
              expectedPathname: session.pathname,
            },
          ],
        }),
      ]);

      if (probeLease?.signal.aborted) {
        return fail("scan_cancelled", "扫描已取消");
      }

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

      // Design Intelligence is an experimental, best-effort module. Injection
      // or payload failures must not weaken Collector authorization or prevent
      // the catalog/frontend modules from completing.
      let design: DesignIntelligenceResult = emptyDesignIntelligence(
        designAttempt.status === "rejected"
          ? "probe_injection_failed"
          : "invalid_probe_result",
      );
      if (designAttempt.status === "fulfilled") {
        const candidate = readInjectionResult(
          designAttempt.value,
          session.documentId,
        );
        if (
          candidate !== undefined &&
          isDesignIntelligenceResult(candidate, {
            origin: session.origin,
            pathname: session.pathname,
          })
        ) {
          design = candidate;
        }
      }

      const afterProbe = await sessionManager.validateForExecution(handle);
      if (!afterProbe.ok) {
        return fail(afterProbe.reason, sessionFailureMessage(afterProbe.reason));
      }
      if (probeLease?.signal.aborted) {
        return fail("scan_cancelled", "扫描已取消");
      }
      const resources = registerResourceCandidates(
        collector.ok ? (collector.resources ?? []) : [],
        { origin: afterProbe.session.origin },
      );
      const registered = await sessionManager.replaceRegisteredResources(
        handle,
        resources,
      );
      if (!registered.ok) {
        return fail(registered.reason, sessionFailureMessage(registered.reason));
      }
      const afterRegistration = await sessionManager.validateForExecution(handle);
      if (!afterRegistration.ok) {
        return fail(
          afterRegistration.reason,
          sessionFailureMessage(afterRegistration.reason),
        );
      }
      if (probeLease?.signal.aborted) {
        return fail("scan_cancelled", "扫描已取消");
      }
      return {
        ok: true,
        bootId,
        session: sessionSummary(afterRegistration.session),
        main,
        collector,
        design,
        resources,
      };
    } finally {
      probeLease?.release();
    }
  }

  if (message.type === "M3_FETCH_RESOURCE") {
    if (!isValidResourceId(message.resourceId)) {
      return fail("invalid_request", "resourceId 格式无效");
    }
    if (!isValidScanId(message.scanId)) {
      return fail("invalid_request", "scanId 格式无效");
    }
    const descriptor = session.resources?.find(
      (resource) => resource.resourceId === message.resourceId,
    );
    if (descriptor === undefined) {
      const result: ResourceFetchResult = {
        ok: false,
        resourceId: message.resourceId,
        reason: "resource_not_registered",
      };
      return { ok: true, bootId, result };
    }
    const scope = {
      runId: handle.runId,
      scanId: message.scanId,
      tabId: session.tabId,
      windowId: session.windowId,
    };
    const budgetLease = resourceBudgets.acquire(scope, descriptor.kind);
    if (budgetLease === undefined) {
      const result: ResourceFetchResult = {
        ok: false,
        resourceId: descriptor.resourceId,
        reason: "budget_exceeded",
        descriptor: {
          ...descriptor,
          fetchStatus: "skipped",
          failureReason: "budget_exceeded",
        },
      };
      return { ok: true, bootId, result };
    }
    const lease = inFlightRequests.acquire(scope);
    let result: ResourceFetchResult;
    let acceptedBytes: number | undefined;
    try {
      result = await executeRegisteredResourceRequest(
        { origin: session.origin },
        descriptor,
        {
          signal: lease.signal,
          maximumBytes: budgetLease.maximumBytes,
        },
      );
      if (result.ok) acceptedBytes = result.descriptor.byteLength ?? 0;
      else if (result.reason === "too_large" && budgetLease.budgetLimited) {
        result = {
          ...result,
          reason: "budget_exceeded",
          ...(result.descriptor === undefined
            ? {}
            : {
                descriptor: {
                  ...result.descriptor,
                  fetchStatus: "skipped",
                  failureReason: "budget_exceeded",
                },
              }),
        };
      }
    } finally {
      budgetLease.complete(acceptedBytes);
      lease.release();
    }
    const afterFetch = await sessionManager.validateForExecution(handle);
    if (!afterFetch.ok) {
      return fail(afterFetch.reason, sessionFailureMessage(afterFetch.reason));
    }
    if (result.ok) {
      const derived = deriveSourceMapCapability(
        { origin: afterFetch.session.origin },
        result.descriptor,
        result.text,
      );
      if (derived !== undefined) {
        const registration = await sessionManager.registerDerivedResource(
          handle,
          descriptor.resourceId,
          derived,
        );
        if (!registration.ok && registration.reason !== "resource_limit") {
          return fail(
            registration.reason,
            sessionFailureMessage(registration.reason),
          );
        }
        if (registration.ok) {
          result = {
            ...result,
            derivedResources: [registration.resource],
          };
        }
      }
    }
    return { ok: true, bootId, result };
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
    "M0_VALIDATE_SESSION",
    "M0_RUN_PROBES",
    "M0_FETCH_ENDPOINT",
    "M3_FETCH_RESOURCE",
    "M3_FINISH_RESOURCE_SCAN",
    "M1_CANCEL_SCAN",
    "M0_REVOKE_SESSION",
    "DESIGN_V2_BEGIN_VIEWPORT_CAPTURE",
    "DESIGN_V2_PREPARE_CAPTURE",
    "DESIGN_V2_CAPTURE_CHECKPOINT",
    "DESIGN_V2_RESTORE_SCROLL",
    "DESIGN_V2_END_VIEWPORT_CAPTURE",
    "M0_GET_BOOT_ID",
  ].includes(value.type);
}

function isValidScanId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9._~-]{1,128}$/u.test(value)
  );
}

function isValidResourceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
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
    (value.favicon === undefined || isCleanPublicUrl(value.favicon)) &&
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
    ) &&
    Array.isArray(value.socials) &&
    value.socials.length <= 12 &&
    value.socials.every(isCollectorSocialLink) &&
    (value.resources === undefined ||
      (Array.isArray(value.resources) &&
        value.resources.length <= 300 &&
        value.resources.every(isCollectorResourceCandidate) &&
        collectorResourceBytes(value.resources) <= 192 * 1_024))
  );
}

function isCollectorResourceCandidate(
  value: unknown,
): value is CollectorResourceCandidate {
  if (!isRecord(value)) return false;
  const allowedKinds = new Set([
    "document",
    "script",
    "style",
    "json",
    "source-map",
    "iframe",
    "image",
    "font",
    "other",
  ]);
  if (
    typeof value.url !== "string" ||
    value.url.length === 0 ||
    value.url.length > 2_048 ||
    !allowedKinds.has(String(value.kind)) ||
    !["none", "cache-key", "redacted"].includes(String(value.queryPolicy)) ||
    !Array.isArray(value.sources) ||
    value.sources.length < 1 ||
    value.sources.length > 2 ||
    !value.sources.every(
      (source) => source === "dom" || source === "resource-timing",
    ) ||
    (value.initiator !== undefined &&
      (typeof value.initiator !== "string" || value.initiator.length > 64)) ||
    !isOptionalMetric(value.transferSize) ||
    !isOptionalMetric(value.durationMs)
  ) {
    return false;
  }
  try {
    const url = new URL(value.url);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hash.length === 0 &&
      (value.queryPolicy === "cache-key" || url.search.length === 0)
    );
  } catch {
    return false;
  }
}

function collectorResourceBytes(values: readonly unknown[]): number {
  let bytes = 0;
  for (const value of values) {
    if (!isRecord(value) || typeof value.url !== "string") {
      return Number.POSITIVE_INFINITY;
    }
    bytes += new TextEncoder().encode(value.url).byteLength;
  }
  return bytes;
}

function isOptionalMetric(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isCollectorSocialLink(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const allowedPlatforms = new Set([
    "instagram",
    "facebook",
    "tiktok",
    "youtube",
    "x",
    "pinterest",
    "linkedin",
    "threads",
  ]);
  return (
    Object.keys(value).every((key) => key === "platform" || key === "url") &&
    typeof value.platform === "string" &&
    allowedPlatforms.has(value.platform) &&
    isCleanPublicUrl(value.url)
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

function waitForMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
