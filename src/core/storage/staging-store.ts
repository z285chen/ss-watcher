const DATABASE_VERSION = 1;
const DEFAULT_SCHEMA_VERSION = 1;
const MAX_PRODUCT_BATCH_SIZE = 100;

const TERMINAL_MODULE_STATUSES = new Set<string>([
  "completed",
  "partial",
  "failed",
  "skipped",
  "unsupported",
]);

const STORE_NAMES = {
  scanRuns: "scanRuns",
  snapshots: "snapshots",
  products: "products",
  moduleResults: "moduleResults",
} as const;

const INDEX_NAMES = {
  runBySnapshotId: "bySnapshotId",
  runByStatus: "byStatus",
  productBySnapshotId: "bySnapshotId",
  moduleResultBySnapshotId: "bySnapshotId",
} as const;

export type ScanRunStatus =
  | "running"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "completed";

export type ModuleTerminalStatus =
  | "completed"
  | "partial"
  | "failed"
  | "skipped"
  | "unsupported";

export type StagingWriteOperation =
  | "start-run"
  | "heartbeat-run"
  | "write-products"
  | "seal-product-manifest"
  | "write-module-result"
  | "write-snapshot-draft"
  | "commit-run"
  | "cleanup-run"
  | "reconcile-stale-runs"
  | "cleanup-uncommitted";

export interface ProductManifest {
  /** All put attempts, including idempotent replays. */
  attemptedProductWrites: number;
  /** Current number of distinct [snapshotId + productKey] records. */
  writtenProductCount: number;
  /** Final distinct count declared by the coordinator. */
  expectedProductCount: number | null;
  /** Final distinct count persisted in the pagination checkpoint. */
  checkpointProductCount: number | null;
  sealed: boolean;
}

export interface WriteManifest {
  plannedModuleIds: string[];
  products: ProductManifest;
}

export interface ScanRunRecord {
  schemaVersion: number;
  runId: string;
  snapshotId: string;
  status: ScanRunStatus;
  staging: boolean;
  startedAt: number;
  heartbeatAt: number;
  finishedAt?: number;
  errorCode?: string;
  writeManifest: WriteManifest;
}

export interface StartRunInput {
  runId: string;
  snapshotId: string;
  plannedModuleIds: readonly string[];
  schemaVersion?: number;
  heartbeatAt?: number;
}

export interface StagedProductInput {
  productKey?: string;
  id?: string | number;
  handle?: string;
  canonicalUrl?: string;
  [key: string]: unknown;
}

export interface ProductRecord<TProduct extends StagedProductInput = StagedProductInput> {
  schemaVersion: number;
  snapshotId: string;
  productKey: string;
  value: TProduct;
}

export interface ModuleResultInput<TResult = unknown> {
  moduleId: string;
  status: ModuleTerminalStatus;
  result?: TResult;
  errors?: readonly unknown[];
}

export interface ModuleResultRecord<TResult = unknown> {
  schemaVersion: number;
  snapshotId: string;
  moduleId: string;
  status: ModuleTerminalStatus;
  result?: TResult;
  errors?: readonly unknown[];
}

export interface SnapshotDraftInput {
  storeKey: string;
  schemaVersion?: number;
  snapshotId?: string;
  committed?: boolean;
  [key: string]: unknown;
}

export interface SnapshotRecord {
  schemaVersion: number;
  snapshotId: string;
  storeKey: string;
  committed: boolean;
  [key: string]: unknown;
}

export interface CommittedSnapshotRecord extends SnapshotRecord {
  committed: true;
}

export interface CommittedSnapshotBundle {
  snapshot: CommittedSnapshotRecord;
  products: ProductRecord[];
  moduleResults: ModuleResultRecord[];
}

export interface StagingCounts {
  snapshotPresent: boolean;
  productCount: number;
  moduleResultCount: number;
}

export interface CleanupSummary {
  snapshotCount: number;
  productCount: number;
  moduleResultCount: number;
  interruptedRunIds: string[];
}

export interface WriteInterceptionContext {
  operation: StagingWriteOperation;
  runId?: string;
  snapshotId?: string;
  recordCount?: number;
}

export type TransactionFaultPoint =
  | "heartbeat-run:after-run-put"
  | "write-products:after-product-put"
  | "commit-run:after-snapshot-put";

export interface TransactionFaultContext {
  point: TransactionFaultPoint;
  runId: string;
  snapshotId: string;
  recordIndex?: number;
}

export type SnapshotValidator = (
  snapshot: SnapshotRecord,
) => true | string | readonly string[];

export interface StagingStoreOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
  schemaVersion?: number;
  now?: () => number;
  beforeWrite?: (
    context: WriteInterceptionContext,
  ) => void | Promise<void>;
  /** Synchronous M0 fault hook used to prove IndexedDB rollback boundaries. */
  transactionFaultInjector?: (context: TransactionFaultContext) => void;
  snapshotValidator?: SnapshotValidator;
}

export class StagingStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StagingStoreError";
  }
}

