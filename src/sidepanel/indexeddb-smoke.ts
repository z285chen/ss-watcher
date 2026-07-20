import { StagingStore } from "../core/storage/staging-store";

export type IndexedDbSmokeResult = {
  ok: true;
  nativeIndexedDb: true;
  commit: {
    committedAfterReopen: true;
    productCount: number;
    moduleResultCount: number;
  };
  productRollback: {
    faultObserved: true;
    productCountAfterReopen: 0;
    attemptedWritesAfterReopen: 0;
  };
  commitRollback: {
    faultObserved: true;
    invisibleAfterFault: true;
    retryCommitted: true;
  };
  quotaFailure: {
    faultObserved: true;
    runStatus: "failed";
    errorCode: "quota_exceeded";
    stagingRowsAfterFailure: 0;
  };
  storageEstimate: {
    usage?: number;
    quota?: number;
  };
  temporaryDatabasesDeleted: true;
};

/**
 * Runs the SPK-7 smoke suite against the browser's native IndexedDB, never
 * fake-indexeddb. Every database has a random M0-only name and is deleted in a
 * finally block, so the check cannot touch production snapshots.
 */
export async function runIndexedDbSmoke(): Promise<IndexedDbSmokeResult> {
  if (globalThis.indexedDB === undefined) {
    throw new Error("Native IndexedDB is unavailable in the Side Panel");
  }

  const prefix = `ss-watcher-m0-${crypto.randomUUID()}`;
  const databaseNames = {
    commit: `${prefix}-commit`,
    productRollback: `${prefix}-product-rollback`,
    commitRollback: `${prefix}-commit-rollback`,
    quota: `${prefix}-quota`,
  };

  try {
    const commit = await verifyCommitPersistence(databaseNames.commit);
    const productRollback = await verifyProductRollback(
      databaseNames.productRollback,
    );
    const commitRollback = await verifyCommitRollback(
      databaseNames.commitRollback,
    );
    const quotaFailure = await verifyQuotaCleanup(databaseNames.quota);
    const estimate = await navigator.storage?.estimate?.();

    return {
      ok: true,
      nativeIndexedDb: true,
      commit,
      productRollback,
      commitRollback,
      quotaFailure,
      storageEstimate: {
        ...(estimate?.usage === undefined ? {} : { usage: estimate.usage }),
        ...(estimate?.quota === undefined ? {} : { quota: estimate.quota }),
      },
      temporaryDatabasesDeleted: true,
    };
  } finally {
    await Promise.all(
      Object.values(databaseNames).map((databaseName) =>
        deleteTemporaryDatabase(databaseName),
      ),
    );
  }
}

async function verifyCommitPersistence(
  databaseName: string,
): Promise<IndexedDbSmokeResult["commit"]> {
  const store = new StagingStore({ databaseName });
  try {
    await prepareCommittableRun(store, "commit-run", "commit-snapshot");
    assert(
      (await store.getCommittedSnapshot("commit-snapshot")) === undefined,
      "staging snapshot became visible before commit",
    );
    await store.commitRun("commit-run");
    await store.close();

    const reopened = new StagingStore({ databaseName });
    try {
      const bundle = await reopened.getCommittedSnapshot("commit-snapshot");
      assert(bundle !== undefined, "committed snapshot missing after reopen");
      assert(bundle.snapshot.committed, "snapshot is not marked committed");
      assert(bundle.products.length === 2, "unexpected committed product count");
      assert(
        bundle.moduleResults.length === 1,
        "unexpected committed module-result count",
      );
      return {
        committedAfterReopen: true,
        productCount: bundle.products.length,
        moduleResultCount: bundle.moduleResults.length,
      };
    } finally {
      await reopened.close();
    }
  } finally {
    await store.close();
  }
}

async function verifyProductRollback(
  databaseName: string,
): Promise<IndexedDbSmokeResult["productRollback"]> {
  let injectFault = true;
  const faulting = new StagingStore({
    databaseName,
    transactionFaultInjector: (context) => {
      if (
        injectFault &&
        context.point === "write-products:after-product-put" &&
        context.recordIndex === 0
      ) {
        injectFault = false;
        throw new Error("m0_product_transaction_fault");
      }
    },
  });
  let faultObserved = false;
  try {
    await faulting.startRun({
      runId: "rollback-run",
      snapshotId: "rollback-snapshot",
      plannedModuleIds: [],
    });
    try {
      await faulting.writeProducts("rollback-run", [
        { id: 1, handle: "one" },
        { id: 2, handle: "two" },
      ]);
    } catch (error: unknown) {
      faultObserved = error instanceof Error &&
        error.message.includes("m0_product_transaction_fault");
    }
  } finally {
    await faulting.close();
  }
  assert(faultObserved, "product transaction fault was not observed");

  const reopened = new StagingStore({ databaseName });
  try {
    const counts = await reopened.getStagingCounts("rollback-snapshot");
    const run = await reopened.getRun("rollback-run");
    assert(counts.productCount === 0, "partial product batch survived reopen");
    assert(
      run?.writeManifest.products.attemptedProductWrites === 0,
      "rolled-back manifest write survived reopen",
    );
    return {
      faultObserved: true,
      productCountAfterReopen: 0,
      attemptedWritesAfterReopen: 0,
    };
  } finally {
    await reopened.close();
  }
}

