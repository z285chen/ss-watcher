import {
  checkPublicPath,
  type PathPolicyRejectionReason,
} from "../core/security/path-policy";
import {
  MAX_DERIVED_SOURCE_MAPS,
  MAX_RESOURCE_CAPABILITIES,
  isResourceDescriptor,
} from "../core/frontend/resource-policy";
import type { ResourceDescriptor } from "../core/frontend/resource-types";

export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1_000;
export const SESSION_STORAGE_PREFIX = "scan-session:";

const TOKEN_BYTE_LENGTH = 32;
const RUN_ID_BYTE_LENGTH = 16;
const RUN_ID_PATTERN = /^[a-zA-Z0-9._~-]{1,128}$/u;
const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{43}$/u;
const PANEL_INSTANCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ScanSession = {
  runId: string;
  sessionToken: string;
  /** Present when Chrome exposes MessageSender.documentId for the Side Panel. */
  panelDocumentId?: string;
  /** SHA-256 of the in-memory panel nonce; the raw nonce is never persisted. */
  panelInstanceHash?: string;
  /** Narrow mode for an explicitly targeted extension-owned capture controller. */
  detachedController?: true;
  windowId: number;
  tabId: number;
  documentId: string;
  origin: string;
  /** Normalized, query-free path used to detect same-document path changes. */
  pathname: string;
  authorizedAt: string;
  expiresAt: string;
  state: "active";
  /** Page-observed, SW-registered capabilities; deleted with this session. */
  resources?: ResourceDescriptor[];
};

export type SessionHandle = Pick<ScanSession, "runId" | "sessionToken">;

export type SessionFailureReason =
  | "invalid_request"
  | "invalid_panel_sender"
  | "invalid_collector_sender"
  | "no_active_tab"
  | "invalid_tab"
  | "invalid_window"
  | "unsupported_url"
  | PathPolicyRejectionReason
  | "authorization_probe_failed"
  | "authorization_race"
  | "storage_error"
  | "session_not_found"
  | "session_corrupt"
  | "session_mismatch"
  | "session_expired";

export type EstablishSessionResult =
  | { ok: true; session: ScanSession; handle: SessionHandle }
  | { ok: false; reason: SessionFailureReason };

export type SessionValidationResult =
  | { ok: true; session: ScanSession }
  | { ok: false; reason: SessionFailureReason };

export type DerivedResourceRegistrationResult =
  | {
      ok: true;
      session: ScanSession;
      resource: ResourceDescriptor;
      created: boolean;
    }
  | { ok: false; reason: SessionFailureReason | "resource_limit" };

export type EstablishSessionCandidate = {
  windowId: number;
  /** Optional explicit active tab used by the detached capture controller. */
  tabId?: number;
  panelInstanceId?: string;
  /** If absent, the manager creates a cryptographically random run id. */
  runId?: string;
};

export type TabLike = {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string;
};

export type WindowLike = {
  id?: number;
  focused?: boolean;
};

export type MessageSenderLike = {
  id?: string;
  url?: string;
  origin?: string;
  documentId?: string;
  frameId?: number;
  tab?: TabLike;
};

export type AuthorizationProbePayload = {
  href: string;
  origin: string;
  pathname: string;
};

export type AuthorizationProbeInjectionResult = {
  frameId: number;
  documentId?: string;
  result?: AuthorizationProbePayload;
};

export type AuthorizationProbeInjection = {
  target: { tabId: number; frameIds: [number] };
  func: () => AuthorizationProbePayload;
};

export interface SessionStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface SessionTabsApi {
  query(queryInfo: { active: true; windowId: number }): Promise<TabLike[]>;
  get(tabId: number): Promise<TabLike>;
}

export interface SessionWindowsApi {
  get(windowId: number): Promise<WindowLike>;
}

export interface SessionScriptingApi {
  executeScript(
    injection: AuthorizationProbeInjection,
  ): Promise<AuthorizationProbeInjectionResult[]>;
}

export type SessionManagerChromeApi = {
  runtime: {
    id: string;
    getURL(path: string): string;
  };
  storage: {
    session: SessionStorageArea;
  };
  tabs: SessionTabsApi;
  windows: SessionWindowsApi;
  scripting: SessionScriptingApi;
};

export type SessionManagerOptions = {
  ttlMs?: number;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
};

