import { describe, expect, it, vi } from "vitest";

import { createRetryingEndpointExecutor } from "../../src/core/network/retry-executor";
import type {
  EndpointExecutionResult,
  EndpointRequest,
} from "../../src/core/network/request-policy";
import type { EndpointExecutor } from "../../src/core/shopify/catalog-scanner";

describe("retrying endpoint executor", () => {
  it("retries one transient failure and preserves the fixed endpoint request", async () => {
    let attempt = 0;
    const base = vi.fn<EndpointExecutor>(async (request) => {
      attempt += 1;
      return attempt === 1
        ? failure(request, "http_5xx")
        : success(request, { name: "Fixture" });
    });
    const sleep = vi.fn(async () => undefined);
    const retrying = createRetryingEndpointExecutor(base, { sleep });
    const request = { kind: "meta" } as const;

    await expect(retrying.execute(request)).resolves.toMatchObject({ ok: true });
    expect(base).toHaveBeenNthCalledWith(1, request, {});
    expect(base).toHaveBeenNthCalledWith(2, request, {});
    expect(sleep).toHaveBeenCalledWith(2_000, undefined);
    expect(retrying.getSummary()).toEqual({
      retryCount: 1,
      scanWaitedMs: 2_000,
      concurrency: 4,
      concurrencyReductionCount: 0,
      eventsDropped: 0,
      events: [
        {
          retryNumber: 1,
          endpointKind: "meta",
          delayMs: 2_000,
          category: "http_5xx",
          concurrencyBefore: 4,
          concurrency: 4,
        },
      ],
    });
  });

  it("honors Retry-After and keeps concurrency at one for later requests", async () => {
    let first = true;
    const base: EndpointExecutor = async (request) => {
      if (first) {
        first = false;
        return {
          ...failure(request, "rate_limited"),
          retryAfterSeconds: 1,
        };
      }
      return success(request, { products: [] });
    };
    const sleep = vi.fn(async () => undefined);
    const onRetry = vi.fn();
    const retrying = createRetryingEndpointExecutor(base, { sleep, onRetry });

    await retrying.execute({ kind: "products-page", page: 1, limit: 1 });
    expect(sleep).toHaveBeenCalledWith(1_000, undefined);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointKind: "products-page",
        category: "rate_limited",
        concurrency: 1,
      }),
    );
    expect(retrying.getSummary()).toMatchObject({
      retryCount: 1,
      concurrency: 1,
      concurrencyReductionCount: 1,
      eventsDropped: 0,
      events: [
        expect.objectContaining({
          retryNumber: 1,
          concurrencyBefore: 4,
          concurrency: 1,
        }),
      ],
    });
  });

  it("never retries a terminal category", async () => {
    const base = vi.fn<EndpointExecutor>(async (request) =>
      failure(request, "challenge_page"),
    );
    const sleep = vi.fn(async () => undefined);
    const retrying = createRetryingEndpointExecutor(base, { sleep });

    await expect(retrying.execute({ kind: "sitemap" })).resolves.toMatchObject({
      ok: false,
      category: "challenge_page",
    });
    expect(base).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("caps persisted retry events while preserving aggregate counts", async () => {
    let failNext = true;
    const base: EndpointExecutor = async (request) => {
      if (failNext) {
        failNext = false;
        return failure(request, "http_5xx");
      }
      failNext = true;
      return success(request, {});
    };
    const retrying = createRetryingEndpointExecutor(base, {
      sleep: async () => undefined,
      scanWaitBudgetMs: 1_000_000,
    });

    for (let index = 0; index < 101; index += 1) {
      await retrying.execute({ kind: "meta" });
    }

    expect(retrying.getSummary()).toMatchObject({
      retryCount: 101,
      eventsDropped: 1,
    });
    expect(retrying.getSummary().events).toHaveLength(100);
  });
});

function success(
  request: EndpointRequest,
  data: unknown,
): EndpointExecutionResult {
  return {
    ok: true,
    kind: request.kind,
    requestUrl: `https://store.example/${request.kind}`,
    responseUrl: `https://store.example/${request.kind}`,
    status: 200,
    contentType: "application/json",
    byteLength: 2,
    data,
  };
}

function failure(
  request: EndpointRequest,
  category: "http_5xx" | "rate_limited" | "challenge_page",
): Extract<EndpointExecutionResult, { ok: false }> {
  return {
    ok: false,
    kind: request.kind,
    requestUrl: `https://store.example/${request.kind}`,
    category,
    message: category,
  };
}
