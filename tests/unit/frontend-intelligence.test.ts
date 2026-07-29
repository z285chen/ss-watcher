import { describe, expect, it } from "vitest";

import {
  collectFrontendIntelligence,
} from "../../src/core/frontend/frontend-intelligence";
import type {
  ResourceDescriptor,
  ResourceFetchResult,
} from "../../src/core/frontend/resource-types";

describe("Frontend Intelligence", () => {
  it("analyzes bounded transient text, emits evidence, and persists no source body", async () => {
    const resources = [
      descriptor(1, "https://store.example/cdn/shop/t/1/assets/theme.js", "script"),
      descriptor(
        2,
        "https://www.googletagmanager.com/gtag/js",
        "script",
        "cross-origin",
      ),
    ];
    let active = 0;
    let maximumActive = 0;
    const result = await collectFrontendIntelligence(
      resources,
      async (resourceId): Promise<ResourceFetchResult> => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        const current = resources.find((resource) => resource.resourceId === resourceId);
        if (current === undefined) throw new Error("missing fixture");
        const text = [
          "Shopify.theme = { name: 'Fixture' };",
          "const endpoint = '/cart.js';",
          "gtag('config', 'G-TEST');",
          "//# sourceMappingURL=theme.js.map",
          "RAW_BODY_SENTINEL",
        ].join("\n");
        return {
          ok: true,
          resourceId,
          descriptor: {
            ...current,
            fetchStatus: "analyzed",
            contentType: "text/javascript",
            byteLength: new TextEncoder().encode(text).byteLength,
            sha256: "a".repeat(64),
          },
          text,
        };
      },
    );

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(result.summary).toMatchObject({
      totalResources: 2,
      analyzedResources: 1,
      crossOriginResources: 1,
      metadataOnlyResources: 1,
    });
    expect(result.findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining(["theme", "api-reference", "pixel", "source-map"]),
    );
    expect(JSON.stringify(result)).not.toContain("RAW_BODY_SENTINEL");
    expect(result.resources[1]).toMatchObject({ fetchStatus: "metadata-only" });
  });

  it("marks overflow bodies skipped without failing already analyzed resources", async () => {
    const resources = [
      descriptor(1, "https://store.example/one.js", "script"),
      descriptor(2, "https://store.example/two.js", "script"),
    ];
    const result = await collectFrontendIntelligence(
      resources,
      async (resourceId) => {
        const current = resources.find((resource) => resource.resourceId === resourceId)!;
        return {
          ok: true as const,
          resourceId,
          descriptor: {
            ...current,
            fetchStatus: "analyzed" as const,
            contentType: "text/javascript",
            byteLength: 8,
            sha256: "b".repeat(64),
          },
          text: "const x=1",
        };
      },
      { maximumBodies: 1 },
    );
    expect(result.status).toBe("partial");
    expect(result.summary).toMatchObject({
      failedResources: 0,
      skippedResources: 1,
      failureReasons: { budget_exceeded: 1 },
    });
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fetchStatus: "analyzed" }),
        expect.objectContaining({
          fetchStatus: "skipped",
          failureReason: "budget_exceeded",
        }),
      ]),
    );
  });

  it("analyzes a SW-registered external map within the same body budget", async () => {
    const parent = descriptor(
      1,
      "https://store.example/assets/theme.js",
      "script",
    );
    const derived: ResourceDescriptor = {
      resourceId: "00000000-0000-4000-8000-000000000002",
      url: "https://store.example/assets/theme.js.map",
      originRelation: "same-origin",
      kind: "source-map",
      queryPolicy: "none",
      sources: ["source-map-reference"],
      derivedFromResourceId: parent.resourceId,
      fetchStatus: "pending",
    };
    const requested: string[] = [];
    const result = await collectFrontendIntelligence([parent], async (resourceId) => {
      requested.push(resourceId);
      const current = resourceId === parent.resourceId ? parent : derived;
      const text =
        resourceId === parent.resourceId
          ? "const theme = true;\n//# sourceMappingURL=theme.js.map"
          : JSON.stringify({
              version: 3,
              sources: ["src/theme.ts"],
              names: ["theme"],
              mappings: "AAAA",
              sourcesContent: ["RAW_MAP_SOURCE_SENTINEL"],
            });
      return {
        ok: true as const,
        resourceId,
        descriptor: {
          ...current,
          fetchStatus: "analyzed" as const,
          contentType:
            resourceId === parent.resourceId
              ? "text/javascript"
              : "application/json",
          byteLength: new TextEncoder().encode(text).byteLength,
          sha256: "c".repeat(64),
        },
        text,
        ...(resourceId === parent.resourceId
          ? { derivedResources: [derived] }
          : {}),
      };
    });

    expect(requested).toEqual([parent.resourceId, derived.resourceId]);
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: derived.resourceId,
          kind: "source-map",
          fetchStatus: "analyzed",
          derivedFromResourceId: parent.resourceId,
        }),
      ]),
    );
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "source-map",
          label: "source map 已验证 · 1 sources",
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("RAW_MAP_SOURCE_SENTINEL");
  });

  it("keeps an unavailable Source Map as low-impact evidence instead of downgrading core analysis", async () => {
    const parent = descriptor(
      1,
      "https://store.example/assets/theme.js",
      "script",
    );
    const derived: ResourceDescriptor = {
      resourceId: "00000000-0000-4000-8000-000000000004",
      url: "https://store.example/assets/theme.js.map",
      originRelation: "same-origin",
      kind: "source-map",
      queryPolicy: "none",
      sources: ["source-map-reference"],
      derivedFromResourceId: parent.resourceId,
      fetchStatus: "pending",
    };

    const result = await collectFrontendIntelligence([parent], async (resourceId) => {
      if (resourceId === parent.resourceId) {
        const text = "const theme = true;\n//# sourceMappingURL=theme.js.map";
        return {
          ok: true as const,
          resourceId,
          descriptor: {
            ...parent,
            fetchStatus: "analyzed" as const,
            contentType: "text/javascript",
            byteLength: text.length,
            sha256: "e".repeat(64),
          },
          text,
          derivedResources: [derived],
        };
      }
      return {
        ok: false as const,
        resourceId,
        reason: "http_error" as const,
        status: 404,
        descriptor: {
          ...derived,
          fetchStatus: "failed" as const,
          failureReason: "http_error" as const,
          httpStatus: 404,
        },
      };
    });

    expect(result.status).toBe("completed");
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      analyzedResources: 1,
      failedResources: 1,
      failureReasons: { http_error: 1 },
    });
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: derived.resourceId,
          kind: "source-map",
          fetchStatus: "failed",
          failureReason: "http_error",
          httpStatus: 404,
        }),
      ]),
    );
  });

  it("does not let an optional Source Map displace an already queued core resource", async () => {
    const parent = descriptor(
      1,
      "https://store.example/assets/parent.js",
      "script",
    );
    const sibling = descriptor(
      2,
      "https://store.example/assets/sibling.js",
      "script",
    );
    const derived: ResourceDescriptor = {
      resourceId: "00000000-0000-4000-8000-000000000005",
      url: "https://store.example/assets/parent.js.map",
      originRelation: "same-origin",
      kind: "source-map",
      queryPolicy: "none",
      sources: ["source-map-reference"],
      derivedFromResourceId: parent.resourceId,
      fetchStatus: "pending",
    };
    const requested: string[] = [];
    const resources = [parent, sibling];

    const result = await collectFrontendIntelligence(
      resources,
      async (resourceId) => {
        requested.push(resourceId);
        const current = resources.find(
          (resource) => resource.resourceId === resourceId,
        );
        if (current === undefined) throw new Error("unexpected derived request");
        const text =
          resourceId === parent.resourceId
            ? "const parent = true;\n//# sourceMappingURL=parent.js.map"
            : "const sibling = true;";
        return {
          ok: true as const,
          resourceId,
          descriptor: {
            ...current,
            fetchStatus: "analyzed" as const,
            contentType: "text/javascript",
            byteLength: text.length,
            sha256: "f".repeat(64),
          },
          text,
          ...(resourceId === parent.resourceId
            ? { derivedResources: [derived] }
            : {}),
        };
      },
      { concurrency: 1, maximumBodies: 2 },
    );

    expect(requested).toEqual([parent.resourceId, sibling.resourceId]);
    expect(result.status).toBe("completed");
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: sibling.resourceId,
          fetchStatus: "analyzed",
        }),
        expect.objectContaining({
          resourceId: derived.resourceId,
          fetchStatus: "skipped",
          failureReason: "budget_exceeded",
        }),
      ]),
    );
  });

  it("still marks a failed public script as a core frontend failure", async () => {
    const script = descriptor(1, "https://store.example/assets/theme.js", "script");
    const result = await collectFrontendIntelligence([script], async (resourceId) => ({
      ok: false as const,
      resourceId,
      reason: "http_error" as const,
      status: 503,
      descriptor: {
        ...script,
        fetchStatus: "failed" as const,
        failureReason: "http_error" as const,
        httpStatus: 503,
      },
    }));

    expect(result.status).toBe("failed");
    expect(result.errors).toEqual([`${script.resourceId}: http_error`]);
  });

  it("does not skip a map derived after another concurrent worker drains the queue", async () => {
    const fast = descriptor(
      1,
      "https://store.example/assets/fast.js",
      "script",
    );
    const slow = descriptor(
      2,
      "https://store.example/assets/slow.css",
      "style",
    );
    const derived: ResourceDescriptor = {
      resourceId: "00000000-0000-4000-8000-000000000003",
      url: "https://store.example/assets/slow.css.map",
      originRelation: "same-origin",
      kind: "source-map",
      queryPolicy: "none",
      sources: ["source-map-reference"],
      derivedFromResourceId: slow.resourceId,
      fetchStatus: "pending",
    };
    let releaseSlow: () => void = () => undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let markSlowStarted: () => void = () => undefined;
    const slowStarted = new Promise<void>((resolve) => {
      markSlowStarted = resolve;
    });

    const collection = collectFrontendIntelligence(
      [fast, slow],
      async (resourceId) => {
        const current =
          resourceId === fast.resourceId
            ? fast
            : resourceId === slow.resourceId
              ? slow
              : derived;
        if (resourceId === slow.resourceId) {
          markSlowStarted();
          await slowGate;
        }
        const text =
          resourceId === derived.resourceId
            ? JSON.stringify({ version: 3, sources: ["src/slow.scss"] })
            : resourceId === slow.resourceId
              ? "body{}\n/*# sourceMappingURL=slow.css.map */"
              : "const fast = true";
        return {
          ok: true as const,
          resourceId,
          descriptor: {
            ...current,
            fetchStatus: "analyzed" as const,
            contentType:
              current.kind === "source-map"
                ? "application/json"
                : current.kind === "style"
                  ? "text/css"
                  : "text/javascript",
            byteLength: new TextEncoder().encode(text).byteLength,
            sha256: "d".repeat(64),
          },
          text,
          ...(resourceId === slow.resourceId
            ? { derivedResources: [derived] }
            : {}),
        };
      },
      { concurrency: 2 },
    );

    await slowStarted;
    await Promise.resolve();
    await Promise.resolve();
    releaseSlow();
    const result = await collection;

    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: derived.resourceId,
          fetchStatus: "analyzed",
          derivedFromResourceId: slow.resourceId,
        }),
      ]),
    );
    expect(result.summary.failureReasons).not.toHaveProperty("budget_exceeded");
  });
});

function descriptor(
  suffix: number,
  url: string,
  kind: ResourceDescriptor["kind"],
  originRelation: ResourceDescriptor["originRelation"] = "same-origin",
): ResourceDescriptor {
  return {
    resourceId: `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
    url,
    originRelation,
    kind,
    queryPolicy: "none",
    sources: ["dom"],
    fetchStatus:
      originRelation === "same-origin" ? "pending" : "metadata-only",
  };
}
