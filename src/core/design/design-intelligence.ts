export const DESIGN_INTELLIGENCE_ANALYZER_VERSION =
  "computed-style-spike-v1" as const;

export const MAX_DESIGN_INTELLIGENCE_RESULT_BYTES = 256 * 1_024;
export const MAX_DESIGN_COLORS = 48;
export const MAX_DESIGN_TYPOGRAPHY_STYLES = 48;
export const MAX_DESIGN_SPACING_VALUES = 32;
export const MAX_DESIGN_RADII = 32;
export const MAX_DESIGN_SHADOWS = 32;
export const MAX_DESIGN_CSS_VARIABLES = 100;
export const MAX_DESIGN_BREAKPOINTS = 30;
export const MAX_DESIGN_COMPONENT_VARIANTS = 40;
export const MAX_DESIGN_LAYOUT_NODES = 120;

export const DESIGN_CONTEXTS = [
  "heading",
  "body-text",
  "button",
  "input",
  "link",
  "media",
  "card",
  "navigation",
  "other",
] as const;

export const DESIGN_COLOR_PROPERTIES = [
  "color",
  "background-color",
  "border-color",
  "outline-color",
] as const;

export const DESIGN_SPACING_PROPERTIES = [
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "row-gap",
  "column-gap",
] as const;

export const DESIGN_COMPONENT_KINDS = [
  "button",
  "input",
  "link",
  "card",
] as const;

export const DESIGN_LAYOUT_KINDS = [
  "header",
  "navigation",
  "main",
  "section",
  "footer",
  "aside",
  "form",
  "dialog",
  "list",
  "card",
  "container",
] as const;

export const DESIGN_LAYOUT_MODES = [
  "block",
  "flex",
  "grid",
  "inline",
  "other",
] as const;

export const DESIGN_LAYOUT_POSITIONS = [
  "static",
  "relative",
  "absolute",
  "fixed",
  "sticky",
  "other",
] as const;

export const DESIGN_LAYOUT_AXES = ["row", "column", "unknown"] as const;

export const DESIGN_BREAKPOINT_MODES = ["min", "max", "exact"] as const;

export const DESIGN_WARNING_CODES = [
  "element_limit_reached",
  "time_budget_reached",
  "stylesheet_access_limited",
  "stylesheet_limit_reached",
  "stylesheet_rule_limit_reached",
  "css_variable_limit_reached",
  "shadow_dom_unscanned",
  "layout_limit_reached",
] as const;

export const DESIGN_ERROR_CODES = [
  "origin_changed",
  "path_changed",
  "sensitive_path",
  "probe_injection_failed",
  "invalid_probe_result",
  "probe_runtime_failed",
] as const;

export type DesignContext = (typeof DESIGN_CONTEXTS)[number];
export type DesignColorProperty = (typeof DESIGN_COLOR_PROPERTIES)[number];
export type DesignSpacingProperty = (typeof DESIGN_SPACING_PROPERTIES)[number];
export type DesignComponentKind = (typeof DESIGN_COMPONENT_KINDS)[number];
export type DesignLayoutKind = (typeof DESIGN_LAYOUT_KINDS)[number];
export type DesignLayoutMode = (typeof DESIGN_LAYOUT_MODES)[number];
export type DesignLayoutPosition = (typeof DESIGN_LAYOUT_POSITIONS)[number];
export type DesignLayoutAxis = (typeof DESIGN_LAYOUT_AXES)[number];
export type DesignBreakpointMode = (typeof DESIGN_BREAKPOINT_MODES)[number];
export type DesignWarningCode = (typeof DESIGN_WARNING_CODES)[number];
export type DesignErrorCode = (typeof DESIGN_ERROR_CODES)[number];

export type DesignCapture = Readonly<{
  origin: string;
  pathname: string;
  capturedAt: string;
  viewport: Readonly<{
    width: number;
    height: number;
    devicePixelRatio: number;
    colorScheme: "light" | "dark";
  }>;
}>;

