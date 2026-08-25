import {
  DEFAULT_FULL_PAGE_CAPTURE_LIMITS,
  planBoundedFullPageCapture,
  type FullPageCaptureLimits,
} from "../core/design/full-page-capture";
import { pngDimensions } from "../core/design/png-evidence";
import {
  DESIGN_VIEWPORT_PROFILES,
  type DesignViewportName,
} from "../core/design/viewport-profiles";
import type {
  EvidenceDynamicRegion,
  EvidenceAsset,
  EvidenceCapture,
  SswDesignPackageFile,
} from "../core/design/evidence-package";
import type {
  DesignCaptureCheckpointResponse,
  DesignPrepareCaptureResponse,
  DesignRestoreScrollResponse,
  DesignViewportLifecycleResponse,
  M0Request,
  SessionHandle,
} from "../shared/messages";

export type DesignCaptureSend = <T>(message: M0Request) => Promise<T>;
type DesignSettledCheckpoint = Extract<
  DesignCaptureCheckpointResponse,
  { ok: true }
>["checkpoint"];

export async function captureFullPageState(input: Readonly<{
  send: DesignCaptureSend;
  handle: SessionHandle;
  panelInstanceId: string;
  stateId: string;
  viewportName: DesignViewportName;
  preparedViewport?: Readonly<{ originalScrollY: number }>;
  settleMs?: number;
  limits?: Partial<FullPageCaptureLimits>;
  signal?: AbortSignal;
  onProgress?: (progress: Readonly<{ completed: number; total: number }>) => void;
}>): Promise<Readonly<{
  capture: EvidenceCapture;
  screenshots: readonly SswDesignPackageFile[];
  assets: readonly EvidenceAsset[];
}>> {
  let originalScrollY: number;
  if (input.preparedViewport === undefined) {
    const begun = await input.send<DesignViewportLifecycleResponse>({
      type: "DESIGN_V2_BEGIN_VIEWPORT_CAPTURE",
      handle: input.handle,
      panelInstanceId: input.panelInstanceId,
      viewportName: input.viewportName,
    });
    if (!begun.ok) throw new Error(begun.message);
    if (!Number.isFinite(begun.originalScrollY) || (begun.originalScrollY ?? -1) < 0) {
      await input.send<DesignViewportLifecycleResponse>({
        type: "DESIGN_V2_END_VIEWPORT_CAPTURE",
        handle: input.handle,
        panelInstanceId: input.panelInstanceId,
      }).catch(() => undefined);
      throw new Error("Original scroll position was not preserved before viewport emulation");
    }
    originalScrollY = begun.originalScrollY as number;
  } else {
    originalScrollY = input.preparedViewport.originalScrollY;
    if (!Number.isFinite(originalScrollY) || originalScrollY < 0) {
      throw new Error("Prepared viewport did not preserve the original scroll position");
    }
  }
  const expectedViewport = DESIGN_VIEWPORT_PROFILES[input.viewportName];
  let graph: (DesignPrepareCaptureResponse & { ok: true })["graph"] | undefined;
  let plan: ReturnType<typeof planBoundedFullPageCapture> | undefined;
  const screenshotSegments: Array<{ path: string; scrollY: number }> = [];
  const screenshots: SswDesignPackageFile[] = [];
  let timeLimited = false;
  let adaptiveHeightLimit = false;
  let adaptiveScreenLimit = false;
  let finalCheckpoint: DesignSettledCheckpoint | undefined;
  let primaryError: unknown;
  try {
    const prepared = await input.send<DesignPrepareCaptureResponse>({
      type: "DESIGN_V2_PREPARE_CAPTURE",
      handle: input.handle,
      panelInstanceId: input.panelInstanceId,
    });
    if (!prepared.ok) throw new Error(prepared.message);
    const preparedGraph = prepared.graph;
    graph = preparedGraph;
    if (preparedGraph.truncated || preparedGraph.privacyTruncated) {
      throw new Error("Privacy masking could not cover the full component graph within its bounded probe");
    }
    if (
      preparedGraph.viewport.width !== expectedViewport.width ||
      preparedGraph.viewport.height !== expectedViewport.height ||
      preparedGraph.viewport.devicePixelRatio !== expectedViewport.deviceScaleFactor
    ) {
      throw new Error(
        `DevTools viewport ${preparedGraph.viewport.width}x${preparedGraph.viewport.height}@${preparedGraph.viewport.devicePixelRatio} does not match ${expectedViewport.width}x${expectedViewport.height}@${expectedViewport.deviceScaleFactor}`,
      );
    }
    plan = planBoundedFullPageCapture({
      documentHeight: preparedGraph.documentHeight,
      viewportHeight: preparedGraph.viewport.height,
      originalScrollY,
      ...(input.limits === undefined ? {} : { limits: input.limits }),
    });
    const resolvedLimits = { ...DEFAULT_FULL_PAGE_CAPTURE_LIMITS, ...input.limits };
    const positions = [...plan.positions];
    const captureDeadline = performance.now() + plan.maximumDurationMs;
    for (let index = 0; index < positions.length; index += 1) {
      const scrollY = positions[index];
      if (scrollY === undefined) break;
      throwIfAborted(input.signal);
      if (performance.now() >= captureDeadline) {
        timeLimited = true;
        break;
      }
      let response: DesignCaptureCheckpointResponse;
      try {
        response = await beforeDeadline(input.send<DesignCaptureCheckpointResponse>({
          type: "DESIGN_V2_CAPTURE_CHECKPOINT",
          handle: input.handle,
          panelInstanceId: input.panelInstanceId,
          scrollY,
          // Leave dynamic regions and responsive layout enough time to settle
          // after each bounded scroll checkpoint.
          settleMs: input.settleMs ?? 650,
          includeGraph: false,
        }), captureDeadline);
      } catch (error: unknown) {
        if (error instanceof DesignCaptureTimeLimitError && screenshots.length > 0) {
          timeLimited = true;
          break;
        }
        throw error;
      }
      if (!response.ok) throw new Error(response.message);
      finalCheckpoint = response.checkpoint;
      if (
        response.checkpoint.width !== preparedGraph.viewport.width ||
        response.checkpoint.height !== preparedGraph.viewport.height ||
        response.checkpoint.devicePixelRatio !== preparedGraph.viewport.devicePixelRatio
      ) throw new Error("Viewport changed during full-page capture");
      const path = `screenshots/${input.stateId}-${input.viewportName}-${String(index).padStart(2, "0")}.png`;
      const screenshotBytes = decodePngDataUrl(response.screenshotDataUrl);
      const screenshotSize = pngDimensions(screenshotBytes);
      const expectedPixelWidth = Math.round(response.checkpoint.width * response.checkpoint.devicePixelRatio);
      const expectedPixelHeight = Math.round(response.checkpoint.height * response.checkpoint.devicePixelRatio);
      if (
        screenshotSize.width !== expectedPixelWidth ||
        screenshotSize.height !== expectedPixelHeight
      ) {
        throw new Error(
          `Screenshot pixels ${screenshotSize.width}x${screenshotSize.height} do not match viewport ${expectedPixelWidth}x${expectedPixelHeight}`,
        );
      }
      const maskRects = dynamicMaskRects(
        preparedGraph.dynamicRegions,
        response.checkpoint.scrollY,
        response.checkpoint.width,
        response.checkpoint.height,
        response.checkpoint.devicePixelRatio,
      );
      maskRects.push(...privacyMaskRects(
        preparedGraph.privacyRegions,
        response.checkpoint.scrollY,
        response.checkpoint.width,
        response.checkpoint.height,
        response.checkpoint.devicePixelRatio,
      ));
      const maskedBytes = await maskPngRegions(screenshotBytes, maskRects);
      const maskedSize = pngDimensions(maskedBytes);
      if (maskedSize.width !== screenshotSize.width || maskedSize.height !== screenshotSize.height) {
        throw new Error("Dynamic masking changed screenshot dimensions");
      }
      screenshotSegments.push({ path, scrollY: response.checkpoint.scrollY });
      screenshots.push({ path, mediaType: "image/png", bytes: maskedBytes });
      if (index + 1 === positions.length && !response.checkpoint.atBottom) {
        if (response.checkpoint.documentHeight > resolvedLimits.maximumDocumentHeight) {
          adaptiveHeightLimit = true;
        }
        const maximumBoundedScrollY = Math.max(
          0,
          Math.min(
            response.checkpoint.maximumScrollY,
            resolvedLimits.maximumDocumentHeight - response.checkpoint.height,
          ),
        );
        const nextScrollY = Math.min(
          maximumBoundedScrollY,
          response.checkpoint.scrollY + response.checkpoint.height - resolvedLimits.overlapPx,
        );
        const lastRequested = positions.at(-1) ?? -1;
        if (
          nextScrollY > Math.max(response.checkpoint.scrollY, lastRequested) + 0.01 &&
          positions.length < resolvedLimits.maximumScreens
        ) {
          positions.push(nextScrollY);
        } else if (!adaptiveHeightLimit && positions.length >= resolvedLimits.maximumScreens) {
          adaptiveScreenLimit = true;
        }
      }
      input.onProgress?.({ completed: index + 1, total: positions.length });
      if (index + 1 < positions.length && performance.now() >= captureDeadline) {
        timeLimited = true;
        break;
      }
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      const ended = await input.send<DesignViewportLifecycleResponse>({
        type: "DESIGN_V2_END_VIEWPORT_CAPTURE",
        handle: input.handle,
        panelInstanceId: input.panelInstanceId,
      });
      if (!ended.ok) throw new Error(ended.message);
    } catch (endError) {
      if (primaryError === undefined) primaryError = endError;
    }
    try {
      const restored = await input.send<DesignRestoreScrollResponse>({
        type: "DESIGN_V2_RESTORE_SCROLL",
        handle: input.handle,
        panelInstanceId: input.panelInstanceId,
        scrollY: originalScrollY,
      });
      if (!restored.ok || Math.abs(restored.restoredScrollY - originalScrollY) > 1) {
        throw new Error(restored.ok ? "Original scroll position was not restored" : restored.message);
      }
    } catch (restoreError) {
      if (primaryError === undefined) primaryError = restoreError;
    }
  }
  if (primaryError !== undefined) throw primaryError;
  if (graph === undefined || plan === undefined) throw new Error("Capture did not initialize");
  const coverageDrift = finalCheckpoint === undefined || !finalCheckpoint.atBottom;
  const gaps = [...new Set([
    ...plan.gaps,
    ...(adaptiveHeightLimit ? ["height-limit" as const] : []),
    ...(adaptiveScreenLimit ? ["screen-limit" as const] : []),
    ...(timeLimited ? ["time-limit"] : []),
    ...(coverageDrift ? ["coverage-drift"] : []),
  ])];
  return {
    capture: {
      captureId: `${input.stateId}-${input.viewportName}`,
      stateId: input.stateId,
      viewport: { name: input.viewportName, ...graph.viewport },
      status: gaps.length === 0 ? "complete" : "partial",
      documentHeight: finalCheckpoint?.documentHeight ?? graph.documentHeight,
      screenshotSegments,
      nodes: graph.nodes,
      dynamicRegions: graph.dynamicRegions,
      gaps,
    },
    screenshots,
    assets: graph.assets,
  };
}

