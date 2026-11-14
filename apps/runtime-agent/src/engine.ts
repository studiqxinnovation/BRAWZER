import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import {
  CLIPBOARD_MAX_CHARS,
  BROWSER_PROTOCOL_VERSION,
  type ChosenFile,
  encodeFrame,
  PICTURES_KEPT,
  type RelayMessage,
  type TabSecurity,
  type TabState,
  type TransferChunkHeader,
  type TransferKind,
  type TransferMessage,
  type VideoCodec,
  type Viewport,
  type NavigationError,
  encodeVideoChunk,
} from "@brawzer/contracts";
import { BEE_VERSION } from "./bee.ts";
import type { ChromiumBrand } from "./config.ts";
import type { CdpConnection } from "./cdp.ts";
import type { Engine, EngineOptions, Viewer } from "./engine-types.ts";
import { log } from "./log.ts";
import { FocusReporter, IconReporter, PointerReporter } from "./page-reporters.ts";
import {
  FrameEncoder,
  frameSize,
  framesAreFull,
  jpegSize,
  pictureScale,
  videoSize,
} from "./video.ts";
import {
  fetchImageScript,
  FIND_STOP_SCRIPT,
  findScript,
  selectionScript,
  zoomScript,
} from "./page-tools.ts";
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
  /** A drop onto the page at a point, rather than a file chooser's answer. */
  drop?: { x: number; y: number };
}

/** Keys after which what has focus may have changed. */
const FOCUS_KEYS = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  " ",
  "Escape",
  "Home",
  "End",
]);

/** A name for a saved image: the address's last part, with an extension its type suggests. */
export function imageFilename(url: string, type?: string): string {
  let base = "image";
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    if (last)
      base =
        last
          .replace(/[\p{Cc}/\\]/gu, " ")
          .trim()
          .slice(0, 120) || "image";
  } catch {
    // Not an address worth naming after.
  }
  const extension = type
    ? {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/svg+xml": "svg",
        "image/avif": "avif",
        "image/x-icon": "ico",
      }[type]
    : undefined;
  if (extension && !/\.[a-z0-9]{2,5}$/i.test(base)) base = `${base}.${extension}`;
  return base;
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
  /** The site icon last sent for this tab, and where it came from. */
  icon: string | null;
  iconUrl: string | null;
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
/**
 * The engine's frames of the page: what the video encoder is fed while it
 * moves, and what the viewer is shown, as it is, once it stops. So good
 * enough to read from.
 */
const JPEG_QUALITY = 90;
/** A picture taken of a still page whose frames are less dense than the viewer's screen. */
const SHARP_QUALITY = 92;
/**
 * Pictures of the page go no faster than this many bytes a second: a page
 * that keeps changing a little (a blinking cursor) must not cost more than
 * one that moves.
 */
const PICTURE_BYTES_PER_SECOND = 750_000;
/** How long video stays light after the viewer's connection fell behind. */
const VIDEO_LEAN_MS = 60_000;
/** No frame for this long means the page has stopped moving. */
const STILL_MS = 300;
/**
 * A page between two documents (a navigation going through) can't be asked
 * for its frames: the engine answers "Not attached to an active page". It is
 * asked again this often, this many times.
 */
const CAST_RETRY_MS = 100;
const CAST_ATTEMPTS = 20;
/**
 * What counts as the page moving once the viewer shows a picture of it: this
 * many frames within the window. A lone frame now and then (a typed letter,
 * a blinking cursor, a clock) is shown as a picture too, instead of trading
 * the picture for video and back.
 */
const MOTION_FRAMES = 3;
const MOTION_WINDOW_MS = 700;
/**
 * The same, when the engine's frames are themselves the pictures (as dense
 * as the viewer's screen): showing one costs the engine nothing, so the page
 * stays a picture through more of them (typing, a cursor blinking meanwhile)
 * and only what really moves (scrolling, an animation, a film) becomes video.
 */
const FULL_MOTION_FRAMES = 5;
/**
 * And only while pictures keep up: once the next one would have to wait
 * longer than this for the connection's share (PICTURE_BYTES_PER_SECOND),
 * video shows the change sooner.
 */
const PICTURE_LAG_MS = 120;
/**
 * A picture waits for video of the page from before it stopped to leave the
 * encoder (a new one takes a while to start), or the viewer would be left
 * showing that video over the picture. Looked at this often, for this long.
 */