async function verifyCommitRollback(
  databaseName: string,
): Promise<IndexedDbSmokeResult["commitRollback"]> {
  let injectFault = true;
  const faulting = new StagingStore({
    databaseName,
    transactionFaultInjector: (context) => {
      if (injectFault && context.point === "commit-run:after-snapshot-put") {
        injectFault = false;
        throw new Error("m0_commit_transaction_fault");
      }
    },
  });
  let faultObserved = false;
  try {
    await prepareCommittableRun(faulting, "atomic-run", "atomic-snapshot");
    try {
      await faulting.commitRun("atomic-run");
    } catch (error: unknown) {
      faultObserved = error instanceof Error &&
        error.message.includes("m0_commit_transaction_fault");
    }
  } finally {
    await faulting.close();
  }
  assert(faultObserved, "commit transaction fault was not observed");

  const reopened = new StagingStore({ databaseName });
  try {
    const invisible =
      (await reopened.getCommittedSnapshot("atomic-snapshot")) === undefined;
    const run = await reopened.getRun("atomic-run");
    assert(invisible, "half-committed snapshot became visible");
    assert(
      run?.status === "running" && run.staging,
      "run state did not roll back with snapshot",
    );
    const retried = await reopened.commitRun("atomic-run");
    assert(retried.snapshot.committed, "commit retry did not publish snapshot");
    return {
      faultObserved: true,
      invisibleAfterFault: true,
      retryCommitted: true,
    };
  } finally {
    await reopened.close();
  }
}

async function verifyQuotaCleanup(
  databaseName: string,
): Promise<IndexedDbSmokeResult["quotaFailure"]> {
  let quotaEnabled = false;
  const store = new StagingStore({
    databaseName,
    beforeWrite: (context) => {
      if (quotaEnabled && context.operation === "write-products") {
        quotaEnabled = false;
        throw new DOMException("m0 simulated quota", "QuotaExceededError");
      }
    },
  });
  let faultObserved = false;
  try {
    await store.startRun({
      runId: "quota-run",
      snapshotId: "quota-snapshot",
      plannedModuleIds: [],
    });
    await store.writeSnapshotDraft("quota-run", smokeSnapshot("https://quota.test"));
    quotaEnabled = true;
    try {
      await store.writeProducts("quota-run", [{ id: 1, handle: "quota" }]);
    } catch (error: unknown) {
      faultObserved = error instanceof DOMException &&
        error.name === "QuotaExceededError";
    }
    const run = await store.getRun("quota-run");
    const counts = await store.getStagingCounts("quota-snapshot");
    assert(faultObserved, "quota fault was not observed");
    assert(
      run?.status === "failed" && run.errorCode === "quota_exceeded",
      "quota failure did not mark run failed",
    );
    assert(
      !counts.snapshotPresent &&
        counts.productCount === 0 &&
        counts.moduleResultCount === 0,
      "quota failure left staging rows behind",
    );
    return {
      faultObserved: true,
      runStatus: "failed",
      errorCode: "quota_exceeded",
      stagingRowsAfterFailure: 0,
    };
  } finally {
    await store.close();
  }
}

async function prepareCommittableRun(
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
    { id: 1, handle: "one", title: "One" },
    { id: 2, handle: "two", title: "Two" },
  ]);
  await store.sealProductManifest(runId, 2, 2);
  await store.writeModuleResult(runId, {
    moduleId: "catalog",
    status: "completed",
    result: { fetched: 2 },
  });
  await store.writeSnapshotDraft(runId, smokeSnapshot("https://smoke.test"));
}

function smokeSnapshot(storeKey: string) {
  return {
    storeKey,
    origin: storeKey,
    storefrontKind: "uncertain",
    storefrontKindEvidence: [],
    scannedAt: new Date().toISOString(),
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
  };
}

async function deleteTemporaryDatabase(databaseName: string): Promise<void> {
  const store = new StagingStore({ databaseName });
  try {
    await store.deleteDatabase();
  } catch (error: unknown) {
    // Cleanup failure is material: the caller must not report the smoke suite
    // as successful while a temporary M0 database may remain.
    throw new Error(`Failed to delete temporary database ${databaseName}`, {
      cause: error,
    });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
