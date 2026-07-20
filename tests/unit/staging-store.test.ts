import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  ManifestValidationError,
  StagingStore,
  StagingStoreError,
  type SnapshotDraftInput,
  type StagingStoreOptions,
} from "../../src/core/storage/staging-store";

const openStores: StagingStore[] = [];

function createStore(
  options: Omit<StagingStoreOptions, "databaseName"> & {
    databaseName?: string;
  } = {},
): StagingStore {
  const store = new StagingStore({
    ...options,
    databaseName:
      options.databaseName ?? `staging-store-test-${crypto.randomUUID()}`,
  });
  openStores.push(store);
  return store;
}

afterEach(async () => {
  const databaseNames = new Set(openStores.map((store) => store.databaseName));
  await Promise.all(openStores.map((store) => store.close()));
  openStores.length = 0;

  for (const databaseName of databaseNames) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
});

describe("StagingStore", () => {
  it("publishes only a fully validated manifest and keeps replayed products idempotent", async () => {
    const store = createStore();
    await store.startRun({
      runId: "run-1",
      snapshotId: "snapshot-1",
      plannedModuleIds: ["catalog", "apps"],
    });

    await store.writeProducts("run-1", [
      { id: 101, handle: "first", title: "First" },
      { handle: "fallback", title: "Fallback" },
    ]);
    const replayManifest = await store.writeProducts("run-1", [
      { id: 101, handle: "first-renamed", title: "First updated" },
    ]);
    expect(replayManifest).toMatchObject({
      attemptedProductWrites: 3,
      writtenProductCount: 2,
      sealed: false,
    });

    await store.writeModuleResult("run-1", {
      moduleId: "catalog",
      status: "completed",
      result: { fetched: 2 },
    });
    await store.writeModuleResult("run-1", {
      moduleId: "apps",
      status: "partial",
      errors: [{ code: "fixture_partial" }],
    });
    await store.writeSnapshotDraft("run-1", validSnapshotDraft(
      "https://example.test",
      {
      scannedAt: "2026-07-20T00:00:00.000Z",
      },
    ));

    // Staging rows exist, but every normal read remains committed-only.
    await expect(store.getCommittedSnapshot("snapshot-1")).resolves.toBeUndefined();
    await expect(store.listCommittedSnapshots()).resolves.toEqual([]);

    const sealed = await store.sealProductManifest("run-1", 2, 2);
    expect(sealed).toMatchObject({
      attemptedProductWrites: 3,
      writtenProductCount: 2,
      expectedProductCount: 2,
      checkpointProductCount: 2,
      sealed: true,
    });

    const published = await store.commitRun("run-1");
    expect(published.snapshot.committed).toBe(true);
    expect(published.products).toHaveLength(2);
    expect(published.moduleResults).toHaveLength(2);
    expect(
      published.products.find((product) => product.productKey === "101")?.value,
    ).toMatchObject({ title: "First updated" });
    expect(
      published.products.find(
        (product) => product.productKey === "handle:fallback",
      ),
    ).toBeDefined();

    await expect(store.getRun("run-1")).resolves.toMatchObject({
      snapshotId: "snapshot-1",
      status: "completed",
      staging: false,
    });
    await expect(store.getCommittedSnapshot("snapshot-1")).resolves.toMatchObject({
      snapshot: { snapshotId: "snapshot-1", committed: true },
    });
  });

  it("rejects a structurally incomplete snapshot and cleans the entire run", async () => {
    const store = createStore();
    await store.startRun({
      runId: "invalid-snapshot-run",
      snapshotId: "invalid-snapshot",
      plannedModuleIds: [],
    });
    await store.sealProductManifest("invalid-snapshot-run", 0);
    const { coverage: _coverage, ...invalidDraft } = validSnapshotDraft(
      "https://invalid-snapshot.test",
    );
    await store.writeSnapshotDraft("invalid-snapshot-run", invalidDraft);

    const error = await store
      .commitRun("invalid-snapshot-run")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ManifestValidationError);
    expect(error).toMatchObject({
      issues: expect.arrayContaining(["snapshot coverage must be an object"]),
    });
    await expect(store.getRun("invalid-snapshot-run")).resolves.toMatchObject({
      status: "failed",
      staging: false,
      errorCode: "manifest_invalid",
    });
    await expect(store.getStagingCounts("invalid-snapshot")).resolves.toEqual({
      snapshotPresent: false,
      productCount: 0,
      moduleResultCount: 0,
    });
  });

  it("derives product identity from id or handle and rejects a conflicting explicit key", async () => {
    const store = createStore();
    await store.startRun({
      runId: "product-key-run",
      snapshotId: "product-key-snapshot",
      plannedModuleIds: [],
    });

    await expect(
      store.writeProducts("product-key-run", [
        { id: "101", handle: "same-product", productKey: "rogue-key" },
      ]),
    ).rejects.toBeInstanceOf(StagingStoreError);
    await expect(store.getRun("product-key-run")).resolves.toMatchObject({
      writeManifest: {
        products: { attemptedProductWrites: 0, writtenProductCount: 0 },
      },
    });
    await expect(store.getStagingCounts("product-key-snapshot")).resolves.toMatchObject({
      productCount: 0,
    });

    await store.writeProducts("product-key-run", [
      { id: "101", handle: "same-product", productKey: "101", title: "first" },
    ]);
    await store.writeProducts("product-key-run", [
      { id: "101", handle: "renamed-product", title: "updated" },
    ]);
    await store.sealProductManifest("product-key-run", 1);
    await store.writeSnapshotDraft(
      "product-key-run",
      validSnapshotDraft("https://product-key.test"),
    );
    const committed = await store.commitRun("product-key-run");
    expect(committed.products).toHaveLength(1);
    expect(committed.products[0]).toMatchObject({
      productKey: "101",
      value: { title: "updated" },
    });
  });

  it("keeps runId and snapshotId one-to-one when either identifier is replayed", async () => {
    const store = createStore();
    await store.startRun({
      runId: "stable-run",
      snapshotId: "stable-snapshot",
      plannedModuleIds: [],
    });

    await expect(
      store.startRun({
        runId: "stable-run",
        snapshotId: "different-snapshot",
        plannedModuleIds: [],
      }),
    ).rejects.toMatchObject({ name: "ConstraintError" });
    await expect(
      store.startRun({
        runId: "different-run",
        snapshotId: "stable-snapshot",
        plannedModuleIds: [],
      }),
    ).rejects.toMatchObject({ name: "ConstraintError" });

    await expect(store.getRun("stable-run")).resolves.toMatchObject({
      snapshotId: "stable-snapshot",
      status: "running",
      staging: true,
    });
    await expect(store.getRun("different-run")).resolves.toBeUndefined();
  });

  it("replays a module result idempotently and publishes only its latest value", async () => {
    const store = createStore();
    await store.startRun({
      runId: "module-replay-run",
      snapshotId: "module-replay-snapshot",
      plannedModuleIds: ["catalog"],
    });
    await store.writeModuleResult("module-replay-run", {
      moduleId: "catalog",
      status: "partial",
      result: { revision: 1 },
    });
    await store.writeModuleResult("module-replay-run", {
      moduleId: "catalog",
      status: "completed",
      result: { revision: 2 },
    });
    await expect(store.getStagingCounts("module-replay-snapshot")).resolves.toMatchObject({
      moduleResultCount: 1,
    });
    await store.sealProductManifest("module-replay-run", 0);
    await store.writeSnapshotDraft(
      "module-replay-run",
      validSnapshotDraft("https://module-replay.test"),
    );

    const committed = await store.commitRun("module-replay-run");
    expect(committed.moduleResults).toEqual([
      expect.objectContaining({
        moduleId: "catalog",
        status: "completed",
        result: { revision: 2 },
      }),
    ]);
  });

  it("rejects an incomplete write manifest and cascades cleanup before returning", async () => {
    const store = createStore();
    await store.startRun({
      runId: "incomplete-run",
      snapshotId: "incomplete-snapshot",
      plannedModuleIds: ["catalog", "apps"],
    });
    await store.writeProducts("incomplete-run", [
      { id: "product-1", handle: "product-1" },
    ]);
    await store.sealProductManifest("incomplete-run", 1);
    await store.writeModuleResult("incomplete-run", {
      moduleId: "catalog",
      status: "completed",
    });
    await store.writeSnapshotDraft("incomplete-run", {
      storeKey: "https://incomplete.test",
    });

    const commitError = await store
      .commitRun("incomplete-run")
      .catch((error: unknown) => error);
    expect(commitError).toBeInstanceOf(ManifestValidationError);
    expect(commitError).toEqual(
      expect.objectContaining({
        issues: expect.arrayContaining([
          "planned module apps has no terminal result",
        ]),
      }),
    );
    expect(
      await store.getRun("incomplete-run"),
    ).toMatchObject({ status: "failed", staging: false, errorCode: "manifest_invalid" });
    await expect(
      store.getStagingCounts("incomplete-snapshot"),
    ).resolves.toEqual({
      snapshotPresent: false,
      productCount: 0,
      moduleResultCount: 0,
    });
    await expect(
      store.getCommittedSnapshot("incomplete-snapshot"),
    ).resolves.toBeUndefined();
  });

  it("cascades product, module, and draft deletion for cancellation and failure", async () => {
    const store = createStore();

    for (const [runId, snapshotId] of [
      ["cancel-run", "cancel-snapshot"],
      ["fail-run", "fail-snapshot"],
    ] as const) {
      await store.startRun({
        runId,
        snapshotId,
        plannedModuleIds: ["catalog", "apps", "reviews"],
      });
      await store.writeProducts(runId, [
        { id: `${runId}-1`, handle: `${runId}-1` },
        { id: `${runId}-2`, handle: `${runId}-2` },
        { id: `${runId}-3`, handle: `${runId}-3` },
      ]);
      for (const moduleId of ["catalog", "apps", "reviews"]) {
        await store.writeModuleResult(runId, {
          moduleId,
          status: "completed",
        });
      }
      await store.writeSnapshotDraft(runId, {
        storeKey: `https://${runId}.test`,
      });
      await expect(store.getStagingCounts(snapshotId)).resolves.toEqual({
        snapshotPresent: true,
        productCount: 3,
        moduleResultCount: 3,
      });
    }

    await store.cancelRun("cancel-run");
    await store.failRun("fail-run", "network");

    await expect(store.getRun("cancel-run")).resolves.toMatchObject({
      status: "cancelled",
      staging: false,
    });
    await expect(store.getRun("fail-run")).resolves.toMatchObject({
      status: "failed",
      staging: false,
      errorCode: "network",
    });
    await expect(store.getStagingCounts("cancel-snapshot")).resolves.toEqual({
      snapshotPresent: false,
      productCount: 0,
      moduleResultCount: 0,
    });
    await expect(store.getStagingCounts("fail-snapshot")).resolves.toEqual({
      snapshotPresent: false,
      productCount: 0,
      moduleResultCount: 0,
    });
  });

  it("rolls back an entire product batch when a transaction fault follows the first put", async () => {
    const databaseName = `staging-product-rollback-${crypto.randomUUID()}`;
    let injectFault = true;
    const firstProcess = createStore({
      databaseName,
      transactionFaultInjector: (context) => {
        if (
          injectFault &&
          context.point === "write-products:after-product-put" &&
          context.recordIndex === 0
        ) {
          injectFault = false;
          throw new Error("simulated product transaction abort");
        }
      },
    });
    await firstProcess.startRun({
      runId: "product-rollback-run",
      snapshotId: "product-rollback-snapshot",
      plannedModuleIds: [],
    });

    await expect(
      firstProcess.writeProducts("product-rollback-run", [
        { id: "product-1", handle: "product-1" },
        { id: "product-2", handle: "product-2" },
        { id: "product-3", handle: "product-3" },
      ]),
    ).rejects.toThrow("simulated product transaction abort");
    await firstProcess.close();

    const restartedProcess = createStore({ databaseName });
    await expect(
      restartedProcess.getStagingCounts("product-rollback-snapshot"),
    ).resolves.toEqual({
      snapshotPresent: false,
      productCount: 0,
      moduleResultCount: 0,
    });
    await expect(restartedProcess.getRun("product-rollback-run")).resolves.toMatchObject({
      status: "running",
      staging: true,
      writeManifest: {
        products: { attemptedProductWrites: 0, writtenProductCount: 0 },
      },
    });
  });

  it("rolls back snapshot publication when commit faults before the run update", async () => {
    const databaseName = `staging-commit-rollback-${crypto.randomUUID()}`;
    let injectFault = true;
    const firstProcess = createStore({
      databaseName,
      transactionFaultInjector: (context) => {
        if (injectFault && context.point === "commit-run:after-snapshot-put") {
          injectFault = false;
          throw new Error("simulated commit transaction abort");
        }
      },
    });
    await prepareCommittableFixture(
      firstProcess,
      "commit-rollback-run",
      "commit-rollback-snapshot",
    );

    await expect(firstProcess.commitRun("commit-rollback-run")).rejects.toThrow(
      "simulated commit transaction abort",
    );
    await expect(
      firstProcess.getCommittedSnapshot("commit-rollback-snapshot"),
    ).resolves.toBeUndefined();
    await expect(firstProcess.getRun("commit-rollback-run")).resolves.toMatchObject({
      status: "running",
      staging: true,
    });
    await firstProcess.close();

    const restartedProcess = createStore({ databaseName });
    await expect(
      restartedProcess.getCommittedSnapshot("commit-rollback-snapshot"),
    ).resolves.toBeUndefined();
    await expect(restartedProcess.commitRun("commit-rollback-run")).resolves.toMatchObject({
      snapshot: { committed: true },
    });
    await expect(restartedProcess.getRun("commit-rollback-run")).resolves.toMatchObject({
      status: "completed",
      staging: false,
    });
  });

  it("reconciles persisted staging after a process restart without exposing it", async () => {
    const databaseName = `staging-crash-${crypto.randomUUID()}`;
    let now = 1_000;
    const firstProcess = createStore({ databaseName, now: () => now });
    await firstProcess.startRun({
      runId: "crashed-run",
      snapshotId: "crashed-snapshot",
      plannedModuleIds: ["catalog"],
    });
    await firstProcess.writeProducts("crashed-run", [
      { id: 1, handle: "left-behind" },
    ]);
    await firstProcess.writeModuleResult("crashed-run", {
      moduleId: "catalog",
      status: "completed",
    });
    await firstProcess.writeSnapshotDraft("crashed-run", {
      storeKey: "https://crash.test",
    });

    // This covers restart between transactions; the fault tests above cover
    // rollback while a product or commit transaction is still in flight.
    await firstProcess.close();
    now = 121_000;
    const restartedProcess = createStore({ databaseName, now: () => now });

    await expect(
      restartedProcess.getCommittedSnapshot("crashed-snapshot"),
    ).resolves.toBeUndefined();
    await expect(restartedProcess.reconcileStaleRuns(61_000)).resolves.toEqual([
      "crashed-run",
    ]);
    await expect(restartedProcess.getRun("crashed-run")).resolves.toMatchObject({
      status: "interrupted",
      staging: false,
      errorCode: "stale_run",
    });
    await expect(
      restartedProcess.getStagingCounts("crashed-snapshot"),
    ).resolves.toEqual({
      snapshotPresent: false,
      productCount: 0,
      moduleResultCount: 0,
    });
  });

  it("manually removes uncommitted/orphan data while preserving committed history", async () => {
    const store = createStore();
    await createCommittedFixture(store, "history", "history-snapshot");

    await store.startRun({
      runId: "orphan-run",
      snapshotId: "orphan-snapshot",
      plannedModuleIds: ["catalog", "apps", "reviews"],
    });
    await store.writeProducts("orphan-run", [
      { id: "orphan-product-1", handle: "orphan-1" },
      { id: "orphan-product-2", handle: "orphan-2" },
      { id: "orphan-product-3", handle: "orphan-3" },
    ]);
    for (const moduleId of ["catalog", "apps", "reviews"]) {
      await store.writeModuleResult("orphan-run", {
        moduleId,
        status: "completed",
      });
    }
    await store.writeSnapshotDraft("orphan-run", {
      storeKey: "https://orphan.test",
    });

    await expect(store.cleanupUncommittedData()).resolves.toEqual({
      snapshotCount: 1,
      productCount: 3,
      moduleResultCount: 3,
      interruptedRunIds: ["orphan-run"],
    });
    await expect(store.getRun("orphan-run")).resolves.toMatchObject({
      status: "interrupted",
      staging: false,
      errorCode: "orphan_cleanup",
    });
    await expect(store.getCommittedSnapshot("history-snapshot")).resolves.toMatchObject({
      snapshot: { committed: true },
      products: [{ productKey: "history-product" }],
    });
  });

  it("turns an injected quota failure into a clean failed run without damaging history", async () => {
    let quotaEnabled = false;
    const store = createStore({
      transactionFaultInjector: (context) => {
        if (
          quotaEnabled &&
          context.point === "write-products:after-product-put" &&
          context.runId === "quota-run" &&
          context.recordIndex === 0
        ) {
          quotaEnabled = false;
          throw new DOMException("simulated small quota", "QuotaExceededError");
        }
      },
    });
    await createCommittedFixture(store, "history", "history-snapshot");

    await store.startRun({
      runId: "quota-run",
      snapshotId: "quota-snapshot",
      plannedModuleIds: ["catalog"],
    });
    await store.writeSnapshotDraft("quota-run", {
      storeKey: "https://quota.test",
    });
    quotaEnabled = true;

    await expect(
      store.writeProducts("quota-run", [
        { id: "too-large-1", handle: "too-large-1" },
        { id: "too-large-2", handle: "too-large-2" },
      ]),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    await expect(store.getRun("quota-run")).resolves.toMatchObject({
      status: "failed",
      staging: false,
      errorCode: "quota_exceeded",
    });
    await expect(store.getStagingCounts("quota-snapshot")).resolves.toEqual({
      snapshotPresent: false,
      productCount: 0,
      moduleResultCount: 0,
    });
    await expect(store.getCommittedSnapshot("history-snapshot")).resolves.toMatchObject({
      snapshot: { committed: true },
      products: [{ productKey: "history-product" }],
    });
  });

  it("cleans a run when its heartbeat write hits quota inside the transaction", async () => {
    let quotaEnabled = false;
    const store = createStore({
      transactionFaultInjector: (context) => {
        if (quotaEnabled && context.point === "heartbeat-run:after-run-put") {
          quotaEnabled = false;
          throw new DOMException("simulated heartbeat quota", "QuotaExceededError");
        }
      },
    });
    await createCommittedFixture(store, "heartbeat-history", "heartbeat-history-snapshot");
    await store.startRun({
      runId: "heartbeat-quota-run",
      snapshotId: "heartbeat-quota-snapshot",
      plannedModuleIds: [],
      heartbeatAt: 1_000,
    });
    await store.writeSnapshotDraft("heartbeat-quota-run", {
      storeKey: "https://heartbeat-quota.test",
    });
    quotaEnabled = true;

    await expect(store.heartbeatRun("heartbeat-quota-run", 2_000)).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    await expect(store.getRun("heartbeat-quota-run")).resolves.toMatchObject({
      status: "failed",
      staging: false,
      errorCode: "quota_exceeded",
    });
    await expect(store.getStagingCounts("heartbeat-quota-snapshot")).resolves.toEqual({
      snapshotPresent: false,
      productCount: 0,
      moduleResultCount: 0,
    });
    await expect(
      store.getCommittedSnapshot("heartbeat-history-snapshot"),
    ).resolves.toMatchObject({ snapshot: { committed: true } });
  });
});

