import {
  StagingStore,
  type CommittedSnapshotBundle,
  type ModuleTerminalStatus,
} from "../storage/staging-store";
import {
  createRetryingEndpointExecutor,
} from "../network/retry-executor";
import {
  analyzeStorefront,
  type StorefrontAnalysisResult,
  type StorefrontAnalysisStage,
} from "../analysis/storefront-analysis";
import {
  scanStorefront,
  type StorefrontScanInput,
  type StorefrontScanResult,
  type StorefrontScanStage,
} from "./storefront-scanner";
import {
  emptyFrontendIntelligence,
  type FrontendIntelligenceResult,
} from "../frontend/frontend-intelligence";
import {
  emptyDesignIntelligence,
  type DesignIntelligenceResult,
} from "../design/design-intelligence";

const STALE_RUN_AFTER_MS = 60_000;

export type PersistedScanStage = StorefrontScanStage | StorefrontAnalysisStage;

export type PersistedScanInput = Omit<
  StorefrontScanInput,
  "onProducts" | "onStage" | "retrying"
> &
  Readonly<{
    store: StagingStore;
    onProducts?: StorefrontScanInput["onProducts"];
    onStage?: (stage: PersistedScanStage) => void;
    frontend?: FrontendIntelligenceResult | Promise<FrontendIntelligenceResult>;
    design?: DesignIntelligenceResult | Promise<DesignIntelligenceResult>;
  }>;

export type PersistedScanResult = Readonly<{
  scanRunId: string;
  snapshotId: string;
  scan: StorefrontScanResult;
  analysis: StorefrontAnalysisResult;
  committed: CommittedSnapshotBundle;
}>;

