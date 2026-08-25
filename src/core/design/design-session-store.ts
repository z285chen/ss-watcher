import {
  MAX_SSW_DESIGN_ASSETS,
  MAX_SSW_DESIGN_STATES,
  isEvidenceAsset,
  isEvidenceCapture,
  isEvidenceState,
  isEvidenceTransition,
  evidenceCaptureFailureReason,
  type EvidenceAsset,
  type EvidenceCapture,
  type EvidenceState,
  type EvidenceTransition,
  type SswDesignPackageFile,
} from "./evidence-package";

export const DESIGN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DATABASE_VERSION = 1;
const SESSION_STORE = "sessions";
const FILE_STORE = "files";

export type DesignSessionRecord = Readonly<{
  sessionId: string;
  packageId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  source: Readonly<{ origin: string; pathname: string }>;
  states: readonly EvidenceState[];
  captures: readonly EvidenceCapture[];
  transitions: readonly EvidenceTransition[];
  assets: readonly EvidenceAsset[];
}>;

type StoredFile = Readonly<{
  key: string;
  sessionId: string;
  path: string;
  mediaType: string;
  bytes: ArrayBuffer;
}>;

export type DesignSessionStoreOptions = Readonly<{
  indexedDB?: IDBFactory;
  databaseName?: string;
  now?: () => number;
}>;

