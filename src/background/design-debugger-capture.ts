import {
  DESIGN_VIEWPORT_PROFILES,
  type DesignViewportName,
  type DesignViewportProfile,
} from "../core/design/viewport-profiles";

export type DesignDebuggerApi = Readonly<{
  attach(target: chrome.debugger.Debuggee, requiredVersion: string): Promise<void>;
  detach(target: chrome.debugger.Debuggee): Promise<void>;
  sendCommand(
    target: chrome.debugger.DebuggerSession,
    method: string,
    commandParams?: Record<string, unknown>,
  ): Promise<object | undefined>;
}>;

export type DesignCaptureMetrics = Readonly<{
  scrollY: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  documentHeight: number;
  maximumScrollY: number;
  atBottom: boolean;
}>;

export type DesignCaptureStability =
  | Readonly<{ ok: true; checkpoint: DesignCaptureMetrics }>
  | Readonly<{
    ok: false;
    reason: "capture_drift" | "coverage_drift";
    changedMetrics: readonly string[];
  }>;

export function compareCaptureMetrics(
  before: DesignCaptureMetrics,
  after: DesignCaptureMetrics,
): DesignCaptureStability {
  const captureDrift = [
    ...(after.width === before.width ? [] : ["width"]),
    ...(after.height === before.height ? [] : ["height"]),
    ...(after.devicePixelRatio === before.devicePixelRatio ? [] : ["devicePixelRatio"]),
    // CSS/device-pixel quantization may move an otherwise stable root scroll by
    // at most one CSS pixel while Chrome rasterizes at 2x DPR. This matches the
    // existing restoration and bottom-coverage rounding contract.
    ...(Math.abs(after.scrollY - before.scrollY) <= 1 ? [] : ["scrollY"]),
  ];
  if (captureDrift.length > 0) {
    return { ok: false, reason: "capture_drift", changedMetrics: captureDrift };
  }
  const coverageDrift = [
    ...(after.documentHeight === before.documentHeight ? [] : ["documentHeight"]),
    ...(after.maximumScrollY === before.maximumScrollY ? [] : ["maximumScrollY"]),
  ];
  if (coverageDrift.length > 0) {
    return { ok: false, reason: "coverage_drift", changedMetrics: coverageDrift };
  }
  return { ok: true, checkpoint: after };
}

type ActiveCapture = {
  runId: string;
  viewportName: DesignViewportName;
  cleanupPending: boolean;
  metricsCleared: boolean;
  cleanupPromise: Promise<void> | undefined;
};

export class DesignDebuggerCapture {
  readonly #activeByTab = new Map<number, ActiveCapture>();

  constructor(private readonly api: DesignDebuggerApi) {}

  async begin(tabId: number, runId: string, viewportName: DesignViewportName): Promise<DesignViewportProfile> {
    if (this.#activeByTab.has(tabId)) throw new Error("该标签页已有视觉证据采集正在运行");
    const profile = DESIGN_VIEWPORT_PROFILES[viewportName];
    const target = { tabId };
    await this.api.attach(target, "1.3");
    this.#activeByTab.set(tabId, {
      runId,
      viewportName,
      cleanupPending: false,
      metricsCleared: false,
      cleanupPromise: undefined,
    });
    try {
      await this.api.sendCommand(target, "Emulation.setDeviceMetricsOverride", {
        width: profile.width,
        height: profile.height,
        deviceScaleFactor: profile.deviceScaleFactor,
        mobile: profile.mobile,
        screenWidth: profile.width,
        screenHeight: profile.height,
      });
      return profile;
    } catch (error) {
      await this.end(tabId, runId).catch(() => undefined);
      throw error;
    }
  }

  async capturePngDataUrl(tabId: number, runId: string): Promise<string> {
    this.#requireOwner(tabId, runId);
    const result = await this.api.sendCommand({ tabId }, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const data = isRecord(result) && typeof result.data === "string" ? result.data : undefined;
    if (data === undefined || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(data)) {
      throw new Error("DevTools 截图返回格式无效");
    }
    return `data:image/png;base64,${data}`;
  }

  async end(tabId: number, runId: string): Promise<void> {
    const active = this.#activeByTab.get(tabId);
    // A successful cleanup can be acknowledged more than once. Ownership is
    // still enforced while another run actively owns the tab.
    if (active === undefined) return;
    if (active.runId !== runId) {
      throw new Error("当前会话未持有该标签页的视口采集锁");
    }
    if (active.cleanupPromise !== undefined) return active.cleanupPromise;

    active.cleanupPending = true;
    const cleanupPromise = this.#cleanup(tabId, active);
    active.cleanupPromise = cleanupPromise;
    try {
      await cleanupPromise;
      if (this.#activeByTab.get(tabId) === active) this.#activeByTab.delete(tabId);
    } catch (error) {
      // Keep ownership and the completed cleanup checkpoints so a later
      // lifecycle signal can retry only the operation that did not finish.
      if (this.#activeByTab.get(tabId) === active) active.cleanupPromise = undefined;
      throw error;
    }
  }

  async cancelTab(tabId: number): Promise<void> {
    const active = this.#activeByTab.get(tabId);
    if (active === undefined) return;
    await this.end(tabId, active.runId);
  }

  async cancelRun(runId: string): Promise<void> {
    const tabs = [...this.#activeByTab.entries()]
      .filter(([, active]) => active.runId === runId)
      .map(([tabId]) => tabId);
    await Promise.all(tabs.map((tabId) => this.end(tabId, runId)));
  }

  async cancelAll(): Promise<void> {
    const captures = [...this.#activeByTab.entries()];
    await Promise.all(captures.map(([tabId, active]) => this.end(tabId, active.runId)));
  }

  noteDetached(tabId: number): void {
    this.#activeByTab.delete(tabId);
  }

  #requireOwner(tabId: number, runId: string): ActiveCapture {
    const active = this.#activeByTab.get(tabId);
    if (active === undefined || active.runId !== runId) {
      throw new Error("当前会话未持有该标签页的视口采集锁");
    }
    if (active.cleanupPending) {
      throw new Error("该标签页正在等待恢复视口，不能继续采集");
    }
    return active;
  }

  async #cleanup(tabId: number, active: ActiveCapture): Promise<void> {
    if (!active.metricsCleared) {
      await this.api.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride");
      active.metricsCleared = true;
    }
    await this.api.detach({ tabId });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
