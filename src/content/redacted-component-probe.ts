import type {
  EvidenceAsset,
  EvidenceDynamicRegion,
  EvidenceNode,
} from "../core/design/evidence-package";

export type RedactedComponentProbeResult =
  | Readonly<{
      ok: true;
      origin: string;
      pathname: string;
      capturedAt: string;
      viewport: Readonly<{ width: number; height: number; devicePixelRatio: number }>;
      documentHeight: number;
      scrollY: number;
      nodes: readonly EvidenceNode[];
      dynamicRegions: readonly EvidenceDynamicRegion[];
      privacyRegions: readonly Readonly<{
        rect: Readonly<{ x: number; y: number; width: number; height: number }>;
        kind: "text" | "control" | "opaque-content";
      }>[];
      privacyTruncated: boolean;
      assets: readonly EvidenceAsset[];
      truncated: boolean;
    }>
  | Readonly<{
      ok: false;
      reason: "origin_changed" | "path_changed" | "sensitive_path" | "probe_runtime_failed";
    }>;

/**
 * Closure-free MAIN document probe. It emits only geometry, semantic classes,
 * selected styles, and visible-text length/purpose. It never emits page copy,
 * form values, DOM identifiers, class names, selectors, or HTML.
 */
export function redactedComponentGraphProbe(input: Readonly<{
  expectedOrigin: string;
  expectedPathname: string;
}>): RedactedComponentProbeResult {
  const maximumNodes = 4_000;
  const maximumDynamicRegions = 100;
  const maximumProbeMs = 8_000;
  const sensitiveRoots = new Set(["account", "admin", "checkout", "checkouts", "orders", "order", "cart", "payments", "payment"]);
  try {
    if (location.origin !== input.expectedOrigin) return { ok: false, reason: "origin_changed" };
    const normalizedActualPath = normalizePath(location.pathname);
    const normalizedExpectedPath = normalizePath(input.expectedPathname);
    if (normalizedActualPath !== normalizedExpectedPath) return { ok: false, reason: "path_changed" };
    const firstSegment = normalizedActualPath.split("/").filter(Boolean)[0]?.toLowerCase();
    if (firstSegment !== undefined && sensitiveRoots.has(firstSegment)) return { ok: false, reason: "sensitive_path" };

    const nodes: EvidenceNode[] = [];
    const dynamicRegions: EvidenceDynamicRegion[] = [];
    const privacyRegions: Array<{
      rect: { x: number; y: number; width: number; height: number };
      kind: "text" | "control" | "opaque-content";
    }> = [];
    const assets: EvidenceAsset[] = [];
    const assetNumbers = new Map<string, number>();
    const nodeNumbers = new Map<Element, number>();
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    let candidate = walker.currentNode as Element | null;
    let truncated = false;
    let privacyTruncated = false;
    const deadline = performance.now() + maximumProbeMs;
    while (candidate !== null) {
      if (performance.now() >= deadline) { truncated = true; break; }
      const element = candidate;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (isRendered(style, rect)) {
        if (nodes.length >= maximumNodes) { truncated = true; break; }
        const parentNodeNumber = nearestParentNumber(element.parentElement);
        const role = semanticRole(element);
        const nodeNumber = nodes.length;
        const tag = safeTag(element.localName);
        nodes.push({
          nodeNumber,
          parentNodeNumber,
          tag,
          role,
          textPurpose: textPurpose(tag, role),
          textLength: visibleTextLength(element),
          rect: {
            x: round(rect.left + scrollX),
            y: round(rect.top + scrollY),
            width: round(rect.width),
            height: round(rect.height),
          },
          style: {
            display: safeStyle(style.display),
            position: safeStyle(style.position),
            color: safeStyle(style.color),
            backgroundColor: safeStyle(style.backgroundColor),
            border: safeStyle(style.border),
            borderRadius: safeStyle(style.borderRadius),
            boxShadow: safeStyle(style.boxShadow),
            fontFamily: safeStyle(style.fontFamily),
            fontSize: safeStyle(style.fontSize),
            fontWeight: safeStyle(style.fontWeight),
            lineHeight: safeStyle(style.lineHeight),
            letterSpacing: safeStyle(style.letterSpacing),
            padding: safeStyle(style.padding),
            gap: safeStyle(style.gap),
          },
        });
        nodeNumbers.set(element, nodeNumber);
        recordAsset(element, tag, nodeNumber);
        recordPrivacyRegions(element, rect);
        if (dynamicRegions.length < maximumDynamicRegions) {
          const dynamic = dynamicRegion(element, style, rect, dynamicRegions.length);
          if (dynamic !== null) dynamicRegions.push(dynamic);
        }
      }
      candidate = walker.nextNode() as Element | null;
    }
    const scrollingRoot = document.scrollingElement ?? document.documentElement;
    return {
      ok: true,
      origin: location.origin,
      pathname: normalizedActualPath,
      capturedAt: new Date().toISOString(),
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      // Evidence coverage uses the range reachable by window.scrollTo plus the
      // screenshot viewport. Under CDP emulation the root clientHeight can be
      // larger than innerHeight; raw scrollHeight would then overstate the
      // capturable bottom even when the root scrollbar is fully at its end.
      documentHeight: Math.max(
        innerHeight,
        scrollingRoot.scrollHeight - scrollingRoot.clientHeight + innerHeight,
      ),
      scrollY,
      nodes,
      dynamicRegions,
      privacyRegions,
      privacyTruncated,
      assets,
      truncated,
    };

    function nearestParentNumber(parent: Element | null): number | null {
      let current = parent;
      while (current !== null) {
        const number = nodeNumbers.get(current);
        if (number !== undefined) return number;
        current = current.parentElement;
      }
      return null;
    }
    function isRendered(style: CSSStyleDeclaration, rect: DOMRect): boolean {
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    }
    function semanticRole(element: Element): EvidenceNode["role"] {
      const explicit = element.getAttribute("role")?.toLowerCase() ?? "";
      const allowed = ["banner", "navigation", "main", "region", "contentinfo", "complementary", "form", "dialog", "list", "listitem", "heading", "paragraph", "link", "button", "textbox", "img", "video", "presentation", "generic"];
      if (allowed.includes(explicit)) return explicit as EvidenceNode["role"];
      switch (element.localName) {
        case "header": return "banner"; case "nav": return "navigation"; case "main": return "main";
        case "section": return "region"; case "footer": return "contentinfo"; case "aside": return "complementary";
        case "form": return "form"; case "dialog": return "dialog"; case "ul": case "ol": return "list";
        case "li": return "listitem"; case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
        case "p": return "paragraph"; case "a": return "link"; case "button": return "button";
        case "input": case "textarea": return "textbox"; case "img": case "picture": return "img"; case "video": return "video";
        default: return "generic";
      }
    }
    function textPurpose(tag: string, role: EvidenceNode["role"]): EvidenceNode["textPurpose"] {
      if (role === "heading") return "heading";
      if (role === "button" || role === "link" || role === "textbox") return "action";
      if (role === "paragraph") return "body";
      if (tag === "small" || tag === "time") return "metadata";
      return "none";
    }
    function visibleTextLength(element: Element): number {
      if (element.localName === "input" || element.localName === "textarea" || element.localName === "select") return 0;
      const text = element.textContent;
      return text === null ? 0 : Math.min(100_000, text.trim().replace(/\s+/gu, " ").length);
    }
    function dynamicRegion(element: Element, style: CSSStyleDeclaration, rect: DOMRect, regionNumber: number): EvidenceDynamicRegion | null {
      const roleDescription = element.getAttribute("aria-roledescription")?.toLowerCase();
      const isCarousel = roleDescription === "carousel" || element.getAttribute("aria-live") === "polite";
      const isVideo = element.localName === "video";
      const animations = element.getAnimations().filter((animation) => animation.playState === "running");
      if (!isCarousel && !isVideo && animations.length === 0) return null;
      const itemCountText = element.getAttribute("aria-setsize");
      const itemPositionText = element.getAttribute("aria-posinset");
      return {
        regionNumber,
        rect: { x: round(rect.left + scrollX), y: round(rect.top + scrollY), width: round(rect.width), height: round(rect.height) },
        currentItem: positiveInteger(itemPositionText),
        itemCount: positiveInteger(itemCountText),
        behavior: isCarousel ? "carousel" : isVideo ? "video" : "animation",
        pixelPolicy: "mask-content",
      };
    }
    function recordPrivacyRegions(element: Element, elementRect: DOMRect): void {
      const maximumPrivacyRegions = 12_000;
      if (privacyRegions.length >= maximumPrivacyRegions) { privacyTruncated = true; return; }
      const tag = element.localName;
      if (tag === "input" || tag === "textarea" || tag === "select") {
        pushPrivacyRect(elementRect, "control");
        return;
      }
      // Cross-origin frames, canvases, and closed component internals cannot be
      // inspected safely for visible copy or form state. Mask the opaque pixel
      // surface rather than making an unverifiable privacy claim.
      if (tag === "iframe" || tag === "canvas" || element.shadowRoot !== null || tag.includes("-")) {
        pushPrivacyRect(elementRect, "opaque-content");
        return;
      }
      for (const child of element.childNodes) {
        if (privacyRegions.length >= maximumPrivacyRegions) { privacyTruncated = true; break; }
        if (child.nodeType !== Node.TEXT_NODE || (child.textContent ?? "").trim().length === 0) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const textRect of range.getClientRects()) {
          pushPrivacyRect(textRect, "text");
          if (privacyRegions.length >= maximumPrivacyRegions) { privacyTruncated = true; break; }
        }
        range.detach();
      }
      const before = getComputedStyle(element, "::before").content;
      const after = getComputedStyle(element, "::after").content;
      if (hasGeneratedText(before) || hasGeneratedText(after)) pushPrivacyRect(elementRect, "text");
    }
    function pushPrivacyRect(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, kind: "text" | "control" | "opaque-content"): void {
      if (rect.width <= 0 || rect.height <= 0) return;
      privacyRegions.push({
        rect: {
          x: round(rect.left + scrollX),
          y: round(rect.top + scrollY),
          width: round(rect.width),
          height: round(rect.height),
        },
        kind,
      });
    }
    function hasGeneratedText(value: string): boolean {
      return value !== "none" && value !== "normal" && value !== "" && value !== "\"\"" && value !== "''";
    }
    function recordAsset(element: Element, tag: string, nodeNumber: number): void {
      if (assets.length >= 1_000) return;
      let rawUrl = "";
      let kind: EvidenceAsset["kind"] = "image";
      let width: number | null = null;
      let height: number | null = null;
      if (tag === "img") {
        const image = element as HTMLImageElement;
        rawUrl = image.currentSrc || image.src;
        width = positiveDimension(image.naturalWidth);
        height = positiveDimension(image.naturalHeight);
      } else if (tag === "video") {
        const video = element as HTMLVideoElement;
        rawUrl = video.currentSrc || video.poster || video.src;
        kind = "video";
        width = positiveDimension(video.videoWidth);
        height = positiveDimension(video.videoHeight);
      } else {
        return;
      }
      const url = sanitizedAssetUrl(rawUrl);
      if (url === null) return;
      const key = `${kind}:${url}`;
      const existingNumber = assetNumbers.get(key);
      if (existingNumber !== undefined) {
        const existing = assets[existingNumber];
        if (existing !== undefined && existing.usageNodeNumbers.length < 100 && !existing.usageNodeNumbers.includes(nodeNumber)) {
          assets[existingNumber] = { ...existing, usageNodeNumbers: [...existing.usageNodeNumbers, nodeNumber] };
        }
        return;
      }
      const assetNumber = assets.length;
      assetNumbers.set(key, assetNumber);
      assets.push({ assetNumber, kind, url, width, height, usageNodeNumbers: [nodeNumber], acquisition: "reference-only" });
    }
    function sanitizedAssetUrl(value: string): string | null {
      if (value.length === 0 || value.length > 2_048) return null;
      try {
        const url = new URL(value, location.href);
        if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) return null;
        url.search = "";
        url.hash = "";
        return url.href;
      } catch { return null; }
    }
    function positiveDimension(value: number): number | null {
      return Number.isSafeInteger(value) && value > 0 && value <= 100_000 ? value : null;
    }
    function positiveInteger(value: string | null): number | null { const parsed = value === null ? NaN : Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
    function safeTag(value: string): string { return /^[a-z][a-z0-9-]{0,31}$/u.test(value) ? value : "div"; }
    function safeStyle(value: string): string { return value.length <= 160 && !/[<>\n\r]/u.test(value) && !/url\s*\(/iu.test(value) ? value : ""; }
    function round(value: number): number { return Math.round(value * 10) / 10; }
    function normalizePath(pathname: string): string {
      let decoded = pathname;
      try { decoded = decodeURIComponent(pathname); } catch { return "/__invalid_path__"; }
      const segments = decoded.replace(/\\/gu, "/").split("/").filter(Boolean).map((segment) => segment.toLowerCase());
      return `/${segments.join("/")}`;
    }
  } catch {
    return { ok: false, reason: "probe_runtime_failed" };
  }
}

