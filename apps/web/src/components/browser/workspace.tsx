"use client";

import {
  CLIPBOARD_MAX_CHARS,
  type AgentMessage,
  type BrowserOverview,
  type BrowserSession,
  type ClientMessageInput,
  engineDetails,
  type FrameHeader,
  type Profile,
  type RefusedAction,
  STREAM_CLOSE_CODES,
  type TabState,
  type TransferMessage,
  type Viewport,
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
import { endBrowserSession, requestStreamTicket, startBrowserSession } from "@/lib/api/browser";
import { displayUrl, hostOf, resolveTyped, searchUrl } from "@/lib/browser/input";
import { nextZoom } from "@/lib/browser/zoom";
import { AudioPlayer } from "@/lib/browser/audio";
import { BrowserStream, describeClose, type StreamEvent } from "@/lib/browser/stream";
import { leaveSignedInArea, onSessionMessage } from "@/lib/session-channel";
import {
  AddressBar,
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
  PageDialog,
  type PageDialogState,
  ShortcutsDialog,
} from "./dialogs";
import { type ChooserRequest, DrivePicker } from "./drive-picker";
import { StartPanel } from "./start-panel";
import { BrowserViewport, type Shortcut, type ViewportHandle } from "./viewport";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "connecting"; session: BrowserSession }
  | { kind: "live"; session: BrowserSession }
  | { kind: "ended"; message: string }
  /** Another window or tab took the stream; the session runs on there. */
  | { kind: "elsewhere"; session: BrowserSession };

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
};

const RECONNECT_ATTEMPTS = 2;

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
  profiles,
  proxies,
  mode = "page",
}: {
  /** "window": the pop-out, with nothing around it but the browser's own chrome. */
  mode?: "page" | "window";
  initial: BrowserOverview;
  profiles: readonly Profile[];
  /** The account's saved proxies, for naming the one a session uses. */
  proxies: readonly { id: string; name: string; protocol: string }[];
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(
    initial.session?.status === "running"
      ? { kind: "connecting", session: initial.session }
      : { kind: "idle" },
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [engine, setEngine] = useState("");
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
  const [firstFrame, setFirstFrame] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** The profile of the session that ran last, for what the end message says. */
  const [lastProfileId, setLastProfileId] = useState<string | null>(
    initial.session?.profileId ?? null,
  );
  const lastProfile = profiles.find((profile) => profile.id === lastProfileId) ?? null;
  const coarsePointer = useSyncExternalStore(subscribeCoarsePointer, isCoarsePointer, () => false);

  const viewportRef = useRef<ViewportHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const viewport = useRef<Viewport>({ width: 1280, height: 800 });
  const attempts = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Stream events are handled outside React's render cycle: read the latest tabs from a ref.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

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
      if (event.kind === "closed") {
        const current = phaseRef.current;
        if (current.kind !== "live" && current.kind !== "connecting") return;
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
          setTimeout(() => void connect(current.session), 1_000);
          return;
        }
        setPhase({ kind: "ended", message });
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
        return;
      case "tabs":
        setTabs(message.tabs);
        setActiveTabId(message.activeTabId);
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
        } else if (message.code === "ended") {
          setPhase({ kind: "ended", message: message.message });
        }
        return;
      case "pong":
        return;
    }
  }

  async function connect(session: BrowserSession) {
    setPhase({ kind: "connecting", session });
    setFirstFrame(false);
    const ticket = await requestStreamTicket(session.id);
    if (!ticket.ok) {
      if (ticket.status === 401) {
        leaveSignedInArea("expired");
        return;
      }
      setPhase({
        kind: "ended",
        message: ticket.status === 404 ? "This browser session has ended." : ticket.error.message,
      });
      return;
    }
    stream.open(ticket.data.url, ticket.data.ticket, viewport.current);
  }

  async function start(profileId: string | null) {
    setStartError(null);
    setPhase({ kind: "starting" });
    const result = await startBrowserSession(profileId ? { profileId } : {});
    if (!result.ok) {
      if (result.status === 401) {
        leaveSignedInArea("expired");
        return;
      }
      setPhase({ kind: "idle" });
      setStartError(result.error.message);
      return;
    }
    attempts.current = 0;
    setLastProfileId(result.data.profileId);
    await connect(result.data);
  }

  async function end() {
    const current = phaseRef.current;
    if (current.kind !== "live" && current.kind !== "connecting") return;
    setEnding(true);
    const result = await endBrowserSession(current.session.id);
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

  // Reattach to a session that was already running when the page loaded.
  useEffect(() => {
    if (initial.session?.status === "running") void connect(initial.session);
    return () => {
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
    },
    [stream],
  );
  const onReady = useCallback(() => {
    setFirstFrame(true);
  }, []);

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
  function popOut() {
    const opened = window.open(
      "/app/browser/window",
      "brawzer-browser",
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

  if (phase.kind === "idle" || phase.kind === "starting") {
    return (
      <StartPanel
        profiles={profiles}
        proxies={proxies}
        overview={initial}
        starting={phase.kind === "starting"}
        error={startError}
        onStart={(profileId) => void start(profileId)}
      />
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
                window.close();
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
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setStartError(null);
              setPhase({ kind: "idle" });
            }}
          >
            Start a new session
          </Button>
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
      <TabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={(id) => {
          send({ type: "activate-tab", tabId: id });
        }}
        onClose={(id) => {
          send({ type: "close-tab", tabId: id });
        }}
        onNew={() => {
          send({ type: "new-tab" });
        }}
      />

      <div className="flex items-center gap-2 border-b border-line bg-canvas px-3 py-2">
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
                  window.close();
                }
              : undefined
          }
          onEnd={() => {
            setConfirmEnd(true);
          }}
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
        />
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
                ? "Connecting to your browser…"
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
      />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
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
      <EndSessionDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        onConfirm={() => void end()}
        busy={ending}
      />
    </div>
  );
}