/** Persists the M1–M3 scan through the proven staging -> commit boundary. */
export async function runPersistedStorefrontScan(
  input: PersistedScanInput,
): Promise<PersistedScanResult> {
  const scanRunId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  let started = false;

  try {
    await input.store.open();
    await input.store.reconcileStaleRuns(Date.now() - STALE_RUN_AFTER_MS);
    await input.store.startRun({
      runId: scanRunId,
      snapshotId,
      plannedModuleIds: [
        "detection",
        "catalog",
        "price-context",
        "statistics",
        "rankings",
        "newness",
        ...(input.frontend === undefined ? [] : ["frontend-intelligence"]),
        ...(input.design === undefined ? [] : ["design-intelligence"]),
      ],
    });
    started = true;
    const retrying = createRetryingEndpointExecutor(input.execute, input.retry);

    const initialScan = await scanStorefront({
      origin: input.origin,
      main: input.main,
      collector: input.collector,
      execute: input.execute,
      retrying,
      ...(input.productLimit === undefined
        ? {}
        : { productLimit: input.productLimit }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      ...(input.ajaxSupplementLimit === undefined
        ? {}
        : { ajaxSupplementLimit: input.ajaxSupplementLimit }),
      ...(input.maxSitemapFiles === undefined
        ? {}
        : { maxSitemapFiles: input.maxSitemapFiles }),
      ...(input.maxCollectionPages === undefined
        ? {}
        : { maxCollectionPages: input.maxCollectionPages }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.onProgress === undefined
        ? {}
        : { onProgress: input.onProgress }),
      ...(input.onStage === undefined ? {} : { onStage: input.onStage }),
      ...(input.retry === undefined ? {} : { retry: input.retry }),
      onProducts: async (products) => {
        await input.store.writeProducts(scanRunId, products);
        await input.onProducts?.(products);
      },
    });

    if (
      input.signal?.aborted === true ||
      initialScan.catalog.termination === "aborted"
    ) {
      await input.store.cancelRun(scanRunId);
      started = false;
      throw abortError(input.signal);
    }

    const analysis = await analyzeStorefront(retrying.execute, initialScan, {
      origin: input.origin,
      collectionHandles: input.collector.ok
        ? input.collector.collectionHandles
        : [],
      ...(input.productLimit === undefined
        ? {}
        : { productLimit: input.productLimit }),
      ...(input.maxCollectionPages === undefined
        ? {}
        : { maxCollectionPages: input.maxCollectionPages }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.onStage === undefined ? {} : { onStage: input.onStage }),
    });
    if (isSignalAborted(input.signal)) {
      await input.store.cancelRun(scanRunId);
      started = false;
      throw abortError(input.signal);
    }
    const scan: StorefrontScanResult = {
      ...initialScan,
      runtimeDiagnostics: { retry: retrying.getSummary() },
    };

    await input.store.sealProductManifest(
      scanRunId,
      scan.catalog.products.length,
      scan.catalog.products.length,
    );
    await input.store.writeModuleResult(scanRunId, {
      moduleId: "detection",
      status: "completed",
      result: scan.detection,
    });
    await input.store.writeModuleResult(scanRunId, {
      moduleId: "catalog",
      status: catalogModuleStatus(scan),
      result: {
        coverage: scan.catalog.coverage,
        termination: scan.catalog.termination,
        complete: scan.catalog.complete,
        runtimeDiagnostics: scan.runtimeDiagnostics,
      },
      ...(scan.catalog.errors.length === 0
        ? {}
        : { errors: scan.catalog.errors }),
    });
    await input.store.writeModuleResult(scanRunId, {
      moduleId: "price-context",
      status: priceContextModuleStatus(scan),
      result: {
        context: scan.context,
        anonymousContext: scan.anonymousContext,
        productsJson: scan.priceVerification,
      },
    });
    await input.store.writeModuleResult(scanRunId, {
      moduleId: "statistics",
      status: scan.status === "not-shopify" ? "skipped" : "completed",
      result: analysis.statistics,
    });
    await input.store.writeModuleResult(scanRunId, {
      moduleId: "rankings",
      status: rankingModuleStatus(analysis),
      result: {
        bestSelling: analysis.bestSelling,
        createdDescending: analysis.createdDescending,
      },
      ...([...analysis.bestSelling.errors, ...analysis.createdDescending.errors]
        .length === 0
        ? {}
        : {
            errors: [
              ...analysis.bestSelling.errors,
              ...analysis.createdDescending.errors,
            ],
          }),
    });
    await input.store.writeModuleResult(scanRunId, {
      moduleId: "newness",
      status: newnessModuleStatus(analysis),
      result: analysis.newness,
    });
    const frontend =
      input.frontend === undefined
        ? undefined
        : await Promise.resolve(input.frontend).catch((error: unknown) =>
            emptyFrontendIntelligence([], errorMessage(error)),
          );
    if (frontend !== undefined) {
      await input.store.writeModuleResult(scanRunId, {
        moduleId: "frontend-intelligence",
        status: frontendModuleStatus(frontend),
        result: frontend,
        ...(frontend.errors.length === 0 ? {} : { errors: frontend.errors }),
      });
    }
    const design =
      input.design === undefined
        ? undefined
        : await Promise.resolve(input.design).catch(() =>
            emptyDesignIntelligence("probe_runtime_failed"),
          );
    if (design !== undefined) {
      await input.store.writeModuleResult(scanRunId, {
        moduleId: "design-intelligence",
        status: designModuleStatus(design),
        result: design,
        ...(design.errors.length === 0 ? {} : { errors: design.errors }),
      });
    }
    const rankingRows = analysis.bestSelling.items.map((item) => ({
      ...item,
      scope: analysis.bestSelling.scope,
      disclaimer: analysis.bestSelling.disclaimer,
    }));
    const analysisErrors = [
      ...scan.catalog.errors,
      ...analysis.bestSelling.errors,
      ...analysis.createdDescending.errors,
      ...(frontend?.errors.map((error) => `frontend: ${error}`) ?? []),
    ];
    await input.store.writeSnapshotDraft(scanRunId, {
      storeKey: input.origin,
      origin: input.origin,
      storefrontKind: scan.detection.storefrontKind,
      storefrontKindEvidence: scan.detection.evidence,
      scannedAt: new Date().toISOString(),
      scanStatus: scan.status,
      context: scan.context,
      detection: scan.detection,
      coverage: scan.catalog.coverage,
      catalogTermination: scan.catalog.termination,
      runtimeDiagnostics: scan.runtimeDiagnostics,
      anonymousContext: scan.anonymousContext,
      priceVerification: scan.priceVerification,
      analysisStatus: analysis.status,
      statistics: analysis.statistics,
      analysis,
      store: {
        domain: new URL(input.origin).hostname,
        ...(input.main?.shop === undefined
          ? {}
          : { myshopifyDomain: input.main.shop }),
        ...(!input.collector.ok || input.collector.favicon === undefined
          ? {}
          : { favicon: input.collector.favicon }),
      },
      ...(input.main?.themeName === undefined &&
      input.main?.themeId === undefined &&
      input.main?.themeSchemaName === undefined
        ? {}
        : {
            theme: {
              ...(input.main?.themeName === undefined
                ? {}
                : { name: input.main.themeName }),
              ...(input.main?.themeId === undefined
                ? {}
                : { id: String(input.main.themeId) }),
              ...(input.main?.themeSchemaName === undefined
                ? {}
                : { schemaName: input.main.themeSchemaName }),
            },
          }),
      rankings: rankingRows,
      newness: analysis.newness.candidates,
      ...(frontend === undefined
        ? { apps: [] }
        : {
            frontend,
            resources: frontend.resources,
            apps: frontend.findings.filter(
              (finding) =>
                finding.category === "app" || finding.category === "pixel",
            ),
          }),
      ...(design === undefined ? {} : { design }),
      socials: input.collector.ok ? input.collector.socials : [],
      errors: analysisErrors,
    });
    const committed = await input.store.commitRun(scanRunId);
    started = false;
    return { scanRunId, snapshotId, scan, analysis, committed };
  } catch (error: unknown) {
    if (started) {
      if (input.signal?.aborted === true || isAbortError(error)) {
        await input.store.cancelRun(scanRunId).catch(() => undefined);
      } else {
        await input.store.failRun(scanRunId, "m2_scan_failed").catch(() => undefined);
      }
    }
    throw error;
  }
}

function designModuleStatus(
  design: DesignIntelligenceResult,
): ModuleTerminalStatus {
  switch (design.status) {
    case "completed":
      return "completed";
    case "partial":
      return "partial";
    case "failed":
      return "failed";
  }
}

function frontendModuleStatus(
  frontend: FrontendIntelligenceResult,
): ModuleTerminalStatus {
  switch (frontend.status) {
    case "completed":
      return "completed";
    case "partial":
      return "partial";
    case "failed":
      return "failed";
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 256);
}

function rankingModuleStatus(
  analysis: StorefrontAnalysisResult,
): ModuleTerminalStatus {
  if (analysis.status === "skipped") return "skipped";
  if (analysis.bestSelling.status === "blocked") return "failed";
  return analysis.bestSelling.status === "completed" &&
    analysis.createdDescending.status === "completed"
    ? "completed"
    : "partial";
}

function newnessModuleStatus(
  analysis: StorefrontAnalysisResult,
): ModuleTerminalStatus {
  if (analysis.status === "skipped" && analysis.newness.status === "unavailable") {
    return "skipped";
  }
  return analysis.newness.status === "completed" ? "completed" : "partial";
}

function priceContextModuleStatus(
  scan: StorefrontScanResult,
): ModuleTerminalStatus {
  if (
    scan.detection.storefrontKind !== "hosted-theme" ||
    scan.priceVerification.status === "not-used"
  ) {
    return "skipped";
  }
  return scan.context.priceContextVerified ? "completed" : "partial";
}

function catalogModuleStatus(scan: StorefrontScanResult): ModuleTerminalStatus {
  switch (scan.status) {
    case "completed":
      return "completed";
    case "not-shopify":
      return "skipped";
    case "blocked":
      return "failed";
    case "partial":
      return "partial";
  }
}

function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Scan cancelled", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
