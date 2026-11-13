"use client";

import {
  type AgentMessage,
  type BrowserOverview,
  type BrowserSession,
  type ClientMessageInput,
  type FrameHeader,
  type Profile,
  type RefusedAction,
  type TabState,
  type TransferMessage,
  type Viewport,
} from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Spinner } from "@brawzer/ui/components/spinner";
import { useToast } from "@brawzer/ui/components/toast";
import { Tooltip } from "@brawzer/ui/components/tooltip";
import { cn } from "@brawzer/ui/lib/cn";
import {
  ArrowLeft,
  ArrowRight,
  Keyboard,
  Lock,
  LockOpen,
  Maximize2,
  Plus,
  Printer,
  RotateCw,
  Square,
  X,
} from "lucide-react";
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
import { displayUrl, hostOf, resolveTyped } from "@/lib/browser/input";
import { BrowserStream, describeClose, type StreamEvent } from "@/lib/browser/stream";
import { leaveSignedInArea, onSessionMessage } from "@/lib/session-channel";
import { EndSessionDialog, PageDialog, type PageDialogState, ShortcutsPopover } from "./dialogs";
import { type ChooserRequest, DrivePicker } from "./drive-picker";
import { StartPanel } from "./start-panel";
import { BrowserViewport, type Shortcut, type ViewportHandle } from "./viewport";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "connecting"; session: BrowserSession }
  | { kind: "live"; session: BrowserSession }
  | { kind: "ended"; message: string };

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
}: {
  initial: BrowserOverview;
  profiles: readonly Profile[];
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
      if (event.kind === "frame") {
        viewportRef.current?.draw(event.header, event.image);
        return;
      }
      if (event.kind === "closed") {
        const current = phaseRef.current;
        if (current.kind !== "live" && current.kind !== "connecting") return;
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
        setEngine(message.engine.version);
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
      case "transfer": {
        const described = describeTransfer(message);
        if (!described) return;
        toast.add({
          ...described,
          ...(message.state === "saved" || message.state === "quarantined"
            ? {
                actionProps: {
                  children: "Open Drive",
                  onClick: () => window.open("/app/drive", "_blank", "noopener"),
                },
              }
            : {}),
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
        if (message.code === "replaced" || message.code === "ended") {
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
      }
    },
    [tabs, activeTabId, send],
  );

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
        overview={initial}
        starting={phase.kind === "starting"}
        error={startError}
        onStart={(profileId) => void start(profileId)}
      />
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
  const profileName = profiles.find((profile) => profile.id === session.profileId)?.name;
  const shownAddress = address ?? displayUrl(activeTab?.url ?? "");

  return (
    <div
      ref={containerRef}
      className="fullscreen:bg-canvas flex h-full min-h-0 flex-col bg-canvas"
      data-testid="browser-workspace"
    >
      {/* Tabs */}
      <div className="flex items-end gap-1 overflow-x-auto border-b border-line bg-surface px-2 pt-2">
        <div role="tablist" aria-label="Tabs" className="flex min-w-0 items-end gap-1">
          {tabs.map((tab) => {
            const selected = tab.id === activeTabId;
            const title =
              tab.url === "about:blank" ? "New tab" : tab.title || hostOf(tab.url) || "New tab";
            return (
              // The tab itself carries the role; the close control sits inside it.
              <div
                key={tab.id}
                role="tab"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                aria-controls="browser-viewport"
                title={title}
                className={cn(
                  "group flex h-9 max-w-56 min-w-28 cursor-default items-center gap-1 rounded-t-lg border border-b-0 pr-1 pl-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                  selected
                    ? "border-line bg-canvas text-ink"
                    : "border-transparent text-ink-secondary hover:bg-hover",
                )}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("[data-tab-close]")) {
                    send({ type: "close-tab", tabId: tab.id });
                  } else if (!selected) {
                    send({ type: "activate-tab", tabId: tab.id });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!selected) send({ type: "activate-tab", tabId: tab.id });
                  } else if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    send({ type: "close-tab", tabId: tab.id });
                  }
                }}
              >
                <span className="min-w-0 flex-1 truncate text-left text-footnote">
                  {tab.loading && <Spinner className="mr-1.5 inline size-3 align-[-2px]" />}
                  {title}
                </span>
                {/* A mouse target only: keyboard users close the focused tab with Delete or Alt+W. */}
                <span
                  aria-hidden="true"
                  data-tab-close
                  data-testid="tab-close"
                  className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-tertiary opacity-70 group-hover:opacity-100 hover:bg-hover hover:text-ink"
                >
                  <X className="size-3.5" />
                </span>
              </div>
            );
          })}
        </div>
        <Tooltip content="New tab (Alt+T)">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New tab"
            className="mb-0.5"
            onClick={() => {
              send({ type: "new-tab" });
            }}
          >
            <Plus aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>

      {/* Address bar and controls */}
      <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
        <Tooltip content="Back (Alt+←)">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            disabled={!activeTab?.canGoBack}
            onClick={() => {
              onShortcut("back");
            }}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip content="Forward (Alt+→)">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Forward"
            disabled={!activeTab?.canGoForward}
            onClick={() => {
              onShortcut("forward");
            }}
          >
            <ArrowRight aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip content={activeTab?.loading ? "Stop" : "Reload (Alt+R)"}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={activeTab?.loading ? "Stop loading" : "Reload"}
            disabled={!activeTab}
            onClick={() => {
              if (!activeTab) return;
              send({ type: activeTab.loading ? "stop" : "reload", tabId: activeTab.id });
            }}
          >
            {activeTab?.loading ? <Square aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
          </Button>
        </Tooltip>
        <form method="post" onSubmit={submitAddress} className="flex min-w-0 flex-1 items-center">
          <label htmlFor="browser-address" className="sr-only">
            Address or search
          </label>
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-canvas px-3 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--bw-accent-soft)]">
            {activeTab?.security === "secure" ? (
              <Lock aria-label="Secure connection" className="size-3.5 shrink-0 text-success" />
            ) : activeTab?.security === "insecure" ? (
              <LockOpen aria-label="Not secure" className="size-3.5 shrink-0 text-warning" />
            ) : null}
            <input
              ref={addressRef}
              id="browser-address"
              name="address"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search or type an address"
              className="min-w-0 flex-1 bg-transparent text-callout text-ink outline-none placeholder:text-ink-tertiary"
              value={shownAddress}
              onChange={(event) => {
                setAddress(event.target.value);
              }}
              onFocus={(event) => {
                event.target.select();
              }}
              onBlur={() => {
                setAddress(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAddress(null);
                  viewportRef.current?.focus();
                }
              }}
            />
          </div>
        </form>
        <Tooltip content="Save as PDF in Drive (Alt+P)">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Save page as PDF in Drive"
            disabled={!activeTab || activeTab.url === "about:blank"}
            onClick={() => {
              onShortcut("print");
            }}
          >
            <Printer aria-hidden="true" />
          </Button>
        </Tooltip>
        {coarsePointer && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Type into the page"
            onClick={() => viewportRef.current?.focusKeyboard()}
          >
            <Keyboard aria-hidden="true" />
          </Button>
        )}
        {!coarsePointer && <ShortcutsPopover />}
        <Tooltip content="Full screen">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Full screen"
            onClick={() => void fullScreen()}
          >
            <Maximize2 aria-hidden="true" />
          </Button>
        </Tooltip>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setConfirmEnd(true);
          }}
        >
          End session
        </Button>
      </div>

      {/* The page */}
      <div className="relative flex min-h-0 flex-1 flex-col" id="browser-viewport">
        <BrowserViewport
          ref={viewportRef}
          tabId={activeTab?.id ?? null}
          send={sendIfLive}
          onDrawn={onDrawn}
          onViewport={onViewport}
          onShortcut={onShortcut}
          onReady={onReady}
        />
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

      {/* Status */}
      <div className="flex items-center gap-3 border-t border-line bg-surface px-3 py-1 text-caption text-ink-tertiary">
        <span>Streaming from Brawzer’s cloud{engine ? ` · ${engine}` : ""}</span>
        {profileName && <span>· {profileName}</span>}
        <span className="ml-auto" aria-live="polite">
          Ends in {remainingLabel(session.expiresAt, now)} at most
        </span>
      </div>

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
