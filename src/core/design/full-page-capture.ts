export type FullPageCaptureLimits = Readonly<{
  maximumDocumentHeight: number;
  maximumScreens: number;
  maximumDurationMs: number;
  overlapPx: number;
}>;

export const DEFAULT_FULL_PAGE_CAPTURE_LIMITS: FullPageCaptureLimits = Object.freeze({
  maximumDocumentHeight: 50_000,
  maximumScreens: 40,
  maximumDurationMs: 60_000,
  overlapPx: 96,
});
export type FullPageCapturePlan = Readonly<{
  originalScrollY: number;
  positions: readonly number[];
  coveredHeight: number;
  status: "complete" | "partial";
  gaps: readonly ("height-limit" | "screen-limit")[];
  maximumDurationMs: number;
  mustRestoreScrollPosition: true;
  allowedActions: readonly ["scroll", "wait", "capture"];
}>;

export function planBoundedFullPageCapture(input: Readonly<{
  documentHeight: number;
  viewportHeight: number;
  originalScrollY: number;
  limits?: Partial<FullPageCaptureLimits>;
}>): FullPageCapturePlan {
  const limits = { ...DEFAULT_FULL_PAGE_CAPTURE_LIMITS, ...input.limits };
  assertFinitePositive(input.documentHeight, "documentHeight");
  assertFinitePositive(input.viewportHeight, "viewportHeight");
  if (!Number.isFinite(input.originalScrollY) || input.originalScrollY < 0) throw new Error("originalScrollY must be non-negative");
  assertFinitePositive(limits.maximumDocumentHeight, "maximumDocumentHeight");
  assertFinitePositive(limits.maximumScreens, "maximumScreens");
  assertFinitePositive(limits.maximumDurationMs, "maximumDurationMs");
  if (!Number.isFinite(limits.overlapPx) || limits.overlapPx < 0 || limits.overlapPx >= input.viewportHeight) throw new Error("overlapPx must be smaller than viewportHeight");

  const targetHeight = Math.min(input.documentHeight, limits.maximumDocumentHeight);
  const maximumScrollY = Math.max(0, targetHeight - input.viewportHeight);
  const step = input.viewportHeight - limits.overlapPx;
  const positions: number[] = [0];
  while (positions.at(-1) !== maximumScrollY && positions.length < limits.maximumScreens) {
    positions.push(Math.min(maximumScrollY, (positions.at(-1) ?? 0) + step));
  }
  const gaps: Array<"height-limit" | "screen-limit"> = [];
  if (input.documentHeight > limits.maximumDocumentHeight) gaps.push("height-limit");
  if (positions.at(-1) !== maximumScrollY) gaps.push("screen-limit");
  const lastPosition = positions.at(-1) ?? 0;
  return {
    originalScrollY: input.originalScrollY,
    positions,
    coveredHeight: Math.min(targetHeight, lastPosition + input.viewportHeight),
    status: gaps.length === 0 ? "complete" : "partial",
    gaps,
    maximumDurationMs: limits.maximumDurationMs,
    mustRestoreScrollPosition: true,
    allowedActions: ["scroll", "wait", "capture"],
  };
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}
