import type { EndpointFailure } from "./request-policy";

export const DEFAULT_MODULE_RETRY_WAIT_BUDGET_MS = 20_000;
export const DEFAULT_SCAN_RETRY_WAIT_BUDGET_MS = 60_000;
export const DEFAULT_SCAN_CONCURRENCY = 4;
export const RATE_LIMIT_RETRY_LIMIT = 3;
export const TRANSIENT_RETRY_LIMIT = 1;

export type RetryPolicyState = Readonly<{
  rateLimitRetries: number;
  transientRetries: number;
  moduleWaitedMs: number;
  scanWaitedMs: number;
  concurrency: number;
}>;

export type RetryDecision =
  | Readonly<{
      action: "retry";
      delayMs: number;
      next: RetryPolicyState;
    }>
  | Readonly<{
      action: "stop";
      reason:
        | "terminal_category"
        | "retry_limit"
        | "module_wait_budget"
        | "scan_wait_budget";
      next: RetryPolicyState;
    }>;

export type RetryPolicyOptions = Readonly<{
  moduleWaitBudgetMs?: number;
  scanWaitBudgetMs?: number;
  random?: () => number;
}>;

export function initialRetryPolicyState(
  concurrency = DEFAULT_SCAN_CONCURRENCY,
): RetryPolicyState {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError("concurrency must be a positive safe integer");
  }
  return {
    rateLimitRetries: 0,
    transientRetries: 0,
    moduleWaitedMs: 0,
    scanWaitedMs: 0,
    concurrency,
  };
}

/**
 * Computes the only retries permitted by DESIGN §14. It performs no waiting or
 * network request itself, which keeps the decision deterministic and lets the
 * Side Panel coordinator persist the returned counters between SW wakeups.
 */
export function decideEndpointRetry(
  failure: Pick<EndpointFailure, "category" | "retryAfterSeconds">,
  state: RetryPolicyState,
  options: RetryPolicyOptions = {},
): RetryDecision {
  validateState(state);
  const moduleBudget = positiveBudget(
    options.moduleWaitBudgetMs,
    DEFAULT_MODULE_RETRY_WAIT_BUDGET_MS,
    "moduleWaitBudgetMs",
  );
  const scanBudget = positiveBudget(
    options.scanWaitBudgetMs,
    DEFAULT_SCAN_RETRY_WAIT_BUDGET_MS,
    "scanWaitBudgetMs",
  );

  let delayMs: number;
  let next: RetryPolicyState;
  if (failure.category === "rate_limited") {
    const throttled = { ...state, concurrency: 1 };
    if (state.rateLimitRetries >= RATE_LIMIT_RETRY_LIMIT) {
      return { action: "stop", reason: "retry_limit", next: throttled };
    }
    delayMs = rateLimitDelayMs(
      state.rateLimitRetries,
      failure.retryAfterSeconds,
      options.random,
    );
    next = {
      ...throttled,
      rateLimitRetries: state.rateLimitRetries + 1,
      moduleWaitedMs: state.moduleWaitedMs + delayMs,
      scanWaitedMs: state.scanWaitedMs + delayMs,
    };
  } else if (
    failure.category === "network" ||
    failure.category === "timeout" ||
    failure.category === "http_5xx"
  ) {
    if (state.transientRetries >= TRANSIENT_RETRY_LIMIT) {
      return { action: "stop", reason: "retry_limit", next: state };
    }
    delayMs = 2_000;
    next = {
      ...state,
      transientRetries: state.transientRetries + 1,
      moduleWaitedMs: state.moduleWaitedMs + delayMs,
      scanWaitedMs: state.scanWaitedMs + delayMs,
    };
  } else {
    return { action: "stop", reason: "terminal_category", next: state };
  }

  if (next.moduleWaitedMs > moduleBudget) {
    return {
      action: "stop",
      reason: "module_wait_budget",
      next: failure.category === "rate_limited" ? { ...state, concurrency: 1 } : state,
    };
  }
  if (next.scanWaitedMs > scanBudget) {
    return {
      action: "stop",
      reason: "scan_wait_budget",
      next: failure.category === "rate_limited" ? { ...state, concurrency: 1 } : state,
    };
  }
  return { action: "retry", delayMs, next };
}

function rateLimitDelayMs(
  retryCount: number,
  retryAfterSeconds: number | undefined,
  random: (() => number) | undefined,
): number {
  if (
    retryAfterSeconds !== undefined &&
    Number.isSafeInteger(retryAfterSeconds) &&
    retryAfterSeconds >= 0
  ) {
    return retryAfterSeconds * 1_000;
  }

  const base = 2_000 * 2 ** retryCount;
  const sample = (random ?? Math.random)();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
    throw new TypeError("random must return a number between 0 and 1");
  }
  return Math.round(base * (0.7 + sample * 0.6));
}

function positiveBudget(
  candidate: number | undefined,
  fallback: number,
  name: string,
): number {
  const value = candidate ?? fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function validateState(state: RetryPolicyState): void {
  for (const [name, value] of Object.entries(state)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer`);
    }
  }
  if (state.concurrency < 1) {
    throw new TypeError("concurrency must be a positive safe integer");
  }
}
