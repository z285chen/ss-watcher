import type {
  DesignComponentKind,
  DesignIntelligenceResult,
  DesignLayoutKind,
  DesignLayoutMode,
} from "../core/design/design-intelligence";

const WARNING_LABELS = {
  element_limit_reached: "元素采样达到上限",
  time_budget_reached: "同步时间预算已用完",
  stylesheet_access_limited: "部分样式表不可读",
  stylesheet_limit_reached: "样式表数量达到上限",
  stylesheet_rule_limit_reached: "CSS 规则达到上限",
  css_variable_limit_reached: "CSS 变量达到上限",
  shadow_dom_unscanned: "Shadow DOM 未展开",
  layout_limit_reached: "布局节点达到上限",
} as const;

const ERROR_LABELS = {
  origin_changed: "页面 origin 已变化",
  path_changed: "页面路径已变化",
  sensitive_path: "敏感路径已拒绝",
  probe_injection_failed: "视觉探针注入失败",
  invalid_probe_result: "视觉结果未通过契约校验",
  probe_runtime_failed: "页面样式 API 运行失败",
} as const;

const COMPONENT_LABELS: Record<DesignComponentKind, string> = {
  button: "按钮",
  input: "输入控件",
  link: "链接",
  card: "卡片",
};

const LAYOUT_KIND_LABELS: Record<DesignLayoutKind, string> = {
  header: "页头",
  navigation: "导航",
  main: "主内容",
  section: "区块",
  footer: "页尾",
  aside: "侧栏",
  form: "表单",
  dialog: "对话框",
  list: "列表",
  card: "卡片",
  container: "容器",
};

const LAYOUT_MODE_LABELS: Record<DesignLayoutMode, string> = {
  block: "Block",
  flex: "Flex",
  grid: "Grid",
  inline: "Inline",
  other: "其他",
};

export type PanelDesignAggregate = Readonly<{
  label: string;
  count: number;
}>;

export type PanelDesignView =
  | Readonly<{
      status: "failed";
      statusLabel: "采集失败";
      analyzerVersion: string;
      errors: readonly string[];
    }>
  | Readonly<{
      status: "completed" | "partial";
      statusLabel: "采集完成" | "部分采集";
      analyzerVersion: string;
      viewportLabel: string;
      capturedAt: string;
      coverageLabel: string;
      durationLabel: string;
      metrics: readonly Readonly<{ label: string; value: number }>[];
      colors: ReadonlyArray<{
        value: string;
        count: number;
        contextLabel: string;
      }>;
      typography: ReadonlyArray<{
        fontFamily: string;
        fontSize: string;
        fontWeight: string;
        lineHeight: string;
        count: number;
      }>;
      spacing: ReadonlyArray<{ value: string; count: number }>;
      radii: ReadonlyArray<{ value: string; count: number }>;
      shadows: ReadonlyArray<{ value: string; count: number }>;
      breakpoints: ReadonlyArray<{ label: string; count: number }>;
      components: ReadonlyArray<{
        kind: DesignComponentKind;
        label: string;
        count: number;
        dimensionLabel: string;
        backgroundColor: string;
        borderRadius: string;
        fontSize: string;
        fontWeight: string;
        padding: string;
      }>;
      layoutKinds: readonly PanelDesignAggregate[];
      layoutModes: readonly PanelDesignAggregate[];
      cssVariables: ReadonlyArray<{ name: string; value: string }>;
      warnings: readonly string[];
    }>;

export function toPanelDesignView(
  result: DesignIntelligenceResult,
): PanelDesignView {
  if (result.status === "failed") {
    return {
      status: "failed",
      statusLabel: "采集失败",
      analyzerVersion: result.analyzerVersion,
      errors: result.errors.map((error) => ERROR_LABELS[error]),
    };
  }

  return {
    status: result.status,
    statusLabel: result.status === "completed" ? "采集完成" : "部分采集",
    analyzerVersion: result.analyzerVersion,
    viewportLabel: `${result.capture.viewport.width} × ${result.capture.viewport.height} · ${formatNumber(result.capture.viewport.devicePixelRatio)}x DPR · ${result.capture.viewport.colorScheme === "dark" ? "深色" : "浅色"}`,
    capturedAt: result.capture.capturedAt,
    coverageLabel: `${result.coverage.sampledElements} / ${result.coverage.visitedElements} 个访问元素进入可见样式样本 · ${result.coverage.styleSheetsReadable} / ${result.coverage.styleSheetsObserved} 张样式表可读`,
    durationLabel: `${formatNumber(result.coverage.durationMs)} ms`,
    metrics: [
      { label: "颜色", value: result.primitives.colors.length },
      { label: "字体", value: result.primitives.typography.length },
      { label: "组件", value: result.components.length },
      { label: "布局", value: result.layout.length },
    ],
    colors: result.primitives.colors.slice(0, 12).map((color) => ({
      value: color.value,
      count: color.count,
      contextLabel: color.contexts.join(" · "),
    })),
    typography: result.primitives.typography.slice(0, 8).map((style) => ({
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      count: style.count,
    })),
    spacing: result.primitives.spacing.slice(0, 12).map(({ value, count }) => ({
      value,
      count,
    })),
    radii: result.primitives.radii.slice(0, 8).map(({ value, count }) => ({
      value,
      count,
    })),
    shadows: result.primitives.shadows.slice(0, 6).map(({ value, count }) => ({
      value,
      count,
    })),
    breakpoints: result.primitives.breakpoints.slice(0, 16).map((breakpoint) => ({
      label: `${formatNumber(breakpoint.valuePx)}px · ${breakpoint.modes.join("/")}`,
      count: breakpoint.count,
    })),
    components: result.components.slice(0, 10).map((component) => ({
      kind: component.kind,
      label: COMPONENT_LABELS[component.kind],
      count: component.count,
      dimensionLabel: formatDimensions(component.sizeRange),
      backgroundColor: component.style.backgroundColor,
      borderRadius: component.style.borderRadius,
      fontSize: component.style.fontSize,
      fontWeight: component.style.fontWeight,
      padding: component.style.padding,
    })),
    layoutKinds: aggregateLayout(
      result.layout.map((node) => node.kind),
      LAYOUT_KIND_LABELS,
    ),
    layoutModes: aggregateLayout(
      result.layout.map((node) => node.mode),
      LAYOUT_MODE_LABELS,
    ),
    cssVariables: result.primitives.cssVariables
      .slice(0, 16)
      .map(({ name, value }) => ({ name, value })),
    warnings: result.warnings.map((warning) => WARNING_LABELS[warning]),
  };
}

function aggregateLayout<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): readonly PanelDesignAggregate[] {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ label: labels[value], count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );
}

function formatDimensions(
  range: Readonly<{
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
  }>,
): string {
  const width =
    range.minWidth === range.maxWidth
      ? formatNumber(range.minWidth)
      : `${formatNumber(range.minWidth)}–${formatNumber(range.maxWidth)}`;
  const height =
    range.minHeight === range.maxHeight
      ? formatNumber(range.minHeight)
      : `${formatNumber(range.minHeight)}–${formatNumber(range.maxHeight)}`;
  return `${width} × ${height}px`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