export class RunNotFoundError extends StagingStoreError {
  constructor(runId: string) {
    super(`Scan run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

export class RunStateError extends StagingStoreError {
  constructor(runId: string, message: string) {
    super(`Invalid state for scan run ${runId}: ${message}`);
    this.name = "RunStateError";
  }
}

export class ManifestValidationError extends StagingStoreError {
  readonly issues: readonly string[];

  constructor(runId: string, issues: readonly string[]) {
    super(`Write manifest validation failed for ${runId}: ${issues.join("; ")}`);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

/**
 * IndexedDB staging store used by the M0 storage spike.
 *
 * Normal snapshot reads are deliberately committed-only. The only method that
 * exposes staging state is `getStagingCounts`, which is intended for diagnostics
 * and cleanup verification rather than product reads.
 */
export class StagingStore {
  readonly databaseName: string;

  private readonly factory: IDBFactory;
  private readonly schemaVersion: number;
  private readonly now: () => number;
  private readonly beforeWrite?: StagingStoreOptions["beforeWrite"];
  private readonly transactionFaultInjector:
    | StagingStoreOptions["transactionFaultInjector"]
    | undefined;
  private readonly snapshotValidator: SnapshotValidator | undefined;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: StagingStoreOptions = {}) {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) {
      throw new StagingStoreError("IndexedDB is not available in this context");
    }

    // Preserve the pre-SS-Watcher namespace so existing local committed
    // snapshots remain readable after the product rename.
    this.databaseName = options.databaseName ?? "shopify-store-inspector";
    this.factory = factory;
    this.schemaVersion = options.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
    this.now = options.now ?? Date.now;
    this.beforeWrite = options.beforeWrite;
    this.transactionFaultInjector = options.transactionFaultInjector;
    this.snapshotValidator = options.snapshotValidator;
  }

  async open(): Promise<void> {
    await this.getDatabase();
  }

  async close(): Promise<void> {
    if (!this.databasePromise) {
      return;
    }

    const database = await this.databasePromise;
    database.close();
    this.databasePromise = undefined;
  }

  /** Test/dev helper. Production data deletion should be gated by UI confirmation. */
  async deleteDatabase(): Promise<void> {
    await this.close();
    await new Promise<void>((resolve, reject) => {
      const request = this.factory.deleteDatabase(this.databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Database deletion failed"));
      request.onblocked = () => reject(new StagingStoreError("Database deletion was blocked"));
    });
  }

  async startRun(input: StartRunInput): Promise<ScanRunRecord> {
    assertNonEmpty(input.runId, "runId");
    assertNonEmpty(input.snapshotId, "snapshotId");

    const plannedModuleIds = normalizeModuleIds(input.plannedModuleIds);
    const timestamp = input.heartbeatAt ?? this.now();
    const run: ScanRunRecord = {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      runId: input.runId,
      snapshotId: input.snapshotId,
      status: "running",
      staging: true,
      startedAt: timestamp,
      heartbeatAt: timestamp,
      writeManifest: {
        plannedModuleIds,
        products: {
          attemptedProductWrites: 0,
          writtenProductCount: 0,
          expectedProductCount: null,
          checkpointProductCount: null,
          sealed: false,
        },
      },
    };

    await this.intercept({
      operation: "start-run",
      runId: run.runId,
      snapshotId: run.snapshotId,
    });

    const database = await this.getDatabase();
    const transaction = database.transaction(STORE_NAMES.scanRuns, "readwrite");
    await runTransaction(transaction, async () => {
      await requestResult(transaction.objectStore(STORE_NAMES.scanRuns).add(run));
    });
    return cloneValue(run);
  }

  async heartbeatRun(runId: string, heartbeatAt = this.now()): Promise<void> {
    try {
      await this.intercept({ operation: "heartbeat-run", runId });
      const database = await this.getDatabase();
      const transaction = database.transaction(STORE_NAMES.scanRuns, "readwrite");
      await runTransaction(transaction, async () => {
        const store = transaction.objectStore(STORE_NAMES.scanRuns);
        const run = await requireRunningRun(store, runId);
        run.heartbeatAt = heartbeatAt;
        await requestResult(store.put(run));
        this.injectTransactionFault({
          point: "heartbeat-run:after-run-put",
          runId,
          snapshotId: run.snapshotId,
        });
      });
    } catch (error) {
      return await this.handlePossibleQuotaFailure(runId, error);
    }
  }

  async writeProducts<TProduct extends StagedProductInput>(
    runId: string,
    products: readonly TProduct[],
  ): Promise<ProductManifest> {
    if (products.length === 0) {
      const run = await this.getRun(runId);
      if (!run) {
        throw new RunNotFoundError(runId);
      }
      if (run.status !== "running" || !run.staging) {
        throw new RunStateError(runId, "product writes require a running staging run");
      }
      return cloneValue(run.writeManifest.products);
    }
    if (products.length > MAX_PRODUCT_BATCH_SIZE) {
      throw new StagingStoreError(
        `Product batch exceeds ${MAX_PRODUCT_BATCH_SIZE} records`,
      );
    }

    const keyedProducts = products.map((product) => ({
      product,
      productKey: resolveProductKey(product),
    }));

    try {
      await this.intercept({
        operation: "write-products",
        runId,
        recordCount: products.length,
      });

      const database = await this.getDatabase();
      const transaction = database.transaction(
        [STORE_NAMES.scanRuns, STORE_NAMES.products],
        "readwrite",
      );
      return await runTransaction(transaction, async () => {
        const runStore = transaction.objectStore(STORE_NAMES.scanRuns);
        const productStore = transaction.objectStore(STORE_NAMES.products);
        const run = await requireRunningRun(runStore, runId);

        if (run.writeManifest.products.sealed) {
          throw new RunStateError(runId, "product manifest is already sealed");
        }

        for (const [recordIndex, { product, productKey }] of keyedProducts.entries()) {
          const record: ProductRecord<TProduct> = {
            schemaVersion: run.schemaVersion,
            snapshotId: run.snapshotId,
            productKey,
            value: cloneValue(product),
          };
          await requestResult(productStore.put(record));
          this.injectTransactionFault({
            point: "write-products:after-product-put",
            runId,
            snapshotId: run.snapshotId,
            recordIndex,
          });
        }

        const writtenProductCount = await requestResult(
          productStore.index(INDEX_NAMES.productBySnapshotId).count(run.snapshotId),
        );
        run.writeManifest.products.attemptedProductWrites += products.length;
        run.writeManifest.products.writtenProductCount = writtenProductCount;
        run.heartbeatAt = this.now();
        await requestResult(runStore.put(run));
        return cloneValue(run.writeManifest.products);
      });
    } catch (error) {
      return await this.handlePossibleQuotaFailure(runId, error);
    }
  }

  async sealProductManifest(
    runId: string,
    expectedProductCount: number,
    checkpointProductCount = expectedProductCount,
  ): Promise<ProductManifest> {
    assertNonNegativeInteger(expectedProductCount, "expectedProductCount");
    assertNonNegativeInteger(checkpointProductCount, "checkpointProductCount");

    try {
      await this.intercept({ operation: "seal-product-manifest", runId });
      const database = await this.getDatabase();
      const transaction = database.transaction(STORE_NAMES.scanRuns, "readwrite");
      return await runTransaction(transaction, async () => {
        const store = transaction.objectStore(STORE_NAMES.scanRuns);
        const run = await requireRunningRun(store, runId);
        run.writeManifest.products.expectedProductCount = expectedProductCount;
        run.writeManifest.products.checkpointProductCount = checkpointProductCount;
        run.writeManifest.products.sealed = true;
        run.heartbeatAt = this.now();
        await requestResult(store.put(run));
        return cloneValue(run.writeManifest.products);
      });
    } catch (error) {
      return await this.handlePossibleQuotaFailure(runId, error);
    }
  }

  async writeModuleResult<TResult>(
    runId: string,
    input: ModuleResultInput<TResult>,
  ): Promise<ModuleResultRecord<TResult>> {
    assertNonEmpty(input.moduleId, "moduleId");
    if (!TERMINAL_MODULE_STATUSES.has(input.status)) {
      throw new StagingStoreError(
        `Module ${input.moduleId} does not have a terminal status`,
      );
    }

    try {
      await this.intercept({ operation: "write-module-result", runId });
      const database = await this.getDatabase();
      const transaction = database.transaction(
        [STORE_NAMES.scanRuns, STORE_NAMES.moduleResults],
        "readwrite",
      );
      return await runTransaction(transaction, async () => {
        const runStore = transaction.objectStore(STORE_NAMES.scanRuns);
        const run = await requireRunningRun(runStore, runId);
        if (!run.writeManifest.plannedModuleIds.includes(input.moduleId)) {
          throw new StagingStoreError(
            `Module ${input.moduleId} is not present in the write manifest`,
          );
        }

        const record: ModuleResultRecord<TResult> = {
          schemaVersion: run.schemaVersion,
          snapshotId: run.snapshotId,
          moduleId: input.moduleId,
          status: input.status,
          ...(input.result === undefined ? {} : { result: cloneValue(input.result) }),
          ...(input.errors === undefined ? {} : { errors: cloneValue(input.errors) }),
        };
        await requestResult(
          transaction.objectStore(STORE_NAMES.moduleResults).put(record),
        );
        run.heartbeatAt = this.now();
        await requestResult(runStore.put(run));
        return cloneValue(record);
      });
    } catch (error) {
      return await this.handlePossibleQuotaFailure(runId, error);
    }
  }

  async writeSnapshotDraft(
    runId: string,
    input: SnapshotDraftInput,
  ): Promise<SnapshotRecord> {
    assertNonEmpty(input.storeKey, "snapshot.storeKey");
    if (input.committed === true) {
      throw new StagingStoreError("A snapshot draft cannot be pre-committed");
    }

    try {
      await this.intercept({ operation: "write-snapshot-draft", runId });
      const database = await this.getDatabase();
      const transaction = database.transaction(
        [STORE_NAMES.scanRuns, STORE_NAMES.snapshots],
        "readwrite",
      );
      return await runTransaction(transaction, async () => {
        const runStore = transaction.objectStore(STORE_NAMES.scanRuns);
        const run = await requireRunningRun(runStore, runId);
        if (input.snapshotId !== undefined && input.snapshotId !== run.snapshotId) {
          throw new StagingStoreError(
            `Snapshot draft ${input.snapshotId} does not belong to run ${runId}`,
          );
        }
        if (
          input.schemaVersion !== undefined &&
          input.schemaVersion !== run.schemaVersion
        ) {
          throw new StagingStoreError("Snapshot and ScanRun schema versions differ");
        }

        const record: SnapshotRecord = {
          ...cloneValue(input),
          schemaVersion: run.schemaVersion,
          snapshotId: run.snapshotId,
          storeKey: input.storeKey,
          committed: false,
        };
        await requestResult(
          transaction.objectStore(STORE_NAMES.snapshots).put(record),
        );
        run.heartbeatAt = this.now();
        await requestResult(runStore.put(run));
        return cloneValue(record);
      });
    } catch (error) {
      return await this.handlePossibleQuotaFailure(runId, error);
    }
  }

  async commitRun(runId: string): Promise<CommittedSnapshotBundle> {
    try {
      await this.intercept({ operation: "commit-run", runId });
      const database = await this.getDatabase();
      const transaction = database.transaction(
        [
          STORE_NAMES.scanRuns,
          STORE_NAMES.snapshots,
          STORE_NAMES.products,
          STORE_NAMES.moduleResults,
        ],
        "readwrite",
      );

      return await runTransaction(transaction, async () => {
        const runStore = transaction.objectStore(STORE_NAMES.scanRuns);
        const snapshotStore = transaction.objectStore(STORE_NAMES.snapshots);
        const productStore = transaction.objectStore(STORE_NAMES.products);
        const moduleResultStore = transaction.objectStore(STORE_NAMES.moduleResults);
        const run = await requireRunningRun(runStore, runId);

        const [snapshot, products, moduleResults] = await Promise.all([
          requestResult<SnapshotRecord | undefined>(
            snapshotStore.get(run.snapshotId),
          ),
          requestResult<ProductRecord[]>(
            productStore.index(INDEX_NAMES.productBySnapshotId).getAll(run.snapshotId),
          ),
          requestResult<ModuleResultRecord[]>(
            moduleResultStore
              .index(INDEX_NAMES.moduleResultBySnapshotId)
              .getAll(run.snapshotId),
          ),
        ]);

        const issues = this.validateManifest(run, snapshot, products, moduleResults);
        if (issues.length > 0) {
          throw new ManifestValidationError(runId, issues);
        }

        const committedSnapshot: CommittedSnapshotRecord = {
          ...(snapshot as SnapshotRecord),
          committed: true,
        };
        const finishedAt = this.now();
        const completedRun: ScanRunRecord = {
          ...run,
          status: "completed",
          staging: false,
          heartbeatAt: finishedAt,
          finishedAt,
        };

        // Both writes live in this single transaction: either the committed
        // snapshot and completed run are visible together, or neither is.
        await requestResult(snapshotStore.put(committedSnapshot));
        this.injectTransactionFault({
          point: "commit-run:after-snapshot-put",
          runId,
          snapshotId: run.snapshotId,
        });
        await requestResult(runStore.put(completedRun));

        return {
          snapshot: cloneValue(committedSnapshot),
          products: cloneValue(products),
          moduleResults: cloneValue(moduleResults),
        };
      });
    } catch (error) {
      if (error instanceof ManifestValidationError) {
        await this.cleanupRunInternal(runId, "failed", "manifest_invalid");
        throw error;
      }
      return await this.handlePossibleQuotaFailure(runId, error);
    }
  }

  async cancelRun(runId: string): Promise<void> {
    await this.intercept({ operation: "cleanup-run", runId });
    await this.cleanupRunInternal(runId, "cancelled");
  }

  async failRun(runId: string, errorCode = "internal"): Promise<void> {
    await this.intercept({ operation: "cleanup-run", runId });
    await this.cleanupRunInternal(runId, "failed", errorCode);
  }

  async reconcileStaleRuns(staleBefore: number): Promise<string[]> {
    await this.intercept({ operation: "reconcile-stale-runs" });
    const database = await this.getDatabase();
    const transaction = database.transaction(STORE_NAMES.scanRuns, "readonly");
    const candidates = await runTransaction(transaction, async () => {
      const runs = await requestResult<ScanRunRecord[]>(
        transaction.objectStore(STORE_NAMES.scanRuns).getAll(),
      );
      return runs
        .filter(
          (run) => run.status === "running" && run.heartbeatAt < staleBefore,
        )
        .map((run) => run.runId);
    });

    const interruptedRunIds: string[] = [];
    for (const runId of candidates) {
      const cleaned = await this.cleanupRunInternal(
        runId,
        "interrupted",
        "stale_run",
        staleBefore,
      );
      if (cleaned) {
        interruptedRunIds.push(runId);
      }
    }
    return interruptedRunIds;
  }

  /**
   * Manual orphan cleanup. It removes every child/draft not rooted at a
   * committed snapshot and turns any affected live run into `interrupted`.
   */
  async cleanupUncommittedData(): Promise<CleanupSummary> {
    await this.intercept({ operation: "cleanup-uncommitted" });
    const database = await this.getDatabase();
    const transaction = database.transaction(
      [
        STORE_NAMES.scanRuns,
        STORE_NAMES.snapshots,
        STORE_NAMES.products,
        STORE_NAMES.moduleResults,
      ],
      "readwrite",
    );

    return await runTransaction(transaction, async () => {
      const runStore = transaction.objectStore(STORE_NAMES.scanRuns);
      const snapshotStore = transaction.objectStore(STORE_NAMES.snapshots);
      const productStore = transaction.objectStore(STORE_NAMES.products);
      const moduleResultStore = transaction.objectStore(STORE_NAMES.moduleResults);
      const [runs, snapshots, products, moduleResults] = await Promise.all([
        requestResult<ScanRunRecord[]>(runStore.getAll()),
        requestResult<SnapshotRecord[]>(snapshotStore.getAll()),
        requestResult<ProductRecord[]>(productStore.getAll()),
        requestResult<ModuleResultRecord[]>(moduleResultStore.getAll()),
      ]);

      const committedSnapshotIds = new Set(
        snapshots
          .filter((snapshot) => snapshot.committed === true)
          .map((snapshot) => snapshot.snapshotId),
      );
      const uncommittedSnapshots = snapshots.filter(
        (snapshot) => !committedSnapshotIds.has(snapshot.snapshotId),
      );
      const orphanProducts = products.filter(
        (product) => !committedSnapshotIds.has(product.snapshotId),
      );
      const orphanModuleResults = moduleResults.filter(
        (result) => !committedSnapshotIds.has(result.snapshotId),
      );

      const deletes: Array<Promise<unknown>> = [];
      for (const snapshot of uncommittedSnapshots) {
        deletes.push(requestResult(snapshotStore.delete(snapshot.snapshotId)));
      }
      for (const product of orphanProducts) {
        deletes.push(
          requestResult(productStore.delete([product.snapshotId, product.productKey])),
        );
      }
      for (const result of orphanModuleResults) {
        deletes.push(
          requestResult(
            moduleResultStore.delete([result.snapshotId, result.moduleId]),
          ),
        );
      }

      const interruptedRunIds: string[] = [];
      const timestamp = this.now();
      for (const run of runs) {
        if (
          !committedSnapshotIds.has(run.snapshotId) &&
          (run.status === "running" || run.staging)
        ) {
          const interrupted: ScanRunRecord = {
            ...run,
            status: "interrupted",
            staging: false,
            heartbeatAt: timestamp,
            finishedAt: timestamp,
            errorCode: "orphan_cleanup",
          };
          deletes.push(requestResult(runStore.put(interrupted)));
          interruptedRunIds.push(run.runId);
        }
      }
      await Promise.all(deletes);

      return {
        snapshotCount: uncommittedSnapshots.length,
        productCount: orphanProducts.length,
        moduleResultCount: orphanModuleResults.length,
        interruptedRunIds,
      };
    });
  }

  async getRun(runId: string): Promise<ScanRunRecord | undefined> {
    const database = await this.getDatabase();
    const transaction = database.transaction(STORE_NAMES.scanRuns, "readonly");
    const run = await runTransaction(transaction, () =>
      requestResult<ScanRunRecord | undefined>(
        transaction.objectStore(STORE_NAMES.scanRuns).get(runId),
      ),
    );
    return run === undefined ? undefined : cloneValue(run);
  }

  async getCommittedSnapshot(
    snapshotId: string,
  ): Promise<CommittedSnapshotBundle | undefined> {
    const database = await this.getDatabase();
    const transaction = database.transaction(
      [STORE_NAMES.snapshots, STORE_NAMES.products, STORE_NAMES.moduleResults],
      "readonly",
    );
    const bundle = await runTransaction(transaction, async () => {
      const snapshot = await requestResult<SnapshotRecord | undefined>(
        transaction.objectStore(STORE_NAMES.snapshots).get(snapshotId),
      );
      if (!snapshot || snapshot.committed !== true) {
        return undefined;
      }

      const [products, moduleResults] = await Promise.all([
        requestResult<ProductRecord[]>(
          transaction
            .objectStore(STORE_NAMES.products)
            .index(INDEX_NAMES.productBySnapshotId)
            .getAll(snapshotId),
        ),
        requestResult<ModuleResultRecord[]>(
          transaction
            .objectStore(STORE_NAMES.moduleResults)
            .index(INDEX_NAMES.moduleResultBySnapshotId)
            .getAll(snapshotId),
        ),
      ]);
      return {
        snapshot: snapshot as CommittedSnapshotRecord,
        products,
        moduleResults,
      };
    });
    return bundle === undefined ? undefined : cloneValue(bundle);
  }

  async listCommittedSnapshots(): Promise<CommittedSnapshotRecord[]> {
    const database = await this.getDatabase();
    const transaction = database.transaction(STORE_NAMES.snapshots, "readonly");
    const snapshots = await runTransaction(transaction, () =>
      requestResult<SnapshotRecord[]>(
        transaction.objectStore(STORE_NAMES.snapshots).getAll(),
      ),
    );
    return cloneValue(
      snapshots.filter(
        (snapshot): snapshot is CommittedSnapshotRecord =>
          snapshot.committed === true,
      ),
    );
  }

  async getLatestCommittedSnapshot(
    storeKey?: string,
  ): Promise<CommittedSnapshotBundle | undefined> {
    const snapshots = await this.listCommittedSnapshots();
    const latest = snapshots
      .filter((snapshot) => storeKey === undefined || snapshot.storeKey === storeKey)
      .sort((left, right) => snapshotTime(right) - snapshotTime(left))[0];
    return latest === undefined
      ? undefined
      : await this.getCommittedSnapshot(latest.snapshotId);
  }

  async getStagingCounts(snapshotId: string): Promise<StagingCounts> {
    const database = await this.getDatabase();
    const transaction = database.transaction(
      [STORE_NAMES.snapshots, STORE_NAMES.products, STORE_NAMES.moduleResults],
      "readonly",
    );
    return await runTransaction(transaction, async () => {
      const [snapshot, productCount, moduleResultCount] = await Promise.all([
        requestResult<SnapshotRecord | undefined>(
          transaction.objectStore(STORE_NAMES.snapshots).get(snapshotId),
        ),
        requestResult(
          transaction
            .objectStore(STORE_NAMES.products)
            .index(INDEX_NAMES.productBySnapshotId)
            .count(snapshotId),
        ),
        requestResult(
          transaction
            .objectStore(STORE_NAMES.moduleResults)
            .index(INDEX_NAMES.moduleResultBySnapshotId)
            .count(snapshotId),
        ),
      ]);
      return {
        snapshotPresent: snapshot !== undefined,
        productCount,
        moduleResultCount,
      };
    });
  }

  private async cleanupRunInternal(
    runId: string,
    status: "interrupted" | "failed" | "cancelled",
    errorCode?: string,
    staleBefore?: number,
  ): Promise<boolean> {
    const database = await this.getDatabase();
    const transaction = database.transaction(
      [
        STORE_NAMES.scanRuns,
        STORE_NAMES.snapshots,
        STORE_NAMES.products,
        STORE_NAMES.moduleResults,
      ],
      "readwrite",
    );

    return await runTransaction(transaction, async () => {
      const runStore = transaction.objectStore(STORE_NAMES.scanRuns);
      const run = await requestResult<ScanRunRecord | undefined>(runStore.get(runId));
      if (!run) {
        throw new RunNotFoundError(runId);
      }
      if (run.status !== "running" || !run.staging) {
        if (staleBefore !== undefined) {
          return false;
        }
        throw new RunStateError(runId, "only a running staging run can be cleaned");
      }
      if (staleBefore !== undefined && run.heartbeatAt >= staleBefore) {
        return false;
      }

      const snapshotStore = transaction.objectStore(STORE_NAMES.snapshots);
      const snapshot = await requestResult<SnapshotRecord | undefined>(
        snapshotStore.get(run.snapshotId),
      );
      if (snapshot?.committed === true) {
        throw new RunStateError(
          runId,
          "refusing to clean records belonging to a committed snapshot",
        );
      }

      const productStore = transaction.objectStore(STORE_NAMES.products);
      const moduleResultStore = transaction.objectStore(STORE_NAMES.moduleResults);
      await Promise.all([
        deleteByIndex(
          productStore.index(INDEX_NAMES.productBySnapshotId),
          run.snapshotId,
        ),
        deleteByIndex(
          moduleResultStore.index(INDEX_NAMES.moduleResultBySnapshotId),
          run.snapshotId,
        ),
        requestResult(snapshotStore.delete(run.snapshotId)),
      ]);

      const finishedAt = this.now();
      const cleanedRun: ScanRunRecord = {
        ...run,
        status,
        staging: false,
        heartbeatAt: finishedAt,
        finishedAt,
        ...(errorCode === undefined ? {} : { errorCode }),
      };
      await requestResult(runStore.put(cleanedRun));
      return true;
    });
  }

  private validateManifest(
    run: ScanRunRecord,
    snapshot: SnapshotRecord | undefined,
    products: readonly ProductRecord[],
    moduleResults: readonly ModuleResultRecord[],
  ): string[] {
    const issues: string[] = [];
    const manifest = run.writeManifest;
    const productManifest = manifest.products;

    if (!productManifest.sealed) {
      issues.push("product manifest is not sealed");
    }
    if (productManifest.expectedProductCount === null) {
      issues.push("expected product count is missing");
    }
    if (productManifest.checkpointProductCount === null) {
      issues.push("checkpoint product count is missing");
    }
    if (productManifest.writtenProductCount !== products.length) {
      issues.push(
        `recorded product count ${productManifest.writtenProductCount} != actual ${products.length}`,
      );
    }
    if (
      productManifest.expectedProductCount !== null &&
      productManifest.expectedProductCount !== products.length
    ) {
      issues.push(
        `expected product count ${productManifest.expectedProductCount} != actual ${products.length}`,
      );
    }
    if (
      productManifest.checkpointProductCount !== null &&
      productManifest.checkpointProductCount !== products.length
    ) {
      issues.push(
        `checkpoint product count ${productManifest.checkpointProductCount} != actual ${products.length}`,
      );
    }

    const moduleResultsById = new Map(
      moduleResults.map((result) => [result.moduleId, result]),
    );
    for (const moduleId of manifest.plannedModuleIds) {
      const result = moduleResultsById.get(moduleId);
      if (!result || !TERMINAL_MODULE_STATUSES.has(result.status)) {
        issues.push(`planned module ${moduleId} has no terminal result`);
      }
    }

    if (!snapshot) {
      issues.push("snapshot draft is missing");
    } else {
      if (snapshot.snapshotId !== run.snapshotId) {
        issues.push("snapshot draft belongs to another run");
      }
      if (snapshot.committed !== false) {
        issues.push("snapshot draft is already committed");
      }
      if (snapshot.schemaVersion !== run.schemaVersion) {
        issues.push("snapshot and ScanRun schema versions differ");
      }
      if (!Number.isInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1) {
        issues.push("snapshot schemaVersion is invalid");
      }
      if (typeof snapshot.storeKey !== "string" || snapshot.storeKey.length === 0) {
        issues.push("snapshot storeKey is invalid");
      }

      issues.push(...validateSnapshotStructure(snapshot));

      const customValidation = this.snapshotValidator?.(snapshot);
      if (customValidation !== undefined && customValidation !== true) {
        if (typeof customValidation === "string") {
          issues.push(customValidation);
        } else {
          issues.push(...customValidation);
        }
      }
    }

    return issues;
  }

  private async handlePossibleQuotaFailure<T>(
    runId: string,
    error: unknown,
  ): Promise<T> {
    if (!isQuotaExceeded(error)) {
      throw error;
    }

    try {
      await this.cleanupRunInternal(runId, "failed", "quota_exceeded");
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Quota failure cleanup also failed for scan run ${runId}`,
      );
    }
    throw error;
  }

  private async intercept(context: WriteInterceptionContext): Promise<void> {
    await this.beforeWrite?.(context);
  }

  private injectTransactionFault(context: TransactionFaultContext): void {
    this.transactionFaultInjector?.(context);
  }

  private getDatabase(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open(this.databaseName, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          upgradeDatabase(request.result, request.transaction);
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            this.databasePromise = undefined;
          };
          resolve(database);
        };
        request.onerror = () => {
          reject(request.error ?? new StagingStoreError("Database open failed"));
        };
        request.onblocked = () => {
          reject(new StagingStoreError("Database open was blocked"));
        };
      });
    }
    return this.databasePromise;
  }
}