export type BeforeSessionRevoke = (session: Readonly<ScanSession>) => Promise<void>;

type InspectedUrl = {
  origin: string;
  pathname: string;
};

type UrlInspectionResult =
  | { ok: true; value: InspectedUrl }
  | {
      ok: false;
      reason: "unsupported_url" | PathPolicyRejectionReason;
    };

type StoredSessionResult =
  | { ok: true; session: ScanSession }
  | { ok: false; reason: SessionFailureReason };

type TabValidationResult =
  | { ok: true }
  | { ok: false; reason: SessionFailureReason };

export function minimalAuthorizationProbe(): AuthorizationProbePayload {
  return {
    href: location.href,
    origin: location.origin,
    pathname: location.pathname,
  };
}

export function createRunId(
  randomBytes: (length: number) => Uint8Array = secureRandomBytes,
): string {
  return `run_${toBase64Url(assertRandomBytes(randomBytes(RUN_ID_BYTE_LENGTH), RUN_ID_BYTE_LENGTH))}`;
}

export function secureRandomBytes(length: number): Uint8Array {
  const result = new Uint8Array(length);
  globalThis.crypto.getRandomValues(result);
  return result;
}

export class SessionManager {
  readonly #api: SessionManagerChromeApi;
  readonly #now: () => number;
  readonly #randomBytes: (length: number) => Uint8Array;
  readonly #ttlMs: number;
  readonly #extensionOrigin: string;
  readonly #extensionProtocol: string;
  readonly #extensionHost: string;
  readonly #sidePanelRoot: URL;
  readonly #resourceMutationTails = new Map<string, Promise<void>>();

  constructor(api: SessionManagerChromeApi, options: SessionManagerOptions = {}) {
    this.#api = api;
    this.#now = options.now ?? Date.now;
    this.#randomBytes = options.randomBytes ?? secureRandomBytes;
    this.#ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;

    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs <= 0) {
      throw new TypeError("ttlMs must be a positive safe integer");
    }

