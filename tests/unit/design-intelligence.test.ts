import { afterEach, describe, expect, it, vi } from "vitest";

import { designIntelligenceProbe } from "../../src/content/design-probe";
import {
  MAX_DESIGN_INTELLIGENCE_RESULT_BYTES,
  emptyDesignIntelligence,
  isDesignIntelligenceResult,
} from "../../src/core/design/design-intelligence";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("designIntelligenceProbe", () => {
  it("collects bounded aggregate styles without page text, input values, selectors, or interaction", () => {
    const fixture = installDesignDomFixture();

    const result = designIntelligenceProbe({
      expectedOrigin: "https://store.example",
      expectedPathname: "/products/widget",
    });

    expect(result.status).toBe("completed");
    if (result.status === "failed") throw new Error("expected successful probe");
    expect(result.capture).toMatchObject({
      origin: "https://store.example",
      pathname: "/products/widget",
      viewport: {
        width: 1_280,
        height: 720,
        devicePixelRatio: 2,
        colorScheme: "dark",
      },
    });
    expect(result.coverage).toMatchObject({
      visitedElements: fixture.elements.length,
      visibleElements: fixture.elements.length,
      sampledElements: fixture.elements.length,
      truncated: false,
      styleSheetsObserved: 1,
      styleSheetsReadable: 1,
      styleSheetsBlocked: 0,
    });
    expect(result.primitives.colors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "rgb(34, 34, 34)",
          properties: expect.arrayContaining(["color"]),
        }),
        expect.objectContaining({
          value: "rgb(102, 51, 153)",
          properties: expect.arrayContaining(["background-color"]),
        }),
      ]),
    );
    expect(result.primitives.typography).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fontFamily: "Inter, sans-serif",
          contexts: expect.arrayContaining(["button"]),
        }),
      ]),
    );
    expect(result.primitives.spacing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "16px",
          properties: expect.arrayContaining(["padding-left", "padding-right"]),
        }),
      ]),
    );
    expect(result.primitives.cssVariables).toEqual([
      { name: "--color-brand", value: "#663399", source: "computed-root" },
    ]);
    expect(result.primitives.breakpoints).toEqual([
      { valuePx: 768, count: 1, modes: ["min"] },
      { valuePx: 1024, count: 1, modes: ["max"] },
    ]);
    expect(result.components.map((component) => component.kind)).toEqual(
      expect.arrayContaining(["button", "input", "link", "card"]),
    );
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "button",
          sizeRange: {
            minWidth: 120,
            maxWidth: 120,
            minHeight: 40,
            maxHeight: 40,
          },
        }),
      ]),
    );
    expect(result.layout).toEqual([
      expect.objectContaining({
        nodeId: 0,
        parentNodeId: null,
        kind: "card",
        mode: "block",
        rect: { x: 0, y: 0, width: 120, height: 40 },
      }),
    ]);
    expect(result.warnings).toEqual([]);
    expect(
      isDesignIntelligenceResult(result, {
        origin: "https://store.example",
        pathname: "/products/widget",
      }),
    ).toBe(true);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("secret-input-value");
    expect(serialized).not.toContain("secret-class-name");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("customer-name");
    expect(fixture.mutationAttempts).toHaveLength(0);
  });

  it("returns a valid partial result when the synchronous time budget is exhausted", () => {
    let clockRead = 0;
    installDesignDomFixture({
      now: () => (clockRead++ === 0 ? 0 : 200),
    });

    const result = designIntelligenceProbe({
      expectedOrigin: "https://store.example",
      expectedPathname: "/products/widget",
    });

    expect(result).toMatchObject({
      status: "partial",
      coverage: {
        visitedElements: 0,
        sampledElements: 0,
        truncated: true,
      },
      warnings: ["time_budget_reached"],
      errors: [],
    });
    expect(
      isDesignIntelligenceResult(result, {
        origin: "https://store.example",
        pathname: "/products/widget",
      }),
    ).toBe(true);
  });

  it("rejects sensitive paths before reading any DOM or style state", () => {
    const accesses: string[] = [];
    vi.stubGlobal(
      "document",
      new Proxy(
        {},
        {
          get(_target, property) {
            accesses.push(String(property));
            throw new Error("DOM must not be read");
          },
        },
      ),
    );
    vi.stubGlobal("location", {
      origin: "https://store.example",
      pathname: "/EN-us/%61ccount",
    });

    expect(
      designIntelligenceProbe({
        expectedOrigin: "https://store.example",
        expectedPathname: "/en-us/account",
      }),
    ).toEqual({
      status: "failed",
      analyzerVersion: "computed-style-spike-v1",
      warnings: [],
      errors: ["sensitive_path"],
    });
    expect(accesses).toEqual([]);
  });

  it("fails only the design probe when browser style APIs throw", () => {
    vi.stubGlobal("location", {
      origin: "https://store.example",
      pathname: "/",
    });
    vi.stubGlobal("performance", { now: () => 0 });
    vi.stubGlobal("document", {
      documentElement: {},
      createTreeWalker: () => {
        throw new Error("hostile DOM API");
      },
    });

    expect(
      designIntelligenceProbe({
        expectedOrigin: "https://store.example",
        expectedPathname: "/",
      }),
    ).toEqual({
      status: "failed",
      analyzerVersion: "computed-style-spike-v1",
      warnings: [],
      errors: ["probe_runtime_failed"],
    });
  });

  it("is closure-free for chrome.scripting serialization", () => {
    const source = designIntelligenceProbe.toString();
    expect(source).not.toContain("DESIGN_INTELLIGENCE_ANALYZER_VERSION");
    expect(source).not.toContain("MAX_DESIGN_");
    expect(source).not.toContain("checkPublicPath");
    expect(source).not.toMatch(/\.(?:textContent|innerText|value|className|id)\b/u);
    expect(source).not.toMatch(
      /\.(?:click|focus|scrollIntoView|setAttribute|append|remove)\s*\(/u,
    );
    expect(source).not.toContain("querySelector");
  });
});

