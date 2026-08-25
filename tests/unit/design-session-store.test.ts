import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  DESIGN_SESSION_TTL_MS,
  DesignSessionStore,
} from "../../src/core/design/design-session-store";
import { deriveEvidenceTransition } from "../../src/core/design/interaction-evidence";
import type {
  EvidenceCapture,
  EvidenceState,
} from "../../src/core/design/evidence-package";

const stores: DesignSessionStore[] = [];

afterEach(async () => {
  await Promise.all(stores.map((store) => store.deleteDatabase()));
  stores.length = 0;
});

describe("DesignSessionStore", () => {
  it("keeps a resumable capture and screenshot in a separate seven-day local store", async () => {
    let now = Date.parse("2026-08-12T10:00:00.000Z");
    const store = createStore(() => now);
    const session = await store.create({
      sessionId: "session-1",
      packageId: "tourbox-home-20260812",
      source: { origin: "https://www.tourboxtech.com", pathname: "/en/" },
    });
    expect(Date.parse(session.expiresAt) - Date.parse(session.createdAt)).toBe(
      DESIGN_SESSION_TTL_MS,
    );

    await store.putState("session-1", defaultState());
    await store.putCapture("session-1", desktopCapture(), screenshots());

    expect(await store.get("session-1")).toMatchObject({
      sessionId: "session-1",
      states: [{ stateId: "default" }],
      captures: [{ captureId: "default-desktop" }],
    });
    expect((await store.files("session-1")).map((file) => file.path)).toEqual(
      Array.from({ length: 8 }, (_, index) => `screenshots/default-desktop-0${index}.png`),
    );

    now += 60_000;
    const refreshed = await store.putState("session-1", {
      stateId: "product-menu",
      kind: "interaction",
      ordinal: 1,
      trigger: "user-confirmed",
      enteredFromStateId: "default",
      canExit: false,
      canReset: false,
    });
    expect(Date.parse(refreshed.expiresAt)).toBe(now + DESIGN_SESSION_TTL_MS);
  });

  it("purges expired session metadata and screenshot bytes together", async () => {
    let now = 1_800_000_000_000;
    const store = createStore(() => now);
    await store.create({
      sessionId: "expired-session",
      packageId: "expired-package",
      source: { origin: "https://example.test", pathname: "/" },
    });
    await store.putState("expired-session", defaultState());
    await store.putCapture("expired-session", desktopCapture(), screenshots());

    now += DESIGN_SESSION_TTL_MS + 1;
    await expect(store.get("expired-session")).resolves.toBeUndefined();
    await expect(store.purgeExpired()).resolves.toBe(1);
    await expect(store.files("expired-session")).resolves.toEqual([]);
  });

  it("requires a registered state and a matching screenshot path", async () => {
    const store = createStore(() => 1_800_000_000_000);
    await store.create({
      sessionId: "strict-session",
      packageId: "strict-package",
      source: { origin: "https://example.test", pathname: "/" },
    });
    await expect(
      store.putCapture("strict-session", desktopCapture(), screenshots()),
    ).rejects.toThrow("not registered");
    await store.putState("strict-session", defaultState());
    await expect(
      store.putCapture("strict-session", desktopCapture(), [{
        path: "screenshots/wrong.png", mediaType: "image/png", bytes: Uint8Array.from([1]),
      }]),
    ).rejects.toThrow("do not match");
  });

  it("removes orphan screenshot bytes when a capture is replaced with fewer segments", async () => {
    const store = createStore(() => 1_800_000_000_000);
    await store.create({
      sessionId: "replace-session",
      packageId: "replace-package",
      source: { origin: "https://example.test", pathname: "/" },
    });
    await store.putState("replace-session", defaultState());
    await store.putCapture("replace-session", desktopCapture(), screenshots());
    const replacement: EvidenceCapture = {
      ...desktopCapture(),
      status: "partial",
      screenshotSegments: desktopCapture().screenshotSegments.slice(0, 2),
      gaps: ["screen-limit"],
    };
    await store.putCapture("replace-session", replacement, screenshots().slice(0, 2));
    expect((await store.files("replace-session")).map((file) => file.path).sort()).toEqual([
      "screenshots/default-desktop-00.png",
      "screenshots/default-desktop-01.png",
    ]);
  });

  it("resumes the newest unexpired session for the exact source page", async () => {
    let now = Date.parse("2026-08-12T10:00:00.000Z");
    const store = createStore(() => now);
    await store.create({
      sessionId: "older-session",
      packageId: "older-package",
      source: { origin: "https://www.tourboxtech.com", pathname: "/en/" },
    });
    await store.putState("older-session", defaultState());

    now += 60_000;
    await store.create({
      sessionId: "newer-session",
      packageId: "newer-package",
      source: { origin: "https://www.tourboxtech.com", pathname: "/en/" },
    });
    await store.putState("newer-session", defaultState());
    await store.putCapture("newer-session", desktopCapture(), screenshots());

    await store.create({
      sessionId: "other-page",
      packageId: "other-package",
      source: { origin: "https://www.tourboxtech.com", pathname: "/en/product/" },
    });
    await store.putState("other-page", defaultState());

    await expect(store.latestForSource({
      origin: "https://www.tourboxtech.com",
      pathname: "/en/",
    })).resolves.toMatchObject({
      sessionId: "newer-session",
      captures: [{ captureId: "default-desktop" }],
    });

    now += DESIGN_SESSION_TTL_MS + 1;
    await expect(store.latestForSource({
      origin: "https://www.tourboxtech.com",
      pathname: "/en/",
    })).resolves.toBeUndefined();
  });

  it("removes only the latest leaf interaction state and its transition", async () => {
    const store = createStore(() => 1_800_000_000_000);
    await store.create({
      sessionId: "delete-state-session",
      packageId: "delete-state-package",
      source: { origin: "https://example.test", pathname: "/" },
    });
    await store.putState("delete-state-session", defaultState());
    await store.putState("delete-state-session", interactionState("interaction-1", 1, "default"));
    await store.putTransition("delete-state-session", deriveEvidenceTransition({
      transitionId: "transition-1",
      fromStateId: "default",
      toStateId: "interaction-1",
      viewportScope: ["desktop"],
      actionKind: "toggle",
      targetRole: "navigation",
      captures: [],
    }));

    await expect(store.deleteLeafInteractionState(
      "delete-state-session",
      "interaction-1",
    )).resolves.toMatchObject({
      states: [{ stateId: "default" }],
      transitions: [],
      captures: [],
    });
    await expect(store.deleteLeafInteractionState(
      "delete-state-session",
      "default",
    )).rejects.toThrow("Only an interaction state");
  });
});

