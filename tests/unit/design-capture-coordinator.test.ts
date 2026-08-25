import { describe, expect, it, vi } from "vitest";

import {
  captureFullPageState,
  dynamicMaskRects,
  privacyMaskRects,
} from "../../src/sidepanel/design-capture-coordinator";
import type { M0Request } from "../../src/shared/messages";

const handle = { runId: "run_test", sessionToken: "a".repeat(43) };

describe("design capture coordinator", () => {
  it("clips document-space dynamic masks into screenshot pixels", () => {
    expect(dynamicMaskRects([{
      regionNumber: 0,
      rect: { x: -10, y: 800, width: 500, height: 300 },
      currentItem: 1,
      itemCount: 7,
      behavior: "carousel",
      pixelPolicy: "mask-content",
    }], 900, 390, 844, 2)).toEqual([
      { x: 0, y: 0, width: 780, height: 400 },
    ]);
  });
  it("converts text and form privacy regions into clipped screenshot masks", () => {
    expect(privacyMaskRects([
      { rect: { x: 20, y: 880, width: 100, height: 24 }, kind: "text" },
      { rect: { x: 360, y: 920, width: 80, height: 40 }, kind: "control" },
    ], 900, 390, 844, 2)).toEqual([
      { x: 40, y: 0, width: 200, height: 8 },
      { x: 720, y: 40, width: 60, height: 80 },
    ]);
  });
  it("captures ordered long-page segments and always restores the original scroll", async () => {
    const messages: M0Request[] = [];
    const send = async <T>(message: M0Request): Promise<T> => {
      messages.push(message);
      if (isViewportLifecycle(message)) return viewportLifecycle(message) as T;
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") return prepared() as T;
      if (message.type === "DESIGN_V2_CAPTURE_CHECKPOINT") {
        return checkpoint(message.scrollY) as T;
      }
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return { ok: true, bootId: "boot", session: summary(), restoredScrollY: message.scrollY } as T;
      }
      throw new Error(`Unexpected message: ${message.type}`);
    };

    const result = await captureFullPageState({
      send: send as never,
      handle,
      panelInstanceId: crypto.randomUUID(),
      stateId: "default",
      viewportName: "desktop",
    });

    expect(result.capture.screenshotSegments).toEqual([
      { path: "screenshots/default-desktop-00.png", scrollY: 0 },
      { path: "screenshots/default-desktop-01.png", scrollY: 100 },
    ]);
    expect(result.capture.status).toBe("complete");
    expect(result.screenshots.every((file) => file.bytes[0] === 137)).toBe(true);
    expect(messages.at(-1)).toMatchObject({
      type: "DESIGN_V2_RESTORE_SCROLL",
      scrollY: 233,
    });
  });

  it("captures a user-prepared interaction viewport without attaching twice", async () => {
    const messages: M0Request[] = [];
    const send = async <T>(message: M0Request): Promise<T> => {
      messages.push(message);
      if (message.type === "DESIGN_V2_END_VIEWPORT_CAPTURE") return viewportLifecycle(message) as T;
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") return prepared() as T;
      if (message.type === "DESIGN_V2_CAPTURE_CHECKPOINT") return checkpoint(message.scrollY) as T;
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return { ok: true, bootId: "boot", session: summary(), restoredScrollY: message.scrollY } as T;
      }
      throw new Error(`Unexpected message: ${message.type}`);
    };
    await captureFullPageState({
      send,
      handle,
      panelInstanceId: "panel",
      stateId: "interaction-1",
      viewportName: "desktop",
      preparedViewport: { originalScrollY: 233 },
    });
    expect(messages.some((message) => message.type === "DESIGN_V2_BEGIN_VIEWPORT_CAPTURE")).toBe(false);
    expect(messages.at(-2)?.type).toBe("DESIGN_V2_END_VIEWPORT_CAPTURE");
    expect(messages.at(-1)).toMatchObject({ type: "DESIGN_V2_RESTORE_SCROLL", scrollY: 233 });
  });

  it("fails closed and ends emulation when the measured viewport is wrong", async () => {
    const messages: M0Request[] = [];
    const send = vi.fn(async (message: M0Request) => {
      messages.push(message);
      if (isViewportLifecycle(message)) return viewportLifecycle(message);
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return { ok: true, bootId: "boot", session: summary(), restoredScrollY: message.scrollY };
      }
      return prepared(1512);
    });
    await expect(captureFullPageState({
      send: send as never,
      handle,
      panelInstanceId: crypto.randomUUID(),
      stateId: "default",
      viewportName: "desktop",
    })).rejects.toThrow("does not match 1440x900@2");
    expect(messages.at(-2)?.type).toBe("DESIGN_V2_END_VIEWPORT_CAPTURE");
    expect(messages.at(-1)?.type).toBe("DESIGN_V2_RESTORE_SCROLL");
  });
  it("fails closed before screenshots when privacy-mask discovery is incomplete", async () => {
    const messages: M0Request[] = [];
    const send = vi.fn(async (message: M0Request) => {
      messages.push(message);
      if (isViewportLifecycle(message)) return viewportLifecycle(message);
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") {
        const response = prepared();
        return { ...response, graph: { ...response.graph, privacyTruncated: true } };
      }
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return { ok: true, bootId: "boot", session: summary(), restoredScrollY: message.scrollY };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    await expect(captureFullPageState({
      send: send as never,
      handle,
      panelInstanceId: "panel",
      stateId: "default",
      viewportName: "desktop",
    })).rejects.toThrow("Privacy masking could not cover");
    expect(messages.some((message) => message.type === "DESIGN_V2_CAPTURE_CHECKPOINT")).toBe(false);
    expect(messages.at(-2)?.type).toBe("DESIGN_V2_END_VIEWPORT_CAPTURE");
    expect(messages.at(-1)?.type).toBe("DESIGN_V2_RESTORE_SCROLL");
  });

  it("rejects screenshots whose pixels do not match viewport times DPR", async () => {
    const send = async <T>(message: M0Request): Promise<T> => {
      if (isViewportLifecycle(message)) return viewportLifecycle(message) as T;
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") return prepared() as T;
      if (message.type === "DESIGN_V2_CAPTURE_CHECKPOINT") {
        return {
          ...checkpoint(message.scrollY),
          screenshotDataUrl: pngHeaderDataUrl(2_252, 1_526),
        } as T;
      }
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return {
          ok: true,
          bootId: "boot",
          session: summary(),
          restoredScrollY: message.scrollY,
        } as T;
      }
      throw new Error("unexpected");
    };
    await expect(captureFullPageState({
      send,
      handle,
      panelInstanceId: "panel",
      stateId: "default",
      viewportName: "desktop",
    })).rejects.toThrow("do not match viewport 2880x1800");
  });

  it("restores scroll after a checkpoint failure", async () => {
    const messages: M0Request[] = [];
    const send = async <T>(message: M0Request): Promise<T> => {
      messages.push(message);
      if (isViewportLifecycle(message)) return viewportLifecycle(message) as T;
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") return prepared() as T;
      if (message.type === "DESIGN_V2_CAPTURE_CHECKPOINT") return { ok: false, bootId: "boot", message: "capture failed", reason: "capture_failed" } as T;
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") return { ok: true, bootId: "boot", session: summary(), restoredScrollY: message.scrollY } as T;
      throw new Error("unexpected");
    };
    await expect(captureFullPageState({
      send,
      handle,
      panelInstanceId: crypto.randomUUID(),
      stateId: "default",
      viewportName: "desktop",
    })).rejects.toThrow("capture failed");
    expect(messages.at(-2)?.type).toBe("DESIGN_V2_END_VIEWPORT_CAPTURE");
    expect(messages.at(-1)?.type).toBe("DESIGN_V2_RESTORE_SCROLL");
  });

  it("restores scroll when the user cancels before the first screenshot", async () => {
    const messages: M0Request[] = [];
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const send = async <T>(message: M0Request): Promise<T> => {
      messages.push(message);
      if (isViewportLifecycle(message)) return viewportLifecycle(message) as T;
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") return prepared() as T;
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return { ok: true, bootId: "boot", session: summary(), restoredScrollY: message.scrollY } as T;
      }
      throw new Error(`Unexpected message: ${message.type}`);
    };
    await expect(captureFullPageState({
      send,
      handle,
      panelInstanceId: "panel",
      stateId: "default",
      viewportName: "desktop",
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(messages.map((message) => message.type)).toEqual([
      "DESIGN_V2_BEGIN_VIEWPORT_CAPTURE",
      "DESIGN_V2_PREPARE_CAPTURE",
      "DESIGN_V2_END_VIEWPORT_CAPTURE",
      "DESIGN_V2_RESTORE_SCROLL",
    ]);
  });

  it("keeps bounded evidence as partial when the page bottom drifts", async () => {
    const send = vi.fn(async (message: M0Request): Promise<unknown> => {
      if (isViewportLifecycle(message)) return viewportLifecycle(message);
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") {
        const response = prepared();
        return {
          ...response,
          graph: {
            ...response.graph,
            viewport: { ...response.graph.viewport, height: 900 },
            documentHeight: 1_700,
          },
        };
      }
      if (message.type === "DESIGN_V2_CAPTURE_CHECKPOINT") {
        const response = checkpoint(Math.min(message.scrollY, 700));
        return {
          ...response,
          checkpoint: {
            ...response.checkpoint,
            height: 900,
            documentHeight: 1_700,
            maximumScrollY: 800,
            atBottom: false,
          },
          screenshotDataUrl: pngHeaderDataUrl(2_880, 1_800),
        };
      }
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return {
          ok: true as const,
          bootId: "boot",
          session: summary(),
          restoredScrollY: message.scrollY,
        };
      }
      throw new Error(`unexpected ${message.type}`);
    });
    const result = await captureFullPageState({
      send: send as never,
      handle,
      panelInstanceId: "panel",
      stateId: "default",
      viewportName: "desktop",
    });
    expect(result.capture.status).toBe("partial");
    expect(result.capture.gaps).toContain("coverage-drift");
  });

  it("accepts only a one-CSS-pixel root-scroll rounding delta", async () => {
    const send = vi.fn(async (message: M0Request): Promise<unknown> => {
      if (isViewportLifecycle(message)) return viewportLifecycle(message);
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") {
        const response = prepared();
        return { ...response, graph: { ...response.graph, documentHeight: 900.5 } };
      }
      if (message.type === "DESIGN_V2_CAPTURE_CHECKPOINT") {
        const response = checkpoint(message.scrollY);
        return {
          ...response,
          checkpoint: {
            ...response.checkpoint,
            documentHeight: 900.5,
            maximumScrollY: 0.5,
            atBottom: message.scrollY + 1 >= 0.5,
          },
        };
      }
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return { ok: true as const, bootId: "boot", session: summary(), restoredScrollY: message.scrollY };
      }
      throw new Error(`unexpected ${message.type}`);
    });
    const result = await captureFullPageState({
      send: send as never,
      handle,
      panelInstanceId: "panel",
      stateId: "default",
      viewportName: "desktop",
    });
    expect(result.capture.status).toBe("complete");
    expect(result.capture.gaps).toEqual([]);
  });

  it("extends the plan when the settled page grows and stops at the live bottom", async () => {
    const requested: number[] = [];
    const send = vi.fn(async (message: M0Request): Promise<unknown> => {
      if (isViewportLifecycle(message)) return viewportLifecycle(message);
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") return prepared();
      if (message.type === "DESIGN_V2_CAPTURE_CHECKPOINT") {
        requested.push(message.scrollY);
        const grown = message.scrollY >= 100;
        const response = checkpoint(message.scrollY);
        return {
          ...response,
          checkpoint: {
            ...response.checkpoint,
            documentHeight: grown ? 1_700 : 1_000,
            maximumScrollY: grown ? 800 : 100,
            atBottom: grown && message.scrollY >= 800,
          },
        };
      }
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return { ok: true as const, bootId: "boot", session: summary(), restoredScrollY: message.scrollY };
      }
      throw new Error(`unexpected ${message.type}`);
    });
    const result = await captureFullPageState({
      send: send as never,
      handle,
      panelInstanceId: "panel",
      stateId: "default",
      viewportName: "desktop",
    });
    expect(requested).toEqual([0, 100, 800]);
    expect(result.capture.documentHeight).toBe(1_700);
    expect(result.capture.status).toBe("complete");
    expect(result.capture.gaps).toEqual([]);
  });

  it("stops at the runtime time budget, preserves partial evidence, and restores scroll", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const messages: M0Request[] = [];
    const send = async <T>(message: M0Request): Promise<T> => {
      messages.push(message);
      if (isViewportLifecycle(message)) return viewportLifecycle(message) as T;
      if (message.type === "DESIGN_V2_PREPARE_CAPTURE") return prepared() as T;
      if (message.type === "DESIGN_V2_CAPTURE_CHECKPOINT") {
        await Promise.resolve();
        now = 101;
        return checkpoint(message.scrollY) as T;
      }
      if (message.type === "DESIGN_V2_RESTORE_SCROLL") {
        return { ok: true, bootId: "boot", session: summary(), restoredScrollY: message.scrollY } as T;
      }
      throw new Error("unexpected");
    };
    const result = await captureFullPageState({
      send,
      handle,
      panelInstanceId: "panel",
      stateId: "default",
      viewportName: "desktop",
      limits: { maximumDurationMs: 100 },
    });
    expect(result.capture.status).toBe("partial");
    expect(result.capture.gaps).toContain("time-limit");
    expect(result.capture.screenshotSegments).toHaveLength(1);
    expect(messages.at(-2)?.type).toBe("DESIGN_V2_END_VIEWPORT_CAPTURE");
    expect(messages.at(-1)?.type).toBe("DESIGN_V2_RESTORE_SCROLL");
  });
});

