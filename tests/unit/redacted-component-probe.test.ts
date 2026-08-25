import { afterEach, describe, expect, it, vi } from "vitest";

import {
  redactedComponentGraphProbe,
  readCaptureScrollPosition,
  readSettledCaptureCheckpoint,
  scrollCaptureCheckpoint,
} from "../../src/content/redacted-component-probe";

afterEach(() => vi.unstubAllGlobals());

describe("redacted component probe", () => {
  it("is closure-free and cannot emit identifiers, selectors, form values, or HTML", () => {
    const source = redactedComponentGraphProbe.toString();
    expect(source).not.toContain("MAX_SSW_DESIGN");
    expect(source).not.toMatch(/\.className\b|\.id\b|\.outerHTML\b|\.innerHTML\b/u);
    expect(source).not.toMatch(/getAttribute\(["'](?:class|id|value)["']\)/u);
    expect(source).not.toMatch(/querySelector|matches\s*\(|closest\s*\(/u);
    expect(source).not.toMatch(/\.value\b/u);
    expect(source).not.toMatch(/\.click\s*\(|\.focus\s*\(/u);
    expect(source).toContain('tag.includes("-")');
    expect(source).toContain('tag === "iframe"');
    expect(source).toContain('tag === "canvas"');
    expect(source).toContain('url.search = ""');
    expect(source).toContain('url.hash = ""');
    expect(source).toContain('acquisition: "reference-only"');
  });

  it("rejects a sensitive path before reading the DOM", () => {
    const reads: string[] = [];
    vi.stubGlobal("location", {
      origin: "https://example.test",
      pathname: "/CHECKOUT/",
    });
    vi.stubGlobal("document", new Proxy({}, {
      get(_target, property) {
        reads.push(String(property));
        throw new Error("DOM must not be read");
      },
    }));

    expect(redactedComponentGraphProbe({
      expectedOrigin: "https://example.test",
      expectedPathname: "/checkout",
    })).toEqual({ ok: false, reason: "sensitive_path" });
    expect(reads).toEqual([]);
  });

  it("returns explicit truncation before exceeding the component-graph time budget", () => {
    const element = {};
    vi.stubGlobal("location", {
      origin: "https://example.test",
      pathname: "/catalog/",
    });
    vi.stubGlobal("NodeFilter", { SHOW_ELEMENT: 1 });
    vi.stubGlobal("performance", { now: vi.fn().mockReturnValueOnce(0).mockReturnValue(8_001) });
    vi.stubGlobal("document", {
      documentElement: { scrollHeight: 7_313, clientHeight: 996 },
      scrollingElement: { scrollHeight: 7_313, clientHeight: 996 },
      body: { scrollHeight: 2_000 },
      createTreeWalker: () => ({ currentNode: element, nextNode: () => null }),
    });
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("devicePixelRatio", 2);
    vi.stubGlobal("scrollY", 0);
    vi.stubGlobal("getComputedStyle", vi.fn(() => {
      throw new Error("style access must not happen after the budget is exhausted");
    }));

    expect(redactedComponentGraphProbe({
      expectedOrigin: "https://example.test",
      expectedPathname: "/catalog",
    })).toMatchObject({
      ok: true,
      documentHeight: 7_161,
      nodes: [],
      privacyRegions: [],
      privacyTruncated: false,
      truncated: true,
    });
  });

  it("refuses to scroll if the page identity changed", () => {
    vi.stubGlobal("location", {
      origin: "https://example.test",
      pathname: "/changed",
    });
    expect(scrollCaptureCheckpoint({
      expectedOrigin: "https://example.test",
      expectedPathname: "/original",
      scrollY: 100,
      settleMs: 250,
    })).toEqual({ ok: false, reason: "page_changed" });
  });

  it("reads the physical scroll position without changing the page", () => {
    const scroll = vi.fn();
    vi.stubGlobal("location", {
      origin: "https://example.test",
      pathname: "/catalog/",
    });
    vi.stubGlobal("scrollY", 321);
    vi.stubGlobal("scrollTo", scroll);
    expect(readCaptureScrollPosition({
      expectedOrigin: "https://example.test",
      expectedPathname: "/catalog",
    })).toEqual({ ok: true, scrollY: 321 });
    expect(scroll).not.toHaveBeenCalled();
  });

  it("reads settled root-scroll coverage and detects the real bottom", () => {
    vi.stubGlobal("location", { origin: "https://example.test", pathname: "/catalog" });
    vi.stubGlobal("document", {
      documentElement: { scrollHeight: 7_313, clientHeight: 996 },
      scrollingElement: { scrollHeight: 7_313, clientHeight: 996 },
    });
    vi.stubGlobal("scrollY", 6_317.5);
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("devicePixelRatio", 2);
    expect(readSettledCaptureCheckpoint({
      expectedOrigin: "https://example.test",
      expectedPathname: "/catalog",
    })).toEqual({
      ok: true,
      scrollY: 6_317.5,
      width: 390,
      height: 844,
      devicePixelRatio: 2,
      documentHeight: 7_161,
      maximumScrollY: 6_317,
      atBottom: true,
    });
  });

  it("treats a trailing slash as the same path at a scroll checkpoint", () => {
    const scroll = vi.fn();
    vi.stubGlobal("location", {
      origin: "https://example.test",
      pathname: "/catalog/",
    });
    vi.stubGlobal("scrollTo", scroll);
    vi.stubGlobal("scrollY", 100);
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", 900);
    vi.stubGlobal("devicePixelRatio", 2);
    expect(scrollCaptureCheckpoint({
      expectedOrigin: "https://example.test",
      expectedPathname: "/catalog",
      scrollY: 100,
      settleMs: 250,
    })).toEqual({
      ok: true,
      scrollY: 100,
      width: 1440,
      height: 900,
      devicePixelRatio: 2,
    });
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("rejects unbounded settle requests without scrolling", () => {
    const scroll = vi.fn();
    vi.stubGlobal("location", {
      origin: "https://example.test",
      pathname: "/",
    });
    vi.stubGlobal("scrollTo", scroll);
    expect(scrollCaptureCheckpoint({
      expectedOrigin: "https://example.test",
      expectedPathname: "/",
      scrollY: 100,
      settleMs: 10_000,
    })).toEqual({ ok: false, reason: "invalid_request" });
    expect(scroll).not.toHaveBeenCalled();
  });
});