const VIDEO_DRAIN_MS = 30;
const VIDEO_DRAIN_MAX_MS = 1_500;
/** Pictures taken again for lone frames come no closer together than this. */
const SHARP_MIN_INTERVAL_MS = 1_000;
/** What follows the header when the viewer is told to show a kept picture again: nothing. */
const NO_IMAGE = new Uint8Array(0);
/** A sharp frame that takes longer than this to be drawn says the connection can't afford them. */
const SHARP_SLOW_MS = 2_500;
/** How long sharp frames pause after a slow one: a little, then longer the more slow ones in a row. */
const SHARP_BACKOFF_MS = 3_000;
const SHARP_BACKOFF_MAX_MS = 30_000;
/** In a tab's in-flight map: a sharp frame, which the engine has nothing to acknowledge for. */
const SHARP_FRAME = "";
/** A sharp frame unacknowledged for this long is given up on, so the next one isn't waited for. */
const SHARP_LOST_MS = 8_000;
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

/** What `Sec-CH-UA-*` and `navigator.userAgentData` say (CDP's UserAgentMetadata). */
export interface UserAgentMetadata {
  brands: { brand: string; version: string }[];
  fullVersionList: { brand: string; version: string }[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
}

/** The name each Chromium browser gives itself in its brand hints, beside "Chromium". */
const BRAND_NAMES: Partial<Record<ChromiumBrand, string>> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
};

/**
 * What websites are told the browser is. Running without a window is how
 * Brawzer runs it, not what it is: the "Headless" marker goes, so Chrome and
 * Edge read as the browsers they are, Chromium as Chromium, and Bee as
 * Chromium with its own name after. Brand hints match, as the browser would
 * send them with a window.
 */
export function browserIdentity(
  version: { product: string; userAgent: string },
  brand: ChromiumBrand,
  arch: string = process.arch,
): { userAgent: string; metadata: UserAgentMetadata | null } {
  const base = version.userAgent
    .replace("HeadlessChrome/", "Chrome/")
    .replace("HeadlessEdg/", "Edg/");
  const full = /\/([\d.]+)$/.exec(version.product)?.[1];
  const userAgent =
    brand === "bee"
      ? `${base} Bee/${BEE_VERSION}`
      : brand === "edge" && !base.includes(" Edg/") && full
        ? `${base} Edg/${full}`
        : base;
  const major = full?.split(".")[0];
  if (!full || !major) return { userAgent, metadata: null };
  const own = BRAND_NAMES[brand];
  const named = (versionOf: (v: string) => string) => [
    ...(own ? [{ brand: own, version: versionOf(full) }] : []),
    { brand: "Chromium", version: versionOf(full) },
    { brand: "Not_A Brand", version: versionOf("24.0.0.0") },
  ];
  return {
    userAgent,
    metadata: {
      brands: named((v) => v.split(".")[0] ?? v),
      fullVersionList: named((v) => v),
      fullVersion: full,
      platform: "Linux",
      platformVersion: "",
      architecture: arch === "arm64" || arch === "arm" ? "arm" : "x86",
      model: "",
      mobile: false,
      bitness: arch === "arm" || arch === "ia32" ? "32" : "64",
    },
  };
}

/** The engine's own UI surfaces (omnibox popups and the like) are never tabs. */
const isInternal = (url: string) =>
  /^(chrome|edge|devtools|chrome-untrusted|chrome-extension|chrome-search|extension):/.test(url);

