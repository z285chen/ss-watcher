import { describe, expect, it, vi } from "vitest";

import {
  deriveSourceMapCapability,
  MAX_RESOURCE_BODY_BYTES,
  executeRegisteredResourceRequest,
  registerResourceCandidates,
} from "../../src/core/frontend/resource-policy";
import type {
  CollectorResourceCandidate,
  ResourceDescriptor,
} from "../../src/core/frontend/resource-types";

const context = { origin: "https://store.example" } as const;

describe("ResourcePolicy registration", () => {
  it("registers only observed bounded resources and keeps cross-origin or unsafe query metadata-only", () => {
    const resources = registerResourceCandidates(
      [
        candidate("https://store.example/assets/theme.js?v=abc", "script", "cache-key"),
        candidate("https://cdn.example/vendor.js", "script"),
        candidate("https://store.example/assets/logo.png", "image"),
        candidate("https://store.example/assets/private.js", "script", "redacted"),
        candidate("https://store.example/account/private.js", "script"),
      ],
      context,
      { createResourceId: idFactory() },
    );

    expect(resources).toHaveLength(5);
    expect(resources[0]).toMatchObject({
      originRelation: "same-origin",
      queryPolicy: "cache-key",
      fetchStatus: "pending",
    });
    expect(resources[1]).toMatchObject({
      originRelation: "cross-origin",
      fetchStatus: "metadata-only",
    });
    expect(resources[2]).toMatchObject({
      kind: "image",
      fetchStatus: "metadata-only",
    });
    expect(resources[3]).toMatchObject({
      queryPolicy: "redacted",
      fetchStatus: "metadata-only",
    });
    expect(resources[4]).toMatchObject({ fetchStatus: "metadata-only" });
  });

  it("deduplicates identical kind and URL capabilities", () => {
    const duplicate = candidate("https://store.example/theme.js", "script");
    expect(
      registerResourceCandidates([duplicate, duplicate], context, {
        createResourceId: idFactory(),
      }),
    ).toHaveLength(1);
  });
});

