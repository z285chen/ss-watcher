import {
  MAX_RESOURCE_BODY_BYTES,
  MAX_SOURCE_MAP_BYTES,
} from "../core/frontend/resource-policy";
import type { ResourceKind } from "../core/frontend/resource-types";

export const MAX_SCAN_RESOURCE_BODIES = 100;
export const MAX_SCAN_RESOURCE_BYTES = 20 * 1_024 * 1_024;
export const MAX_SCAN_RESOURCE_CONCURRENCY = 2;

export type ResourceBudgetScope = Readonly<{
  runId: string;
  scanId: string;
  tabId: number;
  windowId: number;
}>;

export type ResourceBudgetLease = Readonly<{
  maximumBytes: number;
  budgetLimited: boolean;
  complete: (acceptedBytes?: number) => void;
}>;

type BudgetState = {
  scope: ResourceBudgetScope;
  acceptedBodies: number;
  acceptedBytes: number;
  active: number;
  reservedBytes: number;
};

export class ResourceScanBudgetRegistry {
  private readonly states = new Map<string, BudgetState>();

  get size(): number {
    return this.states.size;
  }

  acquire(
    scope: ResourceBudgetScope,
    kind: ResourceKind,
  ): ResourceBudgetLease | undefined {
    validateScope(scope);
    const key = scopeKey(scope.runId, scope.scanId);
    let state = this.states.get(key);
    if (state === undefined) {
      state = {
        scope: { ...scope },
        acceptedBodies: 0,
        acceptedBytes: 0,
        active: 0,
        reservedBytes: 0,
      };
      this.states.set(key, state);
    } else if (
      state.scope.tabId !== scope.tabId ||
      state.scope.windowId !== scope.windowId
    ) {
      throw new TypeError("resource scan scope changed tab or window");
    }
    if (
      state.active >= MAX_SCAN_RESOURCE_CONCURRENCY ||
      state.acceptedBodies + state.active >= MAX_SCAN_RESOURCE_BODIES
    ) {
      return undefined;
    }
    const remaining =
      MAX_SCAN_RESOURCE_BYTES - state.acceptedBytes - state.reservedBytes;
    if (remaining < 1) return undefined;
    const hardMaximum =
      kind === "source-map" ? MAX_SOURCE_MAP_BYTES : MAX_RESOURCE_BODY_BYTES;
    const maximumBytes = Math.min(hardMaximum, remaining);
    state.active += 1;
    state.reservedBytes += maximumBytes;
    let completed = false;
    return {
      maximumBytes,
      budgetLimited: maximumBytes < hardMaximum,
      complete: (acceptedBytes) => {
        if (completed) return;
        completed = true;
        state!.active -= 1;
        state!.reservedBytes -= maximumBytes;
        if (acceptedBytes !== undefined) {
          if (
            !Number.isSafeInteger(acceptedBytes) ||
            acceptedBytes < 0 ||
            acceptedBytes > maximumBytes
          ) {
            throw new TypeError("acceptedBytes exceeds its resource reservation");
          }
          state!.acceptedBodies += 1;
          state!.acceptedBytes += acceptedBytes;
        }
      },
    };
  }

  finish(runId: string, scanId: string): boolean {
    return this.states.delete(scopeKey(runId, scanId));
  }

  cancelRun(runId: string): number {
    return this.deleteWhere((scope) => scope.runId === runId);
  }

  cancelTab(tabId: number): number {
    return this.deleteWhere((scope) => scope.tabId === tabId);
  }

  cancelWindow(windowId: number): number {
    return this.deleteWhere((scope) => scope.windowId === windowId);
  }

  cancelOutsideWindow(windowId: number): number {
    return this.deleteWhere((scope) => scope.windowId !== windowId);
  }

  cancelInactiveForWindow(windowId: number, activeTabId: number): number {
    return this.deleteWhere(
      (scope) => scope.windowId === windowId && scope.tabId !== activeTabId,
    );
  }

  clear(): number {
    const count = this.states.size;
    this.states.clear();
    return count;
  }

  private deleteWhere(predicate: (scope: ResourceBudgetScope) => boolean): number {
    let deleted = 0;
    for (const [key, state] of this.states) {
      if (!predicate(state.scope)) continue;
      this.states.delete(key);
      deleted += 1;
    }
    return deleted;
  }
}

function scopeKey(runId: string, scanId: string): string {
  return JSON.stringify([runId, scanId]);
}

function validateScope(scope: ResourceBudgetScope): void {
  if (scope.runId.length === 0 || scope.scanId.length === 0) {
    throw new TypeError("runId and scanId are required");
  }
  if (
    !Number.isSafeInteger(scope.tabId) ||
    scope.tabId < 0 ||
    !Number.isSafeInteger(scope.windowId) ||
    scope.windowId < 0
  ) {
    throw new TypeError("tabId and windowId must be non-negative safe integers");
  }
}