function upgradeDatabase(
  database: IDBDatabase,
  transaction: IDBTransaction | null,
): void {
  if (!transaction) {
    throw new StagingStoreError("IndexedDB upgrade transaction is unavailable");
  }

  if (!database.objectStoreNames.contains(STORE_NAMES.scanRuns)) {
    const store = database.createObjectStore(STORE_NAMES.scanRuns, {
      keyPath: "runId",
    });
    store.createIndex(INDEX_NAMES.runBySnapshotId, "snapshotId", { unique: true });
    store.createIndex(INDEX_NAMES.runByStatus, "status");
  }
  if (!database.objectStoreNames.contains(STORE_NAMES.snapshots)) {
    database.createObjectStore(STORE_NAMES.snapshots, { keyPath: "snapshotId" });
  }
  if (!database.objectStoreNames.contains(STORE_NAMES.products)) {
    const store = database.createObjectStore(STORE_NAMES.products, {
      keyPath: ["snapshotId", "productKey"],
    });
    store.createIndex(INDEX_NAMES.productBySnapshotId, "snapshotId");
  }
  if (!database.objectStoreNames.contains(STORE_NAMES.moduleResults)) {
    const store = database.createObjectStore(STORE_NAMES.moduleResults, {
      keyPath: ["snapshotId", "moduleId"],
    });
    store.createIndex(INDEX_NAMES.moduleResultBySnapshotId, "snapshotId");
  }
}

