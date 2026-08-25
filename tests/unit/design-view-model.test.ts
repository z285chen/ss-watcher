import { describe, expect, it } from "vitest";

import type { DesignIntelligenceResult } from "../../src/core/design/design-intelligence";
import { toPanelDesignView } from "../../src/sidepanel/design-view-model";

describe("Design Intelligence side-panel view model", () => {
  it("turns bounded visual evidence into compact, ranked presentation data", () => {
    const view = toPanelDesignView(partialFixture());

    expect(view).toMatchObject({
      status: "partial",
      statusLabel: "部分采集",
      viewportLabel: "1126 × 763 · 2x DPR · 浅色",
      coverageLabel:
        "132 / 1500 个访问元素进入可见样式样本 · 76 / 79 张样式表可读",
      durationLabel: "87.5 ms",
      warnings: ["同步时间预算已用完", "部分样式表不可读"],
      metrics: [
        { label: "颜色", value: 13 },
        { label: "字体", value: 1 },
        { label: "组件", value: 2 },
        { label: "布局", value: 3 },
      ],
    });
    if (view.status === "failed") throw new Error("expected visual evidence");

    expect(view.colors).toHaveLength(12);
    expect(view.components).toEqual([
      expect.objectContaining({
        kind: "button",
        label: "按钮",
        dimensionLabel: "120–320 × 40px",
      }),
      expect.objectContaining({
        kind: "card",
        label: "卡片",
        dimensionLabel: "360 × 240–480px",
      }),
    ]);
    expect(view.layoutKinds).toEqual([
      { label: "卡片", count: 2 },
      { label: "主内容", count: 1 },
    ]);
    expect(view.layoutModes).toEqual([
      { label: "Grid", count: 2 },
      { label: "Block", count: 1 },
    ]);
    expect(view.breakpoints).toEqual([
      { label: "768px · min", count: 47 },
      { label: "990px · max", count: 105 },
    ]);
    expect(view.cssVariables).toEqual([
      { name: "--brand-color", value: "#315800" },
    ]);
  });

  it("keeps Design probe failures isolated and user-readable", () => {
    expect(
      toPanelDesignView({
        status: "failed",
        analyzerVersion: "computed-style-spike-v1",
        warnings: [],
        errors: ["probe_injection_failed", "invalid_probe_result"],
      }),
    ).toEqual({
      status: "failed",
      statusLabel: "采集失败",
      analyzerVersion: "computed-style-spike-v1",
      errors: ["视觉探针注入失败", "视觉结果未通过契约校验"],
    });
  });
});

function partialFixture(): DesignIntelligenceResult {
  return {
    status: "partial",
    analyzerVersion: "computed-style-spike-v1",
    capture: {
      origin: "https://petlibro.com",
      pathname: "/",
      capturedAt: "2026-08-12T09:37:00.000Z",
      viewport: {
        width: 1_126,
        height: 763,
        devicePixelRatio: 2,
        colorScheme: "light",
      },
    },
    coverage: {
      visitedElements: 1_500,
      visibleElements: 132,
      sampledElements: 132,
      visitLimit: 5_000,
      elementLimit: 1_500,
      truncated: true,
      styleSheetsObserved: 79,
      styleSheetsReadable: 76,
      styleSheetsBlocked: 3,
      openShadowRoots: 0,
      durationMs: 87.5,
    },
    layout: [
      layoutNode(0, null, "main", "block"),
      layoutNode(1, 0, "card", "grid"),
      layoutNode(2, 0, "card", "grid"),
    ],
    primitives: {
      colors: Array.from({ length: 13 }, (_, index) => ({
        value: `rgb(${index}, ${index}, ${index})`,
        count: 20 - index,
        properties: ["color" as const],
        contexts: ["body-text" as const],
      })),
      typography: [
        {
          fontFamily: "sohne",
          fontSize: "16px",
          fontWeight: "400",
          lineHeight: "28.8px",
          letterSpacing: "normal",
          count: 42,
          contexts: ["body-text"],
        },
      ],
      spacing: [
        { value: "16px", count: 22, properties: ["padding-left"] },
      ],
      radii: [{ value: "4px", count: 12, contexts: ["input"] }],
      shadows: [],
      cssVariables: [
        { name: "--brand-color", value: "#315800", source: "computed-root" },
      ],
      breakpoints: [
        { valuePx: 768, count: 47, modes: ["min"] },
        { valuePx: 990, count: 105, modes: ["max"] },
      ],
    },
    components: [
      {
        kind: "button",
        count: 7,
        style: componentStyle("rgb(49, 88, 0)", "0px"),
        sizeRange: {
          minWidth: 120,
          maxWidth: 320,
          minHeight: 40,
          maxHeight: 40,
        },
      },
      {
        kind: "card",
        count: 3,
        style: componentStyle("rgb(255, 255, 255)", "16px"),
        sizeRange: {
          minWidth: 360,
          maxWidth: 360,
          minHeight: 240,
          maxHeight: 480,
        },
      },
    ],
    warnings: ["time_budget_reached", "stylesheet_access_limited"],
    errors: [],
  };
}

function componentStyle(backgroundColor: string, borderRadius: string) {
  return {
    color: "rgb(255, 255, 255)",
    backgroundColor,
    border: "0px none rgb(255, 255, 255)",
    borderRadius,
    boxShadow: "none",
    fontFamily: "sohne",
    fontSize: "16px",
    fontWeight: "400",
    padding: "12px 20px",
  };
}

function layoutNode(
  nodeId: number,
  parentNodeId: number | null,
  kind: "main" | "card",
  mode: "block" | "grid",
) {
  return {
    nodeId,
    parentNodeId,
    kind,
    mode,
    position: "static" as const,
    axis: mode === "grid" ? ("row" as const) : ("unknown" as const),
    rect: { x: 0, y: nodeId * 100, width: 1_126, height: 100 },
    childElementCount: 2,
    columnCount: mode === "grid" ? 2 : 0,
    gap: mode === "grid" ? "24px" : "normal",
    padding: "0px",
  };
}
