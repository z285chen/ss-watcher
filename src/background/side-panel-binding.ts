const DEFAULT_PANEL_PATH = "sidepanel/index.html";
const STORAGE_KEY = "ssWatcherSidePanelBinding";

interface SidePanelOptions {
  tabId?: number;
  path?: string;
  enabled?: boolean;
}

interface SidePanelBindingApi {
  sidePanel: {
    setOptions(options: SidePanelOptions): Promise<void>;
    open(options: { tabId: number }): Promise<void>;
  };
  tabs: {
    query(
      queryInfo: Record<string, never>,
    ): Promise<Array<{ id: number | undefined }>>;
  };
  storage: {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(key: string): Promise<void>;
  };
}

interface PersistedBinding {
  tabId: number;
  origin: string;
}

export class SidePanelBindingController {
  private revision = 0;
  private desiredTabId: number | undefined;

  constructor(private readonly api: SidePanelBindingApi) {}

  async disableGlobalPanel(): Promise<void> {
    await this.api.sidePanel.setOptions({ enabled: false });
  }

  async openForTab(tabId: number, url: string | undefined): Promise<boolean> {
    const origin = publicOrigin(url);
    if (origin === undefined) return false;

    const revision = ++this.revision;
    this.desiredTabId = tabId;

    // Both calls are deliberately dispatched before the first await. Chrome
    // requires sidePanel.open() to remain in the action's user-gesture turn.
    const configure = this.api.sidePanel.setOptions({
      tabId,
      path: DEFAULT_PANEL_PATH,
      enabled: true,
    });
    const open = this.api.sidePanel.open({ tabId });
    const [configured, opened] = await Promise.allSettled([configure, open]);

    if (configured.status === "rejected" || opened.status === "rejected") {
      if (this.desiredTabId === tabId) this.desiredTabId = undefined;
      await this.disableTabOption(tabId);
      return false;
    }

    if (revision !== this.revision) {
      if (this.desiredTabId !== tabId) await this.disableTabOption(tabId);
      return false;
    }

    let tabs: Array<{ id: number | undefined }>;
    try {
      tabs = await this.api.tabs.query({});
    } catch {
      await this.disableTabOption(tabId);
      if (this.desiredTabId === tabId) this.desiredTabId = undefined;
      return false;
    }

    if (revision !== this.revision) {
      if (this.desiredTabId !== tabId) await this.disableTabOption(tabId);
      return false;
    }

    await Promise.allSettled(
      tabs.flatMap((tab) =>
        validTabId(tab.id) && tab.id !== tabId
          ? [this.api.sidePanel.setOptions({ tabId: tab.id, enabled: false })]
          : [],
      ),
    );

    try {
      await this.api.storage.set({
        [STORAGE_KEY]: { tabId, origin } satisfies PersistedBinding,
      });
    } catch {
      // The native tab binding still works. A later cross-origin navigation
      // will fail closed through the normal ScanSession checks even if this
      // convenience record could not be persisted.
    }
    return true;
  }

  async handleNavigation(tabId: number, nextUrl: string): Promise<void> {
    const binding = await this.readBinding();
    if (binding === undefined || binding.tabId !== tabId) return;

    const nextOrigin = publicOrigin(nextUrl);
    if (nextOrigin === binding.origin) return;
    await this.disableTab(tabId);
  }

  async disableTab(tabId: number): Promise<void> {
    if (this.desiredTabId === tabId) {
      ++this.revision;
      this.desiredTabId = undefined;
    }
    await this.disableTabOption(tabId);

    const binding = await this.readBinding();
    if (binding?.tabId === tabId) await this.removeBinding();
  }

  async disableAllTabs(): Promise<void> {
    ++this.revision;
    this.desiredTabId = undefined;

    try {
      const tabs = await this.api.tabs.query({});
      await Promise.allSettled(
        tabs.flatMap((tab) =>
          validTabId(tab.id)
            ? [this.api.sidePanel.setOptions({ tabId: tab.id, enabled: false })]
            : [],
        ),
      );
    } finally {
      await this.removeBinding();
    }
  }

  private async disableTabOption(tabId: number): Promise<void> {
    try {
      await this.api.sidePanel.setOptions({ tabId, enabled: false });
    } catch {
      // The tab may already have closed.
    }
  }

  private async readBinding(): Promise<PersistedBinding | undefined> {
    try {
      const stored = await this.api.storage.get(STORAGE_KEY);
      const candidate = stored[STORAGE_KEY];
      if (!isRecord(candidate)) return undefined;
      const tabId = candidate.tabId;
      const origin = candidate.origin;
      return validTabId(tabId) && typeof origin === "string"
        ? { tabId, origin }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async removeBinding(): Promise<void> {
    try {
      await this.api.storage.remove(STORAGE_KEY);
    } catch {
      // Best effort during extension/browser teardown.
    }
  }
}

function publicOrigin(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function validTabId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