    const extensionRoot = new URL(api.runtime.getURL("/"));
    if (
      extensionRoot.protocol !== "chrome-extension:" ||
      extensionRoot.host !== api.runtime.id
    ) {
      throw new TypeError("runtime.getURL must resolve to this extension");
    }
    this.#extensionProtocol = extensionRoot.protocol;
    this.#extensionHost = extensionRoot.host;
    this.#extensionOrigin = `${extensionRoot.protocol}//${extensionRoot.host}`;
    this.#sidePanelRoot = new URL("sidepanel/", extensionRoot);
  }

  async establishSession(
    candidate: EstablishSessionCandidate,
    sender: MessageSenderLike,
  ): Promise<EstablishSessionResult> {
    const panelBinding = await this.#validatedPanelBinding(
      sender,
      candidate.panelInstanceId,
    );
    if (panelBinding === undefined) {
      return { ok: false, reason: "invalid_panel_sender" };
    }
    if (!Number.isSafeInteger(candidate.windowId) || candidate.windowId < 0) {
      return { ok: false, reason: "invalid_request" };
    }
    if (panelBinding.detachedController === true && candidate.tabId === undefined) {
      return { ok: false, reason: "invalid_request" };
    }
    if (
      panelBinding.detachedController !== true &&
      !(await this.#isFocusedWindow(candidate.windowId))
    ) {
      return { ok: false, reason: "invalid_window" };
    }

    let runId: string;
    try {
      runId = candidate.runId ?? createRunId(this.#randomBytes);
    } catch {
      return { ok: false, reason: "invalid_request" };
    }
    if (!isValidRunId(runId)) {
      return { ok: false, reason: "invalid_request" };
    }

    // A failed re-authorization attempt must never leave an older credential
    // with the same run id usable.
    try {
      await this.#api.storage.session.remove(storageKey(runId));
    } catch {
      return { ok: false, reason: "storage_error" };
    }

    let tab: TabLike | undefined;
    if (candidate.tabId !== undefined) {
      if (!Number.isSafeInteger(candidate.tabId) || candidate.tabId < 0) {
        return { ok: false, reason: "invalid_request" };
      }
      try {
        tab = await this.#api.tabs.get(candidate.tabId);
      } catch {
        return { ok: false, reason: "no_active_tab" };
      }
    } else {
      let matchingTabs: TabLike[];
      try {
        matchingTabs = await this.#api.tabs.query({
          active: true,
          windowId: candidate.windowId,
        });
      } catch {
        return { ok: false, reason: "no_active_tab" };
      }
      if (matchingTabs.length !== 1) {
        return { ok: false, reason: "no_active_tab" };
      }
      tab = matchingTabs[0];
    }
    if (
      tab === undefined ||
      !Number.isSafeInteger(tab.id) ||
      tab.id === undefined ||
      tab.id < 0 ||
      tab.windowId !== candidate.windowId ||
      tab.active !== true
    ) {
      return { ok: false, reason: "invalid_tab" };
    }

    const beforeProbe =
      tab.url === undefined ? undefined : inspectStorefrontUrl(tab.url);
    if (beforeProbe !== undefined && !beforeProbe.ok) return beforeProbe;

    let probeResults: AuthorizationProbeInjectionResult[];
    try {
      probeResults = await this.#api.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        func: minimalAuthorizationProbe,
      });
    } catch {
      return { ok: false, reason: "authorization_probe_failed" };
    }

    const probe = validatedProbe(probeResults);
    if (probe === undefined) {
      return { ok: false, reason: "authorization_probe_failed" };
    }
    const probedUrl = inspectStorefrontUrl(probe.result.href);
    if (!probedUrl.ok) return probedUrl;
    if (
      probe.result.origin !== probedUrl.value.origin ||
      probe.result.pathname !== new URL(probe.result.href).pathname ||
      (beforeProbe !== undefined &&
        beforeProbe.ok &&
        !sameInspectedUrl(beforeProbe.value, probedUrl.value))
    ) {
      return { ok: false, reason: "authorization_race" };
    }

    let tabAfterProbe: TabLike;
    try {
      tabAfterProbe = await this.#api.tabs.get(tab.id);
    } catch {
      return { ok: false, reason: "authorization_race" };
    }
    const afterProbe = inspectMatchingTab(
      tabAfterProbe,
      tab.id,
      candidate.windowId,
      probedUrl.value,
      true,
    );
    if (!afterProbe.ok) {
      if (afterProbe.reason === "sensitive_path" || afterProbe.reason === "invalid_path") {
        return afterProbe;
      }
      return { ok: false, reason: "authorization_race" };
    }

    let tokenBytes: Uint8Array;
    try {
      tokenBytes = assertRandomBytes(this.#randomBytes(TOKEN_BYTE_LENGTH), TOKEN_BYTE_LENGTH);
    } catch {
      return { ok: false, reason: "invalid_request" };
    }

    const authorizedAtMs = this.#now();
    const expiresAtMs = authorizedAtMs + this.#ttlMs;
    if (!Number.isFinite(authorizedAtMs) || !Number.isSafeInteger(expiresAtMs)) {
      return { ok: false, reason: "invalid_request" };
    }

    const session: ScanSession = {
      runId,
      sessionToken: toBase64Url(tokenBytes),
      ...panelBinding,
      windowId: candidate.windowId,
      tabId: tab.id,
      documentId: probe.documentId,
      origin: probedUrl.value.origin,
      pathname: probedUrl.value.pathname,
      authorizedAt: new Date(authorizedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      state: "active",
    };

    try {
      await this.#api.storage.session.set({ [storageKey(runId)]: session });
    } catch {
      return { ok: false, reason: "storage_error" };
    }

    return {
      ok: true,
      session,
      handle: { runId, sessionToken: session.sessionToken },
    };
  }

  async validatePanelMessage(
    handle: SessionHandle,
    sender: MessageSenderLike,
    panelInstanceId?: string,
  ): Promise<SessionValidationResult> {
    const stored = await this.#readActiveSession(handle.runId);
    if (!stored.ok) return stored;
    const { session } = stored;

    if (
      !constantTimeEqual(handle.sessionToken, session.sessionToken) ||
      !(await this.#matchesPanelBinding(session, sender, panelInstanceId))
    ) {
      return this.#rejectAndRevoke(session.runId, "session_mismatch");
    }

    const tabValidation = await this.#validateCurrentTab(session, false);
    if (!tabValidation.ok) {
      return this.#rejectAndRevoke(session.runId, tabValidation.reason);
    }
    return { ok: true, session };
  }

  async validateCollectorMessage(
    runId: string,
    sender: MessageSenderLike,
  ): Promise<SessionValidationResult> {
    const stored = await this.#readActiveSession(runId);
    if (!stored.ok) return stored;
    const { session } = stored;

    if (!this.#isValidCollectorSender(sender, session)) {
      return this.#rejectAndRevoke(session.runId, "invalid_collector_sender");
    }

    const tabValidation = await this.#validateCurrentTab(session, false);
    if (!tabValidation.ok) {
      return this.#rejectAndRevoke(session.runId, tabValidation.reason);
    }
    return { ok: true, session };
  }

  /** Rechecks tab, path, origin and document before a privileged operation. */
  async validateForExecution(handle: SessionHandle): Promise<SessionValidationResult> {
    const stored = await this.#readActiveSession(handle.runId);
    if (!stored.ok) return stored;
    const { session } = stored;
    if (!constantTimeEqual(handle.sessionToken, session.sessionToken)) {
      return this.#rejectAndRevoke(session.runId, "session_mismatch");
    }

    const tabValidation = await this.#validateCurrentTab(session, true);
    if (!tabValidation.ok) {
      return this.#rejectAndRevoke(session.runId, tabValidation.reason);
    }
    return { ok: true, session };
  }

  async replaceRegisteredResources(
    handle: SessionHandle,
    resources: readonly ResourceDescriptor[],
  ): Promise<SessionValidationResult> {
    if (
      resources.length > MAX_RESOURCE_CAPABILITIES ||
      resources.some((resource) => !isResourceDescriptor(resource)) ||
      new Set(resources.map((resource) => resource.resourceId)).size !==
        resources.length
    ) {
      return { ok: false, reason: "invalid_request" };
    }
    return this.#withResourceMutation(handle.runId, async () => {
      const stored = await this.#readActiveSession(handle.runId);
      if (!stored.ok) return stored;
      if (!constantTimeEqual(handle.sessionToken, stored.session.sessionToken)) {
        return this.#rejectAndRevoke(stored.session.runId, "session_mismatch");
      }
      const session: ScanSession = {
        ...stored.session,
        resources: resources.map((resource) => ({ ...resource })),
      };
      try {
        await this.#api.storage.session.set({
          [storageKey(session.runId)]: session,
        });
      } catch {
        return { ok: false, reason: "storage_error" };
      }
      return { ok: true, session };
    });
  }

  async registerDerivedResource(
    handle: SessionHandle,
    parentResourceId: string,
    resource: ResourceDescriptor,
  ): Promise<DerivedResourceRegistrationResult> {
    if (
      !isResourceDescriptor(resource) ||
      resource.kind !== "source-map" ||
      resource.originRelation !== "same-origin" ||
      resource.fetchStatus !== "pending" ||
      resource.queryPolicy === "redacted" ||
      resource.sources.length !== 1 ||
      resource.sources[0] !== "source-map-reference" ||
      resource.derivedFromResourceId !== parentResourceId
    ) {
      return { ok: false, reason: "invalid_request" };
    }

    return this.#withResourceMutation(handle.runId, async () => {
      const stored = await this.#readActiveSession(handle.runId);
      if (!stored.ok) return stored;
      if (!constantTimeEqual(handle.sessionToken, stored.session.sessionToken)) {
        await this.#bestEffortRemove(storageKey(stored.session.runId));
        return { ok: false, reason: "session_mismatch" };
      }
      const resources = stored.session.resources ?? [];
      const parent = resources.find(
        (candidate) => candidate.resourceId === parentResourceId,
      );
      if (
        parent === undefined ||
        parent.originRelation !== "same-origin" ||
        (parent.kind !== "script" && parent.kind !== "style")
      ) {
        return { ok: false, reason: "invalid_request" };
      }
      const resourceUrl = new URL(resource.url);
      if (resourceUrl.origin !== stored.session.origin) {
        return { ok: false, reason: "invalid_request" };
      }
      const existing = resources.find(
        (candidate) =>
          candidate.kind === "source-map" && candidate.url === resource.url,
      );
      if (existing !== undefined) {
        return {
          ok: true,
          session: stored.session,
          resource: existing,
          created: false,
        };
      }
      const derivedCount = resources.filter((candidate) =>
        candidate.sources.includes("source-map-reference"),
      ).length;
      if (
        resources.length >= MAX_RESOURCE_CAPABILITIES ||
        derivedCount >= MAX_DERIVED_SOURCE_MAPS
      ) {
        return { ok: false, reason: "resource_limit" };
      }
      const session: ScanSession = {
        ...stored.session,
        resources: [...resources, { ...resource }],
      };
      try {
        await this.#api.storage.session.set({
          [storageKey(session.runId)]: session,
        });
      } catch {
        return { ok: false, reason: "storage_error" };
      }
      return { ok: true, session, resource, created: true };
    });
  }

  async revoke(runId: string): Promise<boolean> {
    if (!isValidRunId(runId)) return false;
    return this.#withResourceMutation(runId, async () => {
      try {
        await this.#api.storage.session.remove(storageKey(runId));
        return true;
      } catch {
        return false;
      }
    });
  }

  async revokeByTab(tabId: number, beforeRevoke?: BeforeSessionRevoke): Promise<number> {
    return this.#revokeMatching((session) => session.tabId === tabId, beforeRevoke);
  }

  async revokeByWindow(windowId: number, beforeRevoke?: BeforeSessionRevoke): Promise<number> {
    return this.#revokeMatching((session) => session.windowId === windowId, beforeRevoke);
  }

  async revokeOutsideWindow(windowId: number, beforeRevoke?: BeforeSessionRevoke): Promise<number> {
    return this.#revokeMatching(
      (session) => session.detachedController !== true && session.windowId !== windowId,
      beforeRevoke,
    );
  }

  /** A transient WINDOW_ID_NONE must not destroy a detached controller session. */
  async revokeOnFocusLoss(beforeRevoke?: BeforeSessionRevoke): Promise<number> {
    return this.#revokeMatching(
      (session) => session.detachedController !== true,
      beforeRevoke,
    );
  }

  async revokeAll(): Promise<number> {
    return this.#revokeMatching(() => true);
  }

  async revokeByPanelDocument(
    panelDocumentId: string,
    beforeRevoke?: BeforeSessionRevoke,
  ): Promise<number> {
    return this.#revokeMatching(
      (session) => session.panelDocumentId === panelDocumentId,
      beforeRevoke,
    );
  }

  async revokeByPanelInstance(
    panelInstanceId: string,
    beforeRevoke?: BeforeSessionRevoke,
  ): Promise<number> {
    if (!PANEL_INSTANCE_PATTERN.test(panelInstanceId)) return 0;
    let panelInstanceHash: string;
    try {
      panelInstanceHash = await hashPanelInstanceId(panelInstanceId);
    } catch {
      return 0;
    }
    return this.#revokeMatching(
      (session) => session.panelInstanceHash === panelInstanceHash,
      beforeRevoke,
    );
  }

  /** Intended for tabs.onActivated: all prior targets in that window expire. */
  async revokeInactiveForWindow(
    windowId: number,
    activeTabId: number,
    beforeRevoke?: BeforeSessionRevoke,
  ): Promise<number> {
    return this.#revokeMatching(
      (session) => session.windowId === windowId && session.tabId !== activeTabId,
      beforeRevoke,
    );
  }

  async purgeExpired(): Promise<number> {
    const now = this.#now();
    if (!Number.isFinite(now)) return this.#revokeMatching(() => true);
    return this.#revokeMatching((session) => Date.parse(session.expiresAt) <= now);
  }

  async #validatedPanelBinding(
    sender: MessageSenderLike,
    panelInstanceId?: string,
  ): Promise<
    Pick<ScanSession, "panelDocumentId" | "panelInstanceHash" | "detachedController"> | undefined
  > {
    if (
      sender.id !== this.#api.runtime.id ||
      sender.url === undefined
    ) {
      return undefined;
    }

    let senderUrl: URL;
    try {
      senderUrl = new URL(sender.url);
    } catch {
      return undefined;
    }

    if (
      senderUrl.protocol !== this.#extensionProtocol ||
      senderUrl.host !== this.#extensionHost ||
      !senderUrl.pathname.startsWith(this.#sidePanelRoot.pathname) ||
      (sender.origin !== undefined && sender.origin !== this.#extensionOrigin)
    ) {
      return undefined;
    }
    const detachedController = senderUrl.searchParams.get("detachedCapture") === "1";
    if (
      sender.tab !== undefined &&
      !(
        detachedController &&
        sender.frameId === 0 &&
        sender.tab.url === sender.url
      )
    ) return undefined;

    const hasDocumentId =
      typeof sender.documentId === "string" && sender.documentId.length > 0;
    const hasPanelInstance =
      typeof panelInstanceId === "string" &&
      PANEL_INSTANCE_PATTERN.test(panelInstanceId);
    if (!hasDocumentId && !hasPanelInstance) return undefined;
    if (panelInstanceId !== undefined && !hasPanelInstance) return undefined;

    try {
      return {
        ...(hasDocumentId ? { panelDocumentId: sender.documentId } : {}),
        ...(hasPanelInstance
          ? { panelInstanceHash: await hashPanelInstanceId(panelInstanceId) }
          : {}),
        ...(detachedController ? { detachedController: true as const } : {}),
      };
    } catch {
      return undefined;
    }
  }

  async #matchesPanelBinding(
    session: ScanSession,
    sender: MessageSenderLike,
    panelInstanceId?: string,
  ): Promise<boolean> {
    const binding = await this.#validatedPanelBinding(sender, panelInstanceId);
    if (binding === undefined) return false;
    return (
      binding.panelDocumentId === session.panelDocumentId &&
      ((binding.panelInstanceHash === undefined &&
        session.panelInstanceHash === undefined) ||
        (binding.panelInstanceHash !== undefined &&
          session.panelInstanceHash !== undefined &&
          constantTimeEqual(
            binding.panelInstanceHash,
            session.panelInstanceHash,
          )))
    );
  }

  #isValidCollectorSender(sender: MessageSenderLike, session: ScanSession): boolean {
    if (
      sender.id !== this.#api.runtime.id ||
      sender.frameId !== 0 ||
      sender.documentId !== session.documentId ||
      sender.url === undefined ||
      sender.tab?.id !== session.tabId ||
      sender.tab.windowId !== session.windowId
    ) {
      return false;
    }

    const senderUrl = inspectStorefrontUrl(sender.url);
    if (
      !senderUrl.ok ||
      senderUrl.value.origin !== session.origin ||
      senderUrl.value.pathname !== session.pathname ||
      (sender.origin !== undefined && sender.origin !== session.origin)
    ) {
      return false;
    }

    if (sender.tab.url !== undefined) {
      const senderTabUrl = inspectStorefrontUrl(sender.tab.url);
      if (
        !senderTabUrl.ok ||
        senderTabUrl.value.origin !== session.origin ||
        senderTabUrl.value.pathname !== session.pathname
      ) {
        return false;
      }
    }
    return true;
  }

  async #readActiveSession(runId: string): Promise<StoredSessionResult> {
    if (!isValidRunId(runId)) return { ok: false, reason: "invalid_request" };

    const key = storageKey(runId);
    let stored: Record<string, unknown>;
    try {
      stored = await this.#api.storage.session.get(key);
    } catch {
      return { ok: false, reason: "storage_error" };
    }

    const value = stored[key];
    if (value === undefined) return { ok: false, reason: "session_not_found" };
    if (!isScanSession(value) || value.runId !== runId) {
      await this.#bestEffortRemove(key);
      return { ok: false, reason: "session_corrupt" };
    }

    const now = this.#now();
    if (!Number.isFinite(now) || Date.parse(value.expiresAt) <= now) {
      await this.#bestEffortRemove(key);
      return { ok: false, reason: "session_expired" };
    }
    return { ok: true, session: value };
  }

  async #validateCurrentTab(
    session: ScanSession,
    checkDocument: boolean,
  ): Promise<SessionValidationResult> {
    if (
      session.detachedController !== true &&
      !(await this.#isFocusedWindow(session.windowId))
    ) {
      return { ok: false, reason: "invalid_window" };
    }

    let tab: TabLike;
    try {
      tab = await this.#api.tabs.get(session.tabId);
    } catch {
      return { ok: false, reason: "invalid_tab" };
    }

    const tabValidation = inspectMatchingTab(
      tab,
      session.tabId,
      session.windowId,
      { origin: session.origin, pathname: session.pathname },
      true,
    );
    if (!tabValidation.ok) return tabValidation;
    if (!checkDocument) return { ok: true, session };

    let probeResults: AuthorizationProbeInjectionResult[];
    try {
      probeResults = await this.#api.scripting.executeScript({
        target: { tabId: session.tabId, frameIds: [0] },
        func: minimalAuthorizationProbe,
      });
    } catch {
      return { ok: false, reason: "authorization_probe_failed" };
    }
    const probe = validatedProbe(probeResults);
    if (probe === undefined || probe.documentId !== session.documentId) {
      return { ok: false, reason: "authorization_race" };
    }
    const probedUrl = inspectStorefrontUrl(probe.result.href);
    if (!probedUrl.ok) return probedUrl;
    if (
      probe.result.origin !== probedUrl.value.origin ||
      probe.result.pathname !== new URL(probe.result.href).pathname ||
      probedUrl.value.origin !== session.origin ||
      probedUrl.value.pathname !== session.pathname
    ) {
      return { ok: false, reason: "authorization_race" };
    }
    return { ok: true, session };
  }

  async #isFocusedWindow(windowId: number): Promise<boolean> {
    try {
      const window = await this.#api.windows.get(windowId);
      return window.id === windowId && window.focused === true;
    } catch {
      return false;
    }
  }

  async #rejectAndRevoke(
    runId: string,
    reason: SessionFailureReason,
  ): Promise<SessionValidationResult> {
    await this.#bestEffortRemove(storageKey(runId));
    return { ok: false, reason };
  }

  async #revokeMatching(
    predicate: (session: ScanSession) => boolean,
    beforeRevoke?: BeforeSessionRevoke,
  ): Promise<number> {
    let stored: Record<string, unknown>;
    try {
      stored = await this.#api.storage.session.get(null);
    } catch {
      return 0;
    }

    const runIdsToRemove: string[] = [];
    const corruptKeysToRemove: string[] = [];
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(SESSION_STORAGE_PREFIX)) continue;
      if (!isScanSession(value)) {
        corruptKeysToRemove.push(key);
      } else if (predicate(value)) {
        runIdsToRemove.push(value.runId);
      }
    }
    if (runIdsToRemove.length === 0 && corruptKeysToRemove.length === 0) return 0;

    let removed = 0;
    for (const runId of runIdsToRemove) {
      const session = Object.values(stored).find(
        (value): value is ScanSession => isScanSession(value) && value.runId === runId,
      );
      if (session === undefined) continue;
      try {
        await beforeRevoke?.(session);
      } catch {
        // The credential must remain revocable while debugger restoration is
        // pending. A later lifecycle event can retry the guarded revoke.
        continue;
      }
      if (await this.revoke(runId)) removed += 1;
    }
    if (corruptKeysToRemove.length > 0) {
      try {
        await this.#api.storage.session.remove(corruptKeysToRemove);
        removed += corruptKeysToRemove.length;
      } catch {
        // Valid sessions have already been handled independently above.
      }
    }
    return removed;
  }

  async #withResourceMutation<T>(
    runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#resourceMutationTails.get(runId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.#resourceMutationTails.set(runId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.#resourceMutationTails.get(runId) === tail) {
        this.#resourceMutationTails.delete(runId);
      }
    }
  }

  async #bestEffortRemove(key: string): Promise<void> {
    try {
      await this.#api.storage.session.remove(key);
    } catch {
      // Rejection remains fail closed even if cleanup cannot be confirmed.
    }
  }
}

