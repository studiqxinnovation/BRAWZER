import { randomUUID } from "node:crypto";
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
import { BEE_VERSION } from "./bee.ts";
import type { CdpConnection } from "./cdp.ts";
import type { Engine, EngineOptions, Viewer } from "./engine-types.ts";
import { log } from "./log.ts";
import { FIND_STOP_SCRIPT, findScript, selectionScript, zoomScript } from "./page-tools.ts";
import { ChunkWriter, sendFile } from "./transfers.ts";

export type { EngineOptions, Viewer } from "./engine-types.ts";

/** A download or a printed page on its way to Drive. */
interface Transfer {
  id: string;
  tabId: string;
  kind: TransferKind;
  filename: string;
  path: string;
  bytes: number;
  /** Set once a final state was reported, so the engine's later events don't report twice. */
  finished: boolean;
}

/** A page's open file chooser, waiting for Drive files. */
interface Chooser {
  id: string;
  tabId: string;
  backendNodeId: number;
  dir: string;
  /** By transfer id, once the relay has said which files come. */
  writers: Map<string, ChunkWriter>;
}

/** Chromium's `net::ERR_NAME_NOT_RESOLVED` → `ERR_NAME_NOT_RESOLVED`, within the protocol's size. */
function errorCode(text: string): string {
  return text.replace(/^net::/, "").slice(0, 64);
}

/** A failed tunnel is the proxy refusing; the proxy's own reason says why. */
const TUNNEL_FAILURES = new Set(["ERR_TUNNEL_CONNECTION_FAILED", "ERR_PROXY_CONNECTION_FAILED"]);

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
  /** The engine is showing its own error page for this address. */
  error: NavigationError | null;
  /** What the last navigate command answered, for an error page that names no code yet. */
  lastNavigateError: string;
  /** Brawzer's layout zoom for this tab, re-applied as pages load. */
  zoom: number;
  /** Brawzer's reader view is showing in place of the page. */
  reader: boolean;
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
/**
 * How often the active tab's title is re-read while someone is watching. The
 * engine reports titles on navigation but not when a page's script changes
 * them later (unread counts and the like), so the agent asks.
 */
const TITLE_POLL_MS = 1_500;
/** Downloads in flight at once; a page starting more has the extra ones cancelled. */
const MAX_ACTIVE_DOWNLOADS = 3;

/** The engine's suggested filename, reduced to something Drive accepts; Drive cleans it again. */
function suggestedName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\p{Cc}/\\]/gu, " ")
    .trim()
    .slice(0, 255);
  return cleaned === "" ? fallback : cleaned;
}

