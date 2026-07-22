import {
  MAX_RESOURCE_BODY_BYTES,
  MAX_SOURCE_MAP_BYTES,
} from "../frontend/resource-policy";
import {
  FETCHABLE_RESOURCE_KINDS,
  type ResourceDescriptor,
  type ResourceFetchResult,
} from "../frontend/resource-types";

export const SOURCE_BUNDLE_SCHEMA_VERSION = 1;
export const MAX_SOURCE_BUNDLE_FILES = 100;
export const MAX_SOURCE_BUNDLE_BYTES = 20 * 1_024 * 1_024;
export const SOURCE_BUNDLE_CONCURRENCY = 2;

export type SourceBundleFile = Readonly<{
  filename: string;
  resourceId: string;
  url: string;
  kind: ResourceDescriptor["kind"];
  contentType: string;
  byteLength: number;
  sha256: string;
  observedSha256?: string;
  changedSinceScan: boolean;
  text: string;
}>;

export type SourceBundleError = Readonly<{
  resourceId: string;
  reason: string;
}>;

export type PublicSourceBundle = Readonly<{
  meta: Readonly<{
    schemaVersion: typeof SOURCE_BUNDLE_SCHEMA_VERSION;
    kind: "ss-watcher-public-source-bundle";
    generatedAt: string;
    snapshotId: string;
    storeKey: string;
    credentialMode: "omit";
    redirectMode: "error";
    fileLimit: typeof MAX_SOURCE_BUNDLE_FILES;
    byteLimit: typeof MAX_SOURCE_BUNDLE_BYTES;
    eligibleResourceCount: number;
    attemptedResourceCount: number;
    exportedFileCount: number;
    exportedTextBytes: number;
    omittedResourceCount: number;
    sourceOrigins: string[];
    status: "completed" | "partial" | "failed";
    warning: string;
  }>;
  errors: SourceBundleError[];
  files: SourceBundleFile[];
}>;

export type SourceBundleExecutor = (
  resourceId: string,
) => Promise<ResourceFetchResult>;

export type CollectSourceBundleInput = Readonly<{
  snapshotId: string;
  storeKey: string;
  resources: readonly ResourceDescriptor[];
  execute: SourceBundleExecutor;
  signal?: AbortSignal;
  generatedAt?: string;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}>;

/**
 * Selects only previously analyzed, same-origin text capabilities. The export
 * still re-fetches every selected item through the Service Worker policy.
 */
export function selectSourceBundleCandidates(
  resources: readonly ResourceDescriptor[],
  storeKey: string,
): ResourceDescriptor[] {
  const origin = validatedOrigin(storeKey);
  const seen = new Set<string>();
  const selected: ResourceDescriptor[] = [];
  for (const resource of resources) {
    if (
      resource.originRelation !== "same-origin" ||
      resource.fetchStatus !== "analyzed" ||
      !FETCHABLE_RESOURCE_KINDS.has(resource.kind) ||
      seen.has(resource.resourceId)
    ) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(resource.url);
    } catch {
      continue;
    }
    if (url.origin !== origin || url.hash.length > 0) continue;
    seen.add(resource.resourceId);
    selected.push({ ...resource });
    if (selected.length >= MAX_SOURCE_BUNDLE_FILES) break;
  }
  return selected;
}

/**
 * Builds the explicit source-bearing export. Raw text exists only in the
 * returned value/string and must be released by the UI immediately after the
 * user-initiated download is dispatched.
 */