describe("ResourcePolicy execution", () => {
  it("fetches one registered same-origin text resource with fixed privacy options and hashes it", async () => {
    const descriptor = registered(
      candidate("https://store.example/assets/theme.js?v=1", "script", "cache-key"),
    );
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      return responseWithUrl(
        "const api = '/cart.js';",
        descriptor.url,
        "text/javascript; charset=utf-8",
      );
    });

    const result = await executeRegisteredResourceRequest(context, descriptor, {
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      resourceId: descriptor.resourceId,
      descriptor: {
        fetchStatus: "analyzed",
        contentType: "text/javascript",
        byteLength: 23,
      },
    });
    if (result.ok) {
      expect(result.text).toBe("const api = '/cart.js';");
      expect(result.descriptor.sha256).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it.each([
    ["cross-origin", candidate("https://cdn.example/theme.js", "script")],
    ["binary", candidate("https://store.example/logo.png", "image")],
    ["unsafe-query", candidate("https://store.example/theme.js", "script", "redacted")],
  ])("never dispatches a %s metadata-only capability", async (_label, observed) => {
    const descriptor = registered(observed);
    const fetchImpl = vi.fn();
    const result = await executeRegisteredResourceRequest(context, descriptor, {
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false, reason: "metadata_only" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects MIME before exposing a body", async () => {
    const descriptor = registered(
      candidate("https://store.example/theme.js", "script"),
    );
    const result = await executeRegisteredResourceRequest(context, descriptor, {
      fetchImpl: async () =>
        responseWithUrl("PNG", descriptor.url, "image/png"),
    });
    expect(result).toMatchObject({ ok: false, reason: "mime_rejected" });
  });

  it("stops at the declared and streamed single-file limits", async () => {
    const descriptor = registered(
      candidate("https://store.example/theme.js", "script"),
    );
    const declared = await executeRegisteredResourceRequest(context, descriptor, {
      fetchImpl: async () =>
        responseWithUrl("small", descriptor.url, "text/javascript", {
          "Content-Length": String(MAX_RESOURCE_BODY_BYTES + 1),
        }),
    });
    expect(declared).toMatchObject({ ok: false, reason: "too_large" });

    const streamed = await executeRegisteredResourceRequest(context, descriptor, {
      fetchImpl: async () =>
        responseWithUrl(
          "x".repeat(MAX_RESOURCE_BODY_BYTES + 1),
          descriptor.url,
          "text/javascript",
        ),
    });
    expect(streamed).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("rejects an observed redirect response without exposing its body", async () => {
    const descriptor = registered(
      candidate("https://store.example/theme.js", "script"),
    );
    const result = await executeRegisteredResourceRequest(context, descriptor, {
      fetchImpl: async () => {
        const response = responseWithUrl("redirect", descriptor.url, "text/javascript");
        Object.defineProperty(response, "redirected", { value: true });
        return response;
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "redirect_blocked" });
  });

  it("rejects a response whose final URL differs from the registered capability", async () => {
    const descriptor = registered(
      candidate("https://store.example/theme.js", "script"),
    );
    const result = await executeRegisteredResourceRequest(context, descriptor, {
      fetchImpl: async () =>
        responseWithUrl(
          "redirected body",
          "https://store.example/other.js",
          "text/javascript",
        ),
    });

    expect(result).toMatchObject({ ok: false, reason: "redirect_blocked" });
  });
});

describe("derived source-map capabilities", () => {
  it("derives a same-origin public map with explicit parent lineage", () => {
    const parent = {
      ...registered(
        candidate("https://store.example/assets/theme.js?v=1", "script", "cache-key"),
      ),
      fetchStatus: "analyzed" as const,
      contentType: "text/javascript",
      byteLength: 42,
      sha256: "a".repeat(64),
    };
    const derived = deriveSourceMapCapability(
      context,
      parent,
      "//# sourceMappingURL=theme.js.map?version=1",
      { createResourceId: idFactory(9) },
    );

    expect(derived).toEqual({
      resourceId: "00000000-0000-4000-8000-000000000009",
      url: "https://store.example/assets/theme.js.map?version=1",
      originRelation: "same-origin",
      kind: "source-map",
      queryPolicy: "cache-key",
      sources: ["source-map-reference"],
      derivedFromResourceId: parent.resourceId,
      fetchStatus: "pending",
    });
  });

  it.each([
    ["cross origin", "//# sourceMappingURL=https://cdn.example/theme.js.map"],
    ["unsafe query", "//# sourceMappingURL=theme.js.map?token=secret"],
    ["sensitive path", "//# sourceMappingURL=/account/theme.js.map"],
    ["local path", "//# sourceMappingURL=/Users/person/theme.js.map"],
    ["inline", "//# sourceMappingURL=data:application/json;base64,e30="],
  ])("does not derive a fetch capability for a %s reference", (_label, source) => {
    const parent = {
      ...registered(candidate("https://store.example/assets/theme.js", "script")),
      fetchStatus: "analyzed" as const,
      contentType: "text/javascript",
      byteLength: source.length,
      sha256: "b".repeat(64),
    };
    expect(deriveSourceMapCapability(context, parent, source)).toBeUndefined();
  });
});

function candidate(
  url: string,
  kind: CollectorResourceCandidate["kind"],
  queryPolicy: CollectorResourceCandidate["queryPolicy"] = "none",
): CollectorResourceCandidate {
  return { url, kind, queryPolicy, sources: ["dom"] };
}

function registered(observed: CollectorResourceCandidate): ResourceDescriptor {
  const resource = registerResourceCandidates([observed], context, {
    createResourceId: idFactory(),
  })[0];
  if (resource === undefined) throw new Error("fixture registration failed");
  return resource;
}

function idFactory(first = 1): () => string {
  let next = first;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

function responseWithUrl(
  body: string,
  url: string,
  contentType: string,
  headers: Record<string, string> = {},
): Response {
  const response = new Response(body, {
    headers: { "Content-Type": contentType, ...headers },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