describe("DesignIntelligenceResult contract", () => {
  it("accepts a bounded failed result", () => {
    expect(isDesignIntelligenceResult(emptyDesignIntelligence("probe_injection_failed"))).toBe(
      true,
    );
  });

  it("rejects capture mismatches, extra fields, unsafe variables, and oversized payloads", () => {
    const result = successfulResult();
    expect(
      isDesignIntelligenceResult(result, {
        origin: "https://store.example",
        pathname: "/",
      }),
    ).toBe(true);
    expect(
      isDesignIntelligenceResult(result, {
        origin: "https://other.example",
        pathname: "/",
      }),
    ).toBe(false);
    expect(isDesignIntelligenceResult({ ...result, unexpected: true })).toBe(false);
    expect(
      isDesignIntelligenceResult({
        ...result,
        primitives: {
          ...result.primitives,
          cssVariables: [
            {
              name: "--background-image",
              value: "url(https://store.example/private?token=secret)",
              source: "computed-root",
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      isDesignIntelligenceResult({
        ...result,
        components: [
          {
            kind: "card",
            count: 1,
            style: {
              color: "x".repeat(MAX_DESIGN_INTELLIGENCE_RESULT_BYTES),
              backgroundColor: "",
              border: "",
              borderRadius: "",
              boxShadow: "",
              fontFamily: "",
              fontSize: "",
              fontWeight: "",
              padding: "",
            },
            sizeRange: {
              minWidth: 0,
              maxWidth: 0,
              minHeight: 0,
              maxHeight: 0,
            },
          },
        ],
      }),
    ).toBe(false);
  });
});

function successfulResult() {
  return {
    status: "completed" as const,
    analyzerVersion: "computed-style-spike-v1" as const,
    capture: {
      origin: "https://store.example",
      pathname: "/",
      capturedAt: "2026-08-12T00:00:00.000Z",
      viewport: {
        width: 1_280,
        height: 720,
        devicePixelRatio: 2,
        colorScheme: "light" as const,
      },
    },
    coverage: {
      visitedElements: 10,
      visibleElements: 8,
      sampledElements: 8,
      visitLimit: 5_000,
      elementLimit: 1_500,
      truncated: false,
      styleSheetsObserved: 2,
      styleSheetsReadable: 1,
      styleSheetsBlocked: 1,
      openShadowRoots: 0,
      durationMs: 12.5,
    },
    layout: [],
    primitives: {
      colors: [],
      typography: [],
      spacing: [],
      radii: [],
      shadows: [],
      cssVariables: [],
      breakpoints: [],
    },
    components: [],
    warnings: [],
    errors: [],
  };
}

function installDesignDomFixture(options: { now?: () => number } = {}) {
  class FakeMediaRule {
    readonly cssRules = ruleList([]);

    constructor(readonly conditionText: string) {}
  }

  const mutationAttempts: string[] = [];
  const elements = [
    element("HTML", "other", mutationAttempts, "private@example.test"),
    element("BUTTON", "button", mutationAttempts, "Buy now"),
    element("P", "body", mutationAttempts, "private@example.test"),
    element("INPUT", "textbox", mutationAttempts, "secret-input-value"),
    element("A", "link", mutationAttempts, "Account"),
    element("ARTICLE", "article", mutationAttempts, "Customer order"),
  ];
  const styles = new Map<object, CSSStyleDeclaration>();
  styles.set(
    elements[0]!,
    style(
      {
        color: "rgb(34, 34, 34)",
        backgroundColor: "rgb(255, 255, 255)",
      },
      {
        "--color-brand": "#663399",
        "--background-image":
          'url("https://store.example/private.png?token=secret")',
        "--customer-name": "private@example.test",
        "--font-family": "Secret Customer Name",
      },
    ),
  );
  styles.set(
    elements[1]!,
    style({
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(102, 51, 153)",
      border: "1px solid rgb(102, 51, 153)",
      borderColor: "rgb(102, 51, 153)",
      borderRadius: "8px",
      boxShadow: "rgba(0, 0, 0, 0.2) 0px 2px 8px 0px",
      padding: "8px 16px",
      paddingTop: "8px",
      paddingRight: "16px",
      paddingBottom: "8px",
      paddingLeft: "16px",
      fontWeight: "600",
    }),
  );
  styles.set(elements[2]!, style({ marginBottom: "16px" }));
  styles.set(
    elements[3]!,
    style({ border: "1px solid rgb(204, 204, 204)", borderRadius: "6px" }),
  );
  styles.set(elements[4]!, style({ color: "rgb(102, 51, 153)" }));
  styles.set(
    elements[5]!,
    style({
      border: "1px solid rgb(230, 230, 230)",
      borderRadius: "12px",
      padding: "16px",
      paddingTop: "16px",
      paddingRight: "16px",
      paddingBottom: "16px",
      paddingLeft: "16px",
    }),
  );

  const mediaRules = ruleList([
    new FakeMediaRule("(min-width: 768px)"),
    new FakeMediaRule("screen and (max-width: 1024px)"),
  ]);
  const sheet = { cssRules: mediaRules };
  let treeIndex = 0;

  vi.stubGlobal("CSSMediaRule", FakeMediaRule);
  vi.stubGlobal("NodeFilter", { SHOW_ELEMENT: 1 });
  vi.stubGlobal("location", {
    origin: "https://store.example",
    pathname: "/Products/Widget",
  });
  vi.stubGlobal("performance", { now: options.now ?? (() => 10) });
  vi.stubGlobal("innerWidth", 1_280);
  vi.stubGlobal("innerHeight", 720);
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("CSS", {
    supports: (property: string, value: string) =>
      property === "color"
        ? /^(?:#[0-9a-f]{3,8}|rgba?\()/iu.test(value)
        : /\d/u.test(value),
  });
  vi.stubGlobal("getComputedStyle", (target: object) => styles.get(target));
  vi.stubGlobal("document", {
    documentElement: elements[0],
    createTreeWalker: () => ({
      currentNode: elements[0],
      nextNode: () => {
        treeIndex += 1;
        return elements[treeIndex] ?? null;
      },
    }),
    styleSheets: {
      length: 1,
      item: (index: number) => (index === 0 ? sheet : null),
    },
  });

  return { elements, mutationAttempts };
}

function element(
  tagName: string,
  role: string,
  mutationAttempts: string[],
  textContent: string,
) {
  return {
    tagName,
    role,
    className: "secret-class-name",
    textContent,
    value: textContent,
    shadowRoot: null,
    parentElement: null,
    children: { length: 0 },
    getAttribute: (name: string) => (name === "role" ? role : null),
    getBoundingClientRect: () => ({ width: 120, height: 40 }),
    setAttribute: () => mutationAttempts.push("setAttribute"),
    click: () => mutationAttempts.push("click"),
    focus: () => mutationAttempts.push("focus"),
  };
}

function style(
  overrides: Partial<CSSStyleDeclaration> = {},
  variables: Record<string, string> = {},
): CSSStyleDeclaration {
  const variableNames = Object.keys(variables);
  return {
    display: "block",
    visibility: "visible",
    opacity: "1",
    color: "rgb(34, 34, 34)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderColor: "rgb(0, 0, 0)",
    outlineColor: "rgb(0, 0, 0)",
    border: "0px none rgb(0, 0, 0)",
    borderRadius: "0px",
    boxShadow: "none",
    fontFamily: "Inter, sans-serif",
    fontSize: "16px",
    fontWeight: "400",
    lineHeight: "24px",
    letterSpacing: "normal",
    marginTop: "0px",
    marginRight: "0px",
    marginBottom: "0px",
    marginLeft: "0px",
    padding: "0px",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
    rowGap: "normal",
    columnGap: "normal",
    gap: "normal",
    position: "static",
    flexDirection: "row",
    gridTemplateColumns: "none",
    length: variableNames.length,
    item: (index: number) => variableNames[index] ?? "",
    getPropertyValue: (name: string) => variables[name] ?? "",
    ...overrides,
  } as CSSStyleDeclaration;
}

function ruleList(values: readonly unknown[]): CSSRuleList {
  return {
    length: values.length,
    item: (index: number) => (values[index] ?? null) as CSSRule | null,
    [Symbol.iterator]: function* () {
      yield* values as CSSRule[];
    },
  } as CSSRuleList;
}