export type DesignCoverage = Readonly<{
  visitedElements: number;
  visibleElements: number;
  sampledElements: number;
  visitLimit: number;
  elementLimit: number;
  truncated: boolean;
  styleSheetsObserved: number;
  styleSheetsReadable: number;
  styleSheetsBlocked: number;
  openShadowRoots: number;
  durationMs: number;
}>;

export type DesignColorEvidence = Readonly<{
  value: string;
  count: number;
  properties: DesignColorProperty[];
  contexts: DesignContext[];
}>;

export type DesignTypographyEvidence = Readonly<{
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  count: number;
  contexts: DesignContext[];
}>;

export type DesignSpacingEvidence = Readonly<{
  value: string;
  count: number;
  properties: DesignSpacingProperty[];
}>;

export type DesignStyleEvidence = Readonly<{
  value: string;
  count: number;
  contexts: DesignContext[];
}>;

export type DesignCssVariableEvidence = Readonly<{
  name: string;
  value: string;
  source: "computed-root";
}>;

export type DesignBreakpointEvidence = Readonly<{
  valuePx: number;
  count: number;
  modes: DesignBreakpointMode[];
}>;

export type DesignComponentStyle = Readonly<{
  color: string;
  backgroundColor: string;
  border: string;
  borderRadius: string;
  boxShadow: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  padding: string;
}>;

export type DesignComponentVariant = Readonly<{
  kind: DesignComponentKind;
  count: number;
  style: DesignComponentStyle;
  sizeRange: Readonly<{
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
  }>;
}>;

export type DesignLayoutNode = Readonly<{
  nodeId: number;
  parentNodeId: number | null;
  kind: DesignLayoutKind;
  mode: DesignLayoutMode;
  position: DesignLayoutPosition;
  axis: DesignLayoutAxis;
  rect: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  childElementCount: number;
  columnCount: number;
  gap: string;
  padding: string;
}>;

export type DesignPrimitives = Readonly<{
  colors: DesignColorEvidence[];
  typography: DesignTypographyEvidence[];
  spacing: DesignSpacingEvidence[];
  radii: DesignStyleEvidence[];
  shadows: DesignStyleEvidence[];
  cssVariables: DesignCssVariableEvidence[];
  breakpoints: DesignBreakpointEvidence[];
}>;

export type SuccessfulDesignIntelligenceResult = Readonly<{
  status: "completed" | "partial";
  analyzerVersion: typeof DESIGN_INTELLIGENCE_ANALYZER_VERSION;
  capture: DesignCapture;
  coverage: DesignCoverage;
  layout: DesignLayoutNode[];
  primitives: DesignPrimitives;
  components: DesignComponentVariant[];
  warnings: DesignWarningCode[];
  errors: [];
}>;

export type FailedDesignIntelligenceResult = Readonly<{
  status: "failed";
  analyzerVersion: typeof DESIGN_INTELLIGENCE_ANALYZER_VERSION;
  warnings: [];
  errors: DesignErrorCode[];
}>;

export type DesignIntelligenceResult =
  | SuccessfulDesignIntelligenceResult
  | FailedDesignIntelligenceResult;

export function emptyDesignIntelligence(
  error: DesignErrorCode,
): FailedDesignIntelligenceResult {
  return {
    status: "failed",
    analyzerVersion: DESIGN_INTELLIGENCE_ANALYZER_VERSION,
    warnings: [],
    errors: [error],
  };
}

