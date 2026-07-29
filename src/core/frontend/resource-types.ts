export const RESOURCE_KINDS = [
  "document",
  "script",
  "style",
  "json",
  "source-map",
  "iframe",
  "image",
  "font",
  "other",
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type ResourceOriginRelation = "same-origin" | "cross-origin";
export type ResourceFetchStatus =
  | "pending"
  | "analyzed"
  | "metadata-only"
  | "skipped"
  | "failed";
export type ResourceCandidateSource = "dom" | "resource-timing";
export type ResourceCapabilitySource =
  | ResourceCandidateSource
  | "source-map-reference";
export type ResourceQueryPolicy = "none" | "cache-key" | "redacted";
export type ResourceReplayPolicy = "safe-get" | "observed-only";

/** Bounded, sanitized signal returned by the ISOLATED Collector. */
export type CollectorResourceCandidate = Readonly<{
  url: string;
  kind: ResourceKind;
  queryPolicy: ResourceQueryPolicy;
  sources: ResourceCandidateSource[];
  initiator?: string;
  transferSize?: number;
  durationMs?: number;
}>;

/** Session-scoped capability. Only resourceId is accepted back from the panel. */
export type ResourceDescriptor = Readonly<{
  resourceId: string;
  url: string;
  originRelation: ResourceOriginRelation;
  kind: ResourceKind;
  queryPolicy: ResourceQueryPolicy;
  /**
   * Whether ResourcePolicy may issue its fixed anonymous GET. Runtime
   * fetch/XHR observations do not expose the original method or body and are
   * therefore retained as evidence only.
   */
  replayPolicy?: ResourceReplayPolicy;
  sources: ResourceCapabilitySource[];
  /** Present only for a SW-derived source-map capability. */
  derivedFromResourceId?: string;
  initiator?: string;
  transferSize?: number;
  durationMs?: number;
  fetchStatus: ResourceFetchStatus;
  contentType?: string;
  byteLength?: number;
  sha256?: string;
  failureReason?: ResourceFetchFailureReason;
  /**
   * Retained only for a non-successful public HTTP response. This makes a
   * resource-level availability decision inspectable without storing headers
   * or a response body.
   */
  httpStatus?: number;
}>;

export type ResourceFetchFailureReason =
  | "resource_not_registered"
  | "metadata_only"
  | "unsupported_kind"
  | "unsafe_query"
  | "sensitive_path"
  | "invalid_path"
  | "redirect_blocked"
  | "http_error"
  | "mime_rejected"
  | "too_large"
  | "budget_exceeded"
  | "timeout"
  | "aborted"
  | "network_error";

export type ResourceFetchResult =
  | Readonly<{
      ok: true;
      resourceId: string;
      descriptor: ResourceDescriptor;
      /** Transient only. Callers must discard this after analysis. */
      text: string;
      /**
       * Capabilities derived and registered by the SW while it held this
       * already-authorized body. The panel never supplies a derived URL.
       */
      derivedResources?: ResourceDescriptor[];
    }>
  | Readonly<{
      ok: false;
      resourceId: string;
      descriptor?: ResourceDescriptor;
      reason: ResourceFetchFailureReason;
      status?: number;
    }>;

export const FETCHABLE_RESOURCE_KINDS = new Set<ResourceKind>([
  "document",
  "script",
  "style",
  "json",
  "source-map",
]);
