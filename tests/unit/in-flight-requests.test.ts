import { describe, expect, it } from "vitest";

import { InFlightRequestRegistry } from "../../src/background/in-flight-requests";

describe("Service Worker in-flight request registry", () => {
  it("shares one abort signal across leases in the same scan scope", () => {
    const registry = new InFlightRequestRegistry();
    const scope = { runId: "run-1", scanId: "scan-1", tabId: 1, windowId: 2 };
    const first = registry.acquire(scope);
    const second = registry.acquire(scope);

    expect(first.signal).toBe(second.signal);
    expect(registry.cancel("run-1", "scan-1")).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(first.signal.reason).toMatchObject({ name: "AbortError" });
    first.release();
    expect(registry.size).toBe(1);
    second.release();
    expect(registry.size).toBe(0);
  });

  it("cancels requests on navigation, window changes, and session revocation", () => {
    const registry = new InFlightRequestRegistry();
    const tabOne = registry.acquire({
      runId: "run-1",
      scanId: "scan-1",
      tabId: 1,
      windowId: 10,
    });
    const tabTwo = registry.acquire({
      runId: "run-2",
      scanId: "scan-2",
      tabId: 2,
      windowId: 10,
    });
    const otherWindow = registry.acquire({
      runId: "run-3",
      scanId: "scan-3",
      tabId: 3,
      windowId: 11,
    });

    expect(registry.cancelInactiveForWindow(10, 2)).toBe(1);
    expect(tabOne.signal.aborted).toBe(true);
    expect(tabTwo.signal.aborted).toBe(false);
    expect(registry.cancelOutsideWindow(10)).toBe(1);
    expect(otherWindow.signal.aborted).toBe(true);
    expect(registry.cancelRun("run-2")).toBe(1);
    expect(tabTwo.signal.aborted).toBe(true);

    tabOne.release();
    tabTwo.release();
    otherWindow.release();
    expect(registry.size).toBe(0);
  });

  it("rejects reuse of a scan scope from a different tab", () => {
    const registry = new InFlightRequestRegistry();
    const lease = registry.acquire({
      runId: "run-1",
      scanId: "scan-1",
      tabId: 1,
      windowId: 2,
    });
    expect(() =>
      registry.acquire({
        runId: "run-1",
        scanId: "scan-1",
        tabId: 9,
        windowId: 2,
      }),
    ).toThrow("scan scope changed tab or window");
    lease.release();
  });
});
