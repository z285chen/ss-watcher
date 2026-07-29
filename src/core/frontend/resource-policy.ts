import { checkPublicPath } from "../security/path-policy";
import { inspectSourceMapReference } from "./source-map-policy";
import {
  FETCHABLE_RESOURCE_KINDS,
  RESOURCE_KINDS,
  type CollectorResourceCandidate,
  type ResourceDescriptor,
  type ResourceFetchFailureReason,
  type ResourceFetchResult,
  type ResourceKind,
  type ResourceQueryPolicy,
  type ResourceReplayPolicy,
} from "./resource-types";

export const MAX_RESOURCE_CANDIDATES = 300;
export const MAX_DERIVED_SOURCE_MAPS = 24;
export const MAX_RESOURCE_CAPABILITIES =
  MAX_RESOURCE_CANDIDATES + MAX_DERIVED_SOURCE_MAPS;
export const MAX_RESOURCE_BODY_BYTES = 2 * 1_024 * 1_024;
export const MAX_SOURCE_MAP_BYTES = 5 * 1_024 * 1_024;
export const DEFAULT_RESOURCE_TIMEOUT_MS = 12_000;

const RESOURCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CACHE_QUERY_KEYS = new Set(["v", "ver", "version"]);
const CACHE_QUERY_VALUE_PATTERN = /^[a-zA-Z0-9._~-]{1,64}$/u;
const RESOURCE_KIND_SET = new Set<string>(RESOURCE_KINDS);
const RUNTIME_REQUEST_INITIATORS = new Set([
  "beacon",
  "fetch",
  "ping",
  "xmlhttprequest",
]);

export type ResourcePolicyContext = Readonly<{ origin: string }>;
export type RegisterResourceOptions = Readonly<{
  createResourceId?: () => string;
}>;
export type ResourceRequestOptions = Readonly<{
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Optional scan-level allowance; never expands the per-kind hard limit. */
  maximumBytes?: number;
}>;

export type DeriveSourceMapOptions = Readonly<{
  createResourceId?: () => string;
}>;

/**
 * Converts page-observed candidates into bounded session capabilities. Unsafe
 * query-bearing resources remain visible as metadata but can never be fetched.
 */
