import type { EndpointExecutor } from "../shopify/catalog-scanner";
import {
  decideEndpointRetry,
  initialRetryPolicyState,
  type RetryPolicyOptions,
  type RetryPolicyState,
} from "./retry-policy";

export const MAX_RETRY_DIAGNOSTIC_EVENTS = 100;

export type RetrySleep = (
  delayMs: number,
  signal: AbortSignal | undefined,
) => Promise<void>;

export type RetryingEndpointOptions = RetryPolicyOptions &
  Readonly<{
    sleep?: RetrySleep;
    onRetry?: (event: RetryExecutionEvent) => void;
  }>;

export type RetryExecutionEvent = Readonly<{
  retryNumber: number;
  endpointKind: string;
  delayMs: number;
  category: string;
  concurrencyBefore: number;
  concurrency: number;
}>;

export type RetryExecutionSummary = Readonly<{
  retryCount: number;
  scanWaitedMs: number;
  concurrency: number;
  concurrencyReductionCount: number;
  events: readonly RetryExecutionEvent[];
  eventsDropped: number;
}>;

export type RetryingEndpointExecutor = Readonly<{
  execute: EndpointExecutor;
  getSummary: () => RetryExecutionSummary;
}>;

/** Applies DESIGN §14 retry limits without moving fetch authority out of SW. */
export function createRetryingEndpointExecutor(
  base: EndpointExecutor,
  options: RetryingEndpointOptions = {},
): RetryingEndpointExecutor {
  let scanWaitedMs = 0;
  let concurrency = 4;
  let retryCount = 0;
  let concurrencyReductionCount = 0;
  const events: RetryExecutionEvent[] = [];
  let eventsDropped = 0;
  const sleep = options.sleep ?? abortableSleep;

  const execute: EndpointExecutor = async (request, executionOptions = {}) => {
    let state: RetryPolicyState = {
      ...initialRetryPolicyState(concurrency),
      scanWaitedMs,
    };

    while (true) {
      const result = await base(request, executionOptions);
      if (result.ok) return result;
      const decision = decideEndpointRetry(result, state, {
        ...(options.moduleWaitBudgetMs === undefined
          ? {}
          : { moduleWaitBudgetMs: options.moduleWaitBudgetMs }),
        ...(options.scanWaitBudgetMs === undefined
          ? {}
          : { scanWaitBudgetMs: options.scanWaitBudgetMs }),
        ...(options.random === undefined ? {} : { random: options.random }),
      });
      const concurrencyBefore = concurrency;
      concurrency = decision.next.concurrency;
      if (concurrency < concurrencyBefore) concurrencyReductionCount += 1;
      if (decision.action === "stop") return result;

      retryCount += 1;
      const event: RetryExecutionEvent = {
        retryNumber: retryCount,
        endpointKind: request.kind,
        delayMs: decision.delayMs,
        category: result.category,
        concurrencyBefore,
        concurrency,
      };
      if (events.length < MAX_RETRY_DIAGNOSTIC_EVENTS) {
        events.push(event);
      } else {
        eventsDropped += 1;
      }
      options.onRetry?.(event);
      await sleep(decision.delayMs, executionOptions.signal);
      state = decision.next;
      scanWaitedMs = state.scanWaitedMs;
    }
  };

  return {
    execute,
    getSummary: () => ({
      retryCount,
      scanWaitedMs,
      concurrency,
      concurrencyReductionCount,
      events: events.map((event) => ({ ...event })),
      eventsDropped,
    }),
  };
}

async function abortableSleep(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted === true) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = (): void => {
      globalThis.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Retry wait aborted", "AbortError");
}
