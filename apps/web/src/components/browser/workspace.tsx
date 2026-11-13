"use client";

import {
  BROWSER_LIMITS,
  CLIPBOARD_MAX_CHARS,
  type AgentMessage,
  type Bookmark,
  type BrowserEngine,
  type BrowserOverview,
  type BrowserSession,
  type ClientMessageInput,
  engineDetails,
  type CursorKind,
  type FrameHeader,
  MAX_CHOSEN_FILES,
  type Profile,
  type RefusedAction,
  STREAM_CLOSE_CODES,
  type TabState,
  type TransferMessage,
  type VideoCodec,
  type Viewport,
  type WebApp,
} from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Spinner } from "@brawzer/ui/components/spinner";
import { useToast } from "@brawzer/ui/components/toast";
import {
  type SubmitEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  endBrowserSession,
  fetchBrowserOverview,
  handOffBrowserSession,
  requestStreamTicket,
  startBrowserSession,
} from "@/lib/api/browser";
import { addBookmark, fetchBookmarks, removeBookmark } from "@/lib/api/history";
import { uploadDriveFile } from "@/lib/api/drive";
import { displayUrl, hostOf, resolveTyped, searchUrl } from "@/lib/browser/input";
import { nextZoom } from "@/lib/browser/zoom";
import { encodeCanvas, screenshotName } from "@/lib/browser/picture";
import { AudioPlayer } from "@/lib/browser/audio";
import { BrowserStream, describeClose, type StreamEvent } from "@/lib/browser/stream";
import { detectVideoCodecs, VideoPlayer } from "@/lib/browser/video";
import { leaveSignedInArea, onSessionMessage } from "@/lib/session-channel";
import {
  ContextMenuHost,
  type MenuEntry,
  openContextMenu,
} from "@/components/desktop/context-menu";
import { driveFolder } from "@/components/desktop/apps/drive-save";
import {
  type BrowserOpen,
  parseDesktopRequest,
  postToDesktop,
  useDesktop,
} from "@/components/desktop/desktop-context";
import { desktopActive, subscribeToDesktop } from "@/lib/desktop";
import { readDesktopPrefs, subscribeToDesktopPrefs } from "@/lib/desktop-prefs";
import { isLocked, subscribeToLock } from "@/lib/lock";
import { examAllows } from "@/lib/exam";
import {
  AddressBar,
  BookmarkStar,
  canBookmark,
  DownloadsButton,
  FindBar,
  IsolatedBadge,
  isStartPage,
  MoreMenu,
  NavButtons,
  NavigationErrorPage,
  ProfileChip,
  type RecentTransfer,
  StatusBar,
  TabStrip,
} from "./chrome";
import {
  ConfirmCopyDialog,
  EndSessionDialog,
  HandOffDialog,
  PageDialog,
  type PageDialogState,
  ShortcutsDialog,
} from "./dialogs";
import { type ChooserRequest, DrivePicker } from "./drive-picker";
import { ReportPageDialog, type ReportTarget } from "./report-dialog";
import { HistoryPanel } from "./history-panel";
import { PasswordsDialog } from "./passwords-dialog";
import { type LaunchChoice, Launcher } from "./launcher";
import { SessionSwitcher } from "./session-switcher";
import { BrowserViewport, type Shortcut, type ViewportHandle } from "./viewport";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  /** `again`: coming back to a session this window was already showing. */
  | { kind: "connecting"; session: BrowserSession; again?: boolean }
  | { kind: "live"; session: BrowserSession }
  | { kind: "ended"; message: string }
  /**
   * This window couldn't get its stream back, which says nothing about the
   * session: it runs on in the cloud, and the window can try again.
   */
  | { kind: "lost"; session: BrowserSession; message: string }
  /** Another window or tab took the stream; the session runs on there. */
  | { kind: "elsewhere"; session: BrowserSession }
  /** The sign-in is locked: the stream stopped, and comes back on unlocking. */
  | { kind: "locked"; session: BrowserSession };

const REFUSALS: Record<RefusedAction, { title: string; description: string }> = {
  download: {
    title: "Download refused",
    description: "The page started too many downloads at once.",
  },
  upload: {
    title: "The page didn’t get a file",
    description: "The cloud browser can’t reach this computer’s files, and Drive couldn’t answer.",
  },
  print: {
    title: "Printing isn’t available",
    description: "Use “Save as PDF” to keep a page in Drive.",
  },
  "blocked-url": {
    title: "Address blocked",
    description: "The cloud browser only opens public websites.",
  },
  drop: {
    title: "The page didn’t get the file",
    description:
      "Firefox can’t take a drop from Brawzer; use the page’s own upload button, which opens Drive.",
  },
  "save-image": {
    title: "The image couldn’t be saved",
    description: "The page wouldn’t let it be read.",
  },
};

/** Streams that open and drop again in a row before the window stops trying on its own. */
const RECONNECT_ATTEMPTS = 5;
/**
 * How long a window keeps asking for its stream while Brawzer's service
 * doesn't answer: longer than the service takes to restart for an update,
 * so a session in the cloud is back in its window without anyone's help.
 */
const RECONNECT_WINDOW_MS = 90_000;
/** How often the tab in front has its preview picture refreshed, if it has drawn since. */
const PREVIEW_INTERVAL_MS = 4_000;
const PREVIEW_WIDTH = 288;

/** Drops the entries for tabs that are gone; the same map when nothing changed. */
function prune<V>(map: ReadonlyMap<string, V>, keep: ReadonlySet<string>): ReadonlyMap<string, V> {
  if ([...map.keys()].every((id) => keep.has(id))) return map;
  return new Map([...map].filter(([id]) => keep.has(id)));
}

/** A small JPEG of the canvas, for a tab's hover preview; null if it can't be made. */
function previewOf(canvas: HTMLCanvasElement): string | null {
  if (canvas.width === 0 || canvas.height === 0) return null;
  const small = document.createElement("canvas");
  small.width = PREVIEW_WIDTH;
  small.height = Math.max(1, Math.round((canvas.height / canvas.width) * PREVIEW_WIDTH));
  const context = small.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, small.width, small.height);
  try {
    return small.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

/** What to tell the person about a file on its way to Drive. Quiet states return null. */
function describeTransfer(
  message: TransferMessage,
): { title: string; description?: string; type: "info" | "success" | "error" } | null {
  const what = message.kind === "print" ? "page" : "download";
  switch (message.state) {
    case "started":
      return message.kind === "print"
        ? { title: `Saving “${message.filename}” to Drive…`, type: "info" }
        : { title: `Downloading “${message.filename}” to Drive…`, type: "info" };
    case "received":
      return null;
    case "saved":
      return {
        title: `“${message.filename}” is in Drive`,
        description: "In the Downloads folder, scanned and encrypted.",
        type: "success",
      };
    case "quarantined":
      return {
        title: `“${message.filename}” was quarantined`,
        description: `The malware scan found ${message.reason ?? "a threat"}. It is in Drive, but can’t be opened or saved to a computer.`,
        type: "error",
      };
    case "too_large":
      return {
        title: `“${message.filename}” wasn’t saved`,
        description: `The ${what} is larger than Drive’s per-file limit.`,
        type: "error",
      };
    case "canceled":
      return {
        title: `“${message.filename}” was cancelled`,
        description: "The page or the cloud browser gave up on it.",
        type: "error",
      };
    case "failed":
      return {
        title: `“${message.filename}” wasn’t saved`,
        description: message.reason ?? "Drive couldn’t take it.",
        type: "error",
      };
  }
}

const coarseQuery = () => window.matchMedia("(pointer: coarse)");
const isCoarsePointer = () => coarseQuery().matches;
function subscribeCoarsePointer(onChange: () => void): () => void {
  const media = coarseQuery();
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

function remainingLabel(expiresAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 60_000));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
  }
  return `${String(minutes)} min`;
}