function inspectStorefrontUrl(urlValue: string): UrlInspectionResult {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return { ok: false, reason: "unsupported_url" };
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return { ok: false, reason: "unsupported_url" };
  }

  const pathDecision = checkPublicPath(url.pathname);
  if (!pathDecision.ok) return { ok: false, reason: pathDecision.reason };
  return {
    ok: true,
    value: {
      origin: url.origin,
      pathname: pathDecision.normalizedPathname,
    },
  };
}

function inspectMatchingTab(
  tab: TabLike,
  expectedTabId: number,
  expectedWindowId: number,
  expectedUrl: InspectedUrl,
  allowMissingUrl = false,
): TabValidationResult {
  if (
    tab.id !== expectedTabId ||
    tab.windowId !== expectedWindowId ||
    tab.active !== true
  ) {
    return { ok: false, reason: "invalid_tab" };
  }
  if (tab.url === undefined) {
    return allowMissingUrl
      ? { ok: true }
      : { ok: false, reason: "invalid_tab" };
  }
  const inspected = inspectStorefrontUrl(tab.url);
  if (!inspected.ok) return inspected;
  if (!sameInspectedUrl(inspected.value, expectedUrl)) {
    return { ok: false, reason: "authorization_race" };
  }
  return { ok: true };
}

function validatedProbe(
  results: AuthorizationProbeInjectionResult[],
): { documentId: string; result: AuthorizationProbePayload } | undefined {
  if (results.length !== 1) return undefined;
  const result = results[0];
  if (
    result === undefined ||
    result.frameId !== 0 ||
    result.documentId === undefined ||
    result.documentId.length === 0 ||
    result.result === undefined ||
    typeof result.result.href !== "string" ||
    typeof result.result.origin !== "string" ||
    typeof result.result.pathname !== "string"
  ) {
    return undefined;
  }
  return { documentId: result.documentId, result: result.result };
}

