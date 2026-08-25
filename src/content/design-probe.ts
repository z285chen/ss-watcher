import type {
  DesignBreakpointEvidence,
  DesignBreakpointMode,
  DesignColorEvidence,
  DesignColorProperty,
  DesignComponentKind,
  DesignComponentStyle,
  DesignComponentVariant,
  DesignContext,
  DesignCssVariableEvidence,
  DesignLayoutAxis,
  DesignLayoutKind,
  DesignLayoutMode,
  DesignLayoutNode,
  DesignLayoutPosition,
  DesignSpacingEvidence,
  DesignSpacingProperty,
  DesignStyleEvidence,
  DesignTypographyEvidence,
  DesignWarningCode,
  SuccessfulDesignIntelligenceResult,
} from "../core/design/design-intelligence";

export type DesignProbeInput = Readonly<{
  expectedOrigin: string;
  expectedPathname: string;
}>;

export type DesignProbeResult =
  | SuccessfulDesignIntelligenceResult
  | Readonly<{
      status: "failed";
      analyzerVersion: "computed-style-spike-v1";
      warnings: [];
      errors: [
        | "origin_changed"
        | "path_changed"
        | "sensitive_path"
        | "probe_runtime_failed",
      ];
    }>;

/**
 * Closure-free, read-only ISOLATED-world visual evidence probe.
 *
 * Chrome serializes this function for injection, so every helper and constant
 * intentionally lives inside the function. The probe never scrolls, focuses,
 * hovers, clicks, mutates the DOM, or returns page text/input values.
 */
