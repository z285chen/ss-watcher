export type InFlightRequestScope = Readonly<{
  runId: string;
  scanId: string;
  tabId: number;
  windowId: number;
}>;

export type InFlightRequestLease = Readonly<{
  signal: AbortSignal;
  release: () => void;
}>;

type RegistryEntry = {
  scope: InFlightRequestScope;
  controller: AbortController;
  leases: number;
};

/**
 * Keeps cancellation authority inside the Service Worker. One scan scope may
 * own multiple future concurrent requests, all sharing one abort signal.
 */
export class InFlightRequestRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  get size(): number {
    return this.entries.size;
  }

  acquire(scope: InFlightRequestScope): InFlightRequestLease {
    validateScope(scope);
    const key = scopeKey(scope.runId, scope.scanId);
    let entry = this.entries.get(key);
    if (entry === undefined) {
      entry = {
        scope: { ...scope },
        controller: new AbortController(),
        leases: 0,
      };
      this.entries.set(key, entry);
    } else if (
      entry.scope.tabId !== scope.tabId ||
      entry.scope.windowId !== scope.windowId
    ) {
      throw new TypeError("scan scope changed tab or window");
    }
    entry.leases += 1;
    let released = false;
    return {
      signal: entry.controller.signal,
      release: () => {
        if (released) return;
        released = true;
        entry.leases -= 1;
        if (entry.leases === 0 && this.entries.get(key) === entry) {
          this.entries.delete(key);
        }
      },
    };
  }

  cancel(runId: string, scanId: string): boolean {
    return this.abortWhere(
      (scope) => scope.runId === runId && scope.scanId === scanId,
      "Scan cancelled",
    ) > 0;
  }

  cancelRun(runId: string): number {
    return this.abortWhere((scope) => scope.runId === runId, "Session revoked");
  }

  cancelTab(tabId: number): number {
    return this.abortWhere((scope) => scope.tabId === tabId, "Tab changed");
  }

  cancelInactiveForWindow(windowId: number, activeTabId: number): number {
    return this.abortWhere(
      (scope) => scope.windowId === windowId && scope.tabId !== activeTabId,
      "Active tab changed",
    );
  }

  cancelWindow(windowId: number): number {
    return this.abortWhere(
      (scope) => scope.windowId === windowId,
      "Window closed or lost focus",
    );
  }

  cancelOutsideWindow(windowId: number): number {
    return this.abortWhere(
      (scope) => scope.windowId !== windowId,
      "Focused window changed",
    );
  }

  cancelAll(): number {
    return this.abortWhere(() => true, "All scan sessions revoked");
  }

  private abortWhere(
    predicate: (scope: InFlightRequestScope) => boolean,
    message: string,
  ): number {
    let cancelled = 0;
    for (const entry of this.entries.values()) {
      if (!predicate(entry.scope) || entry.controller.signal.aborted) continue;
      entry.controller.abort(new DOMException(message, "AbortError"));
      cancelled += 1;
    }
    return cancelled;
  }
}

function scopeKey(runId: string, scanId: string): string {
  return JSON.stringify([runId, scanId]);
}

function validateScope(scope: InFlightRequestScope): void {
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