async function createCommittedFixture(
  store: StagingStore,
  runId: string,
  snapshotId: string,
): Promise<void> {
  await prepareCommittableFixture(store, runId, snapshotId);
  await store.commitRun(runId);
}

async function prepareCommittableFixture(
  store: StagingStore,
  runId: string,
  snapshotId: string,
): Promise<void> {
  await store.startRun({
    runId,
    snapshotId,
    plannedModuleIds: ["catalog"],
  });
  await store.writeProducts(runId, [
    { id: `${runId}-product`, handle: `${runId}-product` },
  ]);
  await store.sealProductManifest(runId, 1);
  await store.writeModuleResult(runId, {
    moduleId: "catalog",
    status: "completed",
  });
  await store.writeSnapshotDraft(runId, {
    ...validSnapshotDraft(`https://${runId}.test`),
  });
}

function validSnapshotDraft(
  storeKey: string,
  overrides: Partial<SnapshotDraftInput> = {},
): SnapshotDraftInput {
  return {
    storeKey,
    origin: storeKey,
    storefrontKind: "uncertain",
    storefrontKindEvidence: [],
    scannedAt: "2026-07-20T00:00:00.000Z",
    context: {
      routeRoot: "/",
      routeRootSource: "fallback",
      localeSource: "unknown",
      countrySource: "unknown",
      currencySource: "unknown",
      priceSourceStatus: {},
      priceContextVerified: false,
      credentialMode: "omit",
      transport: "service-worker",
      storefrontKind: "uncertain",
    },
    coverage: {
      productsFetched: 0,
      truncated: false,
      sources: [],
      capabilityProbes: {},
    },
    store: {},
    rankings: [],
    newness: [],
    apps: [],
    socials: [],
    errors: [],
    ...overrides,
  };
}