export function registerResourceCandidates(
  candidates: readonly CollectorResourceCandidate[],
  context: ResourcePolicyContext,
  options: RegisterResourceOptions = {},
): ResourceDescriptor[] {
  const origin = validatedOrigin(context.origin);
  const createResourceId = options.createResourceId ?? (() => crypto.randomUUID());
  const registered: ResourceDescriptor[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates.slice(0, MAX_RESOURCE_CANDIDATES)) {
    const inspected = inspectCandidate(candidate);
    if (inspected === undefined) continue;
    const key = `${inspected.kind}\u0000${inspected.url.href}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const resourceId = createResourceId();
    if (!RESOURCE_ID_PATTERN.test(resourceId)) {
      throw new TypeError("createResourceId returned an invalid id");
    }
    const originRelation =
      inspected.url.origin === origin ? "same-origin" : "cross-origin";
    const replayPolicy = replayPolicyForCandidate(candidate);
    const canFetch =
      replayPolicy === "safe-get" &&
      originRelation === "same-origin" &&
      inspected.queryPolicy !== "redacted" &&
      FETCHABLE_RESOURCE_KINDS.has(inspected.kind) &&
      checkPublicPath(inspected.url.pathname).ok;

    registered.push({
      resourceId,
      url: inspected.url.href,
      originRelation,
      kind: inspected.kind,
      queryPolicy: inspected.queryPolicy,
      replayPolicy,
      sources: [...new Set(candidate.sources)].slice(0, 2),
      ...(candidate.initiator === undefined
        ? {}
        : { initiator: candidate.initiator.slice(0, 64) }),
      ...(validMetric(candidate.transferSize)
        ? { transferSize: candidate.transferSize }
        : {}),
      ...(validMetric(candidate.durationMs)
        ? { durationMs: candidate.durationMs }
        : {}),
      fetchStatus: canFetch ? "pending" : "metadata-only",
    });
  }
  return registered;
}

/**
 * Creates a capability from a sourceMappingURL only after the SW has fetched
 * the already-registered parent body. The caller must persist the returned
 * descriptor against the same session before it can be executed.
 */
export function deriveSourceMapCapability(
  context: ResourcePolicyContext,
  parent: ResourceDescriptor,
  sourceText: string,
  options: DeriveSourceMapOptions = {},
): ResourceDescriptor | undefined {
  const origin = validatedOrigin(context.origin);
  if (
    !isResourceDescriptor(parent) ||
    parent.originRelation !== "same-origin" ||
    parent.fetchStatus !== "analyzed" ||
    (parent.kind !== "script" && parent.kind !== "style")
  ) {
    return undefined;
  }
  const inspection = inspectSourceMapReference(sourceText, parent.url);
  if (
    inspection.status !== "external" ||
    inspection.originRelation !== "same-origin"
  ) {
    return undefined;
  }

  let mapUrl: URL;
  try {
    mapUrl = new URL(inspection.url);
  } catch {
    return undefined;
  }
  if (
    mapUrl.origin !== origin ||
    mapUrl.username.length > 0 ||
    mapUrl.password.length > 0 ||
    mapUrl.hash.length > 0 ||
    mapUrl.href.length > 2_048 ||
    !hasOnlySafeCacheQuery(mapUrl) ||
    !checkPublicPath(mapUrl.pathname).ok
  ) {
    return undefined;
  }
  const resourceId = (options.createResourceId ?? (() => crypto.randomUUID()))();
  if (!RESOURCE_ID_PATTERN.test(resourceId)) {
    throw new TypeError("createResourceId returned an invalid id");
  }
  return {
    resourceId,
    url: mapUrl.href,
    originRelation: "same-origin",
    kind: "source-map",
    queryPolicy: mapUrl.searchParams.size === 0 ? "none" : "cache-key",
    replayPolicy: "safe-get",
    sources: ["source-map-reference"],
    derivedFromResourceId: parent.resourceId,
    fetchStatus: "pending",
  };
}

export async function executeRegisteredResourceRequest(
  context: ResourcePolicyContext,
  descriptor: ResourceDescriptor,
  options: ResourceRequestOptions = {},
): Promise<ResourceFetchResult> {
  const origin = validatedOrigin(context.origin);
  if (!isResourceDescriptor(descriptor)) {
    return failure("", "resource_not_registered");
  }
  if (
    descriptor.originRelation !== "same-origin" ||
    descriptor.fetchStatus === "metadata-only" ||
    descriptor.replayPolicy === "observed-only"
  ) {
    return failure(descriptor.resourceId, "metadata_only", descriptor);
  }
  if (!FETCHABLE_RESOURCE_KINDS.has(descriptor.kind)) {
    return failure(descriptor.resourceId, "unsupported_kind", descriptor);
  }
  if (descriptor.queryPolicy === "redacted") {
    return failure(descriptor.resourceId, "unsafe_query", descriptor);
  }

  let url: URL;
  try {
    url = new URL(descriptor.url);
  } catch {
    return failure(descriptor.resourceId, "resource_not_registered", descriptor);
  }
  if (url.origin !== origin || !hasOnlySafeCacheQuery(url)) {
    return failure(descriptor.resourceId, "unsafe_query", descriptor);
  }
  const pathDecision = checkPublicPath(url.pathname);
  if (!pathDecision.ok) {
    return failure(descriptor.resourceId, pathDecision.reason, descriptor);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_RESOURCE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new TypeError("timeoutMs must be between 1 and 60000");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestAbort = linkedAbortController(options.signal, timeoutMs);
  try {
    const response = await fetchImpl(url.href, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: requestAbort.controller.signal,
    });
    if (
      response.redirected ||
      response.type === "opaqueredirect" ||
      (response.url.length > 0 && response.url !== url.href)
    ) {
      return failure(descriptor.resourceId, "redirect_blocked", descriptor);
    }
    if (!response.ok) {
      return failure(
        descriptor.resourceId,
        "http_error",
        descriptor,
        response.status,
      );
    }

    const contentType = normalizedContentType(response.headers.get("content-type"));
    if (!isAllowedMime(descriptor.kind, contentType)) {
      return failure(descriptor.resourceId, "mime_rejected", descriptor);
    }
    const kindMaximumBytes =
      descriptor.kind === "source-map"
        ? MAX_SOURCE_MAP_BYTES
        : MAX_RESOURCE_BODY_BYTES;
    const maximumBytes = boundedMaximumBytes(
      options.maximumBytes,
      kindMaximumBytes,
    );
    const declaredLength = finiteContentLength(response.headers.get("content-length"));
    if (declaredLength !== undefined && declaredLength > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      return failure(descriptor.resourceId, "too_large", descriptor);
    }

    const bytes = await readWithinLimit(response, maximumBytes);
    if (bytes === undefined) {
      return failure(descriptor.resourceId, "too_large", descriptor);
    }
    const sha256 = await sha256Hex(bytes);
    const completed: ResourceDescriptor = {
      ...descriptor,
      fetchStatus: "analyzed",
      contentType,
      byteLength: bytes.byteLength,
      sha256,
    };
    return {
      ok: true,
      resourceId: descriptor.resourceId,
      descriptor: completed,
      text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
    };
  } catch (error: unknown) {
    if (requestAbort.timedOut()) {
      return failure(descriptor.resourceId, "timeout", descriptor);
    }
    if (options.signal?.aborted === true || isAbortError(error)) {
      return failure(descriptor.resourceId, "aborted", descriptor);
    }
    return failure(descriptor.resourceId, "network_error", descriptor);
  } finally {
    requestAbort.dispose();
  }
}

export function isResourceDescriptor(value: unknown): value is ResourceDescriptor {
  if (!isRecord(value)) return false;
  if (
    typeof value.resourceId !== "string" ||
    !RESOURCE_ID_PATTERN.test(value.resourceId) ||
    typeof value.url !== "string" ||
    value.url.length === 0 ||
    value.url.length > 2_048 ||
    !RESOURCE_KIND_SET.has(String(value.kind)) ||
    (value.originRelation !== "same-origin" &&
      value.originRelation !== "cross-origin") ||
    !["none", "cache-key", "redacted"].includes(String(value.queryPolicy)) ||
    (value.replayPolicy !== undefined &&
      value.replayPolicy !== "safe-get" &&
      value.replayPolicy !== "observed-only") ||
    !["pending", "analyzed", "metadata-only", "skipped", "failed"].includes(
      String(value.fetchStatus),
    ) ||
    !Array.isArray(value.sources) ||
    value.sources.length < 1 ||
    value.sources.length > 2 ||
    !value.sources.every(
      (source) =>
        source === "dom" ||
        source === "resource-timing" ||
        source === "source-map-reference",
    )
  ) {
    return false;
  }
  try {
    const url = new URL(value.url);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hash.length > 0
    ) {
      return false;
    }
  } catch {
    return false;
  }
  const hasDerivedSource = value.sources.includes("source-map-reference");
  if (
    hasDerivedSource !== (value.derivedFromResourceId !== undefined) ||
    (hasDerivedSource &&
      (value.sources.length !== 1 ||
        value.kind !== "source-map" ||
        value.originRelation !== "same-origin" ||
        typeof value.derivedFromResourceId !== "string" ||
        !RESOURCE_ID_PATTERN.test(value.derivedFromResourceId)))
  ) {
    return false;
  }
  return (
    optionalShortString(value.initiator, 64) &&
    optionalMetric(value.transferSize) &&
    optionalMetric(value.durationMs) &&
    optionalShortString(value.contentType, 256) &&
    optionalMetric(value.byteLength) &&
    optionalHttpStatus(value.httpStatus) &&
    (value.sha256 === undefined ||
      (typeof value.sha256 === "string" && /^[0-9a-f]{64}$/u.test(value.sha256))) &&
    (value.failureReason === undefined || typeof value.failureReason === "string")
  );
}

function replayPolicyForCandidate(
  candidate: CollectorResourceCandidate,
): ResourceReplayPolicy {
  if (candidate.sources.includes("dom")) return "safe-get";
  const initiator = candidate.initiator?.trim().toLowerCase();
  return initiator !== undefined && RUNTIME_REQUEST_INITIATORS.has(initiator)
    ? "observed-only"
    : "safe-get";
}

function inspectCandidate(candidate: CollectorResourceCandidate):
  | { url: URL; kind: ResourceKind; queryPolicy: ResourceQueryPolicy }
  | undefined {
  if (!isRecord(candidate) || !RESOURCE_KIND_SET.has(String(candidate.kind))) {
    return undefined;
  }
  if (
    !Array.isArray(candidate.sources) ||
    candidate.sources.length < 1 ||
    candidate.sources.length > 2 ||
    !candidate.sources.every(
      (source) => source === "dom" || source === "resource-timing",
    )
  ) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(candidate.url);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return undefined;
  }
  url.hash = "";
  const queryPolicy = inspectQuery(url, candidate.queryPolicy);
  if (queryPolicy === "redacted") url.search = "";
  if (url.href.length > 2_048) return undefined;
  return { url, kind: candidate.kind, queryPolicy };
}

function inspectQuery(url: URL, claimed: ResourceQueryPolicy): ResourceQueryPolicy {
  if (claimed === "redacted") return "redacted";
  if (url.searchParams.size === 0) return "none";
  return hasOnlySafeCacheQuery(url) ? "cache-key" : "redacted";
}

function hasOnlySafeCacheQuery(url: URL): boolean {
  if (url.searchParams.size === 0) return true;
  for (const [key, value] of url.searchParams) {
    if (
      !CACHE_QUERY_KEYS.has(key.toLowerCase()) ||
      !CACHE_QUERY_VALUE_PATTERN.test(value)
    ) {
      return false;
    }
  }
  return true;
}

function validatedOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== value ||
    (url.protocol !== "http:" && url.protocol !== "https:")
  ) {
    throw new TypeError("origin must be a canonical http(s) origin");
  }
  return url.origin;
}

function normalizedContentType(value: string | null): string {
  return (value ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase()
    .slice(0, 256) ?? "";
}

function isAllowedMime(kind: ResourceKind, mime: string): boolean {
  if (mime === "text/plain") return FETCHABLE_RESOURCE_KINDS.has(kind);
  switch (kind) {
    case "document":
      return mime === "text/html" || mime === "application/xhtml+xml";
    case "script":
      return [
        "application/javascript",
        "text/javascript",
        "application/x-javascript",
        "application/ecmascript",
        "text/ecmascript",
      ].includes(mime);
    case "style":
      return mime === "text/css";
    case "json":
    case "source-map":
      return (
        mime === "application/json" ||
        mime === "text/json" ||
        /^application\/[a-z0-9.+-]+\+json$/u.test(mime)
      );
    default:
      return false;
  }
}

async function readWithinLimit(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array | undefined> {
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maximumBytes ? bytes : undefined;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value === undefined) continue;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const copied = Uint8Array.from(value);
  const bytes = await crypto.subtle.digest("SHA-256", copied.buffer);
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function linkedAbortController(signal: AbortSignal | undefined, timeoutMs: number): {
  controller: AbortController;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let didTimeOut = false;
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted === true) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    didTimeOut = true;
    controller.abort(new DOMException("Resource request timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    controller,
    timedOut: () => didTimeOut,
    dispose: () => {
      globalThis.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function failure(
  resourceId: string,
  reason: ResourceFetchFailureReason,
  descriptor?: ResourceDescriptor,
  status?: number,
): ResourceFetchResult {
  return {
    ok: false,
    resourceId,
    reason,
    ...(descriptor === undefined
      ? {}
      : {
          descriptor: {
            ...descriptor,
            fetchStatus:
              reason === "metadata_only" || reason === "unsafe_query"
                ? "metadata-only"
                : reason === "unsupported_kind"
                  ? "skipped"
                  : "failed",
            failureReason: reason,
            ...(validHttpStatus(status) ? { httpStatus: status } : {}),
          },
        }),
    ...(status === undefined ? {} : { status }),
  };
}

function finiteContentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function boundedMaximumBytes(
  requested: number | undefined,
  hardMaximum: number,
): number {
  if (requested === undefined) return hardMaximum;
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new TypeError("maximumBytes must be a positive safe integer");
  }
  return Math.min(requested, hardMaximum);
}

function validMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalMetric(value: unknown): boolean {
  return value === undefined || validMetric(value);
}

function optionalHttpStatus(value: unknown): boolean {
  return value === undefined || validHttpStatus(value);
}

function validHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function optionalShortString(value: unknown, maximumLength: number): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && value.length <= maximumLength)
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
