import {
  type AgentMessage,
  BROWSER_PROTOCOL_VERSION,
  type ClientMessage,
  encodeFrame,
  type TabSecurity,
  type TabState,
  type Viewport,
} from "@brawzer/contracts";
import type { CdpConnection } from "./cdp.ts";
import { log } from "./log.ts";

/** Who is watching the stream right now, if anyone. */
export interface Viewer {
  send(message: AgentMessage): void;
  /** False when the viewer can't take the frame right now; it is then dropped and acknowledged. */
  sendFrame(frame: Uint8Array): boolean;
}

interface Tab {
  id: string;
  sessionId: string;
  mainFrameId: string | null;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  security: TabSecurity;
  screencasting: boolean;
  /** Frames sent to the viewer but not yet drawn, by frame id → engine's screencast session id. */
  inFlight: Map<number, string>;
}

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached?: boolean;
  openerId?: string;
}

const MAX_TABS = 16;
const JPEG_QUALITY = 60;

/** The engine's own UI surfaces (omnibox popups and the like) are never tabs. */
const isInternal = (url: string) =>
  /^(chrome|devtools|chrome-untrusted|chrome-extension|chrome-search):/.test(url);

const securityOf = (state: string): TabSecurity => {
  if (state === "secure") return "secure";
  if (state === "insecure" || state === "insecure-broken") return "insecure";
  return "neutral";
};

/**
 * Drives one engine for one session: tabs, navigation, the screencast of the
 * active tab, input, page dialogs, and the refusals Brawzer's UI explains.
 * Everything the viewer sees or sends goes through {@link handle}.
 */
export class BrowserEngine {
  private readonly tabs = new Map<string, Tab>();
  private order: string[] = [];
  private activeId: string | null = null;
  private viewer: Viewer | null = null;
  private viewport: Viewport;
  private frameCounter = 0;
  private version = "";
  private pendingActivation: string | null = null;
  private readonly attaching = new Set<string>();
  private snapshotQueued = false;
  private ready = false;

  constructor(
    private readonly cdp: CdpConnection,
    initialViewport: Viewport,
  ) {
    this.viewport = initialViewport;
  }

  get isReady(): boolean {
    return this.ready && !this.cdp.isClosed;
  }

