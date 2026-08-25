import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_STORAGE_PREFIX,
  SessionManager,
  type AuthorizationProbeInjectionResult,
  type MessageSenderLike,
  type SessionManagerChromeApi,
  type SessionStorageArea,
  type TabLike,
} from "../../src/background/session-manager";
import type { ResourceDescriptor } from "../../src/core/frontend/resource-types";

const EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const WINDOW_ID = 7;
const PANEL_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";

class MemorySessionStorage implements SessionStorageArea {
  readonly values: Record<string, unknown> = {};

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) return { ...this.values };
    const selected = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      selected
        .filter((key) => Object.hasOwn(this.values, key))
        .map((key) => [key, this.values[key]]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
  }
}

type FixtureState = {
  now: number;
  focusedWindowId: number;
  tab: TabLike;
  probeUrl: string;
  probeDocumentId: string;
  probeError?: Error;
};

function panelSender(overrides: Partial<MessageSenderLike> = {}): MessageSenderLike {
  return {
    id: EXTENSION_ID,
    url: `${EXTENSION_ORIGIN}/sidepanel/index.html`,
    origin: EXTENSION_ORIGIN,
    documentId: "panel-document-1",
    ...overrides,
  };
}

function collectorSender(
  state: FixtureState,
  overrides: Partial<MessageSenderLike> = {},
): MessageSenderLike {
  return {
    id: EXTENSION_ID,
    url: state.probeUrl,
    origin: new URL(state.probeUrl).origin,
    documentId: state.probeDocumentId,
    frameId: 0,
    tab: { ...state.tab },
    ...overrides,
  };
}

function createFixture() {
  const storage = new MemorySessionStorage();
  const state: FixtureState = {
    now: Date.UTC(2026, 6, 20, 1, 2, 3),
    focusedWindowId: WINDOW_ID,
    tab: {
      id: 41,
      windowId: WINDOW_ID,
      active: true,
      url: "https://shop.example/products/widget?preview=1#details",
    },
    probeUrl: "https://shop.example/products/widget?preview=1#details",
    probeDocumentId: "store-document-1",
  };

  const query = vi.fn(async ({ windowId }: { active: true; windowId: number }) => {
    if (state.tab.active !== true || state.tab.windowId !== windowId) return [];
    return [{ ...state.tab }];
  });
  const get = vi.fn(async (tabId: number) => {
    if (state.tab.id !== tabId) throw new Error("tab missing");
    return { ...state.tab };
  });
  const executeScript = vi.fn(async (): Promise<AuthorizationProbeInjectionResult[]> => {
    if (state.probeError !== undefined) throw state.probeError;
    const url = new URL(state.probeUrl);
    return [
      {
        frameId: 0,
        documentId: state.probeDocumentId,
        result: { href: url.href, origin: url.origin, pathname: url.pathname },
      },
    ];
  });
  const randomBytes = vi.fn((length: number) => new Uint8Array(length).fill(length));

  const api: SessionManagerChromeApi = {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path) => new URL(path, `${EXTENSION_ORIGIN}/`).href,
    },
    storage: { session: storage },
    tabs: { query, get },
    windows: {
      get: vi.fn(async (windowId: number) => ({
        id: windowId,
        focused: windowId === state.focusedWindowId,
      })),
    },
    scripting: { executeScript },
  };
  const manager = new SessionManager(api, {
    now: () => state.now,
    randomBytes,
  });

  return { storage, state, query, get, executeScript, randomBytes, manager };
}

async function establish(
  fixture: ReturnType<typeof createFixture>,
  runId = "run-test",
) {
  const result = await fixture.manager.establishSession(
    { runId, windowId: WINDOW_ID },
    panelSender(),
  );
  if (!result.ok) throw new Error(`establish failed: ${result.reason}`);
  return result;
}