export function isDesignIntelligenceResult(
  value: unknown,
  expected?: Readonly<{ origin: string; pathname: string }>,
): value is DesignIntelligenceResult {
  if (!isRecord(value) || !withinJsonBudget(value)) return false;
  if (
    value.analyzerVersion !== DESIGN_INTELLIGENCE_ANALYZER_VERSION ||
    !isOneOf(value.status, ["completed", "partial", "failed"])
  ) {
    return false;
  }

  if (value.status === "failed") {
    return (
      hasOnlyKeys(value, ["status", "analyzerVersion", "warnings", "errors"]) &&
      Array.isArray(value.warnings) &&
      value.warnings.length === 0 &&
      isBoundedEnumArray(value.errors, DESIGN_ERROR_CODES, 3, false)
    );
  }

  if (
    !hasOnlyKeys(value, [
      "status",
      "analyzerVersion",
      "capture",
      "coverage",
      "layout",
      "primitives",
      "components",
      "warnings",
      "errors",
    ]) ||
    !Array.isArray(value.errors) ||
    value.errors.length !== 0 ||
    !isBoundedEnumArray(value.warnings, DESIGN_WARNING_CODES, 8, true) ||
    (value.status === "completed" && value.warnings.length !== 0) ||
    (value.status === "partial" && value.warnings.length === 0) ||
    !isDesignCapture(value.capture, expected) ||
    !isDesignCoverage(value.coverage) ||
    !isDesignLayout(value.layout) ||
    !isDesignPrimitives(value.primitives) ||
    !Array.isArray(value.components) ||
    value.components.length > MAX_DESIGN_COMPONENT_VARIANTS ||
    !value.components.every(isDesignComponentVariant)
  ) {
    return false;
  }

  return true;
}

function isDesignLayout(value: unknown): value is DesignLayoutNode[] {
  if (!Array.isArray(value) || value.length > MAX_DESIGN_LAYOUT_NODES) return false;
  for (let index = 0; index < value.length; index += 1) {
    const node = value[index];
    if (
      !isRecord(node) ||
      !hasOnlyKeys(node, [
        "nodeId",
        "parentNodeId",
        "kind",
        "mode",
        "position",
        "axis",
        "rect",
        "childElementCount",
        "columnCount",
        "gap",
        "padding",
      ]) ||
      node.nodeId !== index ||
      !(
        node.parentNodeId === null ||
        (isMetric(node.parentNodeId, MAX_DESIGN_LAYOUT_NODES) &&
          Number(node.parentNodeId) < index)
      ) ||
      !isOneOf(node.kind, DESIGN_LAYOUT_KINDS) ||
      !isOneOf(node.mode, DESIGN_LAYOUT_MODES) ||
      !isOneOf(node.position, DESIGN_LAYOUT_POSITIONS) ||
      !isOneOf(node.axis, DESIGN_LAYOUT_AXES) ||
      !isRecord(node.rect) ||
      !hasOnlyKeys(node.rect, ["x", "y", "width", "height"]) ||
      !isFiniteWithin(node.rect.x, -100_000, 100_000) ||
      !isFiniteWithin(node.rect.y, -100_000, 100_000) ||
      !isFiniteWithin(node.rect.width, 0, 100_000) ||
      !isFiniteWithin(node.rect.height, 0, 100_000) ||
      !isMetric(node.childElementCount, 10_000) ||
      !isMetric(node.columnCount, 100) ||
      !isSafeString(node.gap, 32, true) ||
      !isSafeString(node.padding, 128, true)
    ) {
      return false;
    }
  }
  return true;
}

function isDesignCapture(
  value: unknown,
  expected: Readonly<{ origin: string; pathname: string }> | undefined,
): value is DesignCapture {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["origin", "pathname", "capturedAt", "viewport"]) ||
    !isPublicOrigin(value.origin) ||
    typeof value.pathname !== "string" ||
    value.pathname.length === 0 ||
    value.pathname.length > 8_192 ||
    !value.pathname.startsWith("/") ||
    value.pathname.includes("?") ||
    value.pathname.includes("#") ||
    typeof value.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !isRecord(value.viewport) ||
    !hasOnlyKeys(value.viewport, [
      "width",
      "height",
      "devicePixelRatio",
      "colorScheme",
    ]) ||
    !isMetric(value.viewport.width, 16_384) ||
    !isMetric(value.viewport.height, 16_384) ||
    !isFiniteWithin(value.viewport.devicePixelRatio, 0.1, 16) ||
    !isOneOf(value.viewport.colorScheme, ["light", "dark"])
  ) {
    return false;
  }
  return (
    expected === undefined ||
    (value.origin === expected.origin && value.pathname === expected.pathname)
  );
}

