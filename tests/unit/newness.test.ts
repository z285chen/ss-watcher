import { describe, expect, it } from "vitest";

import { analyzeProductNewness } from "../../src/core/analysis/newness";

describe("newness evidence grading", () => {
  it("assigns A-D evidence without confusing lastmod with launch date", () => {
    const result = analyzeProductNewness(
      [
        product("a", { createdAt: "2026-07-01T00:00:00Z", publishedAt: "2026-07-02T00:00:00Z" }),
        product("b", { publishedAt: "2026-06-01T00:00:00Z" }),
        product("d", { sitemapLastmod: "2026-07-20T00:00:00Z" }),
      ],
      {
        status: "completed",
        sortBy: "created-descending",
        scope: { kind: "all-storefront", handle: "all", url: `${origin}/collections/all` },
        items: [{ rank: 1, handle: "c", sourceUrl: `${origin}/collections/all` }],
        pagesScanned: 1,
        truncated: false,
        termination: "complete",
        disclaimer: "relative",
        errors: [],
      },
    );

    expect(result.status).toBe("completed");
    expect(result.candidates.map((candidate) => [candidate.handle, candidate.primaryGrade])).toEqual([
      ["a", "A"],
      ["b", "B"],
      ["c", "C"],
      ["d", "D"],
    ]);
    expect(result.candidates.at(-1)?.evidence[0]?.meaning).toContain("不等于上新日期");
  });

  it("labels C/D-only results as candidates", () => {
    const result = analyzeProductNewness([
      product("d", { sitemapLastmod: "2026-07-20T00:00:00Z" }),
    ]);
    expect(result).toMatchObject({
      status: "candidate-only",
      hasAbsoluteDateEvidence: false,
    });
  });
});

const origin = "https://store.example";

function product(handle: string, fields: Record<string, string>) {
  return {
    id: handle,
    handle,
    title: handle.toUpperCase(),
    tags: [],
    variants: [],
    images: [],
    sources: ["products-json" as const],
    ...fields,
  };
}
