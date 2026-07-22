import { describe, expect, it } from "vitest";

import {
  MAX_SCAN_RESOURCE_BODIES,
  MAX_SCAN_RESOURCE_BYTES,
  ResourceScanBudgetRegistry,
} from "../../src/background/resource-scan-budget";

const scope = {
  runId: "run-budget",
  scanId: "scan-budget",
  tabId: 1,
  windowId: 2,
} as const;

describe("ResourceScanBudgetRegistry", () => {
  it("hard-limits concurrent resource bodies to two", () => {
    const registry = new ResourceScanBudgetRegistry();
    const first = registry.acquire(scope, "script");
    const second = registry.acquire(scope, "style");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(registry.acquire(scope, "json")).toBeUndefined();
    first?.complete(1);
    expect(registry.acquire(scope, "json")).toBeDefined();
    second?.complete();
  });

  it("reserves at most 20 MB across concurrent or repeated source maps", () => {
    const registry = new ResourceScanBudgetRegistry();
    let accepted = 0;
    for (;;) {
      const lease = registry.acquire(scope, "source-map");
      if (lease === undefined) break;
      lease.complete(lease.maximumBytes);
      accepted += lease.maximumBytes;
    }
    expect(accepted).toBe(MAX_SCAN_RESOURCE_BYTES);
    expect(registry.acquire(scope, "script")).toBeUndefined();
  });

  it("counts accepted bodies, cleans finished scans, and ignores double completion", () => {
    const registry = new ResourceScanBudgetRegistry();
    for (let index = 0; index < MAX_SCAN_RESOURCE_BODIES; index += 1) {
      const lease = registry.acquire(scope, "script");
      expect(lease).toBeDefined();
      lease?.complete(0);
      lease?.complete(0);
    }
    expect(registry.acquire(scope, "script")).toBeUndefined();
    expect(registry.size).toBe(1);
    expect(registry.finish(scope.runId, scope.scanId)).toBe(true);
    expect(registry.size).toBe(0);
  });
});