class DesignCaptureTimeLimitError extends Error {
  constructor() {
    super("Full-page capture reached its time limit");
    this.name = "DesignCaptureTimeLimitError";
  }
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) throw new DesignCaptureTimeLimitError();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeoutId = globalThis.setTimeout(() => reject(new DesignCaptureTimeLimitError()), remainingMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  }
}

export function decodePngDataUrl(value: string): Uint8Array {
  const prefix = "data:image/png;base64,";
  if (!value.startsWith(prefix)) throw new Error("Screenshot is not a PNG data URL");
  const encoded = value.slice(prefix.length);
  if (encoded.length === 0 || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(encoded)) throw new Error("Screenshot base64 is invalid");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export type ScreenshotMaskRect = Readonly<{ x: number; y: number; width: number; height: number }>;

export function dynamicMaskRects(
  regions: readonly EvidenceDynamicRegion[],
  scrollY: number,
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
): ScreenshotMaskRect[] {
  const masks: ScreenshotMaskRect[] = [];
  for (const region of regions) {
    const left = Math.max(0, region.rect.x);
    const top = Math.max(scrollY, region.rect.y);
    const right = Math.min(viewportWidth, region.rect.x + region.rect.width);
    const bottom = Math.min(scrollY + viewportHeight, region.rect.y + region.rect.height);
    if (right <= left || bottom <= top) continue;
    masks.push({
      x: Math.floor(left * devicePixelRatio),
      y: Math.floor((top - scrollY) * devicePixelRatio),
      width: Math.ceil((right - left) * devicePixelRatio),
      height: Math.ceil((bottom - top) * devicePixelRatio),
    });
  }
  return masks;
}

export function privacyMaskRects(
  regions: readonly Readonly<{
    rect: Readonly<{ x: number; y: number; width: number; height: number }>;
    kind: "text" | "control" | "opaque-content";
  }>[],
  scrollY: number,
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
): ScreenshotMaskRect[] {
  return dynamicMaskRects(
    regions.map((region, regionNumber) => ({
      regionNumber,
      rect: region.rect,
      currentItem: null,
      itemCount: null,
      behavior: "unknown" as const,
      pixelPolicy: "mask-content" as const,
    })),
    scrollY,
    viewportWidth,
    viewportHeight,
    devicePixelRatio,
  );
}

async function maskPngRegions(
  bytes: Uint8Array,
  masks: readonly ScreenshotMaskRect[],
): Promise<Uint8Array> {
  if (masks.length === 0) return bytes;
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("Dynamic screenshot masking is unavailable");
  }
  const inputBytes = Uint8Array.from(bytes);
  const bitmap = await createImageBitmap(new Blob([inputBytes], { type: "image/png" }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Dynamic screenshot masking context is unavailable");
    context.drawImage(bitmap, 0, 0);
    for (const mask of mergeMaskRects(masks)) {
      context.fillStyle = "#e5e7eb";
      context.fillRect(mask.x, mask.y, mask.width, mask.height);
      context.strokeStyle = "#9ca3af";
      context.lineWidth = Math.max(1, Math.round(Math.min(mask.width, mask.height) / 200));
      context.strokeRect(mask.x, mask.y, mask.width, mask.height);
    }
    const output = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await output.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

function mergeMaskRects(masks: readonly ScreenshotMaskRect[]): ScreenshotMaskRect[] {
  // Direct text ranges commonly share a baseline but do not overlap. Keep
  // their geometry intact; only collapse exact/contained duplicates to avoid
  // repainting large parent/pseudo-element surfaces needlessly.
  const sorted = [...masks]
    .filter((mask) => mask.width > 0 && mask.height > 0)
    .sort((left, right) => (right.width * right.height) - (left.width * left.height));
  const merged: ScreenshotMaskRect[] = [];
  for (const mask of sorted) {
    if (merged.some((existing) =>
      mask.x >= existing.x && mask.y >= existing.y &&
      mask.x + mask.width <= existing.x + existing.width &&
      mask.y + mask.height <= existing.y + existing.height
    )) continue;
    merged.push(mask);
  }
  return merged;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason ?? new DOMException("Capture aborted", "AbortError");
}