function isDesignCoverage(value: unknown): value is DesignCoverage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "visitedElements",
      "visibleElements",
      "sampledElements",
      "visitLimit",
      "elementLimit",
      "truncated",
      "styleSheetsObserved",
      "styleSheetsReadable",
      "styleSheetsBlocked",
      "openShadowRoots",
      "durationMs",
    ]) &&
    isMetric(value.visitedElements, 10_000) &&
    isMetric(value.visibleElements, 10_000) &&
    isMetric(value.sampledElements, 10_000) &&
    isMetric(value.visitLimit, 10_000) &&
    isMetric(value.elementLimit, 10_000) &&
    Number(value.sampledElements) <= Number(value.visibleElements) &&
    Number(value.visibleElements) <= Number(value.visitedElements) &&
    Number(value.visitedElements) <= Number(value.visitLimit) &&
    Number(value.sampledElements) <= Number(value.elementLimit) &&
    typeof value.truncated === "boolean" &&
    isMetric(value.styleSheetsObserved, 1_000) &&
    isMetric(value.styleSheetsReadable, 1_000) &&
    isMetric(value.styleSheetsBlocked, 1_000) &&
    Number(value.styleSheetsReadable) + Number(value.styleSheetsBlocked) <=
      Number(value.styleSheetsObserved) &&
    isMetric(value.openShadowRoots, 10_000) &&
    isFiniteWithin(value.durationMs, 0, 60_000)
  );
}

function isDesignPrimitives(value: unknown): value is DesignPrimitives {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "colors",
      "typography",
      "spacing",
      "radii",
      "shadows",
      "cssVariables",
      "breakpoints",
    ]) &&
    isBoundedArray(value.colors, MAX_DESIGN_COLORS, isColorEvidence) &&
    isBoundedArray(
      value.typography,
      MAX_DESIGN_TYPOGRAPHY_STYLES,
      isTypographyEvidence,
    ) &&
    isBoundedArray(value.spacing, MAX_DESIGN_SPACING_VALUES, isSpacingEvidence) &&
    isBoundedArray(value.radii, MAX_DESIGN_RADII, isStyleEvidence) &&
    isBoundedArray(value.shadows, MAX_DESIGN_SHADOWS, isStyleEvidence) &&
    isBoundedArray(
      value.cssVariables,
      MAX_DESIGN_CSS_VARIABLES,
      isCssVariableEvidence,
    ) &&
    isBoundedArray(
      value.breakpoints,
      MAX_DESIGN_BREAKPOINTS,
      isBreakpointEvidence,
    )
  );
}

function isColorEvidence(value: unknown): value is DesignColorEvidence {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["value", "count", "properties", "contexts"]) &&
    isSafeString(value.value, 128, false) &&
    isMetric(value.count, 100_000) &&
    isBoundedEnumArray(value.properties, DESIGN_COLOR_PROPERTIES, 4, false) &&
    isBoundedEnumArray(value.contexts, DESIGN_CONTEXTS, 9, false)
  );
}

function isTypographyEvidence(value: unknown): value is DesignTypographyEvidence {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "count",
      "contexts",
    ]) &&
    isSafeString(value.fontFamily, 160, false) &&
    isSafeString(value.fontSize, 32, false) &&
    isSafeString(value.fontWeight, 32, false) &&
    isSafeString(value.lineHeight, 32, true) &&
    isSafeString(value.letterSpacing, 32, true) &&
    isMetric(value.count, 100_000) &&
    isBoundedEnumArray(value.contexts, DESIGN_CONTEXTS, 9, false)
  );
}