/** True for the engine's stand-in titles: the address itself, with or without its scheme. */
function isFallbackTitle(title: string, url: string): boolean {
  if (title === "" || title === url) return true;
  try {
    const parsed = new URL(url);
    const withoutScheme = `${parsed.host}${parsed.pathname}${parsed.search}`;
    return (
      title === withoutScheme || title === parsed.host || title === withoutScheme.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}

class TooLargeError extends Error {}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

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
export class BrowserEngine implements Engine {
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
  private closing = false;
  private readonly transfers = new Map<string, Transfer>();
  /** Finished transfers waiting for a viewer to hand them to. */
  private readonly handoverQueue: string[] = [];
  private handingOver = false;
  private readonly choosers = new Map<string, Chooser>();
  private titleTimer: NodeJS.Timeout | null = null;
  private userAgent = "";

  constructor(
    private readonly cdp: CdpConnection,
    initialViewport: Viewport,
    private readonly options: EngineOptions,
  ) {
    this.viewport = initialViewport;
    for (const dir of [options.downloadDir, options.uploadDir]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
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
      tab.url = targetInfo.url;
      // The engine reports the address as the title until it has read one; that
      // fallback must not replace a title already read from the page.
      if (!isFallbackTitle(targetInfo.title, targetInfo.url)) tab.title = targetInfo.title;
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
      const { frameId, guid, suggestedFilename } = params as {
        frameId: string;
        guid: string;
        url: string;
        suggestedFilename: string;
      };
      const tab =
        [...this.tabs.values()].find((candidate) => candidate.mainFrameId === frameId) ??
        this.activeTab();
      this.downloadStarted(guid, tab?.id ?? "", suggestedFilename);
    });
    this.cdp.on("Browser.downloadProgress", (params) => {
      const progress = params as {
        guid: string;
        totalBytes: number;
        receivedBytes: number;
        state: "inProgress" | "completed" | "canceled";
      };
      void this.downloadProgressed(progress);
    });

    this.cdp.on("Page.frameNavigated", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      const { frame } = params as {
        frame: { id: string; parentId?: string; url: string; unreachableUrl?: string };
      };
      if (!tab || frame.parentId) return;
      tab.mainFrameId = frame.id;
      // An error page keeps the address that failed; Brawzer draws the explanation.
      if (frame.unreachableUrl) {
        tab.url = frame.unreachableUrl;
        tab.error = this.explained({
          url: frame.unreachableUrl,
          code: errorCode(tab.lastNavigateError),
        });
        tab.lastNavigateError = "";
        void this.readErrorCode(tab);
      } else {
        tab.url = frame.url;
        tab.error = null;
      }
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
      tab.reader = false;
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
      if (!tab) return;
      void this.refreshTitle(tab);
      if (tab.zoom !== 1) void this.evaluate(tab, zoomScript(tab.zoom)).catch(() => undefined);
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
    this.cdp.on("Page.fileChooserOpened", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (!tab) return;
      const { mode, backendNodeId } = params as { mode: string; backendNodeId?: number };
      if (backendNodeId === undefined || !this.viewer) {
        // Nothing to fill, or nobody to ask: the page's chooser stays empty.
        this.viewer?.send({ type: "refused", tabId: tab.id, action: "upload" });
        return;
      }
      const chooser: Chooser = {
        id: randomUUID(),
        tabId: tab.id,
        backendNodeId,
        dir: "",
        writers: new Map(),
      };
      chooser.dir = path.join(this.options.uploadDir, chooser.id);
      this.choosers.set(chooser.id, chooser);
      this.viewer.send({
        type: "file-chooser",
        tabId: tab.id,
        chooserId: chooser.id,
        multiple: mode === "selectMultiple",
      });
    });
    this.cdp.on("Page.screencastFrame", (params, sessionId) => {
      const tab = this.tabBySession(sessionId);
      if (tab) this.frameArrived(tab, params as { data: string; sessionId: string });
    });

    const version = await this.cdp.send<{ product: string; userAgent: string }>(
      "Browser.getVersion",
    );
    this.version = version.product;
    // Bee is Brawzer's own browser: it says so, after what it is built on.
    this.userAgent = `${version.userAgent} Bee/${BEE_VERSION}`;
    // Downloads land in the scratch directory under their id and are handed to Drive.
    await this.cdp.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: this.options.downloadDir,
      eventsEnabled: true,
    });
    await this.cdp.send("Target.setDiscoverTargets", { discover: true });
    const deadline = Date.now() + 5_000;
    while (this.tabs.size === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.tabs.size === 0) await this.createTab();
    // Ready means a tab is active too: the welcome names it, and a welcome
    // without one is invalid and would be dropped by the relay.
    while (this.activeId === null && Date.now() < deadline + 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.ready = true;
  }

  attachViewer(viewer: Viewer, viewport: Viewport): void {
    this.viewer = viewer;
    void this.setViewport(viewport).then(() => {
      if (this.viewer !== viewer) return;
      viewer.send({
        type: "welcome",
        protocol: BROWSER_PROTOCOL_VERSION,
        engine: { name: "bee", version: this.version.slice(0, 64) },
        tabs: this.snapshot(),
        activeTabId: this.activeId ?? this.order[0] ?? "",
      });
      void this.syncScreencasts();
      void this.handOver();
    });
    this.titleTimer ??= setInterval(() => {
      const active = this.activeTab();
      if (active && !active.loading) void this.refreshTitle(active, false);
    }, TITLE_POLL_MS);
  }

  detachViewer(viewer: Viewer): void {
    if (this.viewer !== viewer) return;
    this.viewer = null;
    if (this.titleTimer) clearInterval(this.titleTimer);
    this.titleTimer = null;
    void this.syncScreencasts();
  }

  /** Everything the viewer may ask for. Invalid tab ids are ignored, never fatal. */
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
        if (result.errorText && result.errorText !== "net::ERR_ABORTED") {
          log("info", "navigation failed", { errorText: result.errorText });
          // The frame may already show the error page, or be about to.
          if (tab.error?.code === "") {
            tab.error = this.explained({ url: tab.error.url, code: errorCode(result.errorText) });
            this.queueSnapshot();
          } else if (!tab.error) {
            tab.lastNavigateError = result.errorText;
          }
        }
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
      case "print":
        await this.printToDrive(tab);
        return;
      case "file-chooser":
        this.expectChosenFiles(message.chooserId, message.files);
        return;
      case "find":
      case "find-stop":
      case "zoom":
      case "reader":
        await this.pageTool(tab, message);
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
      case "paste":
        await this.cdp.send("Input.insertText", { text: message.text }, tab.sessionId);
        return;
    }
  }

  /** A piece of a Drive file for a page's file chooser, from the relay. */
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
      await this.cdp.send("Browser.close");
    } catch {
      // Already gone.
    }
  }

  // ── Files: downloads and printed pages to Drive, Drive files to pages ──

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

  private downloadStarted(guid: string, tabId: string, suggested: string): void {
    const transfer: Transfer = {
      id: guid,
      tabId,
      kind: "download",
      filename: suggestedName(suggested, "download"),
      path: path.join(this.options.downloadDir, guid),
      bytes: 0,
      finished: false,
    };
    this.transfers.set(guid, transfer);
    const active = [...this.transfers.values()].filter(
      (candidate) => candidate.kind === "download" && !candidate.finished,
    );
    if (active.length > MAX_ACTIVE_DOWNLOADS) {
      void this.cancelDownload(transfer, "failed", "Too many downloads at once.");
      return;
    }
    this.report(transfer, "started");
  }

  private async downloadProgressed(progress: {
    guid: string;
    totalBytes: number;
    receivedBytes: number;
    state: "inProgress" | "completed" | "canceled";
  }): Promise<void> {
    const transfer = this.transfers.get(progress.guid);
    if (!transfer || transfer.finished) return;
    transfer.bytes = progress.receivedBytes;
    if (Math.max(progress.totalBytes, progress.receivedBytes) > this.options.maxFileBytes) {
      await this.cancelDownload(transfer, "too_large");
      return;
    }
    if (progress.state === "canceled") {
      transfer.finished = true;
      this.transfers.delete(transfer.id);
      await rm(transfer.path, { force: true }).catch(() => undefined);
      this.report(transfer, "canceled");
      return;
    }
    if (progress.state === "completed") {
      transfer.bytes = progress.receivedBytes;
      this.queueHandover(transfer);
    }
  }

  private async cancelDownload(
    transfer: Transfer,
    state: "too_large" | "failed",
    reason?: string,
  ): Promise<void> {
    if (transfer.finished) return;
    transfer.finished = true;
    this.transfers.delete(transfer.id);
    await this.cdp.send("Browser.cancelDownload", { guid: transfer.id }).catch(() => undefined);
    await rm(transfer.path, { force: true }).catch(() => undefined);
    this.report(transfer, state, reason);
  }

  /** The whole file is on disk: hand it over now, or as soon as someone is watching. */
  private queueHandover(transfer: Transfer): void {
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
          // The viewer went away mid-file: keep the file and try again with the next viewer.
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

  /** Renders the tab to a PDF in the scratch directory and hands it over like a download. */
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
      const { data } = await this.cdp.send<{ data: string }>(
        "Page.printToPDF",
        { printBackground: true, preferCSSPageSize: true },
        tab.sessionId,
      );
      const bytes = Buffer.from(data, "base64");
      transfer.bytes = bytes.length;
      if (bytes.length > this.options.maxFileBytes) throw new TooLargeError();
      const file = await open(transfer.path, "w", 0o600);
      try {
        await file.write(bytes);
      } finally {
        await file.close();
      }
      this.queueHandover(transfer);
    } catch (error) {
      transfer.finished = true;
      this.transfers.delete(id);
      await rm(transfer.path, { force: true }).catch(() => undefined);
      if (error instanceof TooLargeError) {
        this.report(transfer, "too_large");
      } else {
        log("warn", "print failed", { message: error instanceof Error ? error.message : "" });
        this.report(transfer, "failed", "The page couldn’t be printed.");
      }
    }
  }

  /** The relay has resolved the chosen Drive files; their bytes follow as chunks. */
  private expectChosenFiles(chooserId: string, files: ChosenFile[]): void {
    const chooser = this.choosers.get(chooserId);
    if (!chooser) return;
    this.choosers.delete(chooserId);
    const tab = this.tabs.get(chooser.tabId);
    if (!tab || files.length === 0) return;
    mkdirSync(chooser.dir, { recursive: true, mode: 0o700 });
    const used = new Set<string>();
    for (const file of files) {
      let name = suggestedName(file.name, "file");
      // Two chosen files with one name: the second gets a suffix, as Drive would.
      for (let n = 2; used.has(name.toLowerCase()); n += 1)
        name = `${suggestedName(file.name, "file")} (${String(n)})`;
      used.add(name.toLowerCase());
      chooser.writers.set(
        file.transferId,
        new ChunkWriter(path.join(chooser.dir, name), this.options.maxFileBytes),
      );
    }
    this.choosers.set(chooserId, chooser);
    void Promise.all([...chooser.writers.values()].map((writer) => writer.done))
      .then(async () => {
        await this.cdp.send(
          "DOM.setFileInputFiles",
          {
            files: [...chooser.writers.values()].map((writer) => writer.path),
            backendNodeId: chooser.backendNodeId,
          },
          tab.sessionId,
        );
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
      url: url ?? this.options.homeUrl,
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
      error: null,
      lastNavigateError: "",
      zoom: 1,
      reader: false,
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
        this.cdp.send("Emulation.setUserAgentOverride", { userAgent: this.userAgent }, sessionId),
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
      } else if (!this.closing) {
        // The last tab went: a session always has one. (While closing, tabs go on purpose.)
        this.createTab().catch((error: unknown) => {
          log("warn", "could not open a tab", {
            message: error instanceof Error ? error.message : "",
          });
        });
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
  private async refreshTitle(tab: Tab, withHistory = true): Promise<void> {
    try {
      const { result } = await this.cdp.send<{ result: { value?: unknown } }>(
        "Runtime.evaluate",
        { expression: "document.title", returnByValue: true },
        tab.sessionId,
      );
      if (typeof result.value === "string" && result.value !== "" && result.value !== tab.title) {
        tab.title = result.value;
        this.queueSnapshot();
      }
    } catch {
      // The tab may be gone.
    }
    if (withHistory) await this.refreshHistory(tab);
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
        error: tab.error,
        zoom: tab.zoom,
        reader: tab.reader,
      }));
  }

  private async evaluate(tab: Tab, expression: string): Promise<unknown> {
    const { result } = await this.cdp.send<{ result: { value?: unknown } }>(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      tab.sessionId,
    );
    return result.value;
  }

  /** Find in page, zoom and reader view: Brawzer's tools, run inside the page. */
  private async pageTool(
    tab: Tab,
    message: Extract<RelayMessage, { type: "find" | "find-stop" | "zoom" | "reader" }>,
  ): Promise<void> {
    switch (message.type) {
      case "find": {
        const value = await this.evaluate(
          tab,
          findScript(message.text, message.forward, message.caseSensitive),
        ).catch(() => null);
        const found =
          typeof value === "string"
            ? (JSON.parse(value) as { matches: number; active: number })
            : { matches: 0, active: 0 };
        this.viewer?.send({ type: "find-result", tabId: tab.id, text: message.text, ...found });
        return;
      }
      case "find-stop":
        await this.evaluate(tab, FIND_STOP_SCRIPT).catch(() => undefined);
        return;
      case "zoom":
        tab.zoom = message.factor;
        await this.evaluate(tab, zoomScript(message.factor)).catch(() => undefined);
        this.queueSnapshot();
        return;
      case "reader": {
        if (!message.on) {
          // The page itself is gone (replaced by the reading layout): open it afresh.
          if (tab.reader) await this.cdp.send("Page.navigate", { url: tab.url }, tab.sessionId);
          return;
        }
        const value = await this.evaluate(tab, this.options.readerScript).catch(() => null);
        const ok = typeof value === "string" && (JSON.parse(value) as { ok: boolean }).ok;
        if (ok) {
          tab.reader = true;
          this.queueSnapshot();
        } else {
          this.viewer?.send({ type: "reader-unavailable", tabId: tab.id });
        }
        return;
      }
    }
  }

  /** Brawzer's own reason for a refused tunnel, when the proxy noted one for that address. */
  private explained(error: NavigationError): NavigationError {
    if (!TUNNEL_FAILURES.has(error.code)) return error;
    return { url: error.url, code: this.options.refusalFor(error.url) ?? error.code };
  }

  /** The engine's error page names its code in the document; the person never sees that page. */
  private async readErrorCode(tab: Tab): Promise<void> {
    const failed = tab.error;
    if (!failed) return;
    // The error page renders shortly after the frame commits; look a few times.
    for (let attempt = 0; attempt < 8; attempt++) {
      if (tab.error !== failed) return;
      try {
        const { result } = await this.cdp.send<{ result: { value?: unknown } }>(
          "Runtime.evaluate",
          {
            expression:
              "(document.querySelector('.error-code') || document.querySelector('#error-code'))?.textContent?.trim() || ''",
            returnByValue: true,
          },
          tab.sessionId,
        );
        if (tab.error !== failed) return;
        if (typeof result.value === "string" && result.value !== "") {
          tab.error = this.explained({ url: failed.url, code: errorCode(result.value) });
          this.queueSnapshot();
          return;
        }
      } catch {
        return; // The page moved on.
      }
      if (failed.code !== "") return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    this.queueSnapshot();
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