/**
 * The Browser page: Brawzer's own tabs, address bar and controls around the
 * streamed page. The session lives in Brawzer's cloud; this component only
 * ever holds pixels and the state needed to draw the chrome.
 */
export function BrowserWorkspace({
  initial,
  profiles: loadedProfiles,
  proxies,
  mode = "page",
  embedded = false,
  app,
  openOnStart,
  select = { session: null, launcher: false },
}: {
  /** What to open once the stream is up: a site in a new tab, or the browser's own passwords or account page. */
  openOnStart?: BrowserOpen;
  /** The web app this window is: drawn as an app, its name where the address bar would be, no tabs. */
  app?: WebApp;
  /** "window": the pop-out, with nothing around it but the browser's own chrome. */
  mode?: "page" | "window";
  /** A window on Brawzer's desktop (framed): the desktop switches and closes browsers. */
  embedded?: boolean;
  initial: BrowserOverview;
  profiles: readonly Profile[];
  /** The account's saved proxies, for naming the one a session uses. */
  proxies: readonly { id: string; name: string; protocol: string }[];
  /** Which open browser to show (`?session=`), or the launcher (`?new=1`); else the newest. */
  select?: { session: string | null; launcher: boolean };
}) {
  const toast = useToast();
  const desktop = useDesktop();
  const desktopOn = useSyncExternalStore(subscribeToDesktop, desktopActive, () => false);
  const onDesktop = mode === "page" && desktop !== null && desktopOn;
  /** The launcher reads what's open when it mounts; a new key reads it again. */
  const [launcherVersion, setLauncherVersion] = useState(0);
  // The page's profiles, and any the launcher makes for a browser while this page is open.
  const [profiles, setProfiles] = useState(loadedProfiles);
  const base = mode === "window" ? "/app/browser/window" : "/app/browser";
  const sessionHref = (id: string) => `${base}?${new URLSearchParams({ session: id }).toString()}`;
  const launcherHref = `${base}?new=1`;
  const attachTo = select.launcher
    ? null
    : select.session
      ? (initial.sessions.find((candidate) => candidate.id === select.session) ?? null)
      : initial.session;
  const [phase, setPhase] = useState<Phase>(
    attachTo?.status === "running"
      ? { kind: "connecting", session: attachTo }
      : attachTo?.status === "starting"
        ? { kind: "starting" }
        : { kind: "idle" },
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [engine, setEngine] = useState("");
  /** The engine's name as notifications say it, read outside React's render cycle. */
  const engineRef = useRef("");
  useEffect(() => {
    engineRef.current = engine.split(" · ")[0] ?? "";
  }, [engine]);
  const [dialog, setDialog] = useState<PageDialogState | null>(null);
  const [chooser, setChooser] = useState<ChooserRequest | null>(null);
  const [transfers, setTransfers] = useState<RecentTransfer[]>([]);
  const [unseenTransfers, setUnseenTransfers] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [find, setFind] = useState<{
    text: string;
    result: { matches: number; active: number } | null;
  } | null>(null);
  const findTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The session's sound, played here; on by default, muted from the status bar. */
  const audioRef = useRef(new AudioPlayer());
  // The desktop's Sound volume: read here on the Browser page; a framed window is told by message.
  const desktopVolume = useSyncExternalStore(
    subscribeToDesktopPrefs,
    () => readDesktopPrefs().volume,
    () => 100,
  );
  useEffect(() => {
    if (!embedded) audioRef.current.setVolume(desktopVolume / 100);
  }, [desktopVolume, embedded]);
  const [soundOn, setSoundOn] = useState(true);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  useEffect(() => {
    const player = audioRef.current;
    return () => {
      player.close();
    };
  }, []);
  /** Any input on the page is the gesture the browser wants before it plays. */
  const unlockSound = useCallback(() => {
    audioRef.current.unlock();
    setSoundUnlocked(audioRef.current.unlocked);
    // The context reports "running" a moment after resume.
    setTimeout(() => {
      setSoundUnlocked(audioRef.current.unlocked);
    }, 150);
  }, []);
  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    audioRef.current.setOn(next);
    if (next) unlockSound();
    send({ type: "sound", on: next });
  }
  /** Text the page offered for the local clipboard, waiting for the once-per-session confirmation. */
  const [pendingCopy, setPendingCopy] = useState<string | null>(null);
  const copyConfirmed = useRef(false);
  const [address, setAddress] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [passwordsOpen, setPasswordsOpen] = useState(false);
  const [confirmHandOff, setConfirmHandOff] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  /** The live session's profile's bookmarks, for the star (ADR 0020). */
  const [bookmarks, setBookmarks] = useState<{ profileId: string; list: Bookmark[] } | null>(null);
  const liveProfileId =
    phase.kind === "live" || phase.kind === "connecting" ? phase.session.profileId : null;
  useEffect(() => {
    if (!liveProfileId) return;
    let cancelled = false;
    void fetchBookmarks(liveProfileId).then((result) => {
      if (!cancelled && result.ok) {
        setBookmarks({ profileId: liveProfileId, list: result.data.bookmarks });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [liveProfileId]);
  const profileBookmarks = bookmarks?.profileId === liveProfileId ? bookmarks.list : [];
  const [firstFrame, setFirstFrame] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** The profile of the session that ran last, for what the end message says. */
  const [lastProfileId, setLastProfileId] = useState<string | null>(attachTo?.profileId ?? null);
  const lastProfile = profiles.find((profile) => profile.id === lastProfileId) ?? null;
  const coarsePointer = useSyncExternalStore(subscribeCoarsePointer, isCoarsePointer, () => false);

  const viewportRef = useRef<ViewportHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** What the pointer is over, by tab: the cursor to show, whether a swipe would scroll, a link, an image, a selection. */
  const pointerRef = useRef(
    new Map<
      string,
      {
        cursor: CursorKind;
        hscroll: boolean;
        link: string | null;
        image: string | null;
        selected: boolean;
      }
    >(),
  );
  /** What has focus in the page, as the page labels it, for a screen reader and the caption. */
  const [focusInfo, setFocusInfo] = useState<{
    role: string;
    name: string;
    value: string | null;
  } | null>(null);
  const [captionOn, setCaptionOn] = useState(false);
  const [cursor, setCursor] = useState<CursorKind>("default");
  /** Site icons by tab, fetched by the container; the strip shows an initial until one arrives. */
  const [favicons, setFavicons] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** A small picture of each tab as last drawn here, for the strip's hover preview. */
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(() => new Map());
  const previewDirty = useRef(false);
  /** The link as measured: round trip to the container and frames drawn a second. */
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [fps, setFps] = useState(0);
  const drawTimes = useRef<number[]>([]);
  const addressRef = useRef<HTMLInputElement>(null);
  const viewport = useRef<Viewport>({ width: 1280, height: 800, scale: 1 });
  const attempts = useRef(0);
  /** Counts connect() calls: a newer one, or the window closing, stops an older one's waiting. */
  const connectRun = useRef(0);
  /** Set while this page ends the session itself: the server's own notice then says less. */
  const endingRef = useRef(false);
  const pendingOpen = useRef<BrowserOpen | undefined>(openOnStart);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Stream events are handled outside React's render cycle: read the latest tabs from a ref.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabRef = useRef(activeTabId);
  activeTabRef.current = activeTabId;

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      if (event.kind === "audio") {
        audioRef.current.play(event.header, event.samples);
        return;
      }
      if (event.kind === "frame") {
        viewportRef.current?.draw(event.header, event.image);
        return;
      }
      if (event.kind === "video") {
        videoRef.current?.push(event.header, event.data);
        return;
      }
      if (event.kind === "latency") {
        setLatencyMs(event.ms);
        return;
      }
      if (event.kind === "closed") {
        const current = phaseRef.current;
        if (current.kind !== "live" && current.kind !== "connecting") return;
        // Ending it from here: end() says so once the session is saved and gone.
        if (endingRef.current) return;
        // Locked (here or in another tab): it waits for unlocking.
        if (event.code === STREAM_CLOSE_CODES.locked) {
          setPhase({ kind: "locked", session: current.session });
          setDialog(null);
          setChooser(null);
          return;
        }
        // Another window took it: the session runs on there, and can be brought back.
        if (event.code === STREAM_CLOSE_CODES.replaced) {
          setPhase({ kind: "elsewhere", session: current.session });
          setDialog(null);
          setChooser(null);
          return;
        }
        const { message, retry } = describeClose(event.code);
        if (retry && attempts.current < RECONNECT_ATTEMPTS) {
          attempts.current += 1;
          const { session } = current;
          setTimeout(() => {
            // Locked, ended or closed in the meantime: nothing to come back to.
            const now = phaseRef.current;
            if ((now.kind !== "live" && now.kind !== "connecting") || now.session.id !== session.id)
              return;
            void connect(session, true);
          }, attempts.current * 1_000);
          return;
        }
        // A dropped connection isn't the session's end: it runs on in the cloud.
        setPhase(
          retry ? { kind: "lost", session: current.session, message } : { kind: "ended", message },
        );
        setDialog(null);
        setChooser(null);
        return;
      }
      handleMessage(event.message);
    },
    // connect and handleMessage are stable: they only use refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const stream = useMemo(() => new BrowserStream(handleEvent), [handleEvent]);
  /** The codecs this browser decodes, found once; the stream says hello with them. */
  const codecsRef = useRef<VideoCodec[]>([]);
  useEffect(() => {
    let cancelled = false;
    void detectVideoCodecs().then((codecs) => {
      if (!cancelled) codecsRef.current = codecs;
    });
    return () => {
      cancelled = true;
    };
  }, []);
  /** The video decoder for the stream open now; a new stream gets a new one. */
  const videoRef = useRef<VideoPlayer | null>(null);
  const openVideo = useCallback(() => {
    videoRef.current?.close();
    videoRef.current = new VideoPlayer(
      (frame, header) => {
        viewportRef.current?.drawVideo(frame, header);
        drawTimes.current.push(performance.now());
        previewDirty.current = true;
      },
      () => {
        stream.send({ type: "video-lost" });
      },
    );
  }, [stream]);
  useEffect(
    () => () => {
      videoRef.current?.close();
    },
    [],
  );

  function handleMessage(message: AgentMessage) {
    switch (message.type) {
      case "welcome":
        attempts.current = 0;
        setEngine(
          `${engineDetails[message.engine.name].name} · ${message.engine.version.replace(/^Chrome\//, "Chromium ")}`,
        );
        setTabs(message.tabs);
        setActiveTabId(message.activeTabId);
        setPhase((current) =>
          current.kind === "connecting" ? { kind: "live", session: current.session } : current,
        );
        if (pendingOpen.current) {
          openNow(pendingOpen.current);
          pendingOpen.current = undefined;
        }
        return;
      case "tabs": {
        // The canvas still shows the tab being left: its picture is taken before the next tab draws.
        if (message.activeTabId !== activeTabRef.current) capturePreview(activeTabRef.current);
        setTabs(message.tabs);
        setActiveTabId(message.activeTabId);
        // What was kept for tabs now closed goes with them.
        const open = new Set(message.tabs.map((tab) => tab.id));
        for (const id of [...pointerRef.current.keys()]) {
          if (!open.has(id)) pointerRef.current.delete(id);
        }
        setFavicons((current) => prune(current, open));
        setPreviews((current) => prune(current, open));
        setCursor(pointerRef.current.get(message.activeTabId)?.cursor ?? "default");
        return;
      }
      case "pointer":
        pointerRef.current.set(message.tabId, {
          cursor: message.cursor,
          hscroll: message.hscroll,
          link: message.link,
          image: message.image,
          selected: message.selected,
        });
        if (message.tabId === activeTabRef.current) setCursor(message.cursor);
        return;
      case "focus":
        if (message.tabId === activeTabRef.current) {
          setFocusInfo({ role: message.role, name: message.name, value: message.value });
        }
        return;
      case "favicon":
        setFavicons((current) => {
          const next = new Map(current);
          if (message.icon) next.set(message.tabId, message.icon);
          else next.delete(message.tabId);
          return next;
        });
        return;
      case "dialog": {
        const tab = tabsRef.current.find((candidate) => candidate.id === message.tabId);
        const host = hostOf(tab?.url ?? "");
        setDialog({ ...message, host: host === "" ? null : host });
        return;
      }
      case "refused":
        toast.add({ ...REFUSALS[message.action], type: "error" });
        return;
      case "find-result":
        setFind((current) =>
          current?.text === message.text
            ? { text: current.text, result: { matches: message.matches, active: message.active } }
            : current,
        );
        return;
      case "clipboard":
        if (message.text === "") {
          toast.add({
            title: "Nothing is selected",
            description: "Select text in the page first, then copy it to this computer.",
            type: "info",
          });
        } else if (copyConfirmed.current) {
          copyToLocal(message.text);
        } else {
          setPendingCopy(message.text);
        }
        return;
      case "reader-unavailable":
        toast.add({
          title: "Nothing to read here",
          description: "Reader view needs an article; this page doesn’t have one.",
          type: "info",
        });
        return;
      case "transfer": {
        // The downloads panel keeps the session's files; a toast says when one is done.
        setTransfers((current) => {
          const entry: RecentTransfer = {
            id: message.transferId,
            filename: message.filename,
            kind: message.kind,
            state: message.state,
            bytes: message.bytes ?? 0,
            reason: message.reason,
          };
          const index = current.findIndex((candidate) => candidate.id === entry.id);
          if (index === -1) return [entry, ...current].slice(0, 20);
          return current.map((candidate) => (candidate.id === entry.id ? entry : candidate));
        });
        if (message.state !== "started" && message.state !== "received") setUnseenTransfers(true);
        const described = describeTransfer(message);
        if (!described || message.state === "started") return;
        toast.add(described);
        // A window on the desktop tells the desktop too: Notification Centre keeps it.
        postToDesktop({
          type: "brawzer:notify",
          notification: {
            id: `transfer:${message.transferId}`,
            source: `${engineRef.current} · ${message.kind === "print" ? "Printing" : "Downloads"}`,
            glyph: message.kind === "print" ? "doc" : "archive",
            colour: described.type === "error" ? "red" : "blue",
            tone: described.type === "error" ? "danger" : "success",
            title: described.title,
            description: described.description,
          },
        });
        return;
      }
      case "file-chooser": {
        const tab = tabsRef.current.find((candidate) => candidate.id === message.tabId);
        const host = hostOf(tab?.url ?? "");
        setChooser({ ...message, host: host === "" ? null : host });
        return;
      }
      case "error":
        if (message.code === "replaced") {
          setPhase((current) =>
            current.kind === "live" || current.kind === "connecting"
              ? { kind: "elsewhere", session: current.session }
              : current,
          );
        } else if (message.code === "ended" && !endingRef.current) {
          setPhase({ kind: "ended", message: message.message });
        }
        return;
      case "pong":
        return;
    }
  }

  /**
   * Opens the session's stream in this window. While Brawzer's service
   * doesn't answer (it restarts for an update; the network blinks), the
   * session is still running in the cloud, so this keeps asking for a while
   * rather than calling the session over; only the service saying the session
   * is gone ends it here.
   */
  async function connect(session: BrowserSession, again = false) {
    connectRun.current += 1;
    const run = connectRun.current;
    // Another connect took over, the window closed, or the session was locked or ended meanwhile.
    const superseded = () => run !== connectRun.current || phaseRef.current.kind !== "connecting";
    setPhase({ kind: "connecting", session, again });
    setFirstFrame(false);
    // The viewport stays mounted through a reconnect: it must report the new stream's first frame.
    viewportRef.current?.restart();
    const giveUpAt = performance.now() + RECONNECT_WINDOW_MS;
    for (let wait = 1_000; ; wait = Math.min(wait + 1_000, 5_000)) {
      const ticket = await requestStreamTicket(session.id);
      if (run !== connectRun.current) return;
      if (ticket.ok) {
        if (superseded()) return;
        openVideo();
        stream.open(ticket.data.url, ticket.data.ticket, viewport.current, codecsRef.current);
        return;
      }
      if (ticket.status === 401) {
        leaveSignedInArea("expired");
        return;
      }
      if (superseded()) return;
      if (ticket.status === 423) {
        setPhase({ kind: "locked", session });
        return;
      }
      if (ticket.status === 404) {
        setPhase({ kind: "ended", message: "This browser session has ended." });
        return;
      }
      // No answer, or a gateway's: the service is away, not the session.
      const away = ticket.status === 0 || ticket.status >= 500;
      if (!away || performance.now() + wait > giveUpAt) {
        setPhase({ kind: "lost", session, message: ticket.error.message });
        return;
      }
      setPhase({ kind: "connecting", session, again: true });
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (superseded()) return;
    }
  }

  async function start(profileId: string | null, resume = false, engine?: BrowserEngine) {
    setStartError(null);
    const chosen = engine ?? profiles.find((profile) => profile.id === profileId)?.engine;
    if (chosen && !examAllows(`browser:${chosen}`)) {
      setStartError(
        `${engineDetails[chosen].short} is off during Exam Mode, until its time is up.`,
      );
      return;
    }
    setPhase({ kind: "starting" });
    const result = await startBrowserSession(
      profileId ? { profileId, resume } : engine ? { engine } : {},
    );
    if (!result.ok) {
      if (result.status === 401) {
        leaveSignedInArea("expired");
        return;
      }
      setPhase({ kind: "idle" });
      setStartError(result.error.message);
      return;
    }
    // On the desktop, each browser opens in a window of its own.
    if (mode === "page" && desktop && desktopActive()) {
      desktop.openSession(result.data);
      setPhase({ kind: "idle" });
      setLauncherVersion((version) => version + 1);
      return;
    }
    attempts.current = 0;
    setLastProfileId(result.data.profileId);
    // The address says which browser this is, so a reload comes back to it.
    window.history.replaceState(null, "", sessionHref(result.data.id));
    await connect(result.data);
  }

  async function end() {
    const current = phaseRef.current;
    if (current.kind !== "live" && current.kind !== "connecting") return;
    setEnding(true);
    endingRef.current = true;
    const result = await endBrowserSession(current.session.id);
    endingRef.current = false;
    setEnding(false);
    setConfirmEnd(false);
    if (!result.ok && result.status !== 404) {
      toast.add({
        title: "Couldn’t end the session",
        description: result.error.message,
        type: "error",
      });
      return;
    }
    stream.close();
    setPhase({ kind: "ended", message: "You ended this browser session." });
    setTabs([]);
    setDialog(null);
  }

  /** Ends here; the tabs wait for the profile's next session, on any device. */
  async function handOff() {
    const current = phaseRef.current;
    if (current.kind !== "live") return;
    setEnding(true);
    endingRef.current = true;
    const result = await handOffBrowserSession(current.session.id);
    endingRef.current = false;
    setEnding(false);
    setConfirmHandOff(false);
    if (!result.ok && result.status !== 404) {
      toast.add({
        title: "The session wasn’t handed off",
        description: result.error.message,
        type: "error",
      });
      return;
    }
    stream.close();
    const name =
      profiles.find((candidate) => candidate.id === current.session.profileId)?.name ??
      "the profile";
    setPhase({
      kind: "ended",
      message: `You handed this session off. Its tabs wait with “${name}”: on your other device, open Brawzer’s Browser page and choose Continue.`,
    });
    setTabs([]);
    setDialog(null);
  }

  async function toggleBookmark() {
    const profileId = liveProfileId;
    const tab = activeTab;
    if (!profileId || !tab || !canBookmark(tab.url)) return;
    const existing = profileBookmarks.find((bookmark) => bookmark.url === tab.url);
    setBookmarkBusy(true);
    if (existing) {
      const result = await removeBookmark(profileId, existing.id);
      setBookmarkBusy(false);
      if (result.ok || result.status === 404) {
        setBookmarks({
          profileId,
          list: profileBookmarks.filter((bookmark) => bookmark.id !== existing.id),
        });
        toast.add({ type: "success", title: "Bookmark removed" });
      } else {
        toast.add({
          type: "error",
          title: "Couldn’t remove it",
          description: result.error.message,
        });
      }
      return;
    }
    const result = await addBookmark(profileId, { url: tab.url, title: tab.title.slice(0, 300) });
    setBookmarkBusy(false);
    if (result.ok) {
      setBookmarks({
        profileId,
        list: [
          ...profileBookmarks.filter((bookmark) => bookmark.id !== result.data.id),
          result.data,
        ],
      });
      toast.add({
        type: "success",
        title: "Bookmarked",
        description: tab.title || displayUrl(tab.url),
      });
    } else {
      toast.add({
        type: "error",
        title: "Couldn’t bookmark it",
        description: result.error.message,
      });
    }
  }

  /**
   * The session was still starting when this page loaded (a window opened a
   * moment early, or the page was reloaded mid-start): wait for it to be
   * running and attach, rather than call a browser that is about to appear
   * gone.
   */
  async function awaitStart(session: BrowserSession) {
    connectRun.current += 1;
    const run = connectRun.current;
    const short = engineDetails[session.engine].short;
    const giveUpAt = performance.now() + (BROWSER_LIMITS.startTimeoutSeconds + 15) * 1_000;
    const gaveUp = (message: string) => {
      setStartError(message);
      setPhase({ kind: "idle" });
    };
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      if (run !== connectRun.current) return;
      const overview = await fetchBrowserOverview();
      if (run !== connectRun.current) return;
      if (!overview.ok) {
        if (overview.status === 401) {
          leaveSignedInArea("expired");
          return;
        }
        if (performance.now() < giveUpAt) continue;
        gaveUp(overview.error.message);
        return;
      }
      const now = overview.data.sessions.find((candidate) => candidate.id === session.id);
      if (now?.status === "running") {
        void connect(now);
        return;
      }
      if (!now || performance.now() > giveUpAt) {
        gaveUp(`${short} didn’t start. Close this and open it again.`);
        return;
      }
    }
  }

  // Reattach to a session that was already running when the page loaded. On
  // the desktop, the browser is in its own window: this page is the launcher.
  useEffect(() => {
    if (mode === "page" && desktop && desktopActive()) {
      if (select.session && attachTo) desktop.openSession(attachTo);
      return;
    }
    if (attachTo?.status === "running") void connect(attachTo);
    else if (attachTo?.status === "starting") void awaitStart(attachTo);
    return () => {
      connectRun.current += 1;
      stream.close();
    };
    // Once, for the initial session only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signing out in another tab ends the stream here at once.
  useEffect(
    () =>
      onSessionMessage((message) => {
        if (message.type === "signed-out") stream.close();
      }),
    [stream],
  );

  // Locking stops the stream at once (the server closes it too); unlocking
  // brings the same session back.
  useEffect(
    () =>
      subscribeToLock(() => {
        const current = phaseRef.current;
        if (isLocked()) {
          if (current.kind !== "live" && current.kind !== "connecting") return;
          stream.close();
          setDialog(null);
          setChooser(null);
          setPhase({ kind: "locked", session: current.session });
        } else if (current.kind === "locked") {
          attempts.current = 0;
          void connect(current.session);
        }
      }),
    // connect only uses refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const send = useCallback(
    (message: ClientMessageInput) => {
      stream.send(message);
    },
    [stream],
  );
  const live = phase.kind === "live";
  const sendIfLive = live ? send : null;

  const onViewport = useCallback(
    (next: Viewport) => {
      viewport.current = next;
      if (stream.isOpen) stream.send({ type: "resize", viewport: next });
    },
    [stream],
  );
  const onDrawn = useCallback(
    (header: FrameHeader) => {
      stream.send({ type: "frame-ack", tabId: header.tabId, frameId: header.frameId });
      drawTimes.current.push(performance.now());
      previewDirty.current = true;
    },
    [stream],
  );
  // Frames drawn over the last second, read once a second; a still page shows 0.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      const since = performance.now() - 1_000;
      drawTimes.current = drawTimes.current.filter((at) => at >= since);
      setFps(drawTimes.current.length);
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [live]);
  /** Keeps a small picture of the tab in front, from the canvas, for the strip's hover preview. */
  const capturePreview = useCallback((tabId: string | null) => {
    const canvas = viewportRef.current?.canvas();
    if (!tabId || !canvas) return;
    const picture = previewOf(canvas);
    if (!picture) return;
    previewDirty.current = false;
    setPreviews((current) => {
      const next = new Map(current);
      next.set(tabId, picture);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (previewDirty.current) capturePreview(activeTabRef.current);
    }, PREVIEW_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [live, capturePreview]);
  const onReady = useCallback(() => {
    setFirstFrame(true);
  }, []);

  /** Brawzer's own right-click menu for the page: what is under the pointer decides what it offers. */
  function pageMenu(event: Parameters<typeof openContextMenu>[0]) {
    const tab = activeTabRef.current;
    if (!tab || !live) return;
    const under = pointerRef.current.get(tab);
    const entries: MenuEntry[] = [
      { label: "Back", disabled: !activeTab?.canGoBack, onSelect: () => onShortcut("back") },
      {
        label: "Forward",
        disabled: !activeTab?.canGoForward,
        onSelect: () => onShortcut("forward"),
      },
      { label: "Reload", onSelect: () => onShortcut("reload") },
    ];
    if (under?.link) {
      const link = under.link;
      entries.push(
        "-",
        { label: "Open link in new tab", onSelect: () => send({ type: "new-tab", url: link }) },
        {
          label: "Copy link address",
          sub: hostOf(link),
          onSelect: () => {
            copyToLocal(link);
          },
        },
      );
    }
    if (under?.image) {
      const image = under.image;
      entries.push(
        "-",
        { label: "Save image to Drive", onSelect: () => saveImageToDrive(image) },
        { label: "Open image in new tab", onSelect: () => send({ type: "new-tab", url: image }) },
        {
          label: "Copy image address",
          onSelect: () => {
            copyToLocal(image);
          },
        },
      );
    }
    entries.push(
      "-",
      {
        label: "Copy",
        shortcut: "Alt+C",
        disabled: !under?.selected,
        onSelect: () => onShortcut("copy"),
      },
      { label: "Paste", shortcut: "Alt+V", onSelect: () => onShortcut("paste") },
      "-",
      { label: "Find in page…", shortcut: "Alt+F", onSelect: () => onShortcut("find") },
      { label: "Save as PDF in Drive", shortcut: "Alt+P", onSelect: () => onShortcut("print") },
      {
        label: activeTab?.reader ? "Leave reader view" : "Reader view",
        onSelect: () => onShortcut("reader"),
      },
    );
    openContextMenu(event, entries);
  }

  /** A page's image to Drive, by the container: it lands in Downloads like any download. */
  function saveImageToDrive(url: string) {
    const tab = activeTabRef.current;
    if (!tab) return;
    send({ type: "save-image", tabId: tab, url });
    toast.add({
      type: "info",
      title: "Saving the image to Drive…",
      description: "It goes to Downloads.",
    });
  }

  /**
   * Files dropped on the page: Drive files go straight to the page; this
   * computer's files go to Drive's Uploads first (scanned, encrypted), then
   * to the page, so the page never sees this computer.
   */
  async function dropFiles(
    point: { x: number; y: number },
    dropped: { fileIds: string[]; files: File[] },
  ) {
    const tab = activeTabRef.current;
    if (!tab) return;
    let fileIds = dropped.fileIds;
    if (fileIds.length === 0 && dropped.files.length > 0) {
      toast.add({
        type: "info",
        title:
          dropped.files.length === 1
            ? "Uploading to Drive first…"
            : `Uploading ${String(dropped.files.length)} files to Drive first…`,
        description: "The page gets them from Drive, never from this computer.",
      });
      const folder = await driveFolder("Uploads");
      if (!folder.ok) {
        toast.add({
          type: "error",
          title: "Couldn’t open Drive",
          description: folder.error.message,
        });
        return;
      }
      fileIds = [];
      for (const file of dropped.files.slice(0, MAX_CHOSEN_FILES)) {
        const result = await uploadDriveFile(file, folder.data, () => undefined).result;
        if (result.ok && result.data.status === "clean") fileIds.push(result.data.id);
        else {
          toast.add({
            type: "error",
            title: `“${file.name}” wasn’t given to the page`,
            description: result.ok
              ? "It was quarantined: it matched known malware."
              : result.error.message,
          });
        }
      }
      if (fileIds.length === 0) return;
    }
    send({
      type: "drop",
      tabId: tab,
      dropId: crypto.randomUUID(),
      x: point.x,
      y: point.y,
      fileIds: fileIds.slice(0, MAX_CHOSEN_FILES),
    });
  }

  function navigate(url: string) {
    if (!activeTab) return;
    send({ type: "navigate", tabId: activeTab.id, url });
    setAddress(null);
    viewportRef.current?.focus();
  }

  function submitAddress(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = resolveTyped(address ?? "");
    if (target === "about:blank") {
      setAddress(null);
      return;
    }
    navigate(target);
  }

  const onShortcut = useCallback(
    (shortcut: Shortcut) => {
      const tab = tabs.find((candidate) => candidate.id === activeTabId);
      switch (shortcut) {
        case "address":
          addressRef.current?.focus();
          addressRef.current?.select();
          return;
        case "leave":
          addressRef.current?.focus();
          return;
        case "new-tab":
          send({ type: "new-tab" });
          return;
        case "close-tab":
          if (tab) send({ type: "close-tab", tabId: tab.id });
          return;
        case "back":
          if (tab?.canGoBack) send({ type: "back", tabId: tab.id });
          return;
        case "forward":
          if (tab?.canGoForward) send({ type: "forward", tabId: tab.id });
          return;
        case "reload":
          if (tab) send({ type: "reload", tabId: tab.id });
          return;
        case "print":
          if (tab) send({ type: "print", tabId: tab.id });
          return;
        case "find":
          if (tab) setFind((current) => current ?? { text: "", result: null });
          return;
        case "zoom-in":
        case "zoom-out":
        case "zoom-reset":
          if (tab) {
            const factor =
              shortcut === "zoom-reset" ? 1 : nextZoom(tab.zoom, shortcut === "zoom-in" ? 1 : -1);
            send({ type: "zoom", tabId: tab.id, factor });
          }
          return;
        case "reader":
          if (tab) send({ type: "reader", tabId: tab.id, on: !tab.reader });
          return;
        case "copy":
          if (tab) send({ type: "copy", tabId: tab.id });
          return;
        case "paste":
          if (tab) pasteFromLocal(tab.id);
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pasteFromLocal only uses send and toast
    [tabs, activeTabId, send],
  );

  /** The local clipboard: written only after the page's text was asked for on purpose. */
  function copyToLocal(text: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        toast.add({
          title: "Copied to this computer",
          description: `${String(text.length)} characters are on this computer’s clipboard.`,
          type: "success",
        });
      },
      () => {
        toast.add({
          title: "Couldn’t reach this computer’s clipboard",
          description: "The browser refused clipboard access for this page.",
          type: "error",
        });
      },
    );
  }

  function pasteFromLocal(tabId: string) {
    navigator.clipboard.readText().then(
      (text) => {
        const trimmed = text.slice(0, CLIPBOARD_MAX_CHARS);
        if (trimmed === "") {
          toast.add({ title: "This computer’s clipboard is empty", type: "info" });
          return;
        }
        send({ type: "paste", tabId, text: trimmed });
        // Back to the page, so the next keystroke (Enter, say) goes where the text went.
        viewportRef.current?.focus();
        toast.add({
          title: "Pasted into the page",
          description: `${String(trimmed.length)} characters went to the page’s focused field.`,
          type: "success",
        });
      },
      () => {
        toast.add({
          title: "Couldn’t read this computer’s clipboard",
          description: "Allow clipboard access for Brawzer in your browser, then try again.",
          type: "error",
        });
      },
    );
  }

  /** Each keystroke in the find bar asks the engine for the first match, a moment later. */
  function changeFind(text: string) {
    setFind({ text, result: null });
    if (findTimer.current) clearTimeout(findTimer.current);
    if (!activeTab) return;
    const tabId = activeTab.id;
    if (text === "") {
      send({ type: "find-stop", tabId });
      return;
    }
    findTimer.current = setTimeout(() => {
      send({ type: "find", tabId, text, forward: true });
    }, 150);
  }

  function closeFind() {
    if (findTimer.current) clearTimeout(findTimer.current);
    setFind(null);
    if (activeTab) send({ type: "find-stop", tabId: activeTab.id });
    viewportRef.current?.focus();
  }

  /** The session in a window of its own; it takes the stream, and this page says so. */
  /** The page as drawn here, as a PNG in Drive's top folder; the server never makes one. */
  async function saveScreenshot() {
    const canvas = viewportRef.current?.canvas() ?? null;
    const blob = canvas ? await encodeCanvas(canvas, "image/png", 1, canvas.width) : null;
    if (!blob) {
      toast.add({ title: "There’s nothing to save yet", type: "error" });
      return;
    }
    const name = screenshotName(hostOf(activeTab?.url ?? ""), new Date());
    const saved = await uploadDriveFile(new File([blob], name, { type: "image/png" }), null, () => {
      // A screenshot is small: no progress to show.
    }).result;
    if (saved.ok) {
      toast.add({ title: "Screenshot saved in Drive", description: name, type: "success" });
      postToDesktop({
        type: "brawzer:notify",
        notification: {
          source: `${engineRef.current} · Screenshot`,
          glyph: "camera",
          colour: "pink",
          tone: "success",
          title: "Screenshot saved in Drive",
          description: name,
        },
      });
    } else if (saved.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({
        title: "The screenshot wasn’t saved",
        description: saved.error.message,
        type: "error",
      });
    }
  }

  function openReport() {
    if (phase.kind !== "live") return;
    const tab = activeTab;
    const url = tab && !isStartPage(tab.url) ? (tab.error?.url ?? tab.url) : null;
    setReport({
      sessionId: phase.session.id,
      url,
      title: url !== null && tab?.title ? tab.title : null,
      // An empty code means the engine named none.
      errorCode: tab?.error && tab.error.code !== "" ? tab.error.code : null,
    });
  }

  /** A site in a new tab, or the browser's own page, as the desktop asked. */
  function openNow(open: BrowserOpen) {
    if (open.url) stream.send({ type: "new-tab", url: open.url });
    if (open.page) stream.send({ type: "open-browser-page", page: open.page });
  }

  // The desktop around a framed window asks it to open things and take screenshots.
  const latest = useRef({
    saveScreenshot,
    dropFiles,
    saveImageToDrive,
    live: phase.kind === "live",
  });
  useEffect(() => {
    latest.current = { saveScreenshot, dropFiles, saveImageToDrive, live: phase.kind === "live" };
  });
  useEffect(() => {
    if (!embedded) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const message = parseDesktopRequest(event.data);
      if (!message) return;
      if (message.type === "brawzer:screenshot") {
        void latest.current.saveScreenshot();
      } else if (message.type === "brawzer:volume") {
        audioRef.current.setVolume(message.volume / 100);
      } else if (message.type === "brawzer:drop") {
        const point = viewportRef.current?.pointAt(message.x, message.y);
        if (point) void latest.current.dropFiles(point, { fileIds: message.fileIds, files: [] });
      } else if (message.type === "brawzer:save-image") {
        latest.current.saveImageToDrive(message.url);
      } else if (latest.current.live) {
        openNow(message.open);
      } else {
        pendingOpen.current = message.open;
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
    // openNow only uses the stream, which doesn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded]);

  /** A pop-out closes itself; a desktop window asks the desktop to close it. */
  function closeWindow(sessionId: string) {
    if (embedded) postToDesktop({ type: "brawzer:close-window", session: sessionId });
    else window.close();
  }

  function popOut() {
    const current = phaseRef.current;
    if (current.kind !== "live" && current.kind !== "connecting") return;
    // A window per browser, so Firefox and Chrome can sit side by side.
    const opened = window.open(
      `/app/browser/window?${new URLSearchParams({ session: current.session.id }).toString()}`,
      `brawzer-browser-${current.session.id}`,
      "popup=yes,width=1280,height=860",
    );
    if (!opened) {
      toast.add({
        title: "The window was blocked",
        description: "Allow pop-ups for Brawzer in this browser, then try again.",
        type: "error",
      });
    }
  }

  async function fullScreen() {
    const container = containerRef.current;
    if (!container) return;
    try {
      await container.requestFullscreen();
      // Where supported, full screen lets ⌘/Ctrl shortcuts reach the page.
      const keyboard = (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } })
        .keyboard;
      await keyboard?.lock?.();
    } catch {
      // Not allowed here; the page still works windowed.
    }
    viewportRef.current?.focus();
  }

  if (embedded && phase.kind === "starting") {
    return (
      <div
        role="status"
        className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <Spinner className="size-5" />
        <p className="text-callout text-ink-secondary">
          {attachTo ? engineDetails[attachTo.engine].short : "This browser"} is starting…
        </p>
      </div>
    );
  }

  if (embedded && phase.kind === "idle") {
    // A desktop window shows one browser; opening others is the desktop's.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-callout text-ink-secondary">
          {startError ?? "This browser isn’t running any more."}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            closeWindow(select.session ?? "");
          }}
        >
          Close window
        </Button>
      </div>
    );
  }

  // On the desktop, a running browser is in its own window: this page is the launcher.
  if (
    phase.kind === "idle" ||
    phase.kind === "starting" ||
    (onDesktop && (phase.kind === "connecting" || phase.kind === "live"))
  ) {
    return (
      <Launcher
        key={launcherVersion}
        profiles={profiles}
        proxies={proxies}
        overview={initial}
        onProfileCreated={(profile) => {
          setProfiles((current) => [...current, profile]);
        }}
        starting={phase.kind === "starting"}
        error={startError}
        sessionHref={sessionHref}
        onStart={(choice: LaunchChoice) =>
          void start(choice.profileId, choice.resume, choice.engine)
        }
      />
    );
  }

  if (phase.kind === "locked") {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-callout font-semibold text-ink">Brawzer is locked</p>
        <p className="text-callout text-ink-secondary">
          {engineDetails[phase.session.engine].short} comes back here when it’s unlocked.
        </p>
      </div>
    );
  }

  if (phase.kind === "elsewhere") {
    const elsewhere = phase.session;
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8 sm:py-12">
        <h1 className="text-title-1 text-ink">Browser</h1>
        <FormMessage tone="info" title="This session is open in another window">
          One window shows a session at a time. It keeps running there, with its tabs as they are.
        </FormMessage>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              attempts.current = 0;
              void connect(elsewhere);
            }}
          >
            Bring it back here
          </Button>
          {mode === "window" && (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                closeWindow(elsewhere.id);
              }}
            >
              Close this window
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (phase.kind === "lost") {
    const lost = phase.session;
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8 sm:py-12">
        <h1 className="text-title-1 text-ink">Browser</h1>
        <FormMessage tone="info" title="Connection lost">
          {phase.message} This window lost its connection; the session wasn’t ended.{" "}
          {engineDetails[lost.engine].short} keeps running in Brawzer’s cloud with its tabs as they
          are, for up to {BROWSER_LIMITS.idleMinutes} minutes with nobody viewing it.
        </FormMessage>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              attempts.current = 0;
              void connect(lost, true);
            }}
          >
            Reconnect
          </Button>
          {mode === "window" && (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                closeWindow(lost.id);
              }}
            >
              Close this window
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (phase.kind === "ended") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8 sm:py-12">
        <h1 className="text-title-1 text-ink">Browser</h1>
        <FormMessage tone="info" title="Session over">
          {phase.message}{" "}
          {lastProfile?.keepData
            ? `Its cookies, history and site data were saved to the “${lastProfile.name}” profile; nothing stays on this computer.`
            : "Nothing from it is kept."}
        </FormMessage>
        <div>
          {embedded ? (
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                closeWindow(select.session ?? "");
              }}
            >
              Close window
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                setStartError(null);
                setPhase({ kind: "idle" });
              }}
            >
              Open a browser
            </Button>
          )}
        </div>
      </div>
    );
  }

  const session = phase.session;
  const sessionProfile = profiles.find((profile) => profile.id === session.profileId) ?? null;
  const sessionProxy = proxies.find((proxy) => proxy.id === session.proxyId) ?? null;
  const currentAddress = isStartPage(activeTab?.url ?? "") ? "" : displayUrl(activeTab?.url ?? "");
  const shownAddress = address ?? currentAddress;

  return (
    <div
      ref={containerRef}
      className="fullscreen:bg-canvas flex h-full min-h-0 flex-col bg-canvas"
      data-testid="browser-workspace"
    >
      {!app && (
        <TabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          favicons={favicons}
          previews={previews}
          onActivate={(id) => {
            // The tab being left keeps its last picture.
            capturePreview(activeTabId);
            send({ type: "activate-tab", tabId: id });
          }}
          onClose={(id) => {
            send({ type: "close-tab", tabId: id });
          }}
          onNew={() => {
            send({ type: "new-tab" });
          }}
        />
      )}

      <div className="flex items-center gap-2 border-b border-line bg-canvas px-3 py-2">
        {!embedded && !app && (
          <SessionSwitcher
            current={session}
            engine={session.engine}
            profiles={profiles}
            hrefFor={sessionHref}
            launcherHref={launcherHref}
          />
        )}
        <NavButtons
          tab={activeTab}
          onBack={() => {
            onShortcut("back");
          }}
          onForward={() => {
            onShortcut("forward");
          }}
          onReload={() => {
            onShortcut("reload");
          }}
          onStop={() => {
            if (activeTab) send({ type: "stop", tabId: activeTab.id });
          }}
        />
        {app ? (
          <span
            className="text-sm flex min-w-0 flex-1 items-center gap-2 truncate px-2 font-medium text-ink"
            data-testid="web-app-name"
          >
            {app.name}
            {activeTab?.title &&
              !isStartPage(activeTab.url) &&
              activeTab.title.trim().toLowerCase() !== app.name.toLowerCase() && (
                <span className="truncate font-normal text-ink-secondary">· {activeTab.title}</span>
              )}
          </span>
        ) : (
          <AddressBar
            tab={activeTab}
            value={shownAddress}
            editing={address !== null}
            inputRef={addressRef}
            onChange={setAddress}
            onSubmit={submitAddress}
            onFocus={() => {
              setAddress(currentAddress);
            }}
            onBlur={() => {
              setAddress(null);
            }}
            onEscape={() => {
              setAddress(null);
              viewportRef.current?.focus();
            }}
            onResetZoom={() => {
              onShortcut("zoom-reset");
            }}
            onLeaveReader={() => {
              onShortcut("reader");
            }}
          />
        )}
        {!app && sessionProfile && activeTab && canBookmark(activeTab.url) && (
          <BookmarkStar
            bookmarked={profileBookmarks.some((bookmark) => bookmark.url === activeTab.url)}
            busy={bookmarkBusy}
            onToggle={() => void toggleBookmark()}
          />
        )}
        <IsolatedBadge />
        <ProfileChip
          profile={sessionProfile}
          onEnd={() => {
            setConfirmEnd(true);
          }}
        />
        <DownloadsButton
          transfers={transfers}
          unseen={unseenTransfers}
          onOpen={() => {
            setUnseenTransfers(false);
          }}
        />
        <MoreMenu
          caption={{
            on: captionOn,
            onToggle: () => {
              setCaptionOn((current) => !current);
            },
          }}
          canPrint={Boolean(activeTab) && !isStartPage(activeTab?.url ?? "")}
          coarsePointer={coarsePointer}
          zoom={activeTab?.zoom ?? 1}
          reader={activeTab?.reader ?? false}
          onNewTab={() => {
            send({ type: "new-tab" });
          }}
          onPrint={() => {
            onShortcut("print");
          }}
          onFind={() => {
            onShortcut("find");
          }}
          onCopy={() => {
            onShortcut("copy");
          }}
          onPaste={() => {
            onShortcut("paste");
          }}
          onZoom={(direction) => {
            onShortcut(direction === 0 ? "zoom-reset" : direction === 1 ? "zoom-in" : "zoom-out");
          }}
          onReader={() => {
            onShortcut("reader");
          }}
          onFullScreen={() => void fullScreen()}
          onKeyboard={() => viewportRef.current?.focusKeyboard()}
          onShortcuts={() => {
            setShortcutsOpen(true);
          }}
          onPopOut={mode === "page" ? popOut : undefined}
          onCloseWindow={
            mode === "window"
              ? () => {
                  closeWindow(session.id);
                }
              : undefined
          }
          onEnd={() => {
            setConfirmEnd(true);
          }}
          onScreenshot={() => void saveScreenshot()}
          onReport={openReport}
          onHistory={
            sessionProfile
              ? () => {
                  setHistoryOpen(true);
                }
              : undefined
          }
          onPasswords={() => {
            setPasswordsOpen(true);
          }}
          onHandOff={
            sessionProfile?.keepData
              ? () => {
                  setConfirmHandOff(true);
                }
              : undefined
          }
        />
      </div>

      {find && (
        <FindBar
          text={find.text}
          result={find.result}
          onChange={changeFind}
          onStep={(forward) => {
            if (activeTab && find.text !== "") {
              send({ type: "find", tabId: activeTab.id, text: find.text, forward });
            }
          }}
          onClose={closeFind}
        />
      )}

      {/* The page */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        id="browser-viewport"
        onPointerDownCapture={unlockSound}
        onKeyDownCapture={unlockSound}
      >
        <BrowserViewport
          ref={viewportRef}
          tabId={activeTab?.id ?? null}
          send={sendIfLive}
          onDrawn={onDrawn}
          onViewport={onViewport}
          onShortcut={onShortcut}
          onReady={onReady}
          cursor={cursor}
          canSwipe={() =>
            activeTabRef.current !== null &&
            pointerRef.current.get(activeTabRef.current)?.hscroll !== true
          }
          onGesture={onShortcut}
          onPageMenu={(event) => {
            pageMenu(event);
          }}
          onDropFiles={(point, dropped) => void dropFiles(point, dropped)}
          imageAt={() =>
            activeTabRef.current
              ? (pointerRef.current.get(activeTabRef.current)?.image ?? null)
              : null
          }
          dragOutSession={live ? session.id : null}
        />
        {/* What has focus, for a screen reader (always) and as a caption (when asked for). */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {focusInfo
            ? `${focusInfo.name || "unnamed"}, ${focusInfo.role}${focusInfo.value ? `, ${focusInfo.value}` : ""}`
            : ""}
        </div>
        {captionOn && focusInfo && (
          <div
            className="pointer-events-none absolute right-3 bottom-3 left-3 rounded-xl bg-ink/85 px-3 py-2 text-footnote text-canvas"
            data-testid="focus-caption"
          >
            <span className="font-semibold">{focusInfo.name || "Unnamed"}</span>
            <span className="opacity-80"> · {focusInfo.role}</span>
            {focusInfo.value !== null && focusInfo.value !== "" && (
              <span className="opacity-80"> · {focusInfo.value}</span>
            )}
          </div>
        )}
        {activeTab?.error && live && (
          <NavigationErrorPage
            tab={activeTab}
            onRetry={() => {
              navigate(activeTab.error?.url ?? activeTab.url);
            }}
            onCopy={() => {
              const address = activeTab.error?.url ?? activeTab.url;
              navigator.clipboard.writeText(address).then(
                () => {
                  toast.add({ title: "Address copied", description: address, type: "success" });
                },
                () => {
                  toast.add({
                    title: "Couldn’t copy the address",
                    description: "Select it in the address bar instead.",
                    type: "error",
                  });
                },
              );
            }}
            onSearch={() => {
              const host = hostOf(activeTab.error?.url ?? activeTab.url);
              navigate(searchUrl(host || displayUrl(activeTab.url)));
            }}
            onReport={openReport}
          />
        )}
        {(!live || !firstFrame) && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-canvas/90"
            role="status"
          >
            <div className="flex items-center gap-3 text-callout text-ink-secondary">
              <Spinner className="size-5" />
              {phase.kind === "connecting"
                ? phase.again
                  ? "Reconnecting to your browser…"
                  : "Connecting to your browser…"
                : "Waiting for the page…"}
            </div>
          </div>
        )}
      </div>

      <StatusBar
        region={initial.region}
        engine={engine}
        proxy={sessionProxy}
        profile={sessionProfile}
        remaining={remainingLabel(session.expiresAt, now)}
        sound={{ on: soundOn, unlocked: soundUnlocked, onToggle: toggleSound }}
        link={{ latencyMs, fps }}
      />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {/* The page's right-click menu needs a host; the desktop has one of its own. */}
      {!desktop && <ContextMenuHost />}
      <ConfirmCopyDialog
        open={pendingCopy !== null}
        chars={pendingCopy?.length ?? 0}
        onOpenChange={(open) => {
          if (!open) setPendingCopy(null);
        }}
        onConfirm={() => {
          if (pendingCopy !== null) {
            copyConfirmed.current = true;
            copyToLocal(pendingCopy);
          }
          setPendingCopy(null);
          viewportRef.current?.focus();
        }}
      />
      <PageDialog
        dialog={dialog}
        onAnswer={(accept, text) => {
          if (dialog) {
            send({
              type: "dialog",
              tabId: dialog.tabId,
              accept,
              ...(text !== undefined ? { text } : {}),
            });
          }
          setDialog(null);
          viewportRef.current?.focus();
        }}
      />
      <DrivePicker
        request={chooser}
        onAnswer={(fileIds) => {
          if (chooser) {
            send({
              type: "file-chooser",
              tabId: chooser.tabId,
              chooserId: chooser.chooserId,
              fileIds,
            });
          }
          setChooser(null);
          viewportRef.current?.focus();
        }}
      />
      <ReportPageDialog
        target={report}
        canvas={() => viewportRef.current?.canvas() ?? null}
        onClose={() => {
          setReport(null);
          viewportRef.current?.focus();
        }}
      />
      {sessionProfile && (
        <HistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          profile={sessionProfile}
          bookmarks={profileBookmarks}
          onOpen={navigate}
        />
      )}
      <PasswordsDialog
        open={passwordsOpen}
        onOpenChange={setPasswordsOpen}
        engine={session.engine}
        profile={sessionProfile}
        onBrowserPage={(page) => {
          send({ type: "open-browser-page", page });
        }}
        onOpenUrl={(url) => {
          send({ type: "new-tab", url });
        }}
      />
      <HandOffDialog
        open={confirmHandOff}
        onOpenChange={setConfirmHandOff}
        onConfirm={() => void handOff()}
        busy={ending}
        profileName={sessionProfile?.name ?? ""}
        tabs={tabs.filter((tab) => canBookmark(tab.url)).length}
      />
      <EndSessionDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        onConfirm={() => void end()}
        busy={ending}
      />
    </div>
  );
}