export async function collectPublicSourceBundle(
  input: CollectSourceBundleInput,
): Promise<{ value: PublicSourceBundle; json: string }> {
  if (input.snapshotId.length === 0) throw new TypeError("snapshotId is required");
  const origin = validatedOrigin(input.storeKey);
  const concurrency = boundedInteger(
    input.concurrency ?? SOURCE_BUNDLE_CONCURRENCY,
    1,
    SOURCE_BUNDLE_CONCURRENCY,
    "concurrency",
  );
  const eligibleResourceCount = input.resources.filter(
    (resource) =>
      resource.originRelation === "same-origin" &&
      resource.fetchStatus === "analyzed" &&
      FETCHABLE_RESOURCE_KINDS.has(resource.kind),
  ).length;
  const candidates = selectSourceBundleCandidates(input.resources, input.storeKey);
  const files: SourceBundleFile[] = [];
  const errors: SourceBundleError[] = [];
  let nextIndex = 0;
  let completed = 0;
  let exportedTextBytes = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, candidates.length) },
    () => worker(),
  );
  await Promise.all(workers);
  throwIfAborted(input.signal);

  files.sort((left, right) => left.filename.localeCompare(right.filename));
  const omittedResourceCount = Math.max(
    0,
    eligibleResourceCount - files.length,
  );
  const status =
    files.length === 0 && (candidates.length > 0 || errors.length > 0)
      ? "failed"
      : errors.length > 0 || omittedResourceCount > 0
        ? "partial"
        : "completed";
  const value: PublicSourceBundle = {
    meta: {
      schemaVersion: SOURCE_BUNDLE_SCHEMA_VERSION,
      kind: "ss-watcher-public-source-bundle",
      generatedAt: validIsoTimestamp(input.generatedAt ?? new Date().toISOString()),
      snapshotId: input.snapshotId,
      storeKey: origin,
      credentialMode: "omit",
      redirectMode: "error",
      fileLimit: MAX_SOURCE_BUNDLE_FILES,
      byteLimit: MAX_SOURCE_BUNDLE_BYTES,
      eligibleResourceCount,
      attemptedResourceCount: candidates.length,
      exportedFileCount: files.length,
      exportedTextBytes,
      omittedResourceCount,
      sourceOrigins: files.length === 0 ? [] : [origin],
      status,
      warning:
        "仅包含用户显式触发时重新读取的匿名同源公开文本；不包含服务器端源码、登录态内容或跨源正文。",
    },
    errors: errors.slice(0, 100),
    files,
  };
  return { value, json: JSON.stringify(value, null, 2) };

  async function worker(): Promise<void> {
    for (;;) {
      throwIfAborted(input.signal);
      const index = nextIndex;
      const target = candidates[index];
      nextIndex += 1;
      if (target === undefined) return;
      let result: ResourceFetchResult;
      try {
        result = await input.execute(target.resourceId);
      } catch (error: unknown) {
        throwIfAborted(input.signal);
        errors.push({
          resourceId: target.resourceId,
          reason: clippedError(error),
        });
        reportProgress();
        continue;
      }
      throwIfAborted(input.signal);
      if (!result.ok) {
        errors.push({ resourceId: target.resourceId, reason: result.reason });
        reportProgress();
        continue;
      }
      const rejection = validateFetchedResource(result, target, origin);
      if (rejection !== undefined) {
        errors.push({ resourceId: target.resourceId, reason: rejection });
        reportProgress();
        continue;
      }
      const encodedLength = new TextEncoder().encode(result.text).byteLength;
      const perFileLimit =
        target.kind === "source-map"
          ? MAX_SOURCE_MAP_BYTES
          : MAX_RESOURCE_BODY_BYTES;
      if (
        encodedLength > perFileLimit ||
        exportedTextBytes + encodedLength > MAX_SOURCE_BUNDLE_BYTES
      ) {
        errors.push({
          resourceId: target.resourceId,
          reason: "budget_exceeded",
        });
        reportProgress();
        continue;
      }
      exportedTextBytes += encodedLength;
      files.push({
        filename: sourceFilename(index, target),
        resourceId: target.resourceId,
        url: target.url,
        kind: target.kind,
        contentType: result.descriptor.contentType!,
        byteLength: encodedLength,
        sha256: result.descriptor.sha256!,
        ...(target.sha256 === undefined
          ? {}
          : { observedSha256: target.sha256 }),
        changedSinceScan:
          target.sha256 !== undefined &&
          target.sha256 !== result.descriptor.sha256,
        text: result.text,
      });
      reportProgress();
    }
  }

  function reportProgress(): void {
    completed += 1;
    input.onProgress?.(completed, candidates.length);
  }
}

function validateFetchedResource(
  result: Extract<ResourceFetchResult, { ok: true }>,
  target: ResourceDescriptor,
  origin: string,
): string | undefined {
  const descriptor = result.descriptor;
  if (
    result.resourceId !== target.resourceId ||
    descriptor.resourceId !== target.resourceId ||
    descriptor.url !== target.url ||
    descriptor.originRelation !== "same-origin" ||
    descriptor.fetchStatus !== "analyzed" ||
    typeof descriptor.contentType !== "string" ||
    descriptor.contentType.length === 0 ||
    !Number.isSafeInteger(descriptor.byteLength) ||
    descriptor.byteLength === undefined ||
    descriptor.byteLength < 0 ||
    typeof descriptor.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(descriptor.sha256)
  ) {
    return "invalid_fetch_result";
  }
  try {
    return new URL(descriptor.url).origin === origin
      ? undefined
      : "origin_mismatch";
  } catch {
    return "invalid_fetch_result";
  }
}

function sourceFilename(index: number, resource: ResourceDescriptor): string {
  const url = new URL(resource.url);
  const pathnameSegment = url.pathname.split("/").pop() ?? "";
  const basename = safelyDecodePathSegment(pathnameSegment)
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  const fallback = `${resource.kind}.${defaultExtension(resource.kind)}`;
  return `${String(index + 1).padStart(3, "0")}-${basename || fallback}`;
}

function safelyDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function defaultExtension(kind: ResourceDescriptor["kind"]): string {
  switch (kind) {
    case "document":
      return "html";
    case "script":
      return "js";
    case "style":
      return "css";
    case "source-map":
      return "map";
    default:
      return "json";
  }
}

function validatedOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new TypeError("storeKey must be an HTTP(S) origin");
  }
  return url.origin;
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

function validIsoTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError("generatedAt must be a valid timestamp");
  }
  return new Date(value).toISOString();
}

function clippedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 128);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Source export aborted", "AbortError");
}