function isSpacingEvidence(value: unknown): value is DesignSpacingEvidence {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["value", "count", "properties"]) &&
    isSafeString(value.value, 32, false) &&
    isMetric(value.count, 100_000) &&
    isBoundedEnumArray(value.properties, DESIGN_SPACING_PROPERTIES, 10, false)
  );
}

function isStyleEvidence(value: unknown): value is DesignStyleEvidence {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["value", "count", "contexts"]) &&
    isSafeString(value.value, 256, false) &&
    isMetric(value.count, 100_000) &&
    isBoundedEnumArray(value.contexts, DESIGN_CONTEXTS, 9, false)
  );
}

function isCssVariableEvidence(value: unknown): value is DesignCssVariableEvidence {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["name", "value", "source"]) &&
    typeof value.name === "string" &&
    /^--[a-zA-Z0-9_-]{1,80}$/u.test(value.name) &&
    isSafeString(value.value, 256, false) &&
    !/(?:url\s*\(|data:|https?:|javascript:|var\s*\(|@|[{};\\'"\[\]])/iu.test(
      String(value.value),
    ) &&
    /^[a-zA-Z0-9#(),.%+\-/*\s_]+$/u.test(String(value.value)) &&
    value.source === "computed-root"
  );
}

function isBreakpointEvidence(value: unknown): value is DesignBreakpointEvidence {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["valuePx", "count", "modes"]) &&
    isFiniteWithin(value.valuePx, 1, 16_384) &&
    isMetric(value.count, 100_000) &&
    isBoundedEnumArray(value.modes, DESIGN_BREAKPOINT_MODES, 3, false)
  );
}

function isDesignComponentVariant(value: unknown): value is DesignComponentVariant {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["kind", "count", "style", "sizeRange"]) ||
    !isOneOf(value.kind, DESIGN_COMPONENT_KINDS) ||
    !isMetric(value.count, 100_000) ||
    !isRecord(value.style) ||
    !hasOnlyKeys(value.style, [
      "color",
      "backgroundColor",
      "border",
      "borderRadius",
      "boxShadow",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "padding",
    ])
  ) {
    return false;
  }
  return (
    Object.values(value.style).every((item) => isSafeString(item, 256, true)) &&
    isRecord(value.sizeRange) &&
    hasOnlyKeys(value.sizeRange, [
      "minWidth",
      "maxWidth",
      "minHeight",
      "maxHeight",
    ]) &&
    isFiniteWithin(value.sizeRange.minWidth, 0, 100_000) &&
    isFiniteWithin(value.sizeRange.maxWidth, 0, 100_000) &&
    isFiniteWithin(value.sizeRange.minHeight, 0, 100_000) &&
    isFiniteWithin(value.sizeRange.maxHeight, 0, 100_000) &&
    Number(value.sizeRange.minWidth) <= Number(value.sizeRange.maxWidth) &&
    Number(value.sizeRange.minHeight) <= Number(value.sizeRange.maxHeight)
  );
}

function withinJsonBudget(value: unknown): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      MAX_DESIGN_INTELLIGENCE_RESULT_BYTES
    );
  } catch {
    return false;
  }
}

function isBoundedArray<T>(
  value: unknown,
  maximum: number,
  predicate: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.length <= maximum && value.every(predicate);
}

function isBoundedEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  maximum: number,
  emptyAllowed: boolean,
): value is T[] {
  return (
    Array.isArray(value) &&
    (emptyAllowed || value.length > 0) &&
    value.length <= maximum &&
    value.every((item) => isOneOf(item, allowed)) &&
    new Set(value).size === value.length
  );
}

function isSafeString(value: unknown, maximum: number, emptyAllowed: boolean): boolean {
  return (
    typeof value === "string" &&
    (emptyAllowed || value.length > 0) &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}

function isMetric(value: unknown, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isFiniteWithin(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isPublicOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
