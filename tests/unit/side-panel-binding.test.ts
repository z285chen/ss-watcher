import { describe, expect, it } from "vitest";

import { SidePanelBindingController } from "../../src/background/side-panel-binding";

function fixture(tabIds = [1, 2, 3]) {
  const calls: string[] = [];
  const stored: Record<string, unknown> = {};
  const api = {
    sidePanel: {
      setOptions: async (options: {
        tabId?: number;
        path?: string;
        enabled?: boolean;
      }) => {
        calls.push(`set:${JSON.stringify(options)}`);
      },
      open: async (options: { tabId: number }) => {
        calls.push(`open:${JSON.stringify(options)}`);
      },
    },
    tabs: {
      query: async (_queryInfo: Record<string, never>) =>
        tabIds.map((id) => ({ id })),
    },
    storage: {
      get: async (key: string) => ({ [key]: stored[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(stored, items);
      },
      remove: async (key: string) => {
        delete stored[key];
      },
    },
  };
  return { controller: new SidePanelBindingController(api), calls, stored };
}

describe("tab-scoped Side Panel binding", () => {
  it("dispatches tab configuration before tab-scoped open and disables all other tabs", async () => {
    const { controller, calls } = fixture();

    await expect(
      controller.openForTab(2, "https://shop.example/products/a"),
    ).resolves.toBe(true);

    expect(calls.slice(0, 2)).toEqual([
      'set:{"tabId":2,"path":"sidepanel/index.html","enabled":true}',
      'open:{"tabId":2}',
    ]);
    expect(calls).toContain('set:{"tabId":1,"enabled":false}');
    expect(calls).toContain('set:{"tabId":3,"enabled":false}');
    expect(calls).not.toContain('set:{"tabId":2,"enabled":false}');
  });

  it("disables the manifest-level default panel", async () => {
    const { controller, calls } = fixture();
    await controller.disableGlobalPanel();
    expect(calls).toEqual(['set:{"enabled":false}']);
  });

  it("keeps the binding on same-store navigation and removes it cross-origin", async () => {
    const { controller, calls, stored } = fixture();
    await controller.openForTab(1, "https://shop.example/products/a");
    calls.length = 0;

    await controller.handleNavigation(
      1,
      "https://shop.example/collections/new?sort_by=best-selling",
    );
    expect(calls).toEqual([]);

    await controller.handleNavigation(1, "https://different.example/");
    expect(calls).toEqual(['set:{"tabId":1,"enabled":false}']);
    expect(stored).toEqual({});
  });

  it("moves the unique binding when another tab is explicitly opened", async () => {
    const { controller, calls, stored } = fixture();
    await controller.openForTab(1, "https://first.example/");
    calls.length = 0;

    await controller.openForTab(3, "https://second.example/");
    expect(calls.slice(0, 2)).toEqual([
      'set:{"tabId":3,"path":"sidepanel/index.html","enabled":true}',
      'open:{"tabId":3}',
    ]);
    expect(calls).toContain('set:{"tabId":1,"enabled":false}');
    expect(stored).toMatchObject({
      ssWatcherSidePanelBinding: {
        tabId: 3,
        origin: "https://second.example",
      },
    });
  });

  it("rejects extension and malformed pages without opening the panel", async () => {
    const { controller, calls } = fixture();
    await expect(
      controller.openForTab(1, "chrome://extensions/"),
    ).resolves.toBe(false);
    await expect(controller.openForTab(1, "not a url")).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("clears every tab binding during extension or browser startup reset", async () => {
    const { controller, calls, stored } = fixture();
    await controller.openForTab(2, "https://shop.example/");
    calls.length = 0;

    await controller.disableAllTabs();
    expect(calls).toEqual([
      'set:{"tabId":1,"enabled":false}',
      'set:{"tabId":2,"enabled":false}',
      'set:{"tabId":3,"enabled":false}',
    ]);
    expect(stored).toEqual({});
  });
});