async function requireRunningRun(
  store: IDBObjectStore,
  runId: string,
): Promise<ScanRunRecord> {
  const run = await requestResult<ScanRunRecord | undefined>(store.get(runId));
  if (!run) {
    throw new RunNotFoundError(runId);
  }
  if (run.status !== "running" || !run.staging) {
    throw new RunStateError(runId, "operation requires a running staging run");
  }
  return run;
}

function resolveProductKey(product: StagedProductInput): string {
  let derivedProductKey: string;
  if (product.id !== undefined && product.id !== null && String(product.id).trim()) {
    derivedProductKey = String(product.id).trim();
  } else if (typeof product.handle === "string" && product.handle.trim()) {
    derivedProductKey = `handle:${product.handle.trim()}`;
  } else if (
    typeof product.canonicalUrl === "string" &&
    isCanonicalPublicUrl(product.canonicalUrl)
  ) {
    derivedProductKey = `url:${product.canonicalUrl}`;
  } else {
    throw new StagingStoreError("Product requires id, handle, or canonicalUrl");
  }

  if (
    product.productKey !== undefined &&
    product.productKey !== derivedProductKey
  ) {
    throw new StagingStoreError(
      `Explicit productKey ${String(product.productKey)} does not match derived key ${derivedProductKey}`,
    );
  }
  return derivedProductKey;
}

