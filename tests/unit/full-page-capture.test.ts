import { describe, expect, it } from "vitest";

import {
  DEFAULT_FULL_PAGE_CAPTURE_LIMITS,
  planBoundedFullPageCapture,
} from "../../src/core/design/full-page-capture";

describe("bounded full-page capture planner", () => {
  it("covers a long page with overlap and an exact final position", () => {
    const plan = planBoundedFullPageCapture({
      documentHeight: 6_802,
      viewportHeight: 900,
      originalScrollY: 412,
    });

    expect(plan.status).toBe("complete");
    expect(plan.positions[0]).toBe(0);
    expect(plan.positions.at(-1)).toBe(5_902);
    expect(plan.coveredHeight).toBe(6_802);
    expect(plan.mustRestoreScrollPosition).toBe(true);
    expect(plan.originalScrollY).toBe(412);
    expect(plan.allowedActions).toEqual(["scroll", "wait", "capture"]);
    expect(plan.allowedActions).not.toContain("click");
  });

  it("reports height and screen truncation instead of claiming completeness", () => {
    const plan = planBoundedFullPageCapture({
      documentHeight: 80_000,
      viewportHeight: 500,
      originalScrollY: 0,
      limits: { maximumDocumentHeight: 20_000, maximumScreens: 3, overlapPx: 50 },
    });

    expect(plan.status).toBe("partial");
    expect(plan.gaps).toEqual(["height-limit", "screen-limit"]);
    expect(plan.positions).toEqual([0, 450, 900]);
    expect(plan.coveredHeight).toBe(1_400);
  });

  it("keeps the default duration bounded", () => {
    const plan = planBoundedFullPageCapture({
      documentHeight: 1_000,
      viewportHeight: 700,
      originalScrollY: 0,
    });
    expect(plan.maximumDurationMs).toBe(
      DEFAULT_FULL_PAGE_CAPTURE_LIMITS.maximumDurationMs,
    );
  });

  it("rejects an overlap that cannot advance the viewport", () => {
    expect(() =>
      planBoundedFullPageCapture({
        documentHeight: 1_000,
        viewportHeight: 500,
        originalScrollY: 0,
        limits: { overlapPx: 500 },
      }),
    ).toThrow("overlapPx");
  });
});