  async start(): Promise<void> {
    // Pages are attached one by one as they are discovered: the engine's
    // browser-level auto-attach doesn't cover its new headless mode's tabs.
    this.cdp.on("Target.targetCreated", (params) => {
      const { targetInfo } = params as { targetInfo: TargetInfo };
      void this.considerTarget(targetInfo);
    });
    this.cdp.on("Target.targetInfoChanged", (params) => {
      const { targetInfo } = params as { targetInfo: TargetInfo };
      const tab = this.tabs.get(targetInfo.targetId);
      if (!tab) {
        void this.considerTarget(targetInfo);
        return;
      }
      tab.title = targetInfo.title;
      tab.url = targetInfo.url;
      this.queueSnapshot();
    });
    this.cdp.on("Target.targetDestroyed", (params) => {
      this.removeTab((params as { targetId: string }).targetId);
    });
    this.cdp.on("Target.detachedFromTarget", (params) => {
      const { targetId } = params as { sessionId: string; targetId?: string };
      if (targetId) this.removeTab(targetId);
    });
    this.cdp.on("Target.targetCrashed", (params) => {
      const { targetId } = params as { targetId: string };
      log("warn", "tab crashed", { targetId });
      void this.cdp.send("Target.closeTarget", { targetId }).catch(() => undefined);
    });
    this.cdp.on("Browser.downloadWillBegin", (params) => {
      const { frameId } = params as { frameId: string };
      const tab =
        [...this.tabs.values()].find((candidate) => candidate.mainFrameId === frameId) ??
        this.activeTab();
      if (tab) this.viewer?.send({ type: "refused", tabId: tab.id, action: "download" });
    });

    this.cdp.on("Page.frameNavigated", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      const { frame } = params as { frame: { id: string; parentId?: string; url: string } };
      if (!tab || frame.parentId) return;
      tab.mainFrameId = frame.id;
      tab.url = frame.url;
      void this.refreshHistory(tab);
    });
    this.cdp.on("Page.navigatedWithinDocument", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (!tab) return;
      tab.url = (params as { url: string }).url;
      void this.refreshHistory(tab);
    });
    this.cdp.on("Page.frameStartedLoading", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (!tab) return;
      if ((params as { frameId: string }).frameId !== tab.mainFrameId) return;
      tab.loading = true;
      this.queueSnapshot();
    });
    this.cdp.on("Page.frameStoppedLoading", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (!tab) return;
      if ((params as { frameId: string }).frameId !== tab.mainFrameId) return;
      tab.loading = false;
      void this.refreshTitle(tab);
    });
    this.cdp.on("Page.loadEventFired", (_params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (tab) void this.refreshTitle(tab);
    });
    this.cdp.on("Security.visibleSecurityStateChanged", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (!tab) return;
      const { visibleSecurityState } = params as {
        visibleSecurityState: { securityState: string };
      };
      tab.security = securityOf(visibleSecurityState.securityState);
      this.queueSnapshot();
    });
    this.cdp.on("Page.javascriptDialogOpening", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (!tab) return;
      const dialog = params as { message: string; type: string; defaultPrompt?: string };
      const kind =
        dialog.type === "confirm" || dialog.type === "prompt" || dialog.type === "beforeunload"
          ? dialog.type
          : "alert";
      if (!this.viewer) {
        // Nobody to ask: dismiss, so the page can't hang the session.
        void this.cdp
          .send("Page.handleJavaScriptDialog", { accept: false }, tab.sessionId)
          .catch(() => undefined);
        return;
      }
      this.viewer.send({
        type: "dialog",
        tabId: tab.id,
        kind,
        message: dialog.message.slice(0, 4096),
        defaultValue: (dialog.defaultPrompt ?? "").slice(0, 4096),
      });
    });
    this.cdp.on("Page.fileChooserOpened", (_params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (tab) this.viewer?.send({ type: "refused", tabId: tab.id, action: "upload" });
    });
    this.cdp.on("Page.screencastFrame", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (tab) this.frameArrived(tab, params as { data: string; sessionId: string });
    });

    const version = await this.cdp.send<{ product: string }>("Browser.getVersion");
    this.version = version.product;
    await this.cdp.send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: true });
    await this.cdp.send("Target.setDiscoverTargets", { discover: true });
    const deadline = Date.now() + 5_000;
    while (this.tabs.size === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.tabs.size === 0) await this.createTab();
    this.ready = true;
  }

  attachViewer(viewer: Viewer, viewport: Viewport): void {
    this.viewer = viewer;
    void this.setViewport(viewport).then(() => {
      if (this.viewer !== viewer) return;
      viewer.send({
        type: "welcome",
        protocol: BROWSER_PROTOCOL_VERSION,
        engine: { name: "chromium", version: this.version.slice(0, 64) },
        tabs: this.snapshot(),
        activeTabId: this.activeId ?? "",
      });
      void this.syncScreencasts();
    });
  }

  detachViewer(viewer: Viewer): void {
    if (this.viewer !== viewer) return;
    this.viewer = null;
    void this.syncScreencasts();
  }

  /** Everything the viewer may ask for. Invalid tab ids are ignored, never fatal. */
  async handle(message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "hello":
      case "ping":
        return;
      case "resize":
        await this.setViewport(message.viewport);
        return;
      case "new-tab":
        await this.createTab(message.url);
        return;
      case "close-tab":
        if (this.tabs.has(message.tabId)) {
          await this.cdp.send("Target.closeTarget", { targetId: message.tabId });
        }
        return;
      case "activate-tab":
        await this.activate(message.tabId);
        return;
      default:
        break;
    }
    const tab = this.tabs.get(message.tabId);
    if (!tab) return;
    switch (message.type) {
      case "navigate": {
        const result = await this.cdp.send<{ errorText?: string }>(
          "Page.navigate",
          { url: message.url },
          tab.sessionId,
        );
        if (result.errorText) log("info", "navigation failed", { errorText: result.errorText });
        return;
      }
      case "back":
      case "forward":
        await this.goInHistory(tab, message.type === "back" ? -1 : 1);
        return;
      case "reload":
        await this.cdp.send("Page.reload", {}, tab.sessionId);
        return;
      case "stop":
        await this.cdp.send("Page.stopLoading", {}, tab.sessionId);
        return;
      case "mouse": {
        const type = {
          move: "mouseMoved",
          down: "mousePressed",
          up: "mouseReleased",
          wheel: "mouseWheel",
        }[message.kind];
        await this.cdp.send(
          "Input.dispatchMouseEvent",
          {
            type,
            x: message.x,
            y: message.y,
            button: message.button,
            buttons: message.buttons,
            clickCount: message.clickCount,
            modifiers: message.modifiers,
            ...(message.kind === "wheel" ? { deltaX: message.deltaX, deltaY: message.deltaY } : {}),
          },
          tab.sessionId,
        );
        return;
      }
      case "key": {
        const text = message.text ?? (message.key === "Enter" ? "\r" : undefined);
        await this.cdp.send(
          "Input.dispatchKeyEvent",
          {
            type: message.kind === "up" ? "keyUp" : text ? "keyDown" : "rawKeyDown",
            key: message.key,
            code: message.code,
            windowsVirtualKeyCode: message.keyCode,
            nativeVirtualKeyCode: message.keyCode,
            modifiers: message.modifiers,
            ...(message.kind === "down" && text ? { text, unmodifiedText: text } : {}),
          },
          tab.sessionId,
        );
        return;
      }
      case "text":
        await this.cdp.send("Input.insertText", { text: message.text }, tab.sessionId);
        return;
      case "frame-ack": {
        const screencastSession = tab.inFlight.get(message.frameId);
        if (screencastSession === undefined) return;
        tab.inFlight.delete(message.frameId);
        await this.ack(tab, screencastSession);
        return;
      }
      case "dialog":
        await this.cdp.send(
          "Page.handleJavaScriptDialog",
          {
            accept: message.accept,
            ...(message.text !== undefined ? { promptText: message.text } : {}),
          },
          tab.sessionId,
        );
        return;
    }
  }

  async close(): Promise<void> {
    this.ready = false;
    try {
      await this.cdp.send("Browser.close");
    } catch {
      // Already gone.
    }
  }

  // ── Tabs ──────────────────────────────────────────────────────────────

  private activeTab(): Tab | undefined {
    return this.activeId ? this.tabs.get(this.activeId) : undefined;
  }

  private tabBySession(sessionId: string | undefined): Tab | undefined {
    if (!sessionId) return undefined;
    for (const tab of this.tabs.values()) if (tab.sessionId === sessionId) return tab;
    return undefined;
  }

  private async createTab(url?: string): Promise<void> {
    if (this.tabs.size >= MAX_TABS) return;
    const { targetId } = await this.cdp.send<{ targetId: string }>("Target.createTarget", {
      url: url ?? "about:blank",
    });
    this.pendingActivation = targetId;
    const existing = this.tabs.get(targetId);
    if (existing) await this.activate(targetId);
  }

  /** Attaches to a page target the engine reported, unless it is internal or already ours. */
  private async considerTarget(info: TargetInfo): Promise<void> {
    if (info.type !== "page" || isInternal(info.url)) return;
    if (this.tabs.has(info.targetId) || this.attaching.has(info.targetId)) return;
    if (this.tabs.size >= MAX_TABS) {
      // Popup storms: close anything past the limit.
      await this.cdp.send("Target.closeTarget", { targetId: info.targetId }).catch(() => undefined);
      return;
    }
    this.attaching.add(info.targetId);
    try {
      const { sessionId } = await this.cdp.send<{ sessionId: string }>("Target.attachToTarget", {
        targetId: info.targetId,
        flatten: true,
      });
      await this.attached(sessionId, info);
    } catch (error) {
      log("warn", "could not attach to tab", {
        message: error instanceof Error ? error.message : "",
      });
    } finally {
      this.attaching.delete(info.targetId);
    }
  }

  private async attached(sessionId: string, info: TargetInfo): Promise<void> {
    const tab: Tab = {
      id: info.targetId,
      sessionId,
      mainFrameId: null,
      url: info.url,
      title: info.title,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      security: "neutral",
      screencasting: false,
      inFlight: new Map(),
    };
    this.tabs.set(tab.id, tab);
    if (!this.order.includes(tab.id)) this.order.push(tab.id);
    try {
      await Promise.all([
        this.cdp.send("Page.enable", {}, sessionId),
        this.cdp.send("Security.enable", {}, sessionId),
        this.cdp.send("Page.setInterceptFileChooserDialog", { enabled: true }, sessionId),
        this.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId),
        this.cdp.send(
          "Emulation.setDeviceMetricsOverride",
          { ...this.viewport, deviceScaleFactor: 1, mobile: false },
          sessionId,
        ),
      ]);
      const tree = await this.cdp.send<{ frameTree: { frame: { id: string } } }>(
        "Page.getFrameTree",
        {},
        sessionId,
      );
      tab.mainFrameId = tree.frameTree.frame.id;
    } catch (error) {
      log("warn", "tab setup failed", { message: error instanceof Error ? error.message : "" });
    }
    // Popups and new tabs come to the front; the first tab becomes active.
    if (this.pendingActivation === tab.id || this.activeId === null || info.openerId) {
      this.pendingActivation = null;
      await this.activate(tab.id);
    } else {
      this.queueSnapshot();
    }
  }

  private removeTab(targetId: string): void {
    const tab = this.tabs.get(targetId);
    if (!tab) return;
    this.tabs.delete(targetId);
    const index = this.order.indexOf(targetId);
    if (index !== -1) this.order.splice(index, 1);
    if (this.activeId === targetId) {
      const next = this.order[Math.min(index, this.order.length - 1)];
      this.activeId = null;
      if (next) {
        void this.activate(next);
      } else {
        void this.createTab();
      }
    }
    this.queueSnapshot();
  }

  private async activate(targetId: string): Promise<void> {
    const tab = this.tabs.get(targetId);
    if (!tab) return;
    this.activeId = targetId;
    await this.cdp.send("Target.activateTarget", { targetId }).catch(() => undefined);
    await this.syncScreencasts();
    this.queueSnapshot();
  }

  /** The engine reports a page's address changes, but not always its title. */
  private async refreshTitle(tab: Tab): Promise<void> {
    try {
      const { result } = await this.cdp.send<{ result: { value?: unknown } }>(
        "Runtime.evaluate",
        { expression: "document.title", returnByValue: true },
        tab.sessionId,
      );
      if (typeof result.value === "string" && result.value !== "") tab.title = result.value;
    } catch {
      // The tab may be gone.
    }
    await this.refreshHistory(tab);
  }

  private async refreshHistory(tab: Tab): Promise<void> {
    try {
      const history = await this.cdp.send<{ currentIndex: number; entries: unknown[] }>(
        "Page.getNavigationHistory",
        {},
        tab.sessionId,
      );
      tab.canGoBack = history.currentIndex > 0;
      tab.canGoForward = history.currentIndex < history.entries.length - 1;
    } catch {
      // The tab may be gone.
    }
    this.queueSnapshot();
  }

  private async goInHistory(tab: Tab, step: -1 | 1): Promise<void> {
    const history = await this.cdp.send<{ currentIndex: number; entries: { id: number }[] }>(
      "Page.getNavigationHistory",
      {},
      tab.sessionId,
    );
    const entry = history.entries[history.currentIndex + step];
    if (entry) {
      await this.cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }, tab.sessionId);
    }
  }

  private snapshot(): TabState[] {
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((tab): tab is Tab => tab !== undefined)
      .map((tab) => ({
        id: tab.id,
        url: tab.url.slice(0, 4096),
        title: tab.title.slice(0, 1024),
        loading: tab.loading,
        canGoBack: tab.canGoBack,
        canGoForward: tab.canGoForward,
        security: tab.security,
      }));
  }

  /** Coalesces bursts of changes into one snapshot per tick. */
  private queueSnapshot(): void {
    if (this.snapshotQueued) return;
    this.snapshotQueued = true;
    setImmediate(() => {
      this.snapshotQueued = false;
      if (!this.viewer || !this.activeId) return;
      this.viewer.send({ type: "tabs", tabs: this.snapshot(), activeTabId: this.activeId });
    });
  }

  // ── Viewport and frames ───────────────────────────────────────────────

  private async setViewport(viewport: Viewport): Promise<void> {
    const changed =
      viewport.width !== this.viewport.width || viewport.height !== this.viewport.height;
    this.viewport = viewport;
    if (!changed) return;
    await Promise.all(
      [...this.tabs.values()].map((tab) =>
        this.cdp
          .send(
            "Emulation.setDeviceMetricsOverride",
            { ...viewport, deviceScaleFactor: 1, mobile: false },
            tab.sessionId,
          )
          .catch(() => undefined),
      ),
    );
    // The screencast's maximum size is fixed when it starts.
    const active = this.activeTab();
    if (active?.screencasting) {
      await this.stopScreencast(active);
      await this.syncScreencasts();
    }
  }

  /** Only the active tab streams, and only while someone is watching. */
  private async syncScreencasts(): Promise<void> {
    for (const tab of this.tabs.values()) {
      const wanted = this.viewer !== null && tab.id === this.activeId;
      if (wanted && !tab.screencasting) {
        tab.screencasting = true;
        await this.cdp
          .send(
            "Page.startScreencast",
            {
              format: "jpeg",
              quality: JPEG_QUALITY,
              maxWidth: this.viewport.width,
              maxHeight: this.viewport.height,
              everyNthFrame: 1,
            },
            tab.sessionId,
          )
          .catch(() => {
            tab.screencasting = false;
          });
      } else if (!wanted && tab.screencasting) {
        await this.stopScreencast(tab);
      }
    }
  }

  private async stopScreencast(tab: Tab): Promise<void> {
    tab.screencasting = false;
    tab.inFlight.clear();
    await this.cdp.send("Page.stopScreencast", {}, tab.sessionId).catch(() => undefined);
  }

  private frameArrived(tab: Tab, frame: { data: string; sessionId: string }): void {
    const viewer = this.viewer;
    if (!viewer || tab.id !== this.activeId || !tab.screencasting) {
      void this.ack(tab, frame.sessionId);
      return;
    }
    const frameId = ++this.frameCounter;
    const bytes = encodeFrame(
      { tabId: tab.id, frameId, width: this.viewport.width, height: this.viewport.height },
      Buffer.from(frame.data, "base64"),
    );
    if (viewer.sendFrame(bytes)) {
      tab.inFlight.set(frameId, frame.sessionId);
    } else {
      // Dropped (the viewer's connection is behind): free the engine to draw the next one.
      void this.ack(tab, frame.sessionId);
    }
  }

  private async ack(tab: Tab, screencastSession: string): Promise<void> {
    await this.cdp
      .send("Page.screencastFrameAck", { sessionId: screencastSession }, tab.sessionId)
      .catch(() => undefined);
  }
}
