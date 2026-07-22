import type {
  ResourceDescriptor,
  ResourceFetchFailureReason,
  ResourceFetchResult,
  ResourceKind,
} from "./resource-types";
import {
  inspectSourceMapReference,
  inspectSourceMapText,
} from "./source-map-policy";
import { detectFingerprints } from "./fingerprint-engine";
import { FINGERPRINT_RULESET_VERSION } from "./fingerprint-rules";

export const MAX_FRONTEND_RESOURCE_BODIES = 100;
export const MAX_FRONTEND_TOTAL_BYTES = 20 * 1_024 * 1_024;
export const FRONTEND_RESOURCE_CONCURRENCY = 2;

export type FrontendAnalyzer =
  | "framework-theme"
  | "api-surface"
  | "performance-static"
  | "fingerprints"
  | "source-map";

export type FrontendFindingCategory =
  | "framework"
  | "theme"
  | "api-reference"
  | "performance"
  | "app"
  | "pixel"
  | "source-map";

export type FrontendEvidence = Readonly<{
  resourceId: string;
  excerpt: string;
  ruleId: string;
}>;

export type FrontendFinding = Readonly<{
  findingId: string;
  analyzer: FrontendAnalyzer;
  category: FrontendFindingCategory;
  label: string;
  confidence: number;
  maturity: "stable" | "experimental";
  evidence: FrontendEvidence[];
}>;

export type FrontendSummary = Readonly<{
  totalResources: number;
  sameOriginResources: number;
  crossOriginResources: number;
  analyzableResources: number;
  analyzedResources: number;
  analyzedBytes: number;
  metadataOnlyResources: number;
  failedResources: number;
  skippedResources: number;
  failureReasons: Partial<Record<ResourceFetchFailureReason, number>>;
  byKind: Partial<Record<ResourceKind, number>>;
  hosts: ReadonlyArray<Readonly<{ host: string; count: number }>>;
}>;

export type FrontendIntelligenceResult = Readonly<{
  status: "completed" | "partial" | "failed";
  analyzerVersion: "token-url-v2";
  fingerprintRulesVersion: typeof FINGERPRINT_RULESET_VERSION;
  summary: FrontendSummary;
  resources: ResourceDescriptor[];
  findings: FrontendFinding[];
  errors: string[];
}>;

export type ResourceExecutor = (
  resourceId: string,
) => Promise<ResourceFetchResult>;

export type FrontendIntelligenceOptions = Readonly<{
  signal?: AbortSignal;
  concurrency?: number;
  maximumBodies?: number;
  maximumTotalBytes?: number;
}>;

type TransientBody = {
  descriptor: ResourceDescriptor;
  text: string;
};

type FindingRule = Readonly<{
  id: string;
  analyzer: FrontendAnalyzer;
  category: FrontendFindingCategory;
  label: string;
  patterns: readonly RegExp[];
  confidence: number;
  maturity: "stable" | "experimental";
}>;