export function scrollCaptureCheckpoint(input: Readonly<{
  expectedOrigin: string;
  expectedPathname: string;
  scrollY: number;
  settleMs: number;
}>): Readonly<{ ok: true; scrollY: number; width: number; height: number; devicePixelRatio: number }> | Readonly<{ ok: false; reason: string }> {
  try {
    if (
      location.origin !== input.expectedOrigin ||
      normalizePath(location.pathname) !== normalizePath(input.expectedPathname)
    ) return { ok: false, reason: "page_changed" };
    if (!Number.isFinite(input.scrollY) || input.scrollY < 0 || !Number.isFinite(input.settleMs) || input.settleMs < 0 || input.settleMs > 2_000) return { ok: false, reason: "invalid_request" };
    scrollTo({ top: input.scrollY, left: 0, behavior: "instant" });
    return { ok: true, scrollY, width: innerWidth, height: innerHeight, devicePixelRatio };
  } catch { return { ok: false, reason: "scroll_failed" }; }

  function normalizePath(pathname: string): string {
    let decoded = pathname;
    try { decoded = decodeURIComponent(pathname); } catch { return "/__invalid_path__"; }
    const segments = decoded.replace(/\\/gu, "/").split("/").filter(Boolean).map((segment) => segment.toLowerCase());
    return `/${segments.join("/")}`;
  }
}

