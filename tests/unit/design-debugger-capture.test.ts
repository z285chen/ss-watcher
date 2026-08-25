import { describe, expect, it, vi } from "vitest";

import {
  compareCaptureMetrics,
  DesignDebuggerCapture,
  type DesignDebuggerApi,
} from "../../src/background/design-debugger-capture";

describe("design debugger capture", () => {
  it("accepts only post-screenshot metrics that preserve viewport and coverage", () => {
    const before = {
      scrollY: 100,
      width: 390,
      height: 844,
      devicePixelRatio: 2,
      documentHeight: 3_000,
      maximumScrollY: 2_156,
      atBottom: false,
    } as const;
    const stableAfter = { ...before, atBottom: true } as const;
    expect(compareCaptureMetrics(before, stableAfter)).toEqual({
      ok: true,
      checkpoint: stableAfter,
    });
    expect(compareCaptureMetrics(before, { ...before, width: 391 })).toEqual({
      ok: false,
      reason: "capture_drift",
      changedMetrics: ["width"],
    });
    expect(compareCaptureMetrics(before, { ...before, scrollY: 101 })).toEqual({
      ok: true,
      checkpoint: { ...before, scrollY: 101 },
    });
    expect(compareCaptureMetrics(before, { ...before, scrollY: 101.01 })).toEqual({
      ok: false,
      reason: "capture_drift",
      changedMetrics: ["scrollY"],
    });
    expect(compareCaptureMetrics(before, {
      ...before,
      documentHeight: 3_200,
      maximumScrollY: 2_356,
      atBottom: false,
    })).toEqual({
      ok: false,
      reason: "coverage_drift",
      changedMetrics: ["documentHeight", "maximumScrollY"],
    });
  });

  it("uses one narrow CDP command sequence and restores the target", async () => {
    const api = fakeApi();
    const capture = new DesignDebuggerCapture(api);

    const profile = await capture.begin(17, "run-a", "mobile");
    expect(profile).toEqual({ width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
    expect(api.attach).toHaveBeenCalledWith({ tabId: 17 }, "1.3");
    expect(api.sendCommand).toHaveBeenNthCalledWith(
      1,
      { tabId: 17 },
      "Emulation.setDeviceMetricsOverride",
      {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: false,
        screenWidth: 390,
        screenHeight: 844,
      },
    );

    expect(await capture.capturePngDataUrl(17, "run-a")).toBe("data:image/png;base64,AQ==");
    expect(api.sendCommand).toHaveBeenNthCalledWith(
      2,
      { tabId: 17 },
      "Page.captureScreenshot",
      { format: "png", fromSurface: true, captureBeyondViewport: false },
    );

    await capture.end(17, "run-a");
    expect(api.sendCommand).toHaveBeenNthCalledWith(
      3,
      { tabId: 17 },
      "Emulation.clearDeviceMetricsOverride",
    );
    expect(api.detach).toHaveBeenCalledWith({ tabId: 17 });
  });

  it("detaches if viewport emulation fails", async () => {
    const api = fakeApi();
    vi.mocked(api.sendCommand).mockRejectedValueOnce(new Error("metrics failed"));
    const capture = new DesignDebuggerCapture(api);

    await expect(capture.begin(7, "run-a", "desktop")).rejects.toThrow("metrics failed");
    expect(api.detach).toHaveBeenCalledWith({ tabId: 7 });
  });

  it("does not let another run capture or end an owned tab", async () => {
    const api = fakeApi();
    const capture = new DesignDebuggerCapture(api);
    await capture.begin(9, "run-a", "tablet");

    await expect(capture.capturePngDataUrl(9, "run-b")).rejects.toThrow("未持有");
    await expect(capture.end(9, "run-b")).rejects.toThrow("未持有");
    expect(api.detach).not.toHaveBeenCalled();

    await capture.cancelRun("run-a");
    expect(api.detach).toHaveBeenCalledWith({ tabId: 9 });
  });

  it("retains ownership when viewport restoration fails and retries before detach", async () => {
    const api = fakeApi();
    vi.mocked(api.sendCommand)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("clear failed"))
      .mockResolvedValueOnce(undefined);
    const capture = new DesignDebuggerCapture(api);
    await capture.begin(12, "run-retry-clear", "desktop");

    await expect(capture.end(12, "run-retry-clear")).rejects.toThrow("clear failed");
    expect(api.detach).not.toHaveBeenCalled();
    await expect(capture.capturePngDataUrl(12, "run-retry-clear")).rejects.toThrow(
      "等待恢复视口",
    );
    await expect(capture.begin(12, "run-other", "mobile")).rejects.toThrow("已有");

    await expect(capture.end(12, "run-retry-clear")).resolves.toBeUndefined();
    expect(api.detach).toHaveBeenCalledTimes(1);
    expect(api.sendCommand).toHaveBeenCalledTimes(3);
    await expect(capture.end(12, "run-retry-clear")).resolves.toBeUndefined();
    expect(api.detach).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a completed restore when detach fails and cancelRun retries", async () => {
    const api = fakeApi();
    vi.mocked(api.detach)
      .mockRejectedValueOnce(new Error("detach failed"))
      .mockResolvedValueOnce(undefined);
    const capture = new DesignDebuggerCapture(api);
    await capture.begin(13, "run-retry-detach", "tablet");

    await expect(capture.cancelRun("run-retry-detach")).rejects.toThrow("detach failed");
    expect(api.sendCommand).toHaveBeenCalledTimes(2);
    expect(api.detach).toHaveBeenCalledTimes(1);

    await expect(capture.cancelRun("run-retry-detach")).resolves.toBeUndefined();
    expect(api.sendCommand).toHaveBeenCalledTimes(2);
    expect(api.detach).toHaveBeenCalledTimes(2);
    await expect(capture.cancelRun("run-retry-detach")).resolves.toBeUndefined();
    expect(api.detach).toHaveBeenCalledTimes(2);
  });

  it("shares one cleanup attempt across concurrent idempotent end calls", async () => {
    const api = fakeApi();
    let releaseDetach: (() => void) | undefined;
    vi.mocked(api.detach).mockImplementation(
      () => new Promise<void>((resolve) => {
        releaseDetach = resolve;
      }),
    );
    const capture = new DesignDebuggerCapture(api);
    await capture.begin(14, "run-concurrent", "mobile");

    const first = capture.end(14, "run-concurrent");
    const second = capture.end(14, "run-concurrent");
    await vi.waitFor(() => expect(api.detach).toHaveBeenCalledTimes(1));
    releaseDetach?.();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(api.sendCommand).toHaveBeenCalledTimes(2);
  });

});

function fakeApi(): DesignDebuggerApi {
  return {
    attach: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
    sendCommand: vi.fn(async (_target, method) =>
      method === "Page.captureScreenshot" ? { data: "AQ==" } : undefined),
  };
}
