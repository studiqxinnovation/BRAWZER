import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import {
  CLIPBOARD_MAX_CHARS,
  BROWSER_PROTOCOL_VERSION,
  type ChosenFile,
  encodeFrame,
  type RelayMessage,
  type TabSecurity,
  type TabState,
  type TransferChunkHeader,
  type TransferKind,
  type TransferMessage,
  type Viewport,
  type NavigationError,
} from "@brawzer/contracts";
import type { BidiConnection } from "./bidi.ts";
import type { Engine, EngineOptions, Viewer } from "./engine-types.ts";
import { log } from "./log.ts";
import { ChunkWriter, sendFile } from "./transfers.ts";
import { FIND_STOP_SCRIPT, findScript, selectionScript, zoomScript } from "./page-tools.ts";

/** Firefox's own error page, `about:neterror?e=<code>&u=<address>`, as the failure it stands for. */
function errorPageOf(url: string): NavigationError | null {
  if (!url.startsWith("about:neterror?") && !url.startsWith("about:certerror?")) return null;
  const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  return {
    url: (params.get("u") ?? "").slice(0, 4096),
    code: (params.get("e") ?? "").slice(0, 64),
  };
}

interface Tab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  security: TabSecurity;
  /** Firefox is showing its own error page for this address. */
  error: NavigationError | null;
  /** Brawzer's layout zoom for this tab, re-applied as pages load. */
  zoom: number;
  /** Brawzer's reader view is showing in place of the page. */
  reader: boolean;
}

interface Transfer {
  id: string;
  tabId: string;
  kind: TransferKind;
  filename: string;
  path: string;
  bytes: number;
  finished: boolean;
}

interface Chooser {
  id: string;
  tabId: string;
  element: { sharedId: string };
  dir: string;
  writers: Map<string, ChunkWriter>;
}

const MAX_TABS = 16;
const JPEG_QUALITY = 0.6;
/** Between screenshots when the page hasn't changed; grows while it stays still. */
const IDLE_MIN_MS = 80;
const IDLE_MAX_MS = 400;
/** How long to wait for the viewer to draw a frame before sending the next. */
const ACK_TIMEOUT_MS = 1_000;
const TITLE_POLL_MS = 1_500;

/** WebDriver's key codes for the keys the page sends by name. */
const KEY_CODES: Record<string, string> = {
  Backspace: "",
  Tab: "",
  Enter: "",
  Shift: "",
  Control: "",
  Alt: "",
  Pause: "",
  Escape: "",
  PageUp: "",
  PageDown: "",
  End: "",
  Home: "",
  ArrowLeft: "",
  ArrowUp: "",
  ArrowRight: "",
  ArrowDown: "",
  Insert: "",
  Delete: "",
  Meta: "",
  F1: "",
  F2: "",
  F3: "",
  F4: "",
  F5: "",
  F6: "",
  F7: "",
  F8: "",
  F9: "",
  F10: "",
  F11: "",
  F12: "",
};

function keyValue(key: string, text: string | undefined): string | null {
  if (KEY_CODES[key]) return KEY_CODES[key];
  if (text && text.length > 0) return text;
  if (key.length === 1) return key;
  return null;
}

function suggestedName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\p{Cc}/\\]/gu, " ")
    .trim()
    .slice(0, 255);
  return cleaned === "" ? fallback : cleaned;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const securityOf = (url: string): TabSecurity =>
  url.startsWith("https://") ? "secure" : url.startsWith("http://") ? "insecure" : "neutral";

/**
 * Drives Firefox for one session over WebDriver BiDi: tabs, navigation,
 * frames (screenshots of the active tab, paced by the viewer's
 * acknowledgements), input, dialogs, downloads and printed pages to Drive,
 * Drive files to file choosers. The same stream protocol as Bee.
 */
export class FirefoxEngine implements Engine {
  private readonly tabs = new Map<string, Tab>();
  private order: string[] = [];
  private activeId: string | null = null;
  private viewer: Viewer | null = null;
  private viewport: Viewport;
  private version = "";
  private ready = false;
  private closing = false;
  private frameCounter = 0;
  private pendingAck: { frameId: number; resolve: () => void } | null = null;
  private streaming = false;
  private lastFrameHash = "";
  private snapshotQueued = false;
  private titleTimer: NodeJS.Timeout | null = null;
  private readonly loadedExtensions: string[] = [];
  private readonly transfers = new Map<string, Transfer>();
  private readonly handoverQueue: string[] = [];
  private handingOver = false;
  private readonly choosers = new Map<string, Chooser>();
  private readonly pendingChoosers = new Map<string, Chooser>();

