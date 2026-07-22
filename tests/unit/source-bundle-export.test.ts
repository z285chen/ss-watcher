import { describe, expect, it } from "vitest";

import {
  collectPublicSourceBundle,
  selectSourceBundleCandidates,
} from "../../src/core/export/source-bundle-export";
import type {
  ResourceDescriptor,
  ResourceFetchResult,
} from "../../src/core/frontend/resource-types";

describe("public source bundle export", () => {
  it("re-fetches only analyzed same-origin text and records an auditable manifest", async () => {
    const resources = [
      descriptor(1, "https://store.example/theme.js", "script", "analyzed"),
      descriptor(2, "https://store.example/theme.css", "style", "analyzed"),
      descriptor(
        3,
        "https://cdn.example/vendor.js",
        "script",
        "metadata-only",
        "cross-origin",
      ),
      descriptor(4, "https://store.example/logo.png", "image", "metadata-only"),
    ];
    let active = 0;
    let maximumActive = 0;
    const executed: string[] = [];
    const exported = await collectPublicSourceBundle({
      snapshotId: "snapshot-1",
      storeKey: "https://store.example",
      resources,
      generatedAt: "2026-07-20T00:00:00.000Z",
      execute: async (resourceId): Promise<ResourceFetchResult> => {
        executed.push(resourceId);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        const target = resources.find(
          (resource) => resource.resourceId === resourceId,
        );
        if (target === undefined) throw new Error("missing fixture");
        const text = target.kind === "style" ? "body{}" : "const publicCode = 1";
        return {
          ok: true,
          resourceId,
          descriptor: {
            ...target,
            contentType:
              target.kind === "style" ? "text/css" : "text/javascript",
            byteLength: new TextEncoder().encode(text).byteLength,
            sha256: "b".repeat(64),
          },
          text,
        };
      },
    });

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(executed).toHaveLength(2);
    expect(exported.value.meta).toMatchObject({
      kind: "ss-watcher-public-source-bundle",
      credentialMode: "omit",
      redirectMode: "error",
      eligibleResourceCount: 2,
      attemptedResourceCount: 2,
      exportedFileCount: 2,
      omittedResourceCount: 0,
      sourceOrigins: ["https://store.example"],
      status: "completed",
    });
    expect(exported.value.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://store.example/theme.js",
          observedSha256: "a".repeat(64),
          sha256: "b".repeat(64),
          changedSinceScan: true,
          text: "const publicCode = 1",
        }),
      ]),
    );
    expect(JSON.parse(exported.json).files).toHaveLength(2);
    expect(exported.json).not.toContain("cdn.example");
  });

  it("fails closed for a mismatched executor response and keeps raw text out", async () => {
    const resource = descriptor(
      1,
      "https://store.example/theme.js",
      "script",
      "analyzed",
    );
    const exported = await collectPublicSourceBundle({
      snapshotId: "snapshot-1",
      storeKey: "https://store.example",
      resources: [resource],
      execute: async () => ({
        ok: true,
        resourceId: resource.resourceId,
        descriptor: {
          ...resource,
          url: "https://store.example/not-registered.js",
          contentType: "text/javascript",
          byteLength: 18,
          sha256: "b".repeat(64),
        },
        text: "RAW_MISMATCH_BODY",
      }),
    });

    expect(exported.value.meta.status).toBe("failed");
    expect(exported.value.files).toHaveLength(0);
    expect(exported.value.errors).toEqual([
      { resourceId: resource.resourceId, reason: "invalid_fetch_result" },
    ]);
    expect(exported.json).not.toContain("RAW_MISMATCH_BODY");
  });

  it("honors cancellation before dispatch", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    let called = false;
    await expect(
      collectPublicSourceBundle({
        snapshotId: "snapshot-1",
        storeKey: "https://store.example",
        resources: [
          descriptor(
            1,
            "https://store.example/theme.js",
            "script",
            "analyzed",
          ),
        ],
        signal: controller.signal,
        execute: async () => {
          called = true;
          throw new Error("unreachable");
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });

  it("does not select stale, binary, cross-origin, or origin-mismatched entries", () => {
    const selected = selectSourceBundleCandidates(
      [
        descriptor(1, "https://store.example/theme.js", "script", "analyzed"),
        descriptor(2, "https://store.example/pending.js", "script", "pending"),
        descriptor(3, "https://store.example/logo.png", "image", "analyzed"),
        descriptor(
          4,
          "https://cdn.example/vendor.js",
          "script",
          "analyzed",
          "cross-origin",
        ),
        descriptor(5, "https://other.example/wrong.js", "script", "analyzed"),
      ],
      "https://store.example",
    );

    expect(selected.map((resource) => resource.url)).toEqual([
      "https://store.example/theme.js",
    ]);
  });
});

function descriptor(
  suffix: number,
  url: string,
  kind: ResourceDescriptor["kind"],
  fetchStatus: ResourceDescriptor["fetchStatus"],
  originRelation: ResourceDescriptor["originRelation"] = "same-origin",
): ResourceDescriptor {
  return {
    resourceId: `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
    url,
    originRelation,
    kind,
    queryPolicy: "none",
    sources: ["dom"],
    fetchStatus,
    ...(fetchStatus === "analyzed"
      ? {
          contentType: "text/javascript",
          byteLength: 10,
          sha256: "a".repeat(64),
        }
      : {}),
  };
}