function prepared(width = 1440) {
  return {
    ok: true as const,
    bootId: "boot",
    session: summary(),
    graph: {
      ok: true as const,
      origin: "https://example.test",
      pathname: "/",
      capturedAt: "2026-08-12T10:00:00.000Z",
      viewport: { width, height: 900, devicePixelRatio: 2 },
      documentHeight: 1_000,
      scrollY: 233,
      nodes: [],
      dynamicRegions: [],
      privacyRegions: [],
      privacyTruncated: false,
      assets: [],
      truncated: false,
    },
  };
}

function checkpoint(scrollY: number) {
  return {
    ok: true as const,
    bootId: "boot",
    session: summary(),
    checkpoint: {
      scrollY,
      width: 1440,
      height: 900,
      devicePixelRatio: 2,
      documentHeight: 1_000,
      maximumScrollY: 100,
      atBottom: scrollY + 1 >= 100,
    },
    screenshotDataUrl: pngHeaderDataUrl(2_880, 1_800),
  };
}

function pngHeaderDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

function summary() {
  return { origin: "https://example.test", pathname: "/", tabId: 1, documentId: "doc" };
}

function isViewportLifecycle(message: M0Request): boolean {
  return message.type === "DESIGN_V2_BEGIN_VIEWPORT_CAPTURE" ||
    message.type === "DESIGN_V2_END_VIEWPORT_CAPTURE";
}

function viewportLifecycle(message: M0Request) {
  if (message.type === "DESIGN_V2_BEGIN_VIEWPORT_CAPTURE") {
    return {
      ok: true as const,
      bootId: "boot",
      session: summary(),
      viewport: { width: 1_440, height: 900, devicePixelRatio: 2 },
      originalScrollY: 233,
    };
  }
  return { ok: true as const, bootId: "boot", session: summary() };
}