  constructor(
    private readonly bidi: BidiConnection,
    initialViewport: Viewport,
    private readonly options: EngineOptions & { acceptInsecureCerts: boolean },
  ) {
    this.viewport = initialViewport;
    for (const dir of [options.downloadDir, options.uploadDir]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  get isReady(): boolean {
    return this.ready && !this.bidi.isClosed;
  }

  async start(): Promise<void> {
    const session = await this.bidi.send<{ capabilities: { browserVersion: string } }>(
      "session.new",
      {
        capabilities: {
          alwaysMatch: {
            acceptInsecureCerts: this.options.acceptInsecureCerts,
            // Prompts and file dialogs stay open for Brawzer to draw.
            unhandledPromptBehavior: { default: "ignore", file: "ignore" },
          },
        },
      },
    );
    this.version = session.capabilities.browserVersion;
    await this.bidi.send("session.subscribe", {
      events: [
        "browsingContext.contextCreated",
        "browsingContext.contextDestroyed",
        "browsingContext.navigationStarted",
        "browsingContext.navigationFailed",
        "browsingContext.navigationCommitted",
        "browsingContext.fragmentNavigated",
        "browsingContext.historyUpdated",
        "browsingContext.load",
        "browsingContext.userPromptOpened",
        "browsingContext.downloadWillBegin",
        "browsingContext.downloadEnd",
        "input.fileDialogOpened",
      ],
    });
    this.bidi.on("browsingContext.contextCreated", (params) => {
      const info = params as { context: string; parent?: string | null; url: string };
      if (info.parent) return;
      void this.addTab(info.context, info.url);
    });
    this.bidi.on("browsingContext.contextDestroyed", (params) => {
      const info = params as { context: string; parent?: string | null };
      if (!info.parent) this.removeTab(info.context);
    });
    this.bidi.on("browsingContext.navigationStarted", (params) => {
      const info = params as { context: string; url: string };
      const tab = this.tabs.get(info.context);
      if (!tab) return;
      tab.loading = true;
      tab.reader = false;
      // Firefox shows a failure as a navigation of its own to about:neterror;
      // the address bar keeps the address that failed.
      const failure = this.explained(errorPageOf(info.url));
      if (failure) {
        tab.url = failure.url || tab.url;
        tab.error = failure;
      } else {
        tab.url = info.url;
        tab.security = securityOf(info.url);
        tab.error = null;
      }
      this.queueSnapshot();
    });
    // Firefox ESR 153 has no navigationAborted event; a stopped navigation
    // reaches "complete" through the title poll instead.
    this.bidi.on("browsingContext.navigationFailed", (params) => {
      const info = params as { context: string; url: string };
      const tab = this.tabs.get(info.context);
      if (!tab) return;
      tab.loading = false;
      tab.error = { url: info.url || tab.url, code: "" };
      void this.readErrorCode(tab);
      this.queueSnapshot();
    });
    // A page restored from the back-forward cache commits without a load event.
    this.bidi.on("browsingContext.navigationCommitted", (params) => {
      const info = params as { context: string; url: string };
      const tab = this.tabs.get(info.context);
      if (!tab || errorPageOf(info.url)) return;
      tab.url = info.url;
      tab.security = securityOf(info.url);
      void this.refreshTitle(tab);
    });
    for (const event of ["browsingContext.fragmentNavigated", "browsingContext.historyUpdated"]) {
      this.bidi.on(event, (params) => {
        const info = params as { context: string; url: string };
        const tab = this.tabs.get(info.context);
        if (!tab || errorPageOf(info.url)) return;
        tab.url = info.url;
        tab.security = securityOf(info.url);
        void this.refreshTitle(tab);
      });
    }
    this.bidi.on("browsingContext.load", (params) => {
      const info = params as { context: string; url: string };
      const tab = this.tabs.get(info.context);
      if (!tab) return;
      tab.loading = false;
      const failure = this.explained(errorPageOf(info.url));
      if (failure) {
        tab.url = failure.url || tab.url;
        tab.error = failure;
      } else {
        tab.url = info.url;
        tab.security = securityOf(info.url);
        if (tab.error && tab.error.url !== info.url) tab.error = null;
      }
      // Always said: the title may already have been read during the load, so
      // the refresh below can find nothing new, and the viewer must still hear
      // that loading is over.
      this.queueSnapshot();
      void this.refreshTitle(tab);
      if (tab.zoom !== 1) void this.evaluate(tab, zoomScript(tab.zoom)).catch(() => undefined);
      this.lastFrameHash = "";
    });
    this.bidi.on("browsingContext.userPromptOpened", (params) => {
      const info = params as {
        context: string;
        type: string;
        message: string;
        defaultValue?: string;
      };
      const tab = this.tabs.get(info.context);
      if (!tab) return;
      const kind =
        info.type === "confirm" || info.type === "prompt" || info.type === "beforeunload"
          ? info.type
          : "alert";
      if (!this.viewer) {
        void this.bidi
          .send("browsingContext.handleUserPrompt", { context: tab.id, accept: false })
          .catch(() => undefined);
        return;
      }
      this.viewer.send({
        type: "dialog",
        tabId: tab.id,
        kind,
        message: info.message.slice(0, 4096),
        defaultValue: (info.defaultValue ?? "").slice(0, 4096),
      });
    });
    this.bidi.on("browsingContext.downloadWillBegin", (params) => {
      const info = params as {
        context: string;
        suggestedFilename: string;
        navigation: string | null;
      };
      const transfer: Transfer = {
        id: info.navigation ?? randomUUID(),
        tabId: info.context,
        kind: "download",
        filename: suggestedName(info.suggestedFilename, "download"),
        path: path.join(this.options.downloadDir, info.suggestedFilename),
        bytes: 0,
        finished: false,
      };
      this.transfers.set(transfer.id, transfer);
      this.report(transfer, "started");
    });
    this.bidi.on("browsingContext.downloadEnd", (params) => {
      const info = params as {
        context: string;
        navigation: string | null;
        status: "complete" | "canceled";
        filepath?: string | null;
      };
      void this.downloadEnded(info);
    });
    this.bidi.on("input.fileDialogOpened", (params) => {
      const info = params as { context: string; element?: { sharedId: string }; multiple: boolean };
      const tab = this.tabs.get(info.context);
      if (!tab) return;
      if (!info.element || !this.viewer) {
        this.viewer?.send({ type: "refused", tabId: tab.id, action: "upload" });
        return;
      }
      const chooser: Chooser = {
        id: randomUUID(),
        tabId: tab.id,
        element: info.element,
        dir: "",
        writers: new Map(),
      };
      chooser.dir = path.join(this.options.uploadDir, chooser.id);
      this.pendingChoosers.set(chooser.id, chooser);
      this.viewer.send({
        type: "file-chooser",
        tabId: tab.id,
        chooserId: chooser.id,
        multiple: info.multiple,
      });
    });

    const { contexts } = await this.bidi.send<{
      contexts: { context: string; url: string; parent?: string | null }[];
    }>("browsingContext.getTree", {});
    for (const context of contexts) {
      if (!context.parent) await this.addTab(context.context, context.url);
    }
    if (this.tabs.size === 0) await this.createTab();
    const first = this.order[0];
    if (first) await this.activate(first);
    await this.installAndTidy();
    this.bidi.onClose(() => {
      this.ready = false;
    });
    this.ready = true;
  }

  /**
   * Installs the profile's extensions once the first tab exists, then closes
   * the tabs they open while being installed (welcome and help pages): every
   * session installs afresh, so those would otherwise open every time.
   */
  private async installAndTidy(): Promise<void> {
    if (this.options.extensions.length === 0) return;
    const before = new Set(this.order);
    await this.installExtensions();
    if (this.loadedExtensions.length === 0) return;
    const closed = new Set<string>();
    const until = Date.now() + 2_000;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      for (const id of [...this.order]) {
        if (before.has(id) || closed.has(id)) continue;
        closed.add(id);
        log("info", "closed a tab an extension opened on install");
        await this.bidi.send("browsingContext.close", { context: id }).catch(() => undefined);
      }
    }
    const first = [...before].find((id) => this.tabs.has(id));
    if (first && this.activeId !== first) await this.activate(first);
  }

  attachViewer(viewer: Viewer, viewport: Viewport): void {
    this.viewer = viewer;
    void this.setViewport(viewport).then(() => {
      if (this.viewer !== viewer) return;
      viewer.send({
        type: "welcome",
        protocol: BROWSER_PROTOCOL_VERSION,
        engine: { name: "firefox", version: this.version.slice(0, 64) },
        tabs: this.snapshot(),
        activeTabId: this.activeId ?? this.order[0] ?? "",
        extensions: this.loadedExtensions,
      });
      this.lastFrameHash = "";
      void this.streamFrames();
      void this.handOver();
    });
    this.titleTimer ??= setInterval(() => {
      const active = this.activeTab();
      if (active) void this.refreshTitle(active);
    }, TITLE_POLL_MS);
  }

  detachViewer(viewer: Viewer): void {
    if (this.viewer !== viewer) return;
    this.viewer = null;
    if (this.titleTimer) clearInterval(this.titleTimer);
    this.titleTimer = null;
    this.pendingAck?.resolve();
    this.pendingAck = null;
  }

  async handle(message: RelayMessage): Promise<void> {
    switch (message.type) {
      case "hello":
      case "ping":
      case "sound":
        return;
      case "resize":
        await this.setViewport(message.viewport);
        return;
      case "new-tab":
        await this.createTab(message.url);
        return;
      case "open-browser-page": {
        const pages = this.options.browserPages;
        const url = pages ? (message.page === "passwords" ? pages.passwords : pages.account) : null;
        if (url) await this.createTab(url);
        return;
      }
      case "close-tab":
        if (this.tabs.has(message.tabId)) {
          await this.bidi.send("browsingContext.close", { context: message.tabId });
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
      case "navigate":
        await this.bidi
          .send("browsingContext.navigate", { context: tab.id, url: message.url, wait: "none" })
          .catch((error: unknown) => {
            log("info", "navigation failed", {
              message: error instanceof Error ? error.message : "",
            });
          });
        return;
      case "back":
      case "forward":
        await this.bidi
          .send("browsingContext.traverseHistory", {
            context: tab.id,
            delta: message.type === "back" ? -1 : 1,
          })
          .catch(() => undefined);
        return;
      case "reload":
        await this.bidi.send("browsingContext.reload", { context: tab.id, wait: "none" });
        return;
      case "stop":
        await this.evaluate(tab, "window.stop()");
        return;
      case "mouse": {
        const actions: object[] = [{ type: "pointerMove", x: message.x, y: message.y }];
        const button = { left: 0, middle: 1, right: 2, back: 3, forward: 4, none: 0 }[
          message.button
        ];
        if (message.kind === "down") actions.push({ type: "pointerDown", button });
        if (message.kind === "up") actions.push({ type: "pointerUp", button });
        if (message.kind === "wheel") {
          await this.bidi.send("input.performActions", {
            context: tab.id,
            actions: [
              {
                type: "wheel",
                id: "wheel",
                actions: [
                  {
                    type: "scroll",
                    x: Math.round(message.x),
                    y: Math.round(message.y),
                    deltaX: Math.round(message.deltaX),
                    deltaY: Math.round(message.deltaY),
                  },
                ],
              },
            ],
          });
          return;
        }
        await this.bidi.send("input.performActions", {
          context: tab.id,
          actions: [{ type: "pointer", id: "mouse", actions }],
        });
        return;
      }
      case "key": {
        const value = keyValue(message.key, message.text);
        if (!value) return;
        await this.bidi.send("input.performActions", {
          context: tab.id,
          actions: [
            {
              type: "key",
              id: "keyboard",
              actions: [{ type: message.kind === "down" ? "keyDown" : "keyUp", value }],
            },
          ],
        });
        return;
      }
      case "text": {
        const actions = Array.from(message.text).flatMap((char) => [
          { type: "keyDown", value: char },
          { type: "keyUp", value: char },
        ]);
        await this.bidi.send("input.performActions", {
          context: tab.id,
          actions: [{ type: "key", id: "keyboard", actions }],
        });
        return;
      }
      case "frame-ack":
        if (this.pendingAck?.frameId === message.frameId) {
          this.pendingAck.resolve();
          this.pendingAck = null;
        }
        return;
      case "dialog":
        await this.bidi
          .send("browsingContext.handleUserPrompt", {
            context: tab.id,
            accept: message.accept,
            ...(message.text !== undefined ? { userText: message.text } : {}),
          })
          .catch(() => undefined);
        return;
      case "print":
        await this.printToDrive(tab);
        return;
      case "file-chooser":
        this.expectChosenFiles(message.chooserId, message.files);
        return;
      case "find": {
        // A page still settling (a navigation committing, no body yet) can fail the
        // search; it is tried again briefly before "no matches" is said.
        let value: unknown = null;
        for (let attempt = 0; attempt < 5 && typeof value !== "string"; attempt++) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 200));
          value = await this.evaluate(
            tab,
            findScript(message.text, message.forward, message.caseSensitive),
          ).catch(() => null);
        }
        const found =
          typeof value === "string"
            ? (JSON.parse(value) as { matches: number; active: number })
            : { matches: 0, active: 0 };
        this.viewer?.send({ type: "find-result", tabId: tab.id, text: message.text, ...found });
        this.lastFrameHash = "";
        return;
      }
      case "find-stop":
        await this.evaluate(tab, FIND_STOP_SCRIPT).catch(() => undefined);
        return;
      case "copy": {
        const value = await this.evaluate(tab, selectionScript(CLIPBOARD_MAX_CHARS)).catch(
          () => "",
        );
        this.viewer?.send({
          type: "clipboard",
          tabId: tab.id,
          text: typeof value === "string" ? value : "",
        });
        return;
      }
      case "paste": {
        // Typed as the keyboard would, so it lands wherever the click before it put the focus.
        const actions = Array.from(message.text).flatMap((char) => [
          { type: "keyDown", value: char },
          { type: "keyUp", value: char },
        ]);
        await this.bidi.send("input.performActions", {
          context: tab.id,
          actions: [{ type: "key", id: "keyboard", actions }],
        });
        this.lastFrameHash = "";
        return;
      }
      case "zoom":
        tab.zoom = message.factor;
        await this.evaluate(tab, zoomScript(message.factor)).catch(() => undefined);
        this.lastFrameHash = "";
        this.queueSnapshot();
        return;
      case "reader": {
        if (!message.on) {
          // The page itself is gone (replaced by the reading layout): open it afresh.
          if (tab.reader) {
            // Firefox's load events are unreliable when the current document was
            // written by script, so the navigation is awaited and the state settled here.
            const url = tab.url;
            await Promise.race([
              this.bidi
                .send("browsingContext.navigate", { context: tab.id, url, wait: "complete" })
                .catch(() => undefined),
              new Promise((resolve) => setTimeout(resolve, 10_000)),
            ]);
            tab.reader = false;
            tab.loading = false;
            tab.url = url;
            this.lastFrameHash = "";
            void this.refreshTitle(tab);
            this.queueSnapshot();
          }
          return;
        }
        const value = await this.evaluate(tab, this.options.readerScript).catch(() => null);
        const ok = typeof value === "string" && (JSON.parse(value) as { ok: boolean }).ok;
        if (ok) {
          tab.reader = true;
          this.lastFrameHash = "";
          this.queueSnapshot();
        } else {
          this.viewer?.send({ type: "reader-unavailable", tabId: tab.id });
        }
        return;
      }
    }
  }

  async receiveChunk(header: TransferChunkHeader, data: Uint8Array): Promise<void> {
    for (const chooser of this.choosers.values()) {
      const writer = chooser.writers.get(header.transferId);
      if (writer) {
        await writer.write(header.seq, data, header.last);
        return;
      }
    }
  }

  async close(): Promise<void> {
    this.ready = false;
    this.closing = true;
    if (this.titleTimer) clearInterval(this.titleTimer);
    this.titleTimer = null;
    try {
      await this.bidi.send("browser.close");
    } catch {
      // Already gone.
    }
  }

  // ── Frames ────────────────────────────────────────────────────────────

  /** Screenshots of the active tab, each sent when the previous one was drawn and the page changed. */
  private async streamFrames(): Promise<void> {
    if (this.streaming) return;
    this.streaming = true;
    let idle = IDLE_MIN_MS;
    try {
      while (this.viewer && !this.closing && !this.bidi.isClosed) {
        const viewer = this.viewer;
        const tab = this.activeTab();
        if (!tab) {
          await new Promise((resolve) => setTimeout(resolve, IDLE_MAX_MS));
          continue;
        }
        let shot: { data: string } | null = null;
        try {
          shot = await this.bidi.send<{ data: string }>("browsingContext.captureScreenshot", {
            context: tab.id,
            origin: "viewport",
            format: { type: "image/jpeg", quality: JPEG_QUALITY },
          });
        } catch {
          shot = null;
        }
        if (!shot) {
          await new Promise((resolve) => setTimeout(resolve, IDLE_MAX_MS));
          continue;
        }
        const hash = createHash("sha1").update(shot.data).digest("hex");
        if (hash === this.lastFrameHash) {
          await new Promise((resolve) => setTimeout(resolve, idle));
          idle = Math.min(IDLE_MAX_MS, Math.round(idle * 1.5));
          continue;
        }
        idle = IDLE_MIN_MS;
        this.lastFrameHash = hash;
        const frameId = ++this.frameCounter;
        const bytes = encodeFrame(
          { tabId: tab.id, frameId, width: this.viewport.width, height: this.viewport.height },
          Buffer.from(shot.data, "base64"),
        );
        if (!viewer.sendFrame(bytes)) {
          await new Promise((resolve) => setTimeout(resolve, IDLE_MIN_MS));
          continue;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (this.pendingAck?.frameId === frameId) this.pendingAck = null;
            resolve();
          }, ACK_TIMEOUT_MS);
          this.pendingAck = {
            frameId,
            resolve: () => {
              clearTimeout(timer);
              resolve();
            },
          };
        });
      }
    } finally {
      this.streaming = false;
    }
  }

  // ── Tabs ──────────────────────────────────────────────────────────────

  private activeTab(): Tab | undefined {
    return this.activeId ? this.tabs.get(this.activeId) : undefined;
  }

  private async addTab(id: string, url: string): Promise<void> {
    if (this.tabs.has(id)) return;
    if (this.tabs.size >= MAX_TABS) {
      await this.bidi.send("browsingContext.close", { context: id }).catch(() => undefined);
      return;
    }
    const tab: Tab = {
      id,
      url,
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      security: securityOf(url),
      error: null,
      zoom: 1,
      reader: false,
    };
    this.tabs.set(id, tab);
    this.order.push(id);
    await this.bidi
      .send("browsingContext.setViewport", {
        context: id,
        viewport: { width: this.viewport.width, height: this.viewport.height },
      })
      .catch(() => undefined);
    // Popups come to the front, like new tabs.
    if (this.activeId !== null && this.tabs.size > 1) await this.activate(id);
    this.queueSnapshot();
  }

  private async createTab(url?: string): Promise<void> {
    if (this.tabs.size >= MAX_TABS) return;
    const { context } = await this.bidi.send<{ context: string }>("browsingContext.create", {
      type: "tab",
    });
    await this.addTab(context, "about:blank");
    await this.activate(context);
    await this.bidi
      .send("browsingContext.navigate", { context, url: url ?? this.options.homeUrl, wait: "none" })
      .catch(() => undefined);
  }

  private removeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.tabs.delete(id);
    const index = this.order.indexOf(id);
    if (index !== -1) this.order.splice(index, 1);
    if (this.activeId === id) {
      const next = this.order[Math.min(index, this.order.length - 1)];
      this.activeId = null;
      if (next) {
        void this.activate(next);
      } else if (!this.closing) {
        this.createTab().catch((error: unknown) => {
          log("warn", "could not open a tab", {
            message: error instanceof Error ? error.message : "",
          });
        });
      }
    }
    this.queueSnapshot();
  }

  private async activate(id: string): Promise<void> {
    if (!this.tabs.has(id)) return;
    this.activeId = id;
    this.lastFrameHash = "";
    await this.bidi.send("browsingContext.activate", { context: id }).catch(() => undefined);
    this.queueSnapshot();
  }

  /** The catalogue builds chosen for this session, installed over BiDi (ADR 0018). */
  private async installExtensions(): Promise<void> {
    for (const extension of this.options.extensions) {
      try {
        await this.bidi.send("webExtension.install", {
          extensionData: { type: "path", path: extension.path },
        });
        this.loadedExtensions.push(extension.slug);
        log("info", "extension loaded", { slug: extension.slug });
      } catch (error) {
        log("warn", "extension not loaded", {
          slug: extension.slug,
          message: error instanceof Error ? error.message : "",
        });
      }
    }
  }

  private async evaluate(tab: Tab, expression: string): Promise<unknown> {
    const result = await this.bidi.send<{ result?: { value?: unknown } }>("script.evaluate", {
      expression,
      target: { context: tab.id },
      awaitPromise: false,
    });
    return result.result?.value;
  }

  /** Brawzer's own reason for a refused tunnel, when the proxy noted one for that address. */
  private explained(error: NavigationError | null): NavigationError | null {
    if (error?.code !== "proxyConnectFailure") return error;
    return { url: error.url, code: this.options.refusalFor(error.url) ?? error.code };
  }

  /** Firefox's error page is `about:neterror?e=<code>&u=<address>`; Brawzer draws the explanation. */
  private async readErrorCode(tab: Tab): Promise<void> {
    const failed = tab.error;
    if (!failed) return;
    // The error document replaces the page shortly after the event; look a few times.
    for (let attempt = 0; attempt < 8; attempt++) {
      if (tab.error !== failed) return;
      try {
        const value = await this.evaluate(tab, "document.documentURI");
        if (tab.error !== failed || typeof value !== "string") return;
        if (value.startsWith("about:neterror?") || value.startsWith("about:certerror?")) {
          const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
          const code = params.get("e") ?? "";
          const url = params.get("u") ?? failed.url;
          const explained = this.explained({ url: url || failed.url, code: code.slice(0, 64) });
          if (explained) tab.error = explained;
          this.queueSnapshot();
          return;
        }
      } catch {
        return; // The page moved on.
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  private async refreshTitle(tab: Tab): Promise<void> {
    try {
      const value = await this.evaluate(
        tab,
        "JSON.stringify({ title: document.title, url: location.href, doc: document.documentURI, complete: document.readyState === 'complete', back: typeof navigation !== 'undefined' ? navigation.canGoBack : history.length > 1, forward: typeof navigation !== 'undefined' ? navigation.canGoForward : false })",
      );
      if (typeof value !== "string") return;
      const state = JSON.parse(value) as {
        title: string;
        url: string;
        doc: string;
        complete: boolean;
        back: boolean;
        forward: boolean;
      };
      let changed = false;
      // Firefox's error page is a document of its own; whichever events were
      // seen, what is shown decides what the tab reports.
      const failure = this.explained(errorPageOf(state.doc));
      if (failure) {
        if (tab.error?.code !== failure.code || tab.error.url !== failure.url) {
          tab.error = failure;
          if (failure.url) tab.url = failure.url;
          changed = true;
        }
        if (tab.loading && state.complete) {
          tab.loading = false;
          changed = true;
        }
      } else if (tab.error && state.url === tab.url && state.complete) {
        tab.error = null;
        changed = true;
      }
      if (state.title !== tab.title) {
        tab.title = state.title;
        changed = true;
      }
      // A back-forward cache restore reaches "complete" without a load event.
      if (tab.loading && state.complete && state.url === tab.url) {
        tab.loading = false;
        this.lastFrameHash = "";
        changed = true;
      }
      if (state.back !== tab.canGoBack || state.forward !== tab.canGoForward) {
        tab.canGoBack = state.back;
        tab.canGoForward = state.forward;
        changed = true;
      }
      if (changed) this.queueSnapshot();
    } catch {
      // The tab may be gone or mid-navigation.
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
        error: tab.error,
        zoom: tab.zoom,
        reader: tab.reader,
      }));
  }

  private queueSnapshot(): void {
    if (this.snapshotQueued) return;
    this.snapshotQueued = true;
    setImmediate(() => {
      this.snapshotQueued = false;
      if (!this.viewer || !this.activeId) return;
      this.viewer.send({ type: "tabs", tabs: this.snapshot(), activeTabId: this.activeId });
    });
  }

  private async setViewport(viewport: Viewport): Promise<void> {
    const changed =
      viewport.width !== this.viewport.width || viewport.height !== this.viewport.height;
    this.viewport = viewport;
    if (!changed) return;
    await Promise.all(
      [...this.tabs.keys()].map((id) =>
        this.bidi
          .send("browsingContext.setViewport", {
            context: id,
            viewport: { width: viewport.width, height: viewport.height },
          })
          .catch(() => undefined),
      ),
    );
    this.lastFrameHash = "";
  }

  // ── Files ─────────────────────────────────────────────────────────────

  private report(transfer: Transfer, state: TransferMessage["state"], reason?: string): void {
    this.viewer?.send({
      type: "transfer",
      transferId: transfer.id,
      tabId: transfer.tabId,
      kind: transfer.kind,
      filename: transfer.filename,
      state,
      bytes: transfer.bytes,
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  private async downloadEnded(info: {
    navigation: string | null;
    status: "complete" | "canceled";
    filepath?: string | null;
  }): Promise<void> {
    const transfer = info.navigation ? this.transfers.get(info.navigation) : undefined;
    if (!transfer || transfer.finished) return;
    if (info.filepath) transfer.path = info.filepath;
    if (info.status !== "complete") {
      transfer.finished = true;
      this.transfers.delete(transfer.id);
      await rm(transfer.path, { force: true }).catch(() => undefined);
      this.report(transfer, "canceled");
      return;
    }
    try {
      const file = await open(transfer.path, "r");
      const { size } = await file.stat();
      await file.close();
      transfer.bytes = size;
    } catch {
      transfer.finished = true;
      this.transfers.delete(transfer.id);
      this.report(transfer, "failed", "The download left no file.");
      return;
    }
    if (transfer.bytes > this.options.maxFileBytes) {
      transfer.finished = true;
      this.transfers.delete(transfer.id);
      await rm(transfer.path, { force: true }).catch(() => undefined);
      this.report(transfer, "too_large");
      return;
    }
    this.handoverQueue.push(transfer.id);
    void this.handOver();
  }

  private async handOver(): Promise<void> {
    if (this.handingOver) return;
    this.handingOver = true;
    try {
      while (this.viewer && this.handoverQueue.length > 0) {
        const id = this.handoverQueue[0];
        const transfer = id === undefined ? undefined : this.transfers.get(id);
        if (!transfer) {
          this.handoverQueue.shift();
          continue;
        }
        const viewer = this.viewer;
        this.report(transfer, "received");
        try {
          await sendFile(viewer, transfer.id, transfer.path);
          this.handoverQueue.shift();
          transfer.finished = true;
          this.transfers.delete(transfer.id);
          await rm(transfer.path, { force: true }).catch(() => undefined);
        } catch (error) {
          log("warn", "hand-over interrupted", {
            message: error instanceof Error ? error.message : "",
          });
          break;
        }
      }
    } finally {
      this.handingOver = false;
    }
  }

  private async printToDrive(tab: Tab): Promise<void> {
    const id = `print-${randomUUID()}`;
    const transfer: Transfer = {
      id,
      tabId: tab.id,
      kind: "print",
      filename: suggestedName(`${tab.title || hostOf(tab.url) || "page"}.pdf`, "page.pdf"),
      path: path.join(this.options.downloadDir, id),
      bytes: 0,
      finished: false,
    };
    this.transfers.set(id, transfer);
    this.report(transfer, "started");
    try {
      const { data } = await this.bidi.send<{ data: string }>("browsingContext.print", {
        context: tab.id,
        background: true,
      });
      const bytes = Buffer.from(data, "base64");
      transfer.bytes = bytes.length;
      if (bytes.length > this.options.maxFileBytes) throw new Error("too large");
      const file = await open(transfer.path, "w", 0o600);
      try {
        await file.write(bytes);
      } finally {
        await file.close();
      }
      this.handoverQueue.push(id);
      void this.handOver();
    } catch (error) {
      transfer.finished = true;
      this.transfers.delete(id);
      await rm(transfer.path, { force: true }).catch(() => undefined);
      if (error instanceof Error && error.message === "too large")
        this.report(transfer, "too_large");
      else {
        log("warn", "print failed", { message: error instanceof Error ? error.message : "" });
        this.report(transfer, "failed", "The page couldn’t be printed.");
      }
    }
  }

  private expectChosenFiles(chooserId: string, files: ChosenFile[]): void {
    const chooser = this.pendingChoosers.get(chooserId);
    if (!chooser) return;
    this.pendingChoosers.delete(chooserId);
    const tab = this.tabs.get(chooser.tabId);
    if (!tab) return;
    if (files.length === 0) {
      void this.bidi
        .send("input.setFiles", { context: tab.id, element: chooser.element, files: [] })
        .catch(() => undefined);
      return;
    }
    mkdirSync(chooser.dir, { recursive: true, mode: 0o700 });
    const used = new Set<string>();
    for (const file of files) {
      let name = suggestedName(file.name, "file");
      for (let n = 2; used.has(name.toLowerCase()); n += 1) {
        name = `${suggestedName(file.name, "file")} (${String(n)})`;
      }
      used.add(name.toLowerCase());
      chooser.writers.set(
        file.transferId,
        new ChunkWriter(path.join(chooser.dir, name), this.options.maxFileBytes),
      );
    }
    this.choosers.set(chooserId, chooser);
    void Promise.all([...chooser.writers.values()].map((writer) => writer.done))
      .then(async () => {
        await this.bidi.send("input.setFiles", {
          context: tab.id,
          element: chooser.element,
          files: [...chooser.writers.values()].map((writer) => writer.path),
        });
        log("info", "file chooser answered", { files: chooser.writers.size });
      })
      .catch((error: unknown) => {
        log("warn", "file chooser failed", {
          message: error instanceof Error ? error.message : "",
        });
        this.viewer?.send({ type: "refused", tabId: tab.id, action: "upload" });
      })
      .finally(() => {
        this.choosers.delete(chooserId);
      });
  }
}
