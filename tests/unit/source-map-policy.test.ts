import { describe, expect, it } from "vitest";

import {
  inspectSourceMapReference,
  inspectSourceMapText,
} from "../../src/core/frontend/source-map-policy";

describe("source map policy", () => {
  it("classifies same-origin and cross-origin external references without fetching", () => {
    expect(
      inspectSourceMapReference(
        "//# sourceMappingURL=theme.js.map",
        "https://store.example/assets/theme.js",
      ),
    ).toEqual({
      status: "external",
      url: "https://store.example/assets/theme.js.map",
      originRelation: "same-origin",
    });
    expect(
      inspectSourceMapReference(
        "//# sourceMappingURL=https://cdn.example/theme.js.map",
        "https://store.example/assets/theme.js",
      ),
    ).toMatchObject({ status: "external", originRelation: "cross-origin" });
  });

  it("accepts a bounded inline map summary but never returns sourcesContent", () => {
    const map = JSON.stringify({
      version: 3,
      sources: ["src/theme.ts"],
      names: ["boot"],
      mappings: "AAAA",
      sourcesContent: ["const secretRawSource = true"],
    });
    const encoded = btoa(map);
    const result = inspectSourceMapReference(
      `//# sourceMappingURL=data:application/json;base64,${encoded}`,
      "https://store.example/assets/theme.js",
    );
    expect(result).toEqual({
      status: "inline",
      sourceCount: 1,
      nameCount: 1,
      hasSourcesContent: true,
    });
    expect(JSON.stringify(result)).not.toContain("secretRawSource");
  });

  it.each([
    [{ version: 3, sources: ["file:///Users/person/theme.ts"], names: [] }, "local_path"],
    [{ version: 3, sources: ["/Users/person/theme.ts"], names: [] }, "local_path"],
    [{ version: 3, sources: ["https://other.example/theme.ts"], names: [] }, "cross_origin_source"],
    [{ version: 3, sources: ["webpack://src/theme.ts"], names: [] }, "unsupported_scheme"],
  ])("rejects unsafe map sources", (map, reason) => {
    expect(
      inspectSourceMapText(
        JSON.stringify({ ...map, mappings: "" }),
        "https://store.example/assets/theme.js.map",
      ),
    ).toEqual({ status: "rejected", reason });
  });
});