const STOREFRONT_KINDS = new Set([
  "hosted-theme",
  "custom-storefront",
  "uncertain",
]);
const ROUTE_ROOT_SOURCES = new Set(["probe", "url-heuristic", "fallback"]);
const LOCALE_SOURCES = new Set(["route-root", "endpoint", "unknown"]);
const COUNTRY_SOURCES = new Set(["anonymous-page", "endpoint", "unknown"]);
const CURRENCY_SOURCES = new Set(["cart-js", "unknown"]);
const TRANSPORTS = new Set(["service-worker", "collector"]);
const COVERAGE_SOURCES = new Set([
  "products-json",
  "sitemap",
  "collection-html",
  "product-ajax-js",
  "canonical",
  "dom",
  "json-ld",
]);
const CAPABILITY_PROBE_STATUSES = new Set([
  "ok",
  "unavailable",
  "challenge",
  "not_json",
]);

function validateSnapshotStructure(snapshot: SnapshotRecord): string[] {
  const issues: string[] = [];

  if (!isHttpOrigin(snapshot.storeKey)) {
    issues.push("snapshot storeKey must be a normalized http(s) origin");
  }
  if (!isHttpOrigin(snapshot.origin)) {
    issues.push("snapshot origin must be a normalized http(s) origin");
  }
  if (
    typeof snapshot.storefrontKind !== "string" ||
    !STOREFRONT_KINDS.has(snapshot.storefrontKind)
  ) {
    issues.push("snapshot storefrontKind is invalid");
  }
  if (!Array.isArray(snapshot.storefrontKindEvidence)) {
    issues.push("snapshot storefrontKindEvidence must be an array");
  }
  if (
    typeof snapshot.scannedAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.scannedAt))
  ) {
    issues.push("snapshot scannedAt is invalid");
  }

  validateSnapshotContext(snapshot.context, snapshot.storefrontKind, issues);
  validateCoverage(snapshot.coverage, issues);
  validateRuntimeDiagnostics(snapshot.runtimeDiagnostics, issues);

  if (!isRecord(snapshot.store)) {
    issues.push("snapshot store must be an object");
  }
  for (const field of [
    "rankings",
    "newness",
    "apps",
    "socials",
    "errors",
  ] as const) {
    if (!Array.isArray(snapshot[field])) {
      issues.push(`snapshot ${field} must be an array`);
    }
  }
  if (snapshot.theme !== undefined && !isRecord(snapshot.theme)) {
    issues.push("snapshot theme must be an object when present");
  }
  if (snapshot.reviews !== undefined && !Array.isArray(snapshot.reviews)) {
    issues.push("snapshot reviews must be an array when present");
  }

  return issues;
}