function createStore(now: () => number): DesignSessionStore {
  const store = new DesignSessionStore({
    indexedDB,
    databaseName: `design-session-${crypto.randomUUID()}`,
    now,
  });
  stores.push(store);
  return store;
}

function defaultState(): EvidenceState {
  return {
    stateId: "default",
    kind: "default",
    ordinal: 0,
    trigger: "initial",
    enteredFromStateId: null,
    canExit: false,
    canReset: true,
  };
}

function interactionState(stateId: string, ordinal: number, enteredFromStateId: string): EvidenceState {
  return {
    stateId,
    kind: "interaction",
    ordinal,
    trigger: "user-confirmed",
    enteredFromStateId,
    canExit: false,
    canReset: false,
  };
}

function desktopCapture(): EvidenceCapture {
  return {
    captureId: "default-desktop",
    stateId: "default",
    viewport: { name: "desktop", width: 1440, height: 900, devicePixelRatio: 2 },
    status: "complete",
    documentHeight: 6_802,
    screenshotSegments: [
      { path: "screenshots/default-desktop-00.png", scrollY: 0 },
      { path: "screenshots/default-desktop-01.png", scrollY: 900 },
      { path: "screenshots/default-desktop-02.png", scrollY: 1_800 },
      { path: "screenshots/default-desktop-03.png", scrollY: 2_700 },
      { path: "screenshots/default-desktop-04.png", scrollY: 3_600 },
      { path: "screenshots/default-desktop-05.png", scrollY: 4_500 },
      { path: "screenshots/default-desktop-06.png", scrollY: 5_400 },
      { path: "screenshots/default-desktop-07.png", scrollY: 5_902 },
    ],
    nodes: [],
    dynamicRegions: [],
    gaps: [],
  };
}

function screenshots() {
  return Array.from({ length: 8 }, (_, index) => ({
    path: `screenshots/default-desktop-0${index}.png`,
    mediaType: "image/png",
    bytes: Uint8Array.from([index, index + 1, index + 2]),
  }));
}
