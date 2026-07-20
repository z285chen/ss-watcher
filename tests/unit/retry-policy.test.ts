import { describe, expect, it } from "vitest";

import {
  decideEndpointRetry,
  initialRetryPolicyState,
} from "../../src/core/network/retry-policy";

describe("endpoint retry policy", () => {
  it("prefers Retry-After and permanently lowers concurrency after 429", () => {
    const decision = decideEndpointRetry(
      { category: "rate_limited", retryAfterSeconds: 3 },
      initialRetryPolicyState(),
    );

    expect(decision).toEqual({
      action: "retry",
      delayMs: 3_000,
      next: {
        rateLimitRetries: 1,
        transientRetries: 0,
        moduleWaitedMs: 3_000,
        scanWaitedMs: 3_000,
        concurrency: 1,
      },
    });
  });

  it("uses bounded 2s/4s/8s fallback backoff and stops after three 429 retries", () => {
    let state = initialRetryPolicyState();
    for (const expectedDelay of [2_000, 4_000, 8_000]) {
      const decision = decideEndpointRetry(
        { category: "rate_limited" },
        state,
        { random: () => 0.5 },
      );
      expect(decision).toMatchObject({
        action: "retry",
        delayMs: expectedDelay,
        next: { concurrency: 1 },
      });
      if (decision.action !== "retry") return;
      state = decision.next;
    }

    expect(
      decideEndpointRetry({ category: "rate_limited" }, state),
    ).toMatchObject({
      action: "stop",
      reason: "retry_limit",
      next: { concurrency: 1 },
    });
  });

  it.each(["security_rejected", "challenge_page", "redirect_blocked"] as const)(
    "never retries terminal %s failures",
    (category) => {
      expect(
        decideEndpointRetry({ category }, initialRetryPolicyState()),
      ).toEqual({
        action: "stop",
        reason: "terminal_category",
        next: initialRetryPolicyState(),
      });
    },
  );

  it.each(["network", "timeout", "http_5xx"] as const)(
    "retries transient %s failures once",
    (category) => {
      const first = decideEndpointRetry(
        { category },
        initialRetryPolicyState(),
      );
      expect(first).toMatchObject({ action: "retry", delayMs: 2_000 });
      if (first.action !== "retry") return;
      expect(decideEndpointRetry({ category }, first.next)).toMatchObject({
        action: "stop",
        reason: "retry_limit",
      });
    },
  );

  it("enforces module and scan wait budgets before scheduling", () => {
    expect(
      decideEndpointRetry(
        { category: "rate_limited", retryAfterSeconds: 21 },
        initialRetryPolicyState(),
      ),
    ).toMatchObject({
      action: "stop",
      reason: "module_wait_budget",
      next: { concurrency: 1, moduleWaitedMs: 0 },
    });

    expect(
      decideEndpointRetry(
        { category: "network" },
        {
          ...initialRetryPolicyState(),
          moduleWaitedMs: 1_000,
          scanWaitedMs: 59_000,
        },
      ),
    ).toMatchObject({
      action: "stop",
      reason: "scan_wait_budget",
      next: { scanWaitedMs: 59_000 },
    });
  });

  it("validates injected jitter and persisted counters", () => {
    expect(() =>
      decideEndpointRetry(
        { category: "rate_limited" },
        initialRetryPolicyState(),
        { random: () => 2 },
      ),
    ).toThrow(TypeError);
    expect(() =>
      decideEndpointRetry(
        { category: "network" },
        { ...initialRetryPolicyState(), scanWaitedMs: -1 },
      ),
    ).toThrow(TypeError);
  });
});