export function designIntelligenceProbe(input: DesignProbeInput): DesignProbeResult {
  const analyzerVersion = "computed-style-spike-v1" as const;
  if (location.origin !== input.expectedOrigin) {
    return failed("origin_changed");
  }
  const inspectedPath = inspectPath(location.pathname);
  if (!inspectedPath.ok) return failed(inspectedPath.reason);
  if (inspectedPath.normalizedPathname !== input.expectedPathname) {
    return failed("path_changed");
  }

  try {
    const startedAt = performance.now();
    const visitLimit = 5_000;
    const elementLimit = 1_500;
    const timeBudgetMs = 150;
    const maximumStyleSheets = 100;
    const maximumStyleSheetRules = 10_000;
    const maximumCssVariables = 100;
    const maximumLayoutNodes = 120;

    type CountWithContexts = {
      count: number;
      contexts: Set<DesignContext>;
    };
    type ColorAccumulator = CountWithContexts & {
      properties: Set<DesignColorProperty>;
    };
    type SpacingAccumulator = {
      count: number;
      properties: Set<DesignSpacingProperty>;
    };
    type TypographyAccumulator = CountWithContexts & {
      fontFamily: string;
      fontSize: string;
      fontWeight: string;
      lineHeight: string;
      letterSpacing: string;
    };
    type ComponentAccumulator = {
      count: number;
      kind: DesignComponentKind;
      style: DesignComponentStyle;
      minWidth: number;
      maxWidth: number;
      minHeight: number;
      maxHeight: number;
    };
    type BreakpointAccumulator = {
      count: number;
      modes: Set<DesignBreakpointMode>;
    };

    const colors = new Map<string, ColorAccumulator>();
    const typography = new Map<string, TypographyAccumulator>();
    const spacing = new Map<string, SpacingAccumulator>();
    const radii = new Map<string, CountWithContexts>();
    const shadows = new Map<string, CountWithContexts>();
    const components = new Map<string, ComponentAccumulator>();
    const breakpoints = new Map<number, BreakpointAccumulator>();
    const layoutNodes: DesignLayoutNode[] = [];
    const layoutNodeIds = new Map<Element, number>();
    const warnings = new Set<DesignWarningCode>();
    let visitedElements = 0;
    let visibleElements = 0;
    let sampledElements = 0;
    let openShadowRoots = 0;
    let timeBudgetReached = false;

    const elementWalker = document.createTreeWalker(
      document.documentElement,
      NodeFilter.SHOW_ELEMENT,
    );
    let current = elementWalker.currentNode as Element | null;
    while (current !== null && visitedElements < visitLimit) {
      if (performance.now() - startedAt >= timeBudgetMs) {
        timeBudgetReached = true;
        break;
      }
      visitedElements += 1;
      if ((current as HTMLElement).shadowRoot?.mode === "open") {
        openShadowRoots += 1;
      }
      if (sampledElements < elementLimit) {
        const style = getComputedStyle(current);
        const rect = current.getBoundingClientRect();
        if (isVisible(style, rect)) {
          visibleElements += 1;
          sampledElements += 1;
          const context = contextFor(current);
          collectColor(style.color, "color", context);
          collectColor(style.backgroundColor, "background-color", context);
          collectColor(style.borderColor, "border-color", context);
          collectColor(style.outlineColor, "outline-color", context);
          collectTypography(style, context);
          collectSpacing(style);
          collectStyle(radii, clipped(style.borderRadius, 128), context, ["0px"]);
          collectStyle(shadows, clipped(style.boxShadow, 256), context, ["none"]);
          collectComponent(current, style, rect, context);
          collectLayout(current, style, rect, context);
        }
      }
      current = elementWalker.nextNode() as Element | null;
    }

    if (visitedElements >= visitLimit || sampledElements >= elementLimit) {
      warnings.add("element_limit_reached");
    }
    if (timeBudgetReached) warnings.add("time_budget_reached");
    if (openShadowRoots > 0) warnings.add("shadow_dom_unscanned");

    const observedStyleSheetCount = document.styleSheets.length;
    let styleSheetsReadable = 0;
    let styleSheetsBlocked = 0;
    let inspectedRules = 0;
    for (
      let sheetIndex = 0;
      sheetIndex < Math.min(observedStyleSheetCount, maximumStyleSheets);
      sheetIndex += 1
    ) {
      if (outOfTime()) break;
      const sheet = document.styleSheets.item(sheetIndex);
      if (sheet === null) continue;
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
        styleSheetsReadable += 1;
      } catch {
        styleSheetsBlocked += 1;
        continue;
      }
      walkRules(rules);
      if (inspectedRules >= maximumStyleSheetRules) break;
    }
    if (styleSheetsBlocked > 0) warnings.add("stylesheet_access_limited");
    if (observedStyleSheetCount > maximumStyleSheets) {
      warnings.add("stylesheet_limit_reached");
    }
    if (inspectedRules >= maximumStyleSheetRules) {
      warnings.add("stylesheet_rule_limit_reached");
    }

    const cssVariables: DesignCssVariableEvidence[] = [];
    const rootStyle = getComputedStyle(document.documentElement);
    for (
      let propertyIndex = 0;
      propertyIndex < rootStyle.length;
      propertyIndex += 1
    ) {
      if (outOfTime()) break;
      const rawName = rootStyle.item(propertyIndex);
      if (!/^--[a-zA-Z0-9_-]{1,80}$/u.test(rawName)) continue;
      const value = clipped(rootStyle.getPropertyValue(rawName).trim(), 256);
      if (!isSafeDesignVariableValue(rawName, value)) {
        continue;
      }
      cssVariables.push({ name: rawName, value, source: "computed-root" });
      if (cssVariables.length >= maximumCssVariables) {
        warnings.add("css_variable_limit_reached");
        break;
      }
    }
    cssVariables.sort((left, right) => left.name.localeCompare(right.name));
    if (timeBudgetReached) warnings.add("time_budget_reached");

    const durationMs = Math.max(0, performance.now() - startedAt);
    const warningList = [...warnings].sort();
    return {
      status: warningList.length === 0 ? "completed" : "partial",
      analyzerVersion,
      capture: {
        origin: location.origin,
        pathname: inspectedPath.normalizedPathname,
        capturedAt: new Date().toISOString(),
        viewport: {
          width: boundedMetric(globalThis.innerWidth, 16_384),
          height: boundedMetric(globalThis.innerHeight, 16_384),
          devicePixelRatio: boundedNumber(globalThis.devicePixelRatio, 0.1, 16, 1),
          colorScheme: globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light",
        },
      },
      coverage: {
        visitedElements,
        visibleElements,
        sampledElements,
        visitLimit,
        elementLimit,
        truncated: warningList.some((warning) =>
          [
            "element_limit_reached",
            "time_budget_reached",
            "stylesheet_limit_reached",
            "stylesheet_rule_limit_reached",
            "css_variable_limit_reached",
          ].includes(warning),
        ),
        styleSheetsObserved: boundedMetric(observedStyleSheetCount, 1_000),
        styleSheetsReadable,
        styleSheetsBlocked,
        openShadowRoots,
        durationMs,
      },
      layout: layoutNodes,
      primitives: {
        colors: topValues(colors, 48, (value, item): DesignColorEvidence => ({
          value,
          count: item.count,
          properties: [...item.properties].sort(),
          contexts: [...item.contexts].sort(),
        })),
        typography: topValues(
          typography,
          48,
          (_key, item): DesignTypographyEvidence => ({
            fontFamily: item.fontFamily,
            fontSize: item.fontSize,
            fontWeight: item.fontWeight,
            lineHeight: item.lineHeight,
            letterSpacing: item.letterSpacing,
            count: item.count,
            contexts: [...item.contexts].sort(),
          }),
        ),
        spacing: topValues(
          spacing,
          32,
          (value, item): DesignSpacingEvidence => ({
            value,
            count: item.count,
            properties: [...item.properties].sort(),
          }),
        ),
        radii: topValues(
          radii,
          32,
          (value, item): DesignStyleEvidence => ({
            value,
            count: item.count,
            contexts: [...item.contexts].sort(),
          }),
        ),
        shadows: topValues(
          shadows,
          32,
          (value, item): DesignStyleEvidence => ({
            value,
            count: item.count,
            contexts: [...item.contexts].sort(),
          }),
        ),
        cssVariables,
        breakpoints: [...breakpoints.entries()]
          .sort((left, right) => left[0] - right[0])
          .slice(0, 30)
          .map(([valuePx, item]): DesignBreakpointEvidence => ({
            valuePx,
            count: item.count,
            modes: [...item.modes].sort(),
          })),
      },
      components: [...components.values()]
        .sort((left, right) => right.count - left.count)
        .slice(0, 40)
        .map(
          (item): DesignComponentVariant => ({
            kind: item.kind,
            count: item.count,
            style: item.style,
            sizeRange: {
              minWidth: item.minWidth,
              maxWidth: item.maxWidth,
              minHeight: item.minHeight,
              maxHeight: item.maxHeight,
            },
          }),
        ),
      warnings: warningList,
      errors: [],
    };

    function isVisible(style: CSSStyleDeclaration, rect: DOMRect): boolean {
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function contextFor(element: Element): DesignContext {
      const tag = element.tagName.toLowerCase();
      const role = (element.getAttribute("role") ?? "").toLowerCase();
      if (/^h[1-6]$/u.test(tag)) return "heading";
      if (tag === "button" || ["button", "tab", "switch", "menuitem"].includes(role)) {
        return "button";
      }
      if (
        ["input", "select", "textarea"].includes(tag) ||
        ["textbox", "searchbox", "combobox", "checkbox", "radio"].includes(role)
      ) {
        return "input";
      }
      if (tag === "a" || role === "link") return "link";
      if (["img", "picture", "video", "canvas", "svg"].includes(tag)) return "media";
      if (tag === "nav" || role === "navigation") return "navigation";
      if (["p", "li", "label", "blockquote", "figcaption"].includes(tag)) {
        return "body-text";
      }
      if (tag === "article" || role === "article") return "card";
      return "other";
    }

    function collectColor(
      raw: string,
      property: DesignColorProperty,
      context: DesignContext,
    ): void {
      const value = clipped(raw.trim(), 128);
      if (
        value.length === 0 ||
        value === "transparent" ||
        value === "rgba(0, 0, 0, 0)" ||
        !isSafeText(value)
      ) {
        return;
      }
      const currentValue = colors.get(value) ?? {
        count: 0,
        properties: new Set<DesignColorProperty>(),
        contexts: new Set<DesignContext>(),
      };
      currentValue.count += 1;
      currentValue.properties.add(property);
      currentValue.contexts.add(context);
      colors.set(value, currentValue);
    }

    function collectTypography(
      style: CSSStyleDeclaration,
      context: DesignContext,
    ): void {
      const fontFamily = clipped(style.fontFamily.trim(), 160);
      const fontSize = clipped(style.fontSize.trim(), 32);
      const fontWeight = clipped(style.fontWeight.trim(), 32);
      const lineHeight = clipped(style.lineHeight.trim(), 32);
      const letterSpacing = clipped(style.letterSpacing.trim(), 32);
      if (
        fontFamily.length === 0 ||
        fontSize.length === 0 ||
        ![fontFamily, fontSize, fontWeight, lineHeight, letterSpacing].every(isSafeText)
      ) {
        return;
      }
      const key = JSON.stringify([
        fontFamily,
        fontSize,
        fontWeight,
        lineHeight,
        letterSpacing,
      ]);
      const currentValue = typography.get(key) ?? {
        fontFamily,
        fontSize,
        fontWeight,
        lineHeight,
        letterSpacing,
        count: 0,
        contexts: new Set<DesignContext>(),
      };
      currentValue.count += 1;
      currentValue.contexts.add(context);
      typography.set(key, currentValue);
    }

    function collectSpacing(style: CSSStyleDeclaration): void {
      const values: readonly [DesignSpacingProperty, string][] = [
        ["margin-top", style.marginTop],
        ["margin-right", style.marginRight],
        ["margin-bottom", style.marginBottom],
        ["margin-left", style.marginLeft],
        ["padding-top", style.paddingTop],
        ["padding-right", style.paddingRight],
        ["padding-bottom", style.paddingBottom],
        ["padding-left", style.paddingLeft],
        ["row-gap", style.rowGap],
        ["column-gap", style.columnGap],
      ];
      for (const [property, raw] of values) {
        const value = clipped(raw.trim(), 32);
        const numeric = Number.parseFloat(value);
        if (
          value.length === 0 ||
          value === "normal" ||
          !Number.isFinite(numeric) ||
          numeric <= 0 ||
          !isSafeText(value)
        ) {
          continue;
        }
        const currentValue = spacing.get(value) ?? {
          count: 0,
          properties: new Set<DesignSpacingProperty>(),
        };
        currentValue.count += 1;
        currentValue.properties.add(property);
        spacing.set(value, currentValue);
      }
    }

    function collectStyle(
      target: Map<string, CountWithContexts>,
      value: string,
      context: DesignContext,
      ignored: readonly string[],
    ): void {
      if (
        value.length === 0 ||
        ignored.includes(value) ||
        !isSafeText(value)
      ) {
        return;
      }
      const currentValue = target.get(value) ?? {
        count: 0,
        contexts: new Set<DesignContext>(),
      };
      currentValue.count += 1;
      currentValue.contexts.add(context);
      target.set(value, currentValue);
    }

    function collectComponent(
      element: Element,
      style: CSSStyleDeclaration,
      rect: DOMRect,
      context: DesignContext,
    ): void {
      const kind = componentKind(element, context);
      if (kind === undefined) return;
      const componentStyle: DesignComponentStyle = {
        color: clipped(style.color.trim(), 128),
        backgroundColor: clipped(style.backgroundColor.trim(), 128),
        border: clipped(style.border.trim(), 256),
        borderRadius: clipped(style.borderRadius.trim(), 128),
        boxShadow: clipped(style.boxShadow.trim(), 256),
        fontFamily: clipped(style.fontFamily.trim(), 160),
        fontSize: clipped(style.fontSize.trim(), 32),
        fontWeight: clipped(style.fontWeight.trim(), 32),
        padding: clipped(style.padding.trim(), 128),
      };
      if (!Object.values(componentStyle).every(isSafeText)) return;
      const key = `${kind}\u0000${JSON.stringify(componentStyle)}`;
      const width = boundedMetric(rect.width, 100_000);
      const height = boundedMetric(rect.height, 100_000);
      const currentValue = components.get(key);
      if (currentValue === undefined) {
        components.set(key, {
          kind,
          count: 1,
          style: componentStyle,
          minWidth: width,
          maxWidth: width,
          minHeight: height,
          maxHeight: height,
        });
      } else {
        currentValue.count += 1;
        currentValue.minWidth = Math.min(currentValue.minWidth, width);
        currentValue.maxWidth = Math.max(currentValue.maxWidth, width);
        currentValue.minHeight = Math.min(currentValue.minHeight, height);
        currentValue.maxHeight = Math.max(currentValue.maxHeight, height);
      }
    }

    function collectLayout(
      element: Element,
      style: CSSStyleDeclaration,
      rect: DOMRect,
      context: DesignContext,
    ): void {
      const mode = layoutMode(style.display);
      const kind = layoutKind(element, mode, context);
      if (kind === undefined) return;
      if (layoutNodes.length >= maximumLayoutNodes) {
        warnings.add("layout_limit_reached");
        return;
      }
      const nodeId = layoutNodes.length;
      let parentNodeId: number | null = null;
      let ancestor = element.parentElement;
      while (ancestor !== null) {
        const candidate = layoutNodeIds.get(ancestor);
        if (candidate !== undefined) {
          parentNodeId = candidate;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      const columnCount =
        mode === "grid" ? countCssTracks(style.gridTemplateColumns) : 0;
      const axis: DesignLayoutAxis =
        mode === "flex"
          ? style.flexDirection.startsWith("column")
            ? "column"
            : "row"
          : mode === "grid"
            ? columnCount > 1
              ? "row"
              : "column"
            : "unknown";
      layoutNodes.push({
        nodeId,
        parentNodeId,
        kind,
        mode,
        position: layoutPosition(style.position),
        axis,
        rect: {
          x: boundedSignedMetric(rect.x, 100_000),
          y: boundedSignedMetric(rect.y, 100_000),
          width: boundedMetric(rect.width, 100_000),
          height: boundedMetric(rect.height, 100_000),
        },
        childElementCount: boundedMetric(element.children.length, 10_000),
        columnCount,
        gap: clipped(style.gap.trim(), 32),
        padding: clipped(style.padding.trim(), 128),
      });
      layoutNodeIds.set(element, nodeId);
    }

    function layoutKind(
      element: Element,
      mode: DesignLayoutMode,
      context: DesignContext,
    ): DesignLayoutKind | undefined {
      const tag = element.tagName.toLowerCase();
      const role = (element.getAttribute("role") ?? "").toLowerCase();
      if (tag === "header" || role === "banner") return "header";
      if (tag === "nav" || role === "navigation") return "navigation";
      if (tag === "main" || role === "main") return "main";
      if (tag === "section" || role === "region") return "section";
      if (tag === "footer" || role === "contentinfo") return "footer";
      if (tag === "aside" || role === "complementary") return "aside";
      if (tag === "form" || role === "form") return "form";
      if (tag === "dialog" || role === "dialog" || role === "alertdialog") {
        return "dialog";
      }
      if (tag === "ul" || tag === "ol" || role === "list") return "list";
      if (context === "card") return "card";
      return (mode === "flex" || mode === "grid") && element.children.length >= 2
        ? "container"
        : undefined;
    }

    function layoutMode(value: string): DesignLayoutMode {
      if (value === "flex" || value === "inline-flex") return "flex";
      if (value === "grid" || value === "inline-grid") return "grid";
      if (value === "block" || value === "flow-root" || value === "table") {
        return "block";
      }
      if (value.startsWith("inline")) return "inline";
      return "other";
    }

    function layoutPosition(value: string): DesignLayoutPosition {
      if (
        value === "static" ||
        value === "relative" ||
        value === "absolute" ||
        value === "fixed" ||
        value === "sticky"
      ) {
        return value;
      }
      return "other";
    }

    function countCssTracks(value: string): number {
      if (value.length === 0 || value === "none") return 0;
      let count = 0;
      let depth = 0;
      let inToken = false;
      for (const character of value) {
        if (character === "(" || character === "[") depth += 1;
        if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
        if (/\s/u.test(character) && depth === 0) {
          if (inToken) count += 1;
          inToken = false;
        } else {
          inToken = true;
        }
      }
      if (inToken) count += 1;
      return Math.min(count, 100);
    }

    function componentKind(
      element: Element,
      context: DesignContext,
    ): DesignComponentKind | undefined {
      if (context === "button") return "button";
      if (context === "input") return "input";
      if (context === "link") return "link";
      return element.tagName.toLowerCase() === "article" ? "card" : undefined;
    }

    function walkRules(rules: CSSRuleList): void {
      for (let index = 0; index < rules.length; index += 1) {
        if (inspectedRules >= maximumStyleSheetRules || outOfTime()) return;
        const rule = rules.item(index);
        if (rule === null) continue;
        inspectedRules += 1;
        if (rule instanceof CSSMediaRule) collectMediaQuery(rule.conditionText);
        const groupingRule = rule as CSSRule & { cssRules?: CSSRuleList };
        if (groupingRule.cssRules !== undefined) walkRules(groupingRule.cssRules);
      }
    }

    function outOfTime(): boolean {
      if (performance.now() - startedAt < timeBudgetMs) return false;
      timeBudgetReached = true;
      return true;
    }

    function collectMediaQuery(conditionText: string): void {
      const matcher = /(min|max)?-?width\s*:\s*(\d+(?:\.\d+)?)px/giu;
      for (const match of conditionText.matchAll(matcher)) {
        const valuePx = Number(match[2]);
        if (!Number.isFinite(valuePx) || valuePx < 1 || valuePx > 16_384) continue;
        const mode: DesignBreakpointMode =
          match[1]?.toLowerCase() === "min"
            ? "min"
            : match[1]?.toLowerCase() === "max"
              ? "max"
              : "exact";
        const currentValue = breakpoints.get(valuePx) ?? {
          count: 0,
          modes: new Set<DesignBreakpointMode>(),
        };
        currentValue.count += 1;
        currentValue.modes.add(mode);
        breakpoints.set(valuePx, currentValue);
      }
    }

    function topValues<TItem extends { count: number }, TResult>(
      source: Map<string, TItem>,
      maximum: number,
      convert: (key: string, item: TItem) => TResult,
    ): TResult[] {
      return [...source.entries()]
        .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
        .slice(0, maximum)
        .map(([key, item]) => convert(key, item));
    }

    function clipped(value: string, maximum: number): string {
      return value.slice(0, maximum);
    }

    function isSafeText(value: string): boolean {
      return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
    }

    function isSafeDesignVariableValue(name: string, value: string): boolean {
      if (
        value.length === 0 ||
        !isSafeText(value) ||
        /(?:url\s*\(|data:|https?:|javascript:|var\s*\(|@|[{};\\'"\[\]])/iu.test(
          value,
        ) ||
        !/^[a-zA-Z0-9#(),.%+\-/*\s_]+$/u.test(value)
      ) {
        return false;
      }
      const supports = globalThis.CSS?.supports;
      if (typeof supports !== "function") return false;
      if (
        /(?:color|background|surface|brand|accent|primary|secondary|foreground|text)/iu.test(
          name,
        )
      ) {
        return supports("color", value);
      }
      if (/shadow/iu.test(name)) return supports("box-shadow", value);
      if (/radius/iu.test(name)) return supports("border-radius", value);
      if (/border/iu.test(name)) return supports("border", value);
      if (/(?:space|spacing|gap|size|width|height)/iu.test(name)) {
        return supports("width", value);
      }
      return false;
    }

    function boundedMetric(value: unknown, maximum: number): number {
      return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, Math.min(maximum, Math.round(value)))
        : 0;
    }

    function boundedSignedMetric(value: unknown, maximum: number): number {
      return typeof value === "number" && Number.isFinite(value)
        ? Math.max(-maximum, Math.min(maximum, Math.round(value)))
        : 0;
    }

    function boundedNumber(
      value: unknown,
      minimum: number,
      maximum: number,
      fallback: number,
    ): number {
      return typeof value === "number" && Number.isFinite(value)
        ? Math.max(minimum, Math.min(maximum, value))
        : fallback;
    }
  } catch {
    return {
      status: "failed",
      analyzerVersion,
      warnings: [],
      errors: ["probe_runtime_failed"],
    };
  }

  function failed(
    error:
      | "origin_changed"
      | "path_changed"
      | "sensitive_path"
      | "probe_runtime_failed",
  ): DesignProbeResult {
    return {
      status: "failed",
      analyzerVersion,
      warnings: [],
      errors: [error],
    };
  }

  function inspectPath(pathname: string):
    | { ok: true; normalizedPathname: string }
    | { ok: false; reason: "path_changed" | "sensitive_path" } {
    if (
      pathname.length === 0 ||
      pathname.length > 8_192 ||
      !pathname.startsWith("/") ||
      pathname.includes("\\")
    ) {
      return { ok: false, reason: "path_changed" };
    }
    const decoded: string[] = [];
    try {
      for (const raw of pathname.split("/")) {
        if (raw.length === 0) continue;
        if (/%(?![0-9a-f]{2})/iu.test(raw)) {
          return { ok: false, reason: "path_changed" };
        }
        const part = decodeURIComponent(raw).normalize("NFKC");
        if (
          part.length === 0 ||
          part === "." ||
          part === ".." ||
          /[\u0000-\u001f\u007f\\/?#]/u.test(part) ||
          /%[0-9a-f]{2}/iu.test(part)
        ) {
          return { ok: false, reason: "path_changed" };
        }
        decoded.push(part.toLocaleLowerCase("en-US"));
      }
    } catch {
      return { ok: false, reason: "path_changed" };
    }
    const effective = [...decoded];
    if (/^[a-z]{2,3}(?:-(?:[a-z]{2}|[0-9]{3}))?$/u.test(effective[0] ?? "")) {
      effective.shift();
    }
    if (
      ["admin", "account", "checkout", "checkouts", "orders", "cart"].includes(
        effective[0] ?? "",
      )
    ) {
      return { ok: false, reason: "sensitive_path" };
    }
    return {
      ok: true,
      normalizedPathname: decoded.length === 0 ? "/" : `/${decoded.join("/")}`,
    };
  }
}