describe("SessionManager", () => {
  it("signs and stores a fully bound session only after the minimum probe", async () => {
    const fixture = createFixture();
    const result = await fixture.manager.establishSession(
      { windowId: WINDOW_ID },
      panelSender(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toMatchObject({
      panelDocumentId: "panel-document-1",
      windowId: WINDOW_ID,
      tabId: 41,
      documentId: "store-document-1",
      origin: "https://shop.example",
      pathname: "/products/widget",
      state: "active",
    });
    expect(result.session.runId).toMatch(/^run_[a-zA-Z0-9_-]{22}$/u);
    expect(result.session.sessionToken).toMatch(/^[a-zA-Z0-9_-]{43}$/u);
    expect(Date.parse(result.session.expiresAt) - Date.parse(result.session.authorizedAt)).toBe(
      DEFAULT_SESSION_TTL_MS,
    );
    expect(fixture.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 41, frameIds: [0] } }),
    );
    expect(fixture.storage.values[`${SESSION_STORAGE_PREFIX}${result.session.runId}`]).toEqual(
      result.session,
    );
    expect(Object.keys(fixture.storage.values)).toHaveLength(1);
  });

  it("binds an explicit active tab for a detached controller without querying another window", async () => {
    const fixture = createFixture();
    fixture.state.focusedWindowId = 8;
    const controllerUrl = `${EXTENSION_ORIGIN}/sidepanel/index.html?detachedCapture=1`;
    const result = await fixture.manager.establishSession(
      { windowId: WINDOW_ID, tabId: 41 },
      panelSender({
        url: controllerUrl,
        frameId: 0,
        tab: { id: 99, windowId: 8, active: true, url: controllerUrl },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.detachedController).toBe(true);
    expect(fixture.get).toHaveBeenCalledWith(41);
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it("preserves only detached controller sessions across controller focus changes", async () => {
    const fixture = createFixture();
    await establish(fixture, "run-regular-focus");
    const controllerUrl = `${EXTENSION_ORIGIN}/sidepanel/index.html?detachedCapture=1`;
    const detached = await fixture.manager.establishSession(
      { runId: "run-detached-focus", windowId: WINDOW_ID, tabId: 41 },
      panelSender({
        url: controllerUrl,
        frameId: 0,
        tab: { id: 99, windowId: WINDOW_ID + 1, active: true, url: controllerUrl },
      }),
    );
    expect(detached.ok).toBe(true);

    await expect(fixture.manager.revokeOutsideWindow(WINDOW_ID + 1)).resolves.toBe(1);
    expect(Object.keys(fixture.storage.values)).toEqual([
      `${SESSION_STORAGE_PREFIX}run-detached-focus`,
    ]);
    if (!detached.ok) return;
    await expect(fixture.manager.validateForExecution(detached.handle)).resolves.toMatchObject({
      ok: true,
      session: { detachedController: true },
    });
  });

  it("preserves detached controller sessions through transient total focus loss", async () => {
    const fixture = createFixture();
    await establish(fixture, "run-regular-none");
    const controllerUrl = `${EXTENSION_ORIGIN}/sidepanel/index.html?detachedCapture=1`;
    const detached = await fixture.manager.establishSession(
      { runId: "run-detached-none", windowId: WINDOW_ID, tabId: 41 },
      panelSender({
        url: controllerUrl,
        frameId: 0,
        tab: { id: 99, windowId: WINDOW_ID + 1, active: true, url: controllerUrl },
      }),
    );
    expect(detached.ok).toBe(true);

    await expect(fixture.manager.revokeOnFocusLoss()).resolves.toBe(1);
    expect(Object.keys(fixture.storage.values)).toEqual([
      `${SESSION_STORAGE_PREFIX}run-detached-none`,
    ]);
  });

  it("rejects a regular extension tab masquerading as a detached controller", async () => {
    const fixture = createFixture();
    const regularUrl = `${EXTENSION_ORIGIN}/sidepanel/index.html`;
    await expect(fixture.manager.establishSession(
      { windowId: WINDOW_ID, tabId: 41 },
      panelSender({
        url: regularUrl,
        frameId: 0,
        tab: { id: 99, windowId: 8, active: true, url: regularUrl },
      }),
    )).resolves.toEqual({ ok: false, reason: "invalid_panel_sender" });
  });

  it("rejects sensitive paths before injecting or generating a token", async () => {
    const fixture = createFixture();
    fixture.state.tab.url = "https://shop.example/EN-ca/%63art/?x=1";
    fixture.state.probeUrl = fixture.state.tab.url;

    const result = await fixture.manager.establishSession(
      { runId: "run-sensitive", windowId: WINDOW_ID },
      panelSender(),
    );

    expect(result).toEqual({ ok: false, reason: "sensitive_path" });
    expect(fixture.executeScript).not.toHaveBeenCalled();
    expect(fixture.randomBytes).not.toHaveBeenCalled();
    expect(fixture.storage.values).toEqual({});
  });

  it("does not treat Side Panel load from an untrusted document as authorization", async () => {
    const fixture = createFixture();
    const result = await fixture.manager.establishSession(
      { runId: "run-untrusted", windowId: WINDOW_ID },
      panelSender({ url: `${EXTENSION_ORIGIN}/options/index.html` }),
    );

    expect(result).toEqual({ ok: false, reason: "invalid_panel_sender" });
    expect(fixture.query).not.toHaveBeenCalled();
    expect(fixture.executeScript).not.toHaveBeenCalled();
  });

  it("binds a per-document panel nonce when Chrome omits sender.documentId", async () => {
    const fixture = createFixture();
    const sender = panelSender();
    delete sender.documentId;

    const rejected = await fixture.manager.establishSession(
      { runId: "run-no-panel-binding", windowId: WINDOW_ID },
      sender,
    );
    expect(rejected).toEqual({ ok: false, reason: "invalid_panel_sender" });

    const established = await fixture.manager.establishSession(
      {
        runId: "run-panel-nonce",
        windowId: WINDOW_ID,
        panelInstanceId: PANEL_INSTANCE_ID,
      },
      sender,
    );
    expect(established.ok).toBe(true);
    if (!established.ok) return;
    expect(established.session.panelInstanceHash).toMatch(
      /^[a-zA-Z0-9_-]{43}$/u,
    );
    expect(established.session.panelInstanceHash).not.toBe(PANEL_INSTANCE_ID);
    expect(established.session.panelDocumentId).toBeUndefined();
    expect(JSON.stringify(fixture.storage.values)).not.toContain(PANEL_INSTANCE_ID);

    await expect(
      fixture.manager.validatePanelMessage(
        established.handle,
        sender,
        PANEL_INSTANCE_ID,
      ),
    ).resolves.toMatchObject({ ok: true });

    // A fresh trusted extension page can read storage.session, including the
    // token and hash, but cannot turn the persisted hash back into the raw
    // per-document nonce required by the message protocol.
    const stored = fixture.storage.values[
      `${SESSION_STORAGE_PREFIX}${established.session.runId}`
    ] as { panelInstanceHash: string };
    await expect(
      fixture.manager.validatePanelMessage(
        established.handle,
        sender,
        stored.panelInstanceHash,
      ),
    ).resolves.toEqual({ ok: false, reason: "session_mismatch" });
    expect(fixture.storage.values).toEqual({});
  });

  it("does not issue a token when the authorization probe fails", async () => {
    const fixture = createFixture();
    fixture.state.probeError = new Error("activeTab unavailable");

    const result = await fixture.manager.establishSession(
      { runId: "run-no-grant", windowId: WINDOW_ID },
      panelSender(),
    );

    expect(result).toEqual({ ok: false, reason: "authorization_probe_failed" });
    expect(fixture.randomBytes).not.toHaveBeenCalled();
    expect(fixture.storage.values).toEqual({});
  });

  it("uses the URL-only probe when activeTab does not expose tab.url", async () => {
    const fixture = createFixture();
    delete fixture.state.tab.url;

    const established = await fixture.manager.establishSession(
      { runId: "run-hidden-tab-url", windowId: WINDOW_ID },
      panelSender(),
    );
    expect(established.ok).toBe(true);
    if (!established.ok) return;
    expect(established.session).toMatchObject({
      origin: "https://shop.example",
      pathname: "/products/widget",
    });
    await expect(
      fixture.manager.validateForExecution(established.handle),
    ).resolves.toMatchObject({ ok: true });
  });

  it("rejects a sensitive probed path before reading page data when tab.url is hidden", async () => {
    const fixture = createFixture();
    delete fixture.state.tab.url;
    fixture.state.probeUrl = "https://shop.example/fr/account?return_to=private";

    const result = await fixture.manager.establishSession(
      { runId: "run-hidden-sensitive", windowId: WINDOW_ID },
      panelSender(),
    );
    expect(result).toEqual({ ok: false, reason: "sensitive_path" });
    expect(fixture.executeScript).toHaveBeenCalledTimes(1);
    expect(fixture.randomBytes).not.toHaveBeenCalled();
    expect(fixture.storage.values).toEqual({});
  });

  it("revokes a hidden-URL session if a later execution probe reaches a sensitive path", async () => {
    const fixture = createFixture();
    delete fixture.state.tab.url;
    const established = await establish(fixture, "run-hidden-nav-sensitive");
    fixture.state.probeUrl = "https://shop.example/checkout?step=contact";

    await expect(
      fixture.manager.validateForExecution(established.handle),
    ).resolves.toEqual({ ok: false, reason: "sensitive_path" });
    expect(fixture.storage.values).toEqual({});
  });

  it("rejects a navigation race between tab preflight and probe", async () => {
    const fixture = createFixture();
    fixture.state.probeUrl = "https://other.example/products/widget";

    const result = await fixture.manager.establishSession(
      { runId: "run-race", windowId: WINDOW_ID },
      panelSender(),
    );

    expect(result).toEqual({ ok: false, reason: "authorization_race" });
    expect(fixture.randomBytes).not.toHaveBeenCalled();
    expect(fixture.storage.values).toEqual({});
  });

  it("validates a panel sender without sender.tab and revokes on document mismatch", async () => {
    const fixture = createFixture();
    const established = await establish(fixture);

    await expect(
      fixture.manager.validatePanelMessage(established.handle, panelSender()),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      fixture.manager.validatePanelMessage(
        established.handle,
        panelSender({ documentId: "replacement-panel-document" }),
      ),
    ).resolves.toEqual({ ok: false, reason: "session_mismatch" });
    expect(fixture.storage.values).toEqual({});
  });

  it("expires without renewal and removes the storage.session record", async () => {
    const fixture = createFixture();
    const established = await establish(fixture, "run-expiring");
    fixture.state.now = Date.parse(established.session.expiresAt);

    await expect(
      fixture.manager.validatePanelMessage(established.handle, panelSender()),
    ).resolves.toEqual({ ok: false, reason: "session_expired" });
    expect(fixture.storage.values).toEqual({});
  });

  it("fails closed and revokes if the active tab moves to a sensitive path", async () => {
    const fixture = createFixture();
    const established = await establish(fixture, "run-path-change");
    fixture.state.tab.url = "https://shop.example/fr/account";

    await expect(
      fixture.manager.validatePanelMessage(established.handle, panelSender()),
    ).resolves.toEqual({ ok: false, reason: "sensitive_path" });
    expect(fixture.storage.values).toEqual({});
  });

  it("uses the tab-context sender track for a top-frame Collector", async () => {
    const fixture = createFixture();
    const established = await establish(fixture, "run-collector");

    await expect(
      fixture.manager.validateCollectorMessage(
        established.session.runId,
        collectorSender(fixture.state),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      fixture.manager.validateCollectorMessage(
        established.session.runId,
        collectorSender(fixture.state, { frameId: 1 }),
      ),
    ).resolves.toEqual({ ok: false, reason: "invalid_collector_sender" });
    expect(fixture.storage.values).toEqual({});
  });

  it("rechecks the bound document before a privileged execution", async () => {
    const fixture = createFixture();
    const established = await establish(fixture, "run-document-change");
    fixture.state.probeDocumentId = "store-document-2";

    await expect(fixture.manager.validateForExecution(established.handle)).resolves.toEqual({
      ok: false,
      reason: "authorization_race",
    });
    expect(fixture.storage.values).toEqual({});
  });

  it("stores only validated resource capabilities with the session and deletes them on revoke", async () => {
    const fixture = createFixture();
    const established = await establish(fixture, "run-resources");
    const resource: ResourceDescriptor = {
      resourceId: "00000000-0000-4000-8000-000000000001",
      url: "https://shop.example/assets/theme.js",
      originRelation: "same-origin",
      kind: "script",
      queryPolicy: "none",
      sources: ["dom"],
      fetchStatus: "pending",
    };

    const replaced = await fixture.manager.replaceRegisteredResources(
      established.handle,
      [resource],
    );
    expect(replaced).toMatchObject({
      ok: true,
      session: { resources: [resource] },
    });
    await expect(
      fixture.manager.validateForExecution(established.handle),
    ).resolves.toMatchObject({ ok: true, session: { resources: [resource] } });

    await expect(fixture.manager.revoke(established.session.runId)).resolves.toBe(
      true,
    );
    expect(fixture.storage.values).toEqual({});
  });

  it("serializes and deduplicates SW-derived source-map capabilities", async () => {
    const fixture = createFixture();
    const established = await establish(fixture, "run-derived-maps");
    const parent: ResourceDescriptor = {
      resourceId: "00000000-0000-4000-8000-000000000001",
      url: "https://shop.example/assets/theme.js",
      originRelation: "same-origin",
      kind: "script",
      queryPolicy: "none",
      sources: ["dom"],
      fetchStatus: "pending",
    };
    await fixture.manager.replaceRegisteredResources(established.handle, [parent]);
    const first: ResourceDescriptor = {
      resourceId: "00000000-0000-4000-8000-000000000002",
      url: "https://shop.example/assets/theme.js.map",
      originRelation: "same-origin",
      kind: "source-map",
      queryPolicy: "none",
      sources: ["source-map-reference"],
      derivedFromResourceId: parent.resourceId,
      fetchStatus: "pending",
    };
    const second: ResourceDescriptor = {
      ...first,
      resourceId: "00000000-0000-4000-8000-000000000003",
      url: "https://shop.example/assets/vendor.js.map",
    };

    const registered = await Promise.all([
      fixture.manager.registerDerivedResource(
        established.handle,
        parent.resourceId,
        first,
      ),
      fixture.manager.registerDerivedResource(
        established.handle,
        parent.resourceId,
        second,
      ),
    ]);
    expect(registered).toEqual([
      expect.objectContaining({ ok: true, created: true, resource: first }),
      expect.objectContaining({ ok: true, created: true, resource: second }),
    ]);

    const duplicate = await fixture.manager.registerDerivedResource(
      established.handle,
      parent.resourceId,
      { ...first, resourceId: "00000000-0000-4000-8000-000000000004" },
    );
    expect(duplicate).toMatchObject({
      ok: true,
      created: false,
      resource: { resourceId: first.resourceId },
    });
    await expect(
      fixture.manager.validateForExecution(established.handle),
    ).resolves.toMatchObject({
      ok: true,
      session: { resources: [parent, first, second] },
    });

    await fixture.manager.revoke(established.session.runId);
    expect(fixture.storage.values).toEqual({});
  });

  it("clears parent and derived capabilities on cancellation without deleting the session", async () => {
    const fixture = createFixture();
    const established = await establish(fixture, "run-cancel-resources");
    const parent: ResourceDescriptor = {
      resourceId: "00000000-0000-4000-8000-000000000001",
      url: "https://shop.example/assets/theme.js",
      originRelation: "same-origin",
      kind: "script",
      queryPolicy: "none",
      sources: ["dom"],
      fetchStatus: "pending",
    };
    const derived: ResourceDescriptor = {
      resourceId: "00000000-0000-4000-8000-000000000002",
      url: "https://shop.example/assets/theme.js.map",
      originRelation: "same-origin",
      kind: "source-map",
      queryPolicy: "none",
      sources: ["source-map-reference"],
      derivedFromResourceId: parent.resourceId,
      fetchStatus: "pending",
    };

    await fixture.manager.replaceRegisteredResources(established.handle, [parent]);
    await fixture.manager.registerDerivedResource(
      established.handle,
      parent.resourceId,
      derived,
    );
    await expect(
      fixture.manager.replaceRegisteredResources(established.handle, []),
    ).resolves.toMatchObject({ ok: true, session: { resources: [] } });
    await expect(
      fixture.manager.validateForExecution(established.handle),
    ).resolves.toMatchObject({ ok: true, session: { resources: [] } });

    // A source-map registration that reaches the serialized mutation queue
    // after cancellation cannot resurrect a capability without its parent.
    await expect(
      fixture.manager.registerDerivedResource(
        established.handle,
        parent.resourceId,
        { ...derived, resourceId: "00000000-0000-4000-8000-000000000003" },
      ),
    ).resolves.toEqual({ ok: false, reason: "invalid_request" });
  });

  it("requires the bound Chrome window to remain focused", async () => {
    const fixture = createFixture();
    const established = await establish(fixture, "run-window-focus");
    fixture.state.focusedWindowId = WINDOW_ID + 1;

    await expect(
      fixture.manager.validateForExecution(established.handle),
    ).resolves.toEqual({ ok: false, reason: "invalid_window" });
    expect(fixture.storage.values).toEqual({});

    const rejected = await fixture.manager.establishSession(
      { runId: "run-unfocused", windowId: WINDOW_ID },
      panelSender(),
    );
    expect(rejected).toEqual({ ok: false, reason: "invalid_window" });
  });

  it("revokes a guessed token and supports tab activation cleanup", async () => {
    const fixture = createFixture();
    const first = await establish(fixture, "run-first-tab");
    await expect(
      fixture.manager.validatePanelMessage(
        { runId: first.session.runId, sessionToken: "x".repeat(43) },
        panelSender(),
      ),
    ).resolves.toEqual({ ok: false, reason: "session_mismatch" });
    expect(fixture.storage.values).toEqual({});

    await establish(fixture, "run-old-active");
    fixture.state.tab = {
      id: 42,
      windowId: WINDOW_ID,
      active: true,
      url: "https://shop.example/collections/all",
    };
    fixture.state.probeUrl = "https://shop.example/collections/all";
    fixture.state.probeDocumentId = "store-document-2";
    await establish(fixture, "run-new-active");

    await expect(fixture.manager.revokeInactiveForWindow(WINDOW_ID, 42)).resolves.toBe(1);
    expect(Object.keys(fixture.storage.values)).toEqual([
      `${SESSION_STORAGE_PREFIX}run-new-active`,
    ]);
  });

  it("runs debugger cleanup before an inactive-tab session is revoked", async () => {
    const fixture = createFixture();
    await establish(fixture, "run-cleanup-order");
    const events: string[] = [];
    const originalRemove = fixture.storage.remove.bind(fixture.storage);
    vi.spyOn(fixture.storage, "remove").mockImplementation(async (keys) => {
      events.push("revoke");
      await originalRemove(keys);
    });

    await expect(
      fixture.manager.revokeInactiveForWindow(WINDOW_ID, 42, async (session) => {
        events.push(`cleanup:${session.runId}`);
      }),
    ).resolves.toBe(1);
    expect(events).toEqual(["cleanup:run-cleanup-order", "revoke"]);
    expect(fixture.storage.values).toEqual({});
  });

  it("retains a guarded session when cleanup fails and revokes it on retry", async () => {
    const fixture = createFixture();
    await establish(fixture, "run-cleanup-retry");
    const cleanup = vi
      .fn<(session: Readonly<{ runId: string }>) => Promise<void>>()
      .mockRejectedValueOnce(new Error("detach failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      fixture.manager.revokeInactiveForWindow(WINDOW_ID, 42, cleanup),
    ).resolves.toBe(0);
    expect(fixture.storage.values).toHaveProperty(
      `${SESSION_STORAGE_PREFIX}run-cleanup-retry`,
    );

    await expect(
      fixture.manager.revokeInactiveForWindow(WINDOW_ID, 42, cleanup),
    ).resolves.toBe(1);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(fixture.storage.values).toEqual({});
  });

  it("supports guarded panel-instance revocation for controller Port disconnect", async () => {
    const fixture = createFixture();
    const established = await fixture.manager.establishSession(
      {
        runId: "run-controller-port",
        windowId: WINDOW_ID,
        panelInstanceId: PANEL_INSTANCE_ID,
      },
      panelSender(),
    );
    expect(established.ok).toBe(true);
    const cleanup = vi.fn(async () => undefined);

    await expect(
      fixture.manager.revokeByPanelInstance(PANEL_INSTANCE_ID, cleanup),
    ).resolves.toBe(1);
    expect(cleanup).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-controller-port" }),
    );
    expect(fixture.storage.values).toEqual({});
  });
});