/** The browser's own pages a profile with its account on may see as tabs (ADR 0021). */
const ACCOUNT_PAGES = /^(chrome:\/\/(password-manager|settings)|edge:\/\/(wallet|settings))(\/|$)/;

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
  private readonly pointer = new PointerReporter<Tab>(
    (tab, expression) => this.evaluate(tab, expression),
    (message) => this.viewer?.send(message),
    (tab) => this.viewer !== null && tab.id === this.activeId && this.tabs.has(tab.id),
  );
  private readonly icons = new IconReporter<Tab>(
    (tab, expression) => this.evaluate(tab, expression),
    (url) => this.options.fetchIcon(url),
    (message) => this.viewer?.send(message),
  );
  private readonly focus = new FocusReporter<Tab>(
    (tab, expression) => this.evaluate(tab, expression),
    (message) => this.viewer?.send(message),
    (tab) => this.viewer !== null && tab.id === this.activeId && this.tabs.has(tab.id),
  );
  /** The moving page as video, when the viewer decodes it and the container can encode it. */
  private encoder: FrameEncoder | null = null;
  private videoSeq = 0;
  /** After a dropped chunk, nothing goes until the next key frame: the viewer couldn't use it. */
  private videoNeedsKey = false;
  /** Until then the moving page is sent light: the viewer's connection fell behind. */
  private videoLeanUntil = 0;
  private viewerCodecs: readonly string[] = [];
  /** Counts down from the last frame of a moving page to its picture. */
  private stillTimer: NodeJS.Timeout | null = null;
  /** The page's latest frame: shown as it is once the page stops, and what the next is told from. */
  private lastFrame: Buffer | null = null;
  /** Whether the viewer keeps pictures to show again, and the ones it holds: the newest sent, in order. */
  private viewerRepeats = false;
  private kept: { frameId: number; frame: Buffer }[] = [];
  /** No picture goes to the viewer before this: the last one's size, paid for in time. */
  private pictureNotBefore = 0;
  /** The picture on its way to the viewer, until it reports it drawn. */
  private sharpInFlight: { tabId: string; frameId: number; sentAt: number } | null = null;
  /** Whether the page showing now has had its picture. */
  private sharpDone = false;
  /** A picture is what the viewer shows: a lone frame becomes one too, rather than video. */
  private sharpHold = false;
  private sharpSentAt = 0;
  /** When the encoder was last given a frame. */
  private videoPushedAt = 0;
  /** When the last few screencast frames arrived, to tell sustained movement from a lone frame. */
  private frameTimes: number[] = [];
  /**
   * The engine's frames are asked for at the page's own size: the page is
   * moving, and frames as dense as the viewer's screen would slow it down.
   */
  private reduced = false;
  /** Between stopping the frames at one size and starting them at the other: what arrives is neither. */
  private recasting = false;
  /** Counts each stop of the frames, so a change of size knows when it was overtaken. */
  private castTurn = 0;
  /** Until when sharp frames are skipped because the last one was slow to arrive, and how many were. */
  private sharpBackoffUntil = 0;
  private sharpSlowCount = 0;
  private userAgent = "";
  private userAgentMetadata: UserAgentMetadata | null = null;
  private readonly loadedExtensions: string[] = [];

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
      void this.icons.refresh(tab);
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
    // Bee is Brawzer's own browser: it says so, after what it is built on. Chrome is as Google ships it.
    const identity = browserIdentity(version, this.options.brand ?? "bee");
    this.userAgent = identity.userAgent;
    this.userAgentMetadata = identity.metadata;
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
    await this.installAndTidy();
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
        await this.cdp.send("Target.closeTarget", { targetId: id }).catch(() => undefined);
      }
    }
    const first = [...before].find((id) => this.tabs.has(id));
    if (first && this.activeId !== first) await this.activate(first);
  }

  attachViewer(
    viewer: Viewer,
    viewport: Viewport,
    codecs: readonly VideoCodec[],
    repeats = false,
  ): void {
    this.viewer = viewer;
    this.viewerCodecs = codecs;
    this.viewerRepeats = repeats;
    this.stopVideo();
    // A new viewer has seen nothing yet, whatever the last one was shown.
    this.kept = [];
    this.lastFrame = null;
    this.sharpDone = false;
    this.sharpHold = false;
    void this.setViewport(viewport).then(() => {
      if (this.viewer !== viewer) return;
      viewer.send({
        type: "welcome",
        protocol: BROWSER_PROTOCOL_VERSION,
        engine: { name: this.options.brand ?? "bee", version: this.version.slice(0, 64) },
        tabs: this.snapshot(),
        activeTabId: this.activeId ?? this.order[0] ?? "",
        extensions: this.loadedExtensions,
      });
      void this.syncScreencasts();
      void this.handOver();
      this.pointer.reset();
      this.focus.reset();
      this.icons.resend(this.tabs.values());
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
    this.clearStill();
    this.pointer.reset();
    this.stopVideo();
    void this.syncScreencasts();
  }

  // ── Video: the moving page encoded, the still page a picture ──────────

  private get videoWanted(): boolean {
    return this.options.video && this.viewerCodecs.includes("vp8");
  }

  /** The encoder for the page's current size, started as needed; a new size gets a new one. */
  private videoEncoder(): FrameEncoder | null {
    if (!this.videoWanted) return null;
    const lean = Date.now() < this.videoLeanUntil;
    const { width, height } = videoSize(this.viewport);
    if (
      this.encoder &&
      (this.encoder.width !== width || this.encoder.height !== height || this.encoder.lean !== lean)
    ) {
      this.stopVideo();
    }
    if (!this.encoder) {
      const encoder = new FrameEncoder(
        width,
        height,
        (frame) => {
          if (this.encoder !== encoder) return;
          this.sendVideo(frame.key, frame.data);
        },
        lean,
      );
      encoder.start();
      this.encoder = encoder;
      this.videoNeedsKey = true;
    }
    return this.encoder;
  }

  private sendVideo(key: boolean, data: Buffer): void {
    const viewer = this.viewer;
    if (!viewer) return;
    if (this.videoNeedsKey && !key) return;
    const { width, height } = this.viewport;
    const sent = viewer.sendVideo(
      encodeVideoChunk({ seq: this.videoSeq, codec: "vp8", key, width, height }, data),
    );
    this.videoSeq = (this.videoSeq + 1) % 1_000_000_000;
    if (sent && this.sharpDone) {
      // It left the encoder after the page's picture went out, and covers it:
      // the picture is shown again (the viewer still holds it).
      this.sharpDone = false;
      this.armStill(0);
    }
    // The viewer couldn't take it: the frames that follow build on it, so they wait for a key.
    this.videoNeedsKey = !sent;
    if (!sent) this.goLean("a video frame could not be sent");
  }

  /** The viewer's connection fell behind: the moving page is sent light for a while. */
  private goLean(reason: string): void {
    if (Date.now() >= this.videoLeanUntil) log("info", "video goes light for a while", { reason });
    this.videoLeanUntil = Date.now() + VIDEO_LEAN_MS;
  }

  private stopVideo(): void {
    this.encoder?.stop();
    this.encoder = null;
    this.videoNeedsKey = true;
  }

  /** Everything the viewer may ask for. Invalid tab ids are ignored, never fatal. */
  async handle(message: RelayMessage): Promise<void> {
    switch (message.type) {
      case "hello":
      case "ping":
      case "sound":
        return;
      case "video-lost":
        // A fresh encoder begins with a key frame.
        this.stopVideo();
        return;
      case "picture-lost":
        // What the viewer was to show again never reached it: the picture itself, then.
        this.kept = [];
        this.sharpDone = false;
        this.armStill(0);
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
        if (message.kind === "move" || message.kind === "up") {
          this.pointer.report(tab, message.x, message.y);
        }
        if (message.kind === "up") this.focus.report(tab);
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
        if (message.kind === "up" && FOCUS_KEYS.has(message.key)) this.focus.report(tab);
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
        if (screencastSession === SHARP_FRAME) this.sharpDrawn(message.frameId);
        else await this.ack(tab, screencastSession);
        // The page may have stopped while the viewer was catching up; a lone
        // frame that came while a picture was on its way is shown next.
        if (tab.inFlight.size === 0) {
          this.armStill(this.sharpHold && this.framesFull ? 0 : STILL_MS);
        }
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
      case "drop": {
        // The relay has resolved the dropped Drive files; their bytes follow as chunks.
        const chooser: Chooser = {
          id: message.dropId,
          tabId: tab.id,
          backendNodeId: 0,
          dir: path.join(this.options.uploadDir, message.dropId),
          writers: new Map(),
          drop: { x: message.x, y: message.y },
        };
        this.choosers.set(chooser.id, chooser);
        this.expectChosenFiles(chooser.id, message.files);
        return;
      }
      case "save-image":
        await this.saveImage(tab, message.url);
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
    this.clearStill();
    this.pointer.reset();
    this.stopVideo();
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

  /**
   * Saves a page's image to Drive: fetched by the page itself where it may
   * (its cookies apply), else through the session's proxy, written to the
   * scratch directory and handed over like a download.
   */
  private async saveImage(tab: Tab, url: string): Promise<void> {
    const id = `image-${randomUUID()}`;
    const transfer: Transfer = {
      id,
      tabId: tab.id,
      kind: "download",
      filename: imageFilename(url),
      path: path.join(this.options.downloadDir, id),
      bytes: 0,
      finished: false,
    };
    this.transfers.set(id, transfer);
    this.report(transfer, "started");
    try {
      let image: { type: string; bytes: Buffer } | null = null;
      const inPage = await this.evaluate(
        tab,
        fetchImageScript(url, this.options.maxFileBytes),
      ).catch(() => null);
      if (typeof inPage === "string") {
        const parsed = JSON.parse(inPage) as { type?: unknown; data?: unknown };
        if (typeof parsed.type === "string" && typeof parsed.data === "string") {
          image = { type: parsed.type, bytes: Buffer.from(parsed.data, "base64") };
        }
      }
      image ??= await this.options.fetchImage(url, this.options.maxFileBytes);
      if (!image) throw new Error("not an image");
      transfer.filename = imageFilename(url, image.type);
      transfer.bytes = image.bytes.length;
      const file = await open(transfer.path, "w", 0o600);
      try {
        await file.write(image.bytes);
      } finally {
        await file.close();
      }
      this.queueHandover(transfer);
    } catch (error) {
      transfer.finished = true;
      this.transfers.delete(id);
      await rm(transfer.path, { force: true }).catch(() => undefined);
      log("warn", "save image failed", { message: error instanceof Error ? error.message : "" });
      this.report(transfer, "failed", "The image couldn’t be read.");
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
        const paths = [...chooser.writers.values()].map((writer) => writer.path);
        if (chooser.drop) {
          // As a drag from the computer's own desktop would arrive: enter, over, drop.
          const data = { items: [], files: paths, dragOperationsMask: 1 };
          const { x, y } = chooser.drop;
          for (const type of ["dragEnter", "dragOver", "drop"] as const) {
            await this.cdp.send("Input.dispatchDragEvent", { type, x, y, data }, tab.sessionId);
          }
          log("info", "files dropped on the page", { files: paths.length });
          return;
        }
        await this.cdp.send(
          "DOM.setFileInputFiles",
          { files: paths, backendNodeId: chooser.backendNodeId },
          tab.sessionId,
        );
        log("info", "file chooser answered", { files: chooser.writers.size });
      })
      .catch((error: unknown) => {
        log("warn", chooser.drop ? "drop failed" : "file chooser failed", {
          message: error instanceof Error ? error.message : "",
        });
        this.viewer?.send({
          type: "refused",
          tabId: tab.id,
          action: chooser.drop ? "drop" : "upload",
        });
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
    const accountPage = Boolean(this.options.browserPages) && ACCOUNT_PAGES.test(info.url);
    if (info.type !== "page" || (isInternal(info.url) && !accountPage)) return;
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
      icon: null,
      iconUrl: null,
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
          "Emulation.setUserAgentOverride",
          {
            userAgent: this.userAgent,
            ...(this.userAgentMetadata ? { userAgentMetadata: this.userAgentMetadata } : {}),
          },
          sessionId,
        ),
        this.cdp.send(
          "Emulation.setDeviceMetricsOverride",
          {
            width: this.viewport.width,
            height: this.viewport.height,
            deviceScaleFactor: this.viewport.scale,
            mobile: false,
          },
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

  /** The catalogue builds chosen for this session, loaded unpacked over the pipe (ADR 0018). */
  private async installExtensions(): Promise<void> {
    for (const extension of this.options.extensions) {
      try {
        await this.cdp.send("Extensions.loadUnpacked", { path: extension.path });
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
      viewport.width !== this.viewport.width ||
      viewport.height !== this.viewport.height ||
      viewport.scale !== this.viewport.scale;
    this.viewport = viewport;
    if (!changed) return;
    this.sharpDone = false;
    this.sharpHold = false;
    await Promise.all(
      [...this.tabs.values()].map((tab) =>
        this.cdp
          .send(
            "Emulation.setDeviceMetricsOverride",
            {
              width: viewport.width,
              height: viewport.height,
              // The page is laid out and painted at the viewer's own pixel
              // ratio: its picture is taken as painted. While it moves its
              // frames are asked for at its own size instead (see recast).
              deviceScaleFactor: viewport.scale,
              mobile: false,
            },
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
        await this.startCast(tab);
      } else if (!wanted && tab.screencasting) {
        await this.stopScreencast(tab);
      }
    }
  }

  /**
   * Asks a tab for its frames. For a viewer that takes video, at its own
   * pixel ratio while the page is still or changes a little (each frame is
   * then its picture), and at the page's own size while it moves (the
   * encoder's). As pictures only (it can't decode video), at the page's size.
   */
  private async startCast(tab: Tab): Promise<void> {
    const turn = this.castTurn;
    for (let attempt = 0; attempt < CAST_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, CAST_RETRY_MS));
        // Stopped, or asked for at another size, meanwhile.
        if (turn !== this.castTurn || !this.tabs.has(tab.id)) return;
      }
      const cast = this.videoWanted && !this.reduced ? frameSize(this.viewport) : this.viewport;
      const started = await this.cdp
        .send(
          "Page.startScreencast",
          {
            format: "jpeg",
            quality: JPEG_QUALITY,
            maxWidth: cast.width,
            maxHeight: cast.height,
            everyNthFrame: 1,
          },
          tab.sessionId,
        )
        .then(
          () => true,
          () => false,
        );
      if (started) return;
      // Whatever kept them from starting, frames of another size are not left running.
      await this.cdp.send("Page.stopScreencast", {}, tab.sessionId).catch(() => undefined);
    }
    if (turn === this.castTurn) tab.screencasting = false;
  }

  /**
   * Changes the size the active tab's frames come at: the page's own once it
   * moves, the viewer's pixel ratio again once it stops. The engine fixes
   * the size when the frames start, so they are stopped and started; it
   * sends one at once, which for a page that stopped is its picture.
   */
  private async recast(reduced: boolean): Promise<void> {
    const tab = this.activeTab();
    if (this.reduced === reduced || this.recasting || !tab?.screencasting) return;
    const turn = ++this.castTurn;
    this.reduced = reduced;
    this.recasting = true;
    await this.cdp.send("Page.stopScreencast", {}, tab.sessionId).catch(() => undefined);
    if (turn !== this.castTurn) return;
    this.recasting = false;
    if (!reduced) {
      this.lastFrame = null;
      this.frameTimes = [];
      this.sharpHold = true;
      // Should the engine send no frame, a picture is taken instead.
      this.armStill();
    }
    await this.startCast(tab);
  }

  private async stopScreencast(tab: Tab): Promise<void> {
    tab.screencasting = false;
    this.castTurn += 1;
    this.reduced = false;
    this.recasting = false;
    tab.inFlight.clear();
    if (this.sharpInFlight?.tabId === tab.id) this.sharpInFlight = null;
    this.sharpHold = false;
    this.frameTimes = [];
    this.lastFrame = null;
    this.clearStill();
    await this.cdp.send("Page.stopScreencast", {}, tab.sessionId).catch(() => undefined);
  }

  // ── The still page: a picture at the viewer's pixel ratio once it stops ──

  /**
   * Whether the engine's frames are as dense as the viewer's screen. Then the
   * last frame of a page that stopped is its picture, there at once and
   * costing the engine nothing; otherwise one is taken of it.
   */
  private get framesFull(): boolean {
    return (
      this.videoWanted &&
      !this.reduced &&
      framesAreFull(this.viewport, this.options.engineScale ?? 1)
    );
  }

  private clearStill(): void {
    if (this.stillTimer) clearTimeout(this.stillTimer);
    this.stillTimer = null;
  }

  /** (Re)starts the count to the page's picture; a new frame of a moving page starts it over. */
  private armStill(delayMs = STILL_MS): void {
    this.clearStill();
    if (this.sharpDone || !this.viewer) return;
    const full = this.framesFull;
    if (!full && this.viewport.scale <= 1) return;
    if (this.sharpInFlight && Date.now() - this.sharpInFlight.sentAt > SHARP_LOST_MS) {
      this.sharpInFlight = null;
    }
    // A connection that was slow with the last picture gets the next after its pause.
    const wait = Math.max(delayMs, this.sharpBackoffUntil - Date.now());
    this.stillTimer = setTimeout(() => {
      this.stillTimer = null;
      // The frames are changing size just now: looked at again once they have.
      if (this.recasting) this.armStill();
      // A page that was moving stopped: its frames at the viewer's pixel ratio again.
      else if (this.reduced) void this.recast(false);
      else if (full) this.sendStill();
      else void this.sendSharp();
    }, wait);
  }

  /**
   * Whether the still page in front wants its picture now. The viewer
   * drawing what it was sent comes first; its acknowledgement arms the count
   * again.
   */
  private sharpWanted(viewer: Viewer, tab: Tab, taken = false): boolean {
    return (
      this.viewer === viewer &&
      tab.id === this.activeId &&
      tab.screencasting &&
      tab.inFlight.size === 0 &&
      !this.sharpDone &&
      this.sharpInFlight === null &&
      // Once the picture is taken, a lone frame's new count doesn't undo it.
      (taken || this.stillTimer === null) &&
      Date.now() >= this.sharpBackoffUntil
    );
  }

  /** Whether video of the page from before it stopped is still on its way out of the encoder. */
  private get videoDraining(): boolean {
    return (this.encoder?.busy ?? false) && Date.now() - this.videoPushedAt < VIDEO_DRAIN_MAX_MS;
  }

  /** Enough frames close together: the page is moving, not blinking a cursor. */
  private get moving(): boolean {
    const now = Date.now();
    return this.frameTimes.filter((at) => now - at < MOTION_WINDOW_MS).length >= MOTION_FRAMES;
  }

  /** The page stopped, or changed a little under its picture: its latest frame is the picture. */
  private sendStill(): void {
    const viewer = this.viewer;
    const tab = this.activeTab();
    const frame = this.lastFrame;
    if (!viewer || !tab) return;
    if (this.videoDraining) {
      this.armStill(VIDEO_DRAIN_MS);
      return;
    }
    if (!frame) {
      // The engine sent no frame of the page as it is: a picture is taken of it.
      void this.sendSharp();
      return;
    }
    if (!this.sharpWanted(viewer, tab)) return;
    const wait = this.pictureNotBefore - Date.now();
    if (wait > 0) {
      this.armStill(wait);
      return;
    }
    const size = jpegSize(frame) ?? frameSize(this.viewport);
    const frameId = ++this.frameCounter;
    // A page that looks as it did a moment ago (a cursor blinking on and off)
    // isn't sent again: the viewer is told which picture it kept to show.
    const again = this.viewerRepeats ? this.kept.find((kept) => kept.frame.equals(frame)) : null;
    const bytes = encodeFrame(
      {
        tabId: tab.id,
        frameId,
        width: size.width,
        height: size.height,
        scale: pictureScale(size, this.viewport),
        ...(again ? { again: again.frameId } : this.viewerRepeats ? { keep: true } : {}),
      },
      again ? NO_IMAGE : frame,
    );
    if (!viewer.sendFrame(bytes)) {
      // The connection can't take it now; the page is still, so it is tried again.
      this.armStill();
      return;
    }
    if (!again && this.viewerRepeats) {
      this.kept.push({ frameId, frame });
      if (this.kept.length > PICTURES_KEPT) this.kept.shift();
    }
    this.pictureSent(tab, frameId, again ? 0 : frame.length);
  }

  private pictureSent(tab: Tab, frameId: number, bytes: number): void {
    const now = Date.now();
    tab.inFlight.set(frameId, SHARP_FRAME);
    this.sharpInFlight = { tabId: tab.id, frameId, sentAt: now };
    this.sharpDone = true;
    this.sharpHold = true;
    this.sharpSentAt = now;
    this.pictureNotBefore = now + (bytes / PICTURE_BYTES_PER_SECOND) * 1_000;
  }

  /** The same, for frames less dense than the viewer's screen: a picture is taken at its pixel ratio. */
  private async sendSharp(): Promise<void> {
    const viewer = this.viewer;
    const tab = this.activeTab();
    if (!viewer || !tab || !this.sharpWanted(viewer, tab)) return;
    if (this.videoDraining) {
      this.armStill(VIDEO_DRAIN_MS);
      return;
    }
    const { width, height, scale } = this.viewport;
    let shot: { data: string };
    try {
      shot = await this.cdp.send<{ data: string }>(
        "Page.captureScreenshot",
        { format: "jpeg", quality: SHARP_QUALITY, optimizeForSpeed: true },
        tab.sessionId,
      );
    } catch {
      // The engine was busy: try again once the page has been still a while longer.
      this.armStill();
      return;
    }
    // A page that began to move meanwhile has sent frames of its own and counts
    // down again. A lone frame (a blinking cursor) does not spoil the picture:
    // on a slow host one always lands while the picture is being taken, and
    // the page would never get its sharp picture at all.
    if (this.moving || !this.sharpWanted(viewer, tab, true)) return;
    this.clearStill();
    const frameId = ++this.frameCounter;
    const picture = Buffer.from(shot.data, "base64");
    const bytes = encodeFrame(
      {
        tabId: tab.id,
        frameId,
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        scale,
      },
      picture,
    );
    if (!viewer.sendFrame(bytes)) {
      // The connection can't take it now; the page is still, so it is tried again.
      this.armStill();
      return;
    }
    this.pictureSent(tab, frameId, picture.length);
  }

  private sharpDrawn(frameId: number): void {
    const sharp = this.sharpInFlight;
    if (sharp?.frameId !== frameId) return;
    this.sharpInFlight = null;
    const took = Date.now() - sharp.sentAt;
    if (took > SHARP_SLOW_MS) {
      this.sharpSlowCount += 1;
      const pause = Math.min(
        SHARP_BACKOFF_MAX_MS,
        SHARP_BACKOFF_MS * 2 ** (this.sharpSlowCount - 1),
      );
      this.sharpBackoffUntil = Date.now() + pause;
      this.goLean("a sharp frame was slow to arrive");
      log("info", "sharp frame was slow to arrive; pausing them", { ms: took, pause });
    } else {
      this.sharpSlowCount = 0;
    }
  }

  private frameArrived(tab: Tab, frame: { data: string; sessionId: string }): void {
    const viewer = this.viewer;
    if (!viewer || tab.id !== this.activeId || !tab.screencasting) {
      void this.ack(tab, frame.sessionId);
      return;
    }
    if (this.recasting) {
      // The frames are changing size: this one is of the size being left.
      void this.ack(tab, frame.sessionId);
      return;
    }
    const image = Buffer.from(frame.data, "base64");
    if (this.lastFrame?.equals(image)) {
      // The engine drew again and nothing changed (taking a picture makes it):
      // there is nothing new to show, and it is no sign of the page moving.
      void this.ack(tab, frame.sessionId);
      return;
    }
    this.lastFrame = image;
    // The page changed: its picture, if it had one, is out of date.
    this.sharpDone = false;
    const now = Date.now();
    this.frameTimes = this.frameTimes.filter((at) => now - at < MOTION_WINDOW_MS);
    this.frameTimes.push(now);
    const full = this.framesFull;
    // A frame by itself is a picture whatever it weighs (it waits its turn);
    // a few close together are, while the pictures' share of the link keeps up.
    const lone = full
      ? this.frameTimes.length === 1 ||
        (this.frameTimes.length < FULL_MOTION_FRAMES &&
          this.pictureNotBefore - now <= PICTURE_LAG_MS)
      : this.viewport.scale > 1 && this.frameTimes.length < MOTION_FRAMES;
    if ((this.sharpHold || full) && lone && now >= this.sharpBackoffUntil) {
      // A lone frame (a page's first, a typed letter, a blinking cursor, a
      // clock tick): the viewer gets or keeps a picture rather than video and
      // then a picture, over and over. The frame itself when it is as dense
      // as the viewer's screen, at once; otherwise, while a picture is up, a
      // fresh one, shortly.
      void this.ack(tab, frame.sessionId);
      this.armStill(full ? 0 : Math.max(STILL_MS, this.sharpSentAt + SHARP_MIN_INTERVAL_MS - now));
      return;
    }
    this.sharpHold = false;
    // The page is moving: from here its frames come at its own size, which
    // the engine and the encoder keep up with.
    if (full && this.viewport.scale > 1) void this.recast(true);
    const encoder = this.videoEncoder();
    if (encoder) {
      // As video: the encoder takes the picture (or skips it when behind) and the
      // engine is freed at once; the viewer never acknowledges video.
      if (encoder.push(image)) this.videoPushedAt = now;
      void this.ack(tab, frame.sessionId);
      this.armStill();
      return;
    }
    const frameId = ++this.frameCounter;
    const bytes = encodeFrame(
      {
        tabId: tab.id,
        frameId,
        width: this.viewport.width,
        height: this.viewport.height,
        scale: 1,
      },
      image,
    );
    if (viewer.sendFrame(bytes)) {
      tab.inFlight.set(frameId, frame.sessionId);
    } else {
      // Dropped (the viewer's connection is behind): free the engine to draw the next one.
      void this.ack(tab, frame.sessionId);
    }
    this.armStill();
  }

  private async ack(tab: Tab, screencastSession: string): Promise<void> {
    await this.cdp
      .send("Page.screencastFrameAck", { sessionId: screencastSession }, tab.sessionId)
      .catch(() => undefined);
  }
}