function isScanSession(value: unknown): value is ScanSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ScanSession>;
  if (
    !isValidRunId(candidate.runId) ||
    typeof candidate.sessionToken !== "string" ||
    !TOKEN_PATTERN.test(candidate.sessionToken) ||
    !Number.isSafeInteger(candidate.windowId) ||
    (candidate.windowId ?? -1) < 0 ||
    !Number.isSafeInteger(candidate.tabId) ||
    (candidate.tabId ?? -1) < 0 ||
    typeof candidate.documentId !== "string" ||
    candidate.documentId.length === 0 ||
    typeof candidate.origin !== "string" ||
    typeof candidate.pathname !== "string" ||
    typeof candidate.authorizedAt !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    candidate.state !== "active"
  ) {
    return false;
  }
  if (candidate.detachedController !== undefined && candidate.detachedController !== true) {
    return false;
  }

  if (
    candidate.resources !== undefined &&
    (!Array.isArray(candidate.resources) ||
      candidate.resources.length > MAX_RESOURCE_CAPABILITIES ||
      candidate.resources.some((resource) => !isResourceDescriptor(resource)) ||
      new Set(candidate.resources.map((resource) => resource.resourceId)).size !==
        candidate.resources.length)
  ) {
    return false;
  }

  const validPanelDocumentId =
    typeof candidate.panelDocumentId === "string" &&
    candidate.panelDocumentId.length > 0;
  const validPanelInstanceHash =
    typeof candidate.panelInstanceHash === "string" &&
    TOKEN_PATTERN.test(candidate.panelInstanceHash);
  if (
    (!validPanelDocumentId && !validPanelInstanceHash) ||
    (candidate.panelDocumentId !== undefined && !validPanelDocumentId) ||
    (candidate.panelInstanceHash !== undefined && !validPanelInstanceHash)
  ) {
    return false;
  }

  const authorizedAt = Date.parse(candidate.authorizedAt);
  const expiresAt = Date.parse(candidate.expiresAt);
  if (!Number.isFinite(authorizedAt) || !Number.isFinite(expiresAt) || expiresAt <= authorizedAt) {
    return false;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(candidate.origin);
  } catch {
    return false;
  }
  if (
    parsedOrigin.origin !== candidate.origin ||
    (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:")
  ) {
    return false;
  }

  const pathDecision = checkPublicPath(candidate.pathname);
  return pathDecision.ok && pathDecision.normalizedPathname === candidate.pathname;
}

function storageKey(runId: string): string {
  return `${SESSION_STORAGE_PREFIX}${runId}`;
}

function isValidRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID_PATTERN.test(value);
}

function sameInspectedUrl(left: InspectedUrl, right: InspectedUrl): boolean {
  return left.origin === right.origin && left.pathname === right.pathname;
}

function constantTimeEqual(left: string, right: string): boolean {
  const maximumLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function assertRandomBytes(value: Uint8Array, expectedLength: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== expectedLength) {
    throw new TypeError(`randomBytes must return ${expectedLength} bytes`);
  }
  return value;
}

function toBase64Url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 0b11) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) {
      encoded += alphabet[((second & 0b1111) << 2) | ((third ?? 0) >> 6)];
    }
    if (third !== undefined) encoded += alphabet[third & 0b111111];
  }
  return encoded;
}

async function hashPanelInstanceId(panelInstanceId: string): Promise<string> {
  const bytes = new TextEncoder().encode(panelInstanceId);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return toBase64Url(new Uint8Array(digest));
}