const FINDING_RULES: readonly FindingRule[] = [
  rule("framework.shopify-theme", "framework-theme", "theme", "Shopify Theme Runtime", [/\/cdn\/shop\/t\//iu, /Shopify\.theme/iu], 0.95),
  rule("framework.next", "framework-theme", "framework", "Next.js", [/\/_next\/static\//iu, /__NEXT_DATA__/u], 0.9),
  rule("framework.react", "framework-theme", "framework", "React", [/react-dom/iu, /__REACT_DEVTOOLS_GLOBAL_HOOK__/u], 0.78),
  rule("framework.vue", "framework-theme", "framework", "Vue", [/\bcreateApp\s*\(/u, /__VUE__/u], 0.78),
  rule("framework.jquery", "framework-theme", "framework", "jQuery", [/jquery(?:\.min)?\.js/iu, /\bjQuery\b/u], 0.72),
];

export async function collectFrontendIntelligence(
  descriptors: readonly ResourceDescriptor[],
  execute: ResourceExecutor,
  options: FrontendIntelligenceOptions = {},
): Promise<FrontendIntelligenceResult> {
  const concurrency = boundedInteger(
    options.concurrency ?? FRONTEND_RESOURCE_CONCURRENCY,
    1,
    FRONTEND_RESOURCE_CONCURRENCY,
    "concurrency",
  );
  const maximumBodies = boundedInteger(
    options.maximumBodies ?? MAX_FRONTEND_RESOURCE_BODIES,
    1,
    MAX_FRONTEND_RESOURCE_BODIES,
    "maximumBodies",
  );
  const maximumTotalBytes = boundedInteger(
    options.maximumTotalBytes ?? MAX_FRONTEND_TOTAL_BYTES,
    1,
    MAX_FRONTEND_TOTAL_BYTES,
    "maximumTotalBytes",
  );
  const resources = descriptors.map((descriptor) => ({ ...descriptor }));
  const descriptorIndex = new Map(
    resources.map((resource, index) => [resource.resourceId, index]),
  );
  const pending = resources.filter(
    (resource) => resource.fetchStatus === "pending",
  );
  const queuedIds = new Set(pending.map((resource) => resource.resourceId));

  const bodies: TransientBody[] = [];
  const errors: string[] = [];
  let nextIndex = 0;
  let startedBodies = 0;
  let analyzedBytes = 0;
  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () =>
    worker(),
  );
  await Promise.all(workers);

  for (const resource of resources) {
    if (resource.fetchStatus !== "pending") continue;
    updateResource(resource.resourceId, {
      fetchStatus: "skipped",
      failureReason: "budget_exceeded",
    });
  }

  const findings = analyzeResources(resources, bodies);
  bodies.length = 0;
  const summary = summarizeResources(resources, analyzedBytes);
  const partial = errors.length > 0 || resources.some(
    (resource) => resource.fetchStatus === "failed" || resource.fetchStatus === "skipped",
  );
  return {
    status:
      resources.length > 0 && summary.analyzedResources === 0 && errors.length > 0
        ? "failed"
        : partial
          ? "partial"
          : "completed",
    analyzerVersion: "token-url-v2",
    fingerprintRulesVersion: FINGERPRINT_RULESET_VERSION,
    summary,
    resources,
    findings,
    errors: errors.slice(0, 100),
  };

  async function worker(): Promise<void> {
    for (;;) {
      if (options.signal?.aborted === true) return;
      if (startedBodies >= maximumBodies) return;
      const target = pending[nextIndex];
      // Do not advance past the current end of this dynamically growing queue.
      // Another worker may still be fetching a parent that will append a
      // source-map capability. Advancing on an empty read would make that late
      // derived item land behind the shared cursor and be mislabeled as a
      // budget overflow after all workers exit.
      if (target === undefined) return;
      nextIndex += 1;
      startedBodies += 1;
      let result: ResourceFetchResult;
      try {
        result = await execute(target.resourceId);
      } catch (error: unknown) {
        errors.push(`${target.resourceId}: ${errorMessage(error)}`);
        updateResource(target.resourceId, {
          fetchStatus: "failed",
          failureReason: "network_error",
        });
        continue;
      }
      if (!result.ok) {
        errors.push(`${target.resourceId}: ${result.reason}`);
        updateResource(
          target.resourceId,
          result.descriptor ?? {
            fetchStatus: "failed",
            failureReason: result.reason,
          },
        );
        continue;
      }
      const byteLength = result.descriptor.byteLength ?? 0;
      if (analyzedBytes + byteLength > maximumTotalBytes) {
        updateResource(target.resourceId, {
          ...result.descriptor,
          fetchStatus: "skipped",
          failureReason: "budget_exceeded",
        });
        errors.push(`${target.resourceId}: budget_exceeded`);
        continue;
      }
      analyzedBytes += byteLength;
      updateResource(target.resourceId, result.descriptor);
      bodies.push({ descriptor: result.descriptor, text: result.text });
      for (const derived of result.derivedResources ?? []) {
        if (
          queuedIds.has(derived.resourceId) ||
          descriptorIndex.has(derived.resourceId)
        ) {
          continue;
        }
        queuedIds.add(derived.resourceId);
        descriptorIndex.set(derived.resourceId, resources.length);
        const copied = { ...derived };
        resources.push(copied);
        // Prefer a map immediately after its parent while keeping the global
        // body budget unchanged. Remaining ordinary resources are not lost;
        // they continue if the map is absent or rejected.
        pending.splice(nextIndex, 0, copied);
      }
    }
  }

  function updateResource(
    resourceId: string,
    patch: Partial<ResourceDescriptor>,
  ): void {
    const index = descriptorIndex.get(resourceId);
    const current = index === undefined ? undefined : resources[index];
    if (index === undefined || current === undefined) return;
    resources[index] = { ...current, ...patch };
  }
}

export function emptyFrontendIntelligence(
  resources: readonly ResourceDescriptor[] = [],
  error = "frontend_analysis_failed",
): FrontendIntelligenceResult {
  const copied = resources.map((resource) => ({ ...resource }));
  return {
    status: "failed",
    analyzerVersion: "token-url-v2",
    fingerprintRulesVersion: FINGERPRINT_RULESET_VERSION,
    summary: summarizeResources(copied, 0),
    resources: copied,
    findings: [],
    errors: [error.slice(0, 256)],
  };
}

function analyzeResources(
  resources: readonly ResourceDescriptor[],
  bodies: readonly TransientBody[],
): FrontendFinding[] {
  const findings = new Map<string, FrontendFinding>();
  const bodyById = new Map(bodies.map((body) => [body.descriptor.resourceId, body]));

  for (const resource of resources) {
    const body = bodyById.get(resource.resourceId);
    const haystack = `${resource.url}\n${body?.text ?? ""}`;
    for (const findingRule of FINDING_RULES) {
      const match = firstMatch(haystack, findingRule.patterns);
      if (match === undefined) continue;
      addFinding(findings, findingRule, {
        resourceId: resource.resourceId,
        excerpt: sanitizeExcerpt(match),
        ruleId: findingRule.id,
      });
    }
    if (body !== undefined) {
      collectApiReferences(findings, body);
      collectSourceMapFindings(findings, body);
    }
    collectPerformanceFindings(findings, resource);
  }
  collectFingerprintFindings(findings, resources, bodyById);
  return [...findings.values()].slice(0, 200);
}

function collectFingerprintFindings(
  findings: Map<string, FrontendFinding>,
  resources: readonly ResourceDescriptor[],
  bodyById: ReadonlyMap<string, TransientBody>,
): void {
  const matches = detectFingerprints(
    resources.map((resource) => {
      const text = bodyById.get(resource.resourceId)?.text;
      return {
        resourceId: resource.resourceId,
        url: resource.url,
        ...(text === undefined ? {} : { text }),
      };
    }),
  );
  for (const match of matches) {
    findings.set(match.ruleId, {
      findingId: match.ruleId,
      analyzer: "fingerprints",
      category: match.category,
      label: match.label,
      confidence: match.confidence,
      maturity: match.maturity,
      evidence: match.evidence.map((evidence) => ({
        resourceId: evidence.resourceId,
        excerpt: evidence.excerpt,
        ruleId: `${match.ruleId}.${evidence.signalId}`,
      })),
    });
  }
}

function collectApiReferences(
  findings: Map<string, FrontendFinding>,
  body: TransientBody,
): void {
  const references = new Set<string>();
  const pathPattern = /["'`](\/(?:api|graphql|cart|products|recommendations)[a-zA-Z0-9_./{}-]{0,180})["'`]/gu;
  for (const match of body.text.matchAll(pathPattern)) {
    if (match[1] !== undefined) references.add(match[1]);
    if (references.size >= 12) break;
  }
  const operationPattern = /\b(?:query|mutation)\s+([A-Z][A-Za-z0-9_]{1,80})\b/gu;
  for (const match of body.text.matchAll(operationPattern)) {
    if (match[1] !== undefined) references.add(`GraphQL operation ${match[1]}`);
    if (references.size >= 16) break;
  }
  for (const reference of references) {
    const id = `api.${stableKey(reference)}`;
    addFinding(
      findings,
      {
        id,
        analyzer: "api-surface",
        category: "api-reference",
        label: `代码引用 · ${reference.slice(0, 120)}`,
        patterns: [],
        confidence: 0.7,
        maturity: "stable",
      },
      {
        resourceId: body.descriptor.resourceId,
        excerpt: sanitizeExcerpt(reference),
        ruleId: id,
      },
    );
  }
}

function collectSourceMapFindings(
  findings: Map<string, FrontendFinding>,
  body: TransientBody,
): void {
  const inspection =
    body.descriptor.kind === "source-map"
      ? inspectSourceMapText(body.text, body.descriptor.url)
      : inspectSourceMapReference(body.text, body.descriptor.url);
  if (inspection.status === "none") return;
  const id = `source-map.${inspection.status}.${
    inspection.status === "rejected" ? inspection.reason : "observed"
  }`;
  const label =
    inspection.status === "inline"
      ? `${body.descriptor.kind === "source-map" ? "source map 已验证" : "内嵌 source map"} · ${inspection.sourceCount} sources`
      : inspection.status === "external"
        ? `${inspection.originRelation === "same-origin" ? "同源" : "跨源"} source map 引用`
        : `source map 已拒绝 · ${inspection.reason}`;
  addFinding(
    findings,
    {
      id,
      analyzer: "source-map",
      category: "source-map",
      label,
      patterns: [],
      confidence: 0.95,
      maturity: "stable",
    },
    {
      resourceId: body.descriptor.resourceId,
      excerpt: label,
      ruleId: id,
    },
  );
}

function collectPerformanceFindings(
  findings: Map<string, FrontendFinding>,
  resource: ResourceDescriptor,
): void {
  if ((resource.transferSize ?? 0) >= 500 * 1_024) {
    addFinding(
      findings,
      performanceRule("large-transfer", "大体积公开资源（Resource Timing）"),
      {
        resourceId: resource.resourceId,
        excerpt: `${displayUrl(resource.url)} · ${resource.transferSize} bytes`,
        ruleId: "performance.large-transfer",
      },
    );
  }
  if ((resource.durationMs ?? 0) >= 1_000) {
    addFinding(
      findings,
      performanceRule("slow-resource", "慢资源观察（Resource Timing）"),
      {
        resourceId: resource.resourceId,
        excerpt: `${displayUrl(resource.url)} · ${Math.round(resource.durationMs ?? 0)} ms`,
        ruleId: "performance.slow-resource",
      },
    );
  }
}

function summarizeResources(
  resources: readonly ResourceDescriptor[],
  analyzedBytes: number,
): FrontendSummary {
  const byKind: Partial<Record<ResourceKind, number>> = {};
  const failureReasons: Partial<Record<ResourceFetchFailureReason, number>> = {};
  const hosts = new Map<string, number>();
  for (const resource of resources) {
    byKind[resource.kind] = (byKind[resource.kind] ?? 0) + 1;
    if (resource.failureReason !== undefined) {
      failureReasons[resource.failureReason] =
        (failureReasons[resource.failureReason] ?? 0) + 1;
    }
    try {
      const host = new URL(resource.url).hostname;
      hosts.set(host, (hosts.get(host) ?? 0) + 1);
    } catch {
      // Registered descriptors are validated; ignore corrupt historical rows.
    }
  }
  return {
    totalResources: resources.length,
    sameOriginResources: resources.filter(
      (resource) => resource.originRelation === "same-origin",
    ).length,
    crossOriginResources: resources.filter(
      (resource) => resource.originRelation === "cross-origin",
    ).length,
    analyzableResources: resources.filter(
      (resource) => resource.originRelation === "same-origin" &&
        ["document", "script", "style", "json", "source-map"].includes(
          resource.kind,
        ),
    ).length,
    analyzedResources: resources.filter(
      (resource) => resource.fetchStatus === "analyzed",
    ).length,
    analyzedBytes,
    metadataOnlyResources: resources.filter(
      (resource) => resource.fetchStatus === "metadata-only",
    ).length,
    failedResources: resources.filter(
      (resource) => resource.fetchStatus === "failed",
    ).length,
    skippedResources: resources.filter(
      (resource) => resource.fetchStatus === "skipped",
    ).length,
    failureReasons,
    byKind,
    hosts: [...hosts]
      .map(([host, count]) => ({ host, count }))
      .sort((left, right) => right.count - left.count || left.host.localeCompare(right.host))
      .slice(0, 50),
  };
}

function addFinding(
  findings: Map<string, FrontendFinding>,
  findingRule: FindingRule,
  evidence: FrontendEvidence,
): void {
  const existing = findings.get(findingRule.id);
  if (existing !== undefined) {
    if (
      existing.evidence.length < 8 &&
      !existing.evidence.some(
        (item) =>
          item.resourceId === evidence.resourceId && item.excerpt === evidence.excerpt,
      )
    ) {
      findings.set(findingRule.id, {
        ...existing,
        confidence: Math.min(0.99, existing.confidence + 0.04),
        evidence: [...existing.evidence, evidence],
      });
    }
    return;
  }
  findings.set(findingRule.id, {
    findingId: findingRule.id,
    analyzer: findingRule.analyzer,
    category: findingRule.category,
    label: findingRule.label,
    confidence: findingRule.confidence,
    maturity: findingRule.maturity,
    evidence: [evidence],
  });
}

function rule(
  id: string,
  analyzer: FrontendAnalyzer,
  category: FrontendFindingCategory,
  label: string,
  patterns: readonly RegExp[],
  confidence: number,
  maturity: "stable" | "experimental" = "stable",
): FindingRule {
  return { id, analyzer, category, label, patterns, confidence, maturity };
}

function performanceRule(id: string, label: string): FindingRule {
  return rule(
    `performance.${id}`,
    "performance-static",
    "performance",
    label,
    [],
    0.8,
  );
}

function firstMatch(value: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(value);
    if (match?.[0] !== undefined) return match[0];
  }
  return undefined;
}

function sanitizeExcerpt(value: string): string {
  return value
    .replace(/([?&](?:token|signature|sig|key|customer|email|auth|session)=[^\s&#"']+)/giu, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .replace(/[a-zA-Z0-9_-]{48,}/gu, "[redacted-token]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 256);
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.slice(0, 180);
  } catch {
    return value.slice(0, 180);
  }
}

function stableKey(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 256);
}