function validateSnapshotContext(
  value: unknown,
  snapshotStorefrontKind: unknown,
  issues: string[],
): void {
  if (!isRecord(value)) {
    issues.push("snapshot context must be an object");
    return;
  }
  if (typeof value.routeRoot !== "string" || value.routeRoot.length === 0) {
    issues.push("snapshot context.routeRoot is invalid");
  }
  if (!isAllowedString(value.routeRootSource, ROUTE_ROOT_SOURCES)) {
    issues.push("snapshot context.routeRootSource is invalid");
  }
  if (!isAllowedString(value.localeSource, LOCALE_SOURCES)) {
    issues.push("snapshot context.localeSource is invalid");
  }
  if (!isAllowedString(value.countrySource, COUNTRY_SOURCES)) {
    issues.push("snapshot context.countrySource is invalid");
  }
  if (!isAllowedString(value.currencySource, CURRENCY_SOURCES)) {
    issues.push("snapshot context.currencySource is invalid");
  }
  if (!isRecord(value.priceSourceStatus)) {
    issues.push("snapshot context.priceSourceStatus must be an object");
  }
  if (typeof value.priceContextVerified !== "boolean") {
    issues.push("snapshot context.priceContextVerified must be boolean");
  }
  if (value.credentialMode !== "omit") {
    issues.push("snapshot context.credentialMode must be omit");
  }
  if (!isAllowedString(value.transport, TRANSPORTS)) {
    issues.push("snapshot context.transport is invalid");
  }
  if (
    !isAllowedString(value.storefrontKind, STOREFRONT_KINDS) ||
    value.storefrontKind !== snapshotStorefrontKind
  ) {
    issues.push("snapshot context.storefrontKind is invalid or inconsistent");
  }
}