export function readSettledCaptureCheckpoint(input: Readonly<{
  expectedOrigin: string;
  expectedPathname: string;
}>): Readonly<{
  ok: true;
  scrollY: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  documentHeight: number;
  maximumScrollY: number;
  atBottom: boolean;
}> | Readonly<{ ok: false; reason: string }> {
  try {
    if (
      location.origin !== input.expectedOrigin ||
      normalizePath(location.pathname) !== normalizePath(input.expectedPathname)
    ) return { ok: false, reason: "page_changed" };
    const scrollingRoot = document.scrollingElement ?? document.documentElement;
    const maximumScrollY = Math.max(0, scrollingRoot.scrollHeight - scrollingRoot.clientHeight);
    return {
      ok: true,
      scrollY,
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
      documentHeight: Math.max(innerHeight, maximumScrollY + innerHeight),
      maximumScrollY,
      atBottom: scrollY + 1 >= maximumScrollY,
    };
  } catch {
    return { ok: false, reason: "checkpoint_failed" };
  }

  function normalizePath(pathname: string): string {
    let decoded = pathname;
    try { decoded = decodeURIComponent(pathname); } catch { return "/__invalid_path__"; }
    const segments = decoded.replace(/\\/gu, "/").split("/").filter(Boolean).map((segment) => segment.toLowerCase());
    return `/${segments.join("/")}`;
  }
}

export function readCaptureScrollPosition(input: Readonly<{
  expectedOrigin: string;
  expectedPathname: string;
}>): Readonly<{ ok: true; scrollY: number }> | Readonly<{ ok: false; reason: string }> {
  try {
    if (
      location.origin !== input.expectedOrigin ||
      normalizePath(location.pathname) !== normalizePath(input.expectedPathname)
    ) return { ok: false, reason: "page_changed" };
    return { ok: true, scrollY };
  } catch {
    return { ok: false, reason: "position_failed" };
  }

  function normalizePath(pathname: string): string {
    let decoded = pathname;
    try { decoded = decodeURIComponent(pathname); } catch { return "/__invalid_path__"; }
    const segments = decoded.replace(/\\/gu, "/").split("/").filter(Boolean).map((segment) => segment.toLowerCase());
    return `/${segments.join("/")}`;
  }
}