export class DesignSessionStore {
  readonly databaseName: string;
  readonly #factory: IDBFactory;
  readonly #now: () => number;
  #databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: DesignSessionStoreOptions = {}) {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (factory === undefined) throw new Error("IndexedDB is unavailable");
    this.#factory = factory;
    this.databaseName = options.databaseName ?? "ss-watcher-design-sessions-v1";
    this.#now = options.now ?? Date.now;
  }

  async create(input: Readonly<{
    sessionId: string;
    packageId: string;
    source: Readonly<{ origin: string; pathname: string }>;
  }>): Promise<DesignSessionRecord> {
    assertSlug(input.sessionId, "sessionId");
    assertSlug(input.packageId, "packageId");
    assertSource(input.source);
    const createdAt = new Date(this.#now()).toISOString();
    const record: DesignSessionRecord = {
      sessionId: input.sessionId,
      packageId: input.packageId,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(this.#now() + DESIGN_SESSION_TTL_MS).toISOString(),
      source: input.source,
      states: [],
      captures: [],
      transitions: [],
      assets: [],
    };
    const database = await this.#database();
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    await request(transaction.objectStore(SESSION_STORE).add(record));
    await transactionComplete(transaction);
    return structuredClone(record);
  }

  async putState(sessionId: string, state: EvidenceState): Promise<DesignSessionRecord> {
    if (!isEvidenceState(state)) throw new Error("Invalid design state");
    return await this.#update(sessionId, (session) => {
      const states = replaceBy(session.states, state, (item) => item.stateId);
      if (states.length > MAX_SSW_DESIGN_STATES) throw new Error("Design state limit exceeded");
      return { ...session, states };
    });
  }

  async putCapture(
    sessionId: string,
    capture: EvidenceCapture,
    screenshots: readonly SswDesignPackageFile[],
  ): Promise<DesignSessionRecord> {
    if (!isEvidenceCapture(capture)) {
      throw new Error(`Invalid design capture: ${evidenceCaptureFailureReason(capture) ?? "unknown"}`);
    }
    const expectedPaths = new Set(capture.screenshotSegments.map((segment) => segment.path));
    if (
      screenshots.length !== expectedPaths.size ||
      screenshots.some((screenshot) => !expectedPaths.has(screenshot.path) || !screenshot.mediaType.startsWith("image/"))
    ) throw new Error("Screenshots do not match capture");
    const database = await this.#database();
    const transaction = database.transaction([SESSION_STORE, FILE_STORE], "readwrite");
    const sessionStore = transaction.objectStore(SESSION_STORE);
    const stored = await request<DesignSessionRecord | undefined>(sessionStore.get(sessionId));
    if (stored === undefined) throw new Error("Design session not found");
    const existing = normalizeRecord(stored);
    assertNotExpired(existing, this.#now());
    if (!existing.states.some((state) => state.stateId === capture.stateId)) throw new Error("Capture state is not registered");
    const replacedCapture = existing.captures.find((item) => item.captureId === capture.captureId);
    const updated = touch({ ...existing, captures: replaceBy(existing.captures, capture, (item) => item.captureId) }, this.#now());
    await request(sessionStore.put(updated));
    for (const segment of replacedCapture?.screenshotSegments ?? []) {
      if (!expectedPaths.has(segment.path)) {
        await request(transaction.objectStore(FILE_STORE).delete(fileKey(sessionId, segment.path)));
      }
    }
    for (const screenshot of screenshots) {
      const storedFile: StoredFile = {
        key: fileKey(sessionId, screenshot.path),
        sessionId,
        path: screenshot.path,
        mediaType: screenshot.mediaType,
        bytes: Uint8Array.from(screenshot.bytes).buffer,
      };
      await request(transaction.objectStore(FILE_STORE).put(storedFile));
    }
    await transactionComplete(transaction);
    return structuredClone(updated);
  }

  async putAssets(sessionId: string, assets: readonly EvidenceAsset[]): Promise<DesignSessionRecord> {
    if (assets.length > MAX_SSW_DESIGN_ASSETS || !assets.every(isEvidenceAsset)) throw new Error("Invalid design assets");
    return await this.#update(sessionId, (session) => ({ ...session, assets: structuredClone(assets) }));
  }

  async putTransition(sessionId: string, transition: EvidenceTransition): Promise<DesignSessionRecord> {
    if (!isEvidenceTransition(transition)) throw new Error("Invalid design transition");
    return await this.#update(sessionId, (session) => {
      const from = session.states.find((state) => state.stateId === transition.fromStateId);
      const to = session.states.find((state) => state.stateId === transition.toStateId);
      if (from === undefined || to?.kind !== "interaction" || to.enteredFromStateId !== from.stateId) {
        throw new Error("Design transition states do not match");
      }
      return {
        ...session,
        transitions: (() => {
          const transitions = replaceBy(session.transitions, transition, (item) => item.transitionId);
          if (transitions.length > MAX_SSW_DESIGN_STATES - 1) throw new Error("Design transition limit exceeded");
          return transitions;
        })(),
      };
    });
  }

  async deleteLeafInteractionState(sessionId: string, stateId: string): Promise<DesignSessionRecord> {
    const database = await this.#database();
    const transaction = database.transaction([SESSION_STORE, FILE_STORE], "readwrite");
    const sessionStore = transaction.objectStore(SESSION_STORE);
    const stored = await request<DesignSessionRecord | undefined>(sessionStore.get(sessionId));
    if (stored === undefined) throw new Error("Design session not found");
    const existing = normalizeRecord(stored);
    assertNotExpired(existing, this.#now());
    const state = existing.states.find((candidate) => candidate.stateId === stateId);
    if (state?.kind !== "interaction") throw new Error("Only an interaction state can be removed");
    if (existing.transitions.some((transition) => transition.fromStateId === stateId)) {
      throw new Error("An interaction state with descendants cannot be removed");
    }
    const highestOrdinal = Math.max(...existing.states.map((candidate) => candidate.ordinal));
    if (state.ordinal !== highestOrdinal) throw new Error("Only the latest interaction state can be removed");
    const removedCaptures = existing.captures.filter((capture) => capture.stateId === stateId);
    const updated = touch({
      ...existing,
      states: existing.states.filter((candidate) => candidate.stateId !== stateId),
      captures: existing.captures.filter((capture) => capture.stateId !== stateId),
      transitions: existing.transitions.filter((transition) =>
        transition.fromStateId !== stateId && transition.toStateId !== stateId
      ),
    }, this.#now());
    await request(sessionStore.put(updated));
    const fileStore = transaction.objectStore(FILE_STORE);
    for (const capture of removedCaptures) {
      for (const segment of capture.screenshotSegments) {
        await request(fileStore.delete(fileKey(sessionId, segment.path)));
      }
    }
    await transactionComplete(transaction);
    return structuredClone(updated);
  }

  async get(sessionId: string): Promise<DesignSessionRecord | undefined> {
    const database = await this.#database();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const result = await request<DesignSessionRecord | undefined>(transaction.objectStore(SESSION_STORE).get(sessionId));
    await transactionComplete(transaction);
    if (result === undefined) return undefined;
    if (isExpired(result, this.#now())) return undefined;
    return structuredClone(normalizeRecord(result));
  }

  async latestForSource(
    source: Readonly<{ origin: string; pathname: string }>,
  ): Promise<DesignSessionRecord | undefined> {
    assertSource(source);
    const database = await this.#database();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const sessions = await request<DesignSessionRecord[]>(
      transaction.objectStore(SESSION_STORE).getAll(),
    );
    await transactionComplete(transaction);
    const latest = sessions.map(normalizeRecord)
      .filter((session) =>
        !isExpired(session, this.#now()) &&
        session.source.origin === source.origin &&
        session.source.pathname === source.pathname &&
        session.states.length > 0
      )
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    return latest === undefined ? undefined : structuredClone(latest);
  }

  async files(sessionId: string): Promise<SswDesignPackageFile[]> {
    const database = await this.#database();
    const transaction = database.transaction(FILE_STORE, "readonly");
    const index = transaction.objectStore(FILE_STORE).index("by-session");
    const rows = await request<StoredFile[]>(index.getAll(sessionId));
    await transactionComplete(transaction);
    return rows.map((file) => ({ path: file.path, mediaType: file.mediaType, bytes: new Uint8Array(file.bytes.slice(0)) }));
  }

  async purgeExpired(): Promise<number> {
    const database = await this.#database();
    const transaction = database.transaction([SESSION_STORE, FILE_STORE], "readwrite");
    const sessions = await request<DesignSessionRecord[]>(transaction.objectStore(SESSION_STORE).getAll());
    const expired = sessions.filter((session) => isExpired(session, this.#now()));
    for (const session of expired) {
      await request(transaction.objectStore(SESSION_STORE).delete(session.sessionId));
      const fileIndex = transaction.objectStore(FILE_STORE).index("by-session");
      const keys = await request<IDBValidKey[]>(fileIndex.getAllKeys(session.sessionId));
      for (const key of keys) await request(transaction.objectStore(FILE_STORE).delete(key));
    }
    await transactionComplete(transaction);
    return expired.length;
  }

  async delete(sessionId: string): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction([SESSION_STORE, FILE_STORE], "readwrite");
    await request(transaction.objectStore(SESSION_STORE).delete(sessionId));
    const keys = await request<IDBValidKey[]>(transaction.objectStore(FILE_STORE).index("by-session").getAllKeys(sessionId));
    for (const key of keys) await request(transaction.objectStore(FILE_STORE).delete(key));
    await transactionComplete(transaction);
  }

  async close(): Promise<void> {
    if (this.#databasePromise === undefined) return;
    const database = await this.#databasePromise;
    database.close();
    this.#databasePromise = undefined;
  }

  async deleteDatabase(): Promise<void> {
    await this.close();
    await new Promise<void>((resolve, reject) => {
      const deletion = this.#factory.deleteDatabase(this.databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error ?? new Error("Database deletion failed"));
      deletion.onblocked = () => reject(new Error("Database deletion blocked"));
    });
  }

  async #update(sessionId: string, update: (record: DesignSessionRecord) => DesignSessionRecord): Promise<DesignSessionRecord> {
    const database = await this.#database();
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    const store = transaction.objectStore(SESSION_STORE);
    const existing = await request<DesignSessionRecord | undefined>(store.get(sessionId));
    if (existing === undefined) throw new Error("Design session not found");
    assertNotExpired(existing, this.#now());
    const updated = touch(update(normalizeRecord(existing)), this.#now());
    await request(store.put(updated));
    await transactionComplete(transaction);
    return structuredClone(updated);
  }

  #database(): Promise<IDBDatabase> {
    this.#databasePromise ??= new Promise((resolve, reject) => {
      const opening = this.#factory.open(this.databaseName, DATABASE_VERSION);
      opening.onupgradeneeded = () => {
        const database = opening.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) database.createObjectStore(SESSION_STORE, { keyPath: "sessionId" });
        if (!database.objectStoreNames.contains(FILE_STORE)) {
          const store = database.createObjectStore(FILE_STORE, { keyPath: "key" });
          store.createIndex("by-session", "sessionId", { unique: false });
        }
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("Database open failed"));
    });
    return this.#databasePromise;
  }
}

function replaceBy<T>(values: readonly T[], replacement: T, key: (value: T) => string): T[] {
  const result = values.filter((value) => key(value) !== key(replacement));
  result.push(replacement);
  return result;
}
function normalizeRecord(record: DesignSessionRecord): DesignSessionRecord {
  return { ...record, transitions: Array.isArray(record.transitions) ? record.transitions : [] };
}
function touch(record: DesignSessionRecord, now: number): DesignSessionRecord { return { ...record, updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + DESIGN_SESSION_TTL_MS).toISOString() }; }
function fileKey(sessionId: string, path: string): string { return `${sessionId}\u0000${path}`; }
function isExpired(record: DesignSessionRecord, now: number): boolean { return Date.parse(record.expiresAt) <= now; }
function assertNotExpired(record: DesignSessionRecord, now: number): void { if (isExpired(record, now)) throw new Error("Design session expired"); }
function assertSlug(value: string, label: string): void { if (!/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(value)) throw new Error(`${label} is invalid`); }
function assertSource(source: Readonly<{ origin: string; pathname: string }>): void { const url = new URL(source.origin); if (url.protocol !== "https:" || url.origin !== source.origin || !source.pathname.startsWith("/") || source.pathname.includes("?") || source.pathname.includes("#")) throw new Error("source is invalid"); }
function request<T = undefined>(operation: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error ?? new Error("IndexedDB request failed")); }); }
function transactionComplete(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed")); transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")); }); }