function validateCoverage(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push("snapshot coverage must be an object");
    return;
  }
  if (!Number.isInteger(value.productsFetched) || Number(value.productsFetched) < 0) {
    issues.push("snapshot coverage.productsFetched is invalid");
  }
  if (
    value.estimatedTotal !== undefined &&
    (!Number.isInteger(value.estimatedTotal) || Number(value.estimatedTotal) < 0)
  ) {
    issues.push("snapshot coverage.estimatedTotal is invalid");
  }
  if (typeof value.truncated !== "boolean") {
    issues.push("snapshot coverage.truncated must be boolean");
  }
  if (
    !Array.isArray(value.sources) ||
    value.sources.some((source) => !isAllowedString(source, COVERAGE_SOURCES))
  ) {
    issues.push("snapshot coverage.sources is invalid");
  }
  if (
    !isRecord(value.capabilityProbes) ||
    Object.values(value.capabilityProbes).some(
      (status) => !isAllowedString(status, CAPABILITY_PROBE_STATUSES),
    )
  ) {
    issues.push("snapshot coverage.capabilityProbes is invalid");
  }
}

function validateRuntimeDiagnostics(value: unknown, issues: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || !isRecord(value.retry)) {
    issues.push("snapshot runtimeDiagnostics.retry must be an object");
    return;
  }
  const retry = value.retry;
  for (const field of [
    "retryCount",
    "scanWaitedMs",
    "concurrencyReductionCount",
    "eventsDropped",
  ] as const) {
    if (!Number.isSafeInteger(retry[field]) || Number(retry[field]) < 0) {
      issues.push(`snapshot runtimeDiagnostics.retry.${field} is invalid`);
    }
  }
  if (
    !Number.isSafeInteger(retry.concurrency) ||
    Number(retry.concurrency) < 1 ||
    Number(retry.concurrency) > 64
  ) {
    issues.push("snapshot runtimeDiagnostics.retry.concurrency is invalid");
  }
  if (!Array.isArray(retry.events) || retry.events.length > 100) {
    issues.push("snapshot runtimeDiagnostics.retry.events is invalid");
    return;
  }
  if (retry.retryCount !== retry.events.length + Number(retry.eventsDropped)) {
    issues.push("snapshot runtimeDiagnostics.retry event count is inconsistent");
  }
  for (const event of retry.events) {
    if (
      !isRecord(event) ||
      !Number.isSafeInteger(event.retryNumber) ||
      Number(event.retryNumber) < 1 ||
      typeof event.endpointKind !== "string" ||
      event.endpointKind.length === 0 ||
      event.endpointKind.length > 64 ||
      typeof event.category !== "string" ||
      event.category.length === 0 ||
      event.category.length > 64 ||
      !Number.isSafeInteger(event.delayMs) ||
      Number(event.delayMs) < 0 ||
      !Number.isSafeInteger(event.concurrencyBefore) ||
      Number(event.concurrencyBefore) < 1 ||
      !Number.isSafeInteger(event.concurrency) ||
      Number(event.concurrency) < 1
    ) {
      issues.push("snapshot runtimeDiagnostics.retry event is invalid");
      break;
    }
  }
}

function isCanonicalPublicUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0 &&
      url.href === value
    );
  } catch {
    return false;
  }
}

function isHttpOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function isAllowedString(value: unknown, allowed: ReadonlySet<string>): boolean {
  return typeof value === "string" && allowed.has(value);
}

function snapshotTime(snapshot: SnapshotRecord): number {
  const scannedAt = snapshot.scannedAt;
  if (typeof scannedAt === "string") {
    const parsed = Date.parse(scannedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeModuleIds(moduleIds: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const moduleId of moduleIds) {
    assertNonEmpty(moduleId, "plannedModuleId");
    if (normalized.has(moduleId)) {
      throw new StagingStoreError(`Duplicate planned module: ${moduleId}`);
    }
    normalized.add(moduleId);
  }
  return [...normalized];
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new StagingStoreError(`${name} must not be empty`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new StagingStoreError(`${name} must be a non-negative integer`);
  }
}

function isQuotaExceeded(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "QuotaExceededError"
  );
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function requestResult<T = undefined>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new StagingStoreError("IndexedDB request failed"));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new StagingStoreError("IndexedDB transaction aborted"));
    transaction.onerror = () => {
      // `onabort` provides the terminal rejection. Prevent no-op implicit handling.
    };
  });
}

async function runTransaction<T>(
  transaction: IDBTransaction,
  operation: () => Promise<T>,
): Promise<T> {
  const completion = transactionCompletion(transaction);
  try {
    const result = await operation();
    await completion;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // It may already have aborted because an IDBRequest failed.
    }
    await completion.catch(() => undefined);
    throw error;
  }
}

function deleteByIndex(index: IDBIndex, key: IDBValidKey): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let deleted = 0;
    // Use a value cursor: unlike a key-only cursor, its delete operation is
    // consistently supported by both Chromium IndexedDB and fake-indexeddb.
    const request = index.openCursor(key);
    request.onerror = () =>
      reject(request.error ?? new StagingStoreError("IndexedDB cursor failed"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(deleted);
        return;
      }
      const deleteRequest = cursor.delete();
      deleteRequest.onerror = () =>
        reject(deleteRequest.error ?? new StagingStoreError("IndexedDB delete failed"));
      deleteRequest.onsuccess = () => {
        deleted += 1;
        cursor.continue();
      };
    };
  });
}
