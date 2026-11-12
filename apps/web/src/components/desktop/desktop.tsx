"use client";

import type { BrowserEngine, BrowserSession, DriveFile, DriveFolder } from "@brawzer/contracts";
import { useToast } from "@brawzer/ui/components/toast";
import { cn } from "@brawzer/ui/lib/cn";
import { Logo } from "@brawzer/ui/brand";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { EngineLogo } from "@/components/browser/engine-logo";
import { endBrowserSession, fetchBrowserOverview } from "@/lib/api/browser";
import {
  createFolder,
  deleteFile,
  emptyTrash,
  fetchDriveOverview,
  listFilesInFolder,
  updateFile,
} from "@/lib/api/drive";
import { NameDialog } from "@/components/drive/dialogs";
import { clearCutFile, cutFile, readCutFile } from "@/lib/file-clipboard";
import { clearIconPositions, readIconPositions } from "@/lib/icon-positions";
import { fetchSecurityOverview } from "@/lib/api/security";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { subscribeToClock } from "@/lib/clock";
import {
  chosenDesktopStyle,
  type DesktopStyle,
  desktopActive,
  readDesktopStyle,
  setDesktopStyle,
  subscribeToDesktop,
} from "@/lib/desktop";
import { setFocusedName } from "@/lib/desktop-focus";
import { formatBytes } from "@/lib/drive";
import {
  chooseDesktopStyle,
  defaultDesktopPrefs,
  desktopPrefsLoaded,
  loadDesktopPrefs,
  readDesktopPrefs,
  setPinned,
  subscribeToDesktopPrefs,
  toggleFavourite,
  updateDesktopPrefs,
} from "@/lib/desktop-prefs";
import { currentExam, endExam, examAllows, loadExam, subscribeToExam } from "@/lib/exam";
import { isLocked, lockNow, subscribeToLock } from "@/lib/lock";
import { add as addScreenTime, flushScreenTime, loadScreenTime } from "@/lib/screen-time";
import { playSound } from "@/lib/sounds";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";
import { clearClipboard, endEverySession, wipeThisComputer } from "@/lib/wipe";
import { type AppWindowApi, AppWindowContext } from "./apps/app-window";
import { saveToDrive } from "./apps/drive-save";
import { type AppId, AppIcon, apps, dockSystemApps, Tile } from "./apps/registry";
import { type WebApp, webAppById } from "./apps/web-apps";
import { ContextMenuHost, type MenuEntry, openContextMenu } from "./context-menu";
import { DashboardBar } from "./dashboard-bar";
import { appFor } from "./apps/open-with";
import { ControlCentre } from "./control-centre";
import { clearRecentFiles, readRecentFiles } from "@/lib/recent-files";
import {
  type BrowserOpen,
  type DesktopApi,
  DesktopContext,
  type DesktopMessage,
} from "./desktop-context";
import { DesktopIcons } from "./desktop-icons";
import { Dock, type DockActions, Taskbar } from "./dock";
import { Launchpad, StartMenu } from "./launchpad";
import { OsPicker } from "./os-picker";
import { WindowSwitcher } from "./switcher";
import { FileInfoDialog, LeaveNoTraceDialog, ShortcutsDialog, WipeDialog } from "./system-dialogs";
import { WallpaperDialog } from "./wallpaper";
import { type Rect, type Snap, snapRect, TitleBar, trackPointer } from "./window-chrome";
import {
  type DesktopWindow,
  isBrowserWindow,
  type WindowContent,
  windowLabel,
  windowTitle,
} from "./windows";
import "@/components/browser/launcher.css";
import "./desktop.css";
import "./apps/apps.css";

interface DashboardState {
  hidden: boolean;
  /** Null: where the stylesheet puts it, filling the desktop. */
  rect: Rect | null;
  /** Where a zoom or snap goes back to ("auto": the stylesheet's place). */
  restore: Rect | "auto" | null;
  z: number;
}

const useDesktopActive = () => useSyncExternalStore(subscribeToDesktop, desktopActive, () => false);
const useLocked = () => useSyncExternalStore(subscribeToLock, isLocked, () => false);
const useExam = () => useSyncExternalStore(subscribeToExam, currentExam, () => null);
const quarterMinute = () => Math.floor(Date.now() / 15_000);
const useStyle = () =>
  useSyncExternalStore<DesktopStyle>(subscribeToDesktop, readDesktopStyle, () => "mac");
/** The style chosen in this tab, if any (on the server: as if chosen, so nothing asks). */
const useChosenStyle = () =>
  useSyncExternalStore(subscribeToDesktop, chosenDesktopStyle, () => "mac" as const);
const usePrefsLoaded = () =>
  useSyncExternalStore(subscribeToDesktopPrefs, desktopPrefsLoaded, () => false);
const useDark = () =>
  useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );

/** What Exam Mode calls a window's content: "app:notepad", "browser:chrome". */
const examTarget = (content: WindowContent) =>
  content.kind === "browser" ? `browser:${content.session.engine}` : `app:${content.app}`;
/** What screen time counts a window as: "files", "browser:chrome". */
const focusedWindowKey = (entry: DesktopWindow | undefined) =>
  entry
    ? entry.content.kind === "browser"
      ? `browser:${entry.content.session.engine}`
      : entry.content.app
    : null;

/** The Dock or taskbar icon a window flies to when it's minimised. */
const dockKey = (content: WindowContent) =>
  content.kind === "browser" ? `browser:${content.session.engine}` : `app:${content.app}`;

/** A browser window's page, and what it should open once its stream is up. */
function frameSource(sessionId: string, open?: BrowserOpen): string {
  const params = new URLSearchParams({ session: sessionId, embedded: "1" });
  if (open?.url) params.set("open", open.url);
  if (open?.page) params.set("page", open.page);
  return `/app/browser/window?${params.toString()}`;
}

/** A title bar's height (2.375rem) and a little more: how far each new window steps. */
const CASCADE_Y = 42;

/**
 * Where the nth new window goes: cascaded down and right by a title bar's
 * height, so every window behind keeps its title and buttons in view.
 */
const BROWSER_WINDOW = { width: 780, height: 500 };

/** Whether the dashboard is out or in the Dock, kept for this tab. */
const DASH_KEY = "brawzer:dash";
const dashListeners = new Set<() => void>();
function rememberDash(state: "shown" | "hidden") {
  try {
    window.sessionStorage.setItem(DASH_KEY, state);
  } catch {
    // Nothing kept.
  }
  for (const listener of dashListeners) listener();
}
const subscribeToDash = (listener: () => void) => {
  dashListeners.add(listener);
  return () => {
    dashListeners.delete(listener);
  };
};
/** What this tab chose; a fresh tab at /app starts on the desktop. */
function readDashPref(): "shown" | "hidden" | null {
  try {
    const kept = window.sessionStorage.getItem(DASH_KEY);
    if (kept === "shown" || kept === "hidden") return kept;
  } catch {
    return null;
  }
  return window.location.pathname === "/app" ? "hidden" : null;
}

/** Who wants to know when the start-up screen is taken away. */
const bootListeners = new Set<() => void>();
const subscribeToBoot = (listener: () => void) => {
  bootListeners.add(listener);
  return () => {
    bootListeners.delete(listener);
  };
};

function cascade(area: Rect, index: number, size?: { width: number; height: number }): Rect {
  const step = index % 4;
  const top = area.top + CASCADE_Y * (step + 1);
  const width = Math.min(size?.width ?? 1180, area.width - 80);
  const height = Math.min(size?.height ?? 780, area.height - (top - area.top) - 8);
  return {
    left: Math.max(area.left, area.left + (area.width - width) / 2 - 60 + step * 30),
    top,
    width,
    height,
  };
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The prototype's genie: from a window to a Dock icon, as a transform. */
function flyTransform(from: DOMRect, to: DOMRect): string {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  return `translate(${String(dx)}px, ${String(dy)}px) scale(${String(Math.max(0.04, to.width / from.width))})`;
}

const visible = (element: Element) => element.getClientRects().length > 0;

/**
 * The signed-in app as the prototype's desktop (wide screens, unless
 * switched off): the dashboard (the app's pages) in a window that flies in
 * from the Dock's Brawzer icon and back, each cloud browser and each app in
 * a window, a Dock (Mac style) or taskbar (Windows style), Launchpad or
 * Start, Control Centre, the desktop's icons, right-click menus everywhere,
 * a window switcher and a wallpaper. On phones and with the desktop off,
 * the app is as it was: the stylesheet hides these extras.
 */
export function DesktopShell({
  menuBar,
  overlays,
  email,
  admin = false,
  children,
}: {
  menuBar: ReactNode;
  overlays?: ReactNode;
  /** The account's, for Start. */
  email: string;
  /** Whether the Account menu offers Admin. */
  admin?: boolean;
  children: ReactNode;
}) {
  const toast = useToast();
  const router = useRouter();
  const active = useDesktopActive();
  // Locked, no window streams: the frames come back, and reconnect, on unlocking.
  const locked = useLocked();
  const style = useStyle();
  const dark = useDark();
  const chosen = useChosenStyle();
  const prefsLoaded = usePrefsLoaded();
  const exam = useExam();
  const examTick = useSyncExternalStore(subscribeToClock, quarterMinute, () => 0);
  const shellRef = useRef<HTMLDivElement>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const dockTile = useRef<HTMLButtonElement>(null);
  const taskbarTile = useRef<HTMLButtonElement>(null);
  const zTop = useRef(10);
  const appCount = useRef(0);
  /** Each browser window's frame, to pass it what to open. */
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  /** Each window's element, for the Dock animations. */
  const windowElements = useRef(new Map<string, HTMLElement>());
  const [dragging, setDragging] = useState(false);
  const [snapHint, setSnapHint] = useState<Rect | null>(null);
  const [windows, setWindows] = useState<DesktopWindow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardState>({
    hidden: false,
    rect: null,
    restore: null,
    z: 5,
  });
  const [focused, setFocused] = useState<string>("dashboard");
  const [engines, setEngines] = useState<readonly BrowserEngine[]>([]);
  const [limit, setLimit] = useState(3);
  const [cloud, setCloud] = useState<"available" | "unavailable" | null>(null);
  /** How long the last check of the cloud took, there and back. */
  const [latency, setLatency] = useState<number | null>(null);
  const [issues, setIssues] = useState(0);
  const [drive, setDrive] = useState<{ used: number; limit: number } | null>(null);
  const [deskFiles, setDeskFiles] = useState<readonly DriveFile[]>([]);
  const [deskFolders, setDeskFolders] = useState<readonly DriveFolder[]>([]);
  const [renaming, setRenaming] = useState<DriveFile | null>(null);
  const [info, setInfo] = useState<DriveFile | null>(null);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [noTrace, setNoTrace] = useState<"ask" | { windows: number; sessions: number } | null>(
    null,
  );
  const [switcher, setSwitcher] = useState<number | null>(null);
  // The dock as the account keeps it: pinned apps and installed web apps.
  const prefs = useSyncExternalStore(
    subscribeToDesktopPrefs,
    readDesktopPrefs,
    defaultDesktopPrefs,
  );
  const pinned = prefs.pinned;
  const installedWebApps = prefs.webApps.flatMap((id) => {
    const app = webAppById(id);
    return app ? [app] : [];
  });
  const { launch } = useLaunchBrowser();
  const openWebApp = (app: WebApp) => {
    void launch(engines.includes("bee") ? "bee" : (engines[0] ?? "bee"), undefined, {
      open: { url: app.url },
    });
  };

  const bounds = useCallback(
    () => shellRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 1280, 800),
    [],
  );
  /** The part of the desktop windows may fill: below the menu bar, above the dock. */
  const workArea = useCallback((): Rect => {
    const box = bounds();
    const windowsStyle = readDesktopStyle() === "windows";
    const top = windowsStyle ? 0 : 32;
    const bottom = windowsStyle ? 48 : 88;
    return windowsStyle
      ? { left: 0, top, width: box.width, height: box.height - top - bottom }
      : { left: 6, top, width: box.width - 12, height: box.height - top - bottom };
  }, [bounds]);

  const raise = () => {
    zTop.current += 1;
    return zTop.current;
  };

  /** The Dock or taskbar icon for a key, as it's drawn now (one of the two is hidden). */
  const dockTarget = useCallback((key: string): HTMLElement | null => {
    const shell = shellRef.current;
    if (!shell) return null;
    const found = [...shell.querySelectorAll<HTMLElement>(`[data-dock="${key}"]`)].find(visible);
    return (
      found ??
      [...shell.querySelectorAll<HTMLElement>(".dt-dock, .dt-taskbar")].find(visible) ??
      null
    );
  }, []);

  /** Opens a window for the content, or brings its window forward. */
  const openWindow = useCallback(
    (content: WindowContent) => {
      if (!examAllows(examTarget(content))) {
        toast.add({
          type: "info",
          title: "Not during Exam Mode",
          description: "Only the apps and browsers you chose open until its time is up.",
        });
        return;
      }
      zTop.current += 1;
      const z = zTop.current;
      // A new app window's id is decided here, so it can be focused at once.
      const newId =
        content.kind === "browser" ? content.session.id : `app-${String((appCount.current += 1))}`;
      let target = newId;
      let added = false;
      setWindows((current) => {
        const existing =
          content.kind === "browser"
            ? current.find((entry) => entry.id === content.session.id)
            : apps[content.app].single
              ? current.find(
                  (entry) => entry.content.kind === "app" && entry.content.app === content.app,
                )
              : undefined;
        if (existing) {
          target = existing.id;
          // An open window keeps its frame: what to open is passed to it instead.
          if (content.kind === "browser" && content.open) {
            const open = content.open;
            queueMicrotask(() => {
              frames.current
                .get(existing.id)
                ?.contentWindow?.postMessage(
                  { type: "brawzer:open", open },
                  window.location.origin,
                );
            });
          }
          // The frame's address stays as it was, so the window doesn't reload.
          const kept =
            content.kind === "browser" && existing.content.kind === "browser"
              ? { ...content, open: existing.content.open }
              : content;
          return current.map((entry) =>
            entry === existing ? { ...entry, content: kept, min: false, z } : entry,
          );
        }
        added = true;
        // Browsers open at the prototype's window size; apps at their own.
        const size = content.kind === "app" ? apps[content.app] : BROWSER_WINDOW;
        return [
          ...current,
          {
            id: newId,
            content,
            title: null,
            min: false,
            restore: null,
            z,
            rect: cascade(workArea(), current.length, size),
          },
        ];
      });
      // The single-instance window's id is known once the update above has run.
      queueMicrotask(() => {
        setFocused(target);
        if (added) playSound("click");
      });
    },
    [workArea, toast],
  );

  const openSession = useCallback(
    (session: BrowserSession, open?: BrowserOpen) => {
      openWindow({ kind: "browser", session, open });
    },
    [openWindow],
  );

  const screenshot = useCallback((sessionId: string) => {
    playSound("shot");
    frames.current
      .get(sessionId)
      ?.contentWindow?.postMessage({ type: "brawzer:screenshot" }, window.location.origin);
  }, []);

  const openApp = useCallback(
    (app: AppId, params: Record<string, string> = {}) => {
      openWindow({ kind: "app", app, params });
    },
    [openWindow],
  );

  const dashboardState = useRef(dashboard);
  const dashHinted = useRef(false);

  // A fresh tab at /app starts on the plain desktop, as the prototype does; the
  // dashboard waits in the Dock. What the person last chose (this tab) is kept.
  const dashPref = useSyncExternalStore(subscribeToDash, readDashPref, () => null);
  const dashHidden = dashboard.hidden || (active && dashPref === "hidden");
  useEffect(() => {
    dashboardState.current = { ...dashboard, hidden: dashHidden };
  });
  // The prototype's one-time hint, kept with the account so it's said once.
  useEffect(() => {
    if (!active || dashPref !== "hidden" || !prefsLoaded || prefs.deskHinted || dashHinted.current)
      return;
    dashHinted.current = true;
    const hint = setTimeout(() => {
      updateDesktopPrefs({ deskHinted: true });
      toast.add({
        type: "info",
        title: "Your desktop",
        description: "Click the Brawzer icon in the Dock to open your dashboard.",
      });
    }, 1_800);
    return () => {
      clearTimeout(hint);
    };
  }, [active, dashPref, prefsLoaded, prefs.deskHinted, toast]);

  /** The dashboard flies out of the Dock's Brawzer icon, or comes forward. */
  const showDashboard = useCallback(() => {
    zTop.current += 1;
    const z = zTop.current;
    const wasHidden = dashboardState.current.hidden;
    rememberDash("shown");
    flushSync(() => {
      setDashboard((current) => ({ ...current, hidden: false, z }));
      setFocused("dashboard");
    });
    const element = dashboardRef.current;
    const tile = [dockTile.current, taskbarTile.current].find(
      (candidate) => candidate && visible(candidate),
    );
    if (!wasHidden || !element || !tile || reducedMotion() || !desktopActive()) return;
    element.animate(
      [
        {
          transform: flyTransform(element.getBoundingClientRect(), tile.getBoundingClientRect()),
          opacity: 0,
        },
        { transform: "none", opacity: 1 },
      ],
      { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" },
    );
  }, []);

  /** …and back into it. */
  const hideDashboard = useCallback(() => {
    const element = dashboardRef.current;
    const tile = [dockTile.current, taskbarTile.current].find(
      (candidate) => candidate && visible(candidate),
    );
    const hide = () => {
      rememberDash("hidden");
      setDashboard((current) => ({ ...current, hidden: true }));
      setFocused((current) => (current === "dashboard" ? "desktop" : current));
    };
    if (dashboardState.current.hidden) return;
    if (!element || !tile || reducedMotion() || !desktopActive()) {
      hide();
      return;
    }
    const flight = element.animate(
      [
        { transform: "none", opacity: 1 },
        {
          transform: flyTransform(element.getBoundingClientRect(), tile.getBoundingClientRect()),
          opacity: 0,
        },
      ],
      { duration: 360, easing: "cubic-bezier(.55,0,.75,.2)", fill: "forwards" },
    );
    flight.onfinish = () => {
      flushSync(hide);
      flight.cancel();
    };
  }, []);

  /** The window in front once one goes: the highest one still showing, or nothing. */
  const focusTop = useCallback((without: string) => {
    setWindows((current) => {
      const top = current
        .filter((entry) => !entry.min && entry.id !== without)
        .sort((a, b) => b.z - a.z)[0];
      const dash = dashboardState.current;
      setFocused(!dash.hidden && (!top || dash.z > top.z) ? "dashboard" : (top?.id ?? "desktop"));
      return current;
    });
  }, []);

  /** A window flies into its Dock icon, then is tucked away. */
  const minimise = useCallback(
    (id: string) => {
      const element = windowElements.current.get(id);
      const entry = windows.find((candidate) => candidate.id === id);
      const done = () => {
        setWindows((current) =>
          current.map((candidate) =>
            candidate.id === id ? { ...candidate, min: true } : candidate,
          ),
        );
        focusTop(id);
      };
      if (!entry || entry.min) return;
      const target = dockTarget(dockKey(entry.content));
      if (!element || !target || reducedMotion()) {
        done();
        return;
      }
      const flight = element.animate(
        [
          { transform: "none", opacity: 1 },
          {
            transform: flyTransform(
              element.getBoundingClientRect(),
              target.getBoundingClientRect(),
            ),
            opacity: 0.15,
          },
        ],
        { duration: 380, easing: "cubic-bezier(.55,0,.75,.2)", fill: "forwards" },
      );
      flight.onfinish = () => {
        flushSync(done);
        flight.cancel();
      };
    },
    [windows, dockTarget, focusTop],
  );

  const showDesktop = useCallback(() => {
    for (const entry of windows) if (!entry.min) minimise(entry.id);
    hideDashboard();
  }, [windows, minimise, hideDashboard]);

  /** The Dock's Brawzer icon, as the prototype's: show it, bring it forward, or send it back. */
  const dockHome = useCallback(() => {
    const dash = dashboardState.current;
    if (dash.hidden) showDashboard();
    else if (focused !== "dashboard" && windows.some((entry) => !entry.min)) showDashboard();
    else hideDashboard();
  }, [focused, windows, showDashboard, hideDashboard]);

  const chooseWallpaper = useCallback(() => {
    setWallpaperOpen(true);
  }, [setWallpaperOpen]);

  const toggleControlCentre = useCallback(() => {
    setControlOpen((current) => !current);
  }, [setControlOpen]);

  const openLauncher = useCallback(() => {
    setLauncherOpen(true);
  }, [setLauncherOpen]);

  const askWipe = useCallback(() => {
    setWipeOpen(true);
  }, [setWipeOpen]);
  const showShortcuts = useCallback(() => {
    setShortcutsOpen(true);
  }, [setShortcutsOpen]);

  const api = useMemo<DesktopApi>(
    () => ({
      openSession,
      screenshot,
      openApp,
      showDashboard,
      showDesktop,
      chooseWallpaper,
      toggleControlCentre,
      openLauncher,
      hideDashboard,
      toggleDashboard: () => {
        if (dashboardState.current.hidden) showDashboard();
        else hideDashboard();
      },
      dashboardHidden: () => dashboardState.current.hidden,
      wipe: askWipe,
      showShortcuts,
    }),
    [
      openSession,
      screenshot,
      openApp,
      showDashboard,
      showDesktop,
      chooseWallpaper,
      toggleControlCentre,
      openLauncher,
      hideDashboard,
      askWipe,
      showShortcuts,
    ],
  );

  // What's offered and what's running: running browsers come back as windows in the dock.
  const apply = useCallback(
    (result: Awaited<ReturnType<typeof fetchBrowserOverview>>) => {
      if (!result.ok) {
        setCloud("unavailable");
        return;
      }
      setEngines(result.data.engines);
      setLimit(result.data.limits.liveSessions);
      setCloud(result.data.runtime);
      setWindows((current) => {
        const live = new Set(result.data.sessions.map((session) => session.id));
        const kept = current.filter(
          (entry) => entry.content.kind !== "browser" || live.has(entry.id),
        );
        const known = new Set(kept.map((entry) => entry.id));
        const area = workArea();
        const added = result.data.sessions
          .filter((session) => !known.has(session.id))
          .map((session, index): DesktopWindow => ({
            id: session.id,
            content: { kind: "browser", session },
            title: null,
            min: true,
            restore: null,
            z: 1,
            rect: cascade(area, kept.length + index),
          }));
        return [...kept, ...added];
      });
    },
    [workArea],
  );

  /** What's in Drive's "Desktop" folder: the desktop's own icons. */
  const loadDesk = useCallback(() => {
    void listFilesInFolder("Desktop").then((files) => {
      setDeskFiles(files);
    });
    void fetchDriveOverview().then((result) => {
      if (result.ok) setDeskFolders(result.data.folders);
    });
  }, []);

  // Whatever changes Drive elsewhere (Files, Trash, saves) refreshes the desktop's icons.
  useEffect(() => {
    if (!active) return;
    window.addEventListener("brawzer:drive-changed", loadDesk);
    return () => {
      window.removeEventListener("brawzer:drive-changed", loadDesk);
    };
  }, [active, loadDesk]);

  /** The Desktop folder's id, made when there is none yet. */
  const desktopFolderId = useCallback(async (): Promise<string | null> => {
    const existing = deskFolders.find(
      (folder) => folder.parentId === null && folder.name === "Desktop",
    );
    if (existing) return existing.id;
    const made = await createFolder({ name: "Desktop", parentId: null, space: "personal" });
    return made.ok ? made.data.id : null;
  }, [deskFolders]);

  /** What a file move or change says when it fails. */
  const fileFailed = useCallback(
    (title: string, message: string) => {
      toast.add({ type: "error", title, description: message });
    },
    [toast],
  );

  /** Pastes the cut file into the Desktop folder: a move. */
  async function pasteOnDesktop() {
    const cut = readCutFile();
    if (!cut) return;
    const folderId = await desktopFolderId();
    if (!folderId) {
      fileFailed("Couldn’t paste it", "The Desktop folder couldn’t be made.");
      return;
    }
    const result = await updateFile(cut.id, { folderId });
    if (!result.ok) {
      fileFailed("Couldn’t paste it", result.error.message);
      return;
    }
    clearCutFile();
    toast.add({ type: "success", title: `Moved “${cut.name}” to the desktop` });
    loadDesk();
  }

  async function moveDeskFile(file: DriveFile, folderId: string | null, where: string) {
    const result = await updateFile(file.id, { folderId });
    if (!result.ok) fileFailed("Couldn’t move it", result.error.message);
    else toast.add({ type: "success", title: `Moved “${file.name}” to ${where}` });
    loadDesk();
  }

  async function trashDeskFile(file: DriveFile) {
    const result = await deleteFile(file.id);
    if (!result.ok) fileFailed("Couldn’t delete it", result.error.message);
    else toast.add({ type: "success", title: `“${file.name}” is in Trash` });
    loadDesk();
  }

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () => {
      const started = performance.now();
      void fetchBrowserOverview().then((result) => {
        if (cancelled) return;
        if (result.ok) setLatency(Math.round(performance.now() - started));
        apply(result);
      });
      void fetchSecurityOverview().then((result) => {
        if (!cancelled && result.ok) setIssues(result.data.recommendations.length);
      });
      void fetchDriveOverview().then((result) => {
        if (!cancelled && result.ok) {
          setDrive({ used: result.data.usage.usedBytes, limit: result.data.usage.limitBytes });
        }
      });
      loadDesk();
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, apply, loadDesk]);

  // The start-up screen plays once; afterwards it's taken away ("Choose your desktop" waits behind it).
  const booting = useSyncExternalStore(
    subscribeToBoot,
    () => Boolean(document.documentElement.dataset.boot),
    () => false,
  );
  useEffect(() => {
    if (!document.documentElement.dataset.boot) return;
    const timer = setTimeout(() => {
      delete document.documentElement.dataset.boot;
      for (const listener of bootListeners) listener();
    }, 2_000);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Exam Mode and the dock's apps: read on arrival. When Exam Mode starts, what it doesn't allow is tucked away.
  useEffect(() => {
    if (!active) return;
    void loadExam();
    void loadDesktopPrefs();
  }, [active]);
  // The style the account chose comes with it, unless this tab chose one itself.
  useEffect(() => {
    if (prefsLoaded && prefs.style && chosenDesktopStyle() === null) setDesktopStyle(prefs.style);
  }, [prefsLoaded, prefs.style]);
  useEffect(
    () =>
      subscribeToExam(() => {
        if (!currentExam()) return;
        setWindows((current) =>
          current.map((entry) =>
            examAllows(examTarget(entry.content)) ? entry : { ...entry, min: true },
          ),
        );
      }),
    [],
  );
  const examLeft = exam ? Math.max(0, Math.ceil((exam.endsAt - examTick * 15_000) / 60_000)) : 0;
  useEffect(() => {
    if (exam && examTick * 15_000 >= exam.endsAt) void endExam();
  }, [exam, examTick]);

  // Framed browser windows say when they're done.
  useEffect(() => {
    const onMessage = (event: MessageEvent<DesktopMessage>) => {
      if (event.origin !== window.location.origin) return;
      const message = event.data;
      if (message.type === "brawzer:close-window") {
        setWindows((current) => current.filter((entry) => entry.id !== message.session));
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  // Screen time: every 15 seconds the app in front is counted (Usage shows it), while this
  // tab is seen and not locked; it's written to the account about once a minute.
  const frontApp =
    focused === "dashboard"
      ? "brawzer"
      : focusedWindowKey(windows.find((entry) => entry.id === focused));
  const frontRef = useRef(frontApp);
  useEffect(() => {
    frontRef.current = frontApp;
  });
  useEffect(() => {
    if (!active) return;
    void loadScreenTime();
    let ticks = 0;
    const timer = setInterval(() => {
      if (isLocked() || document.visibilityState !== "visible") return;
      const app = frontRef.current;
      if (app) addScreenTime(app, 15);
      ticks += 1;
      if (ticks % 4 === 0) void flushScreenTime();
    }, 15_000);
    const flush = () => {
      if (document.visibilityState === "hidden") void flushScreenTime();
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", flush);
      void flushScreenTime();
    };
  }, [active]);

  // The menu bar names the app in front, as a Mac's does.
  const focusedWindow = windows.find((entry) => entry.id === focused);
  const focusedName = focusedWindow ? windowLabel(focusedWindow) : "Brawzer";
  useEffect(() => {
    setFocusedName(active ? focusedName : "Brawzer");
  }, [active, focusedName]);

  function focusWindow(id: string) {
    if (id === "dashboard") {
      showDashboard();
      return;
    }
    const target = windows.find((entry) => entry.id === id);
    if (target && !examAllows(examTarget(target.content))) {
      toast.add({
        type: "info",
        title: "Not during Exam Mode",
        description: "It stays minimised until Exam Mode ends.",
      });
      return;
    }
    const z = raise();
    const wasMin = target?.min ?? false;
    flushSync(() => {
      setWindows((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, min: false, z } : entry)),
      );
      setFocused(id);
    });
    // Back out of its Dock icon.
    const element = windowElements.current.get(id);
    const from = target && dockTarget(wasMin ? `win:${id}` : dockKey(target.content));
    if (!wasMin || !element || !from || reducedMotion()) return;
    element.animate(
      [
        {
          transform: flyTransform(element.getBoundingClientRect(), from.getBoundingClientRect()),
          opacity: 0.15,
        },
        { transform: "none", opacity: 1 },
      ],
      { duration: 360, easing: "cubic-bezier(.22,1,.36,1)" },
    );
  }

  function zoom(id: string) {
    setWindows((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry;
        if (entry.restore) return { ...entry, rect: entry.restore, restore: null };
        return { ...entry, restore: entry.rect, rect: workArea() };
      }),
    );
  }

  function snapWindow(id: string, snap: Snap) {
    setWindows((current) =>
      current.map((entry) =>
        entry.id === id
          ? { ...entry, restore: entry.restore ?? entry.rect, rect: snapRect(snap, workArea()) }
          : entry,
      ),
    );
  }

  async function close(entry: DesktopWindow) {
    const element = windowElements.current.get(entry.id);
    const remove = () => {
      setWindows((current) => current.filter((candidate) => candidate.id !== entry.id));
      focusTop(entry.id);
    };
    if (element && !entry.min && !reducedMotion()) {
      element.animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "scale(.94)" },
        ],
        { duration: 170, easing: "ease-in", fill: "forwards" },
      ).onfinish = remove;
    } else {
      remove();
    }
    if (!isBrowserWindow(entry)) return;
    const result = await endBrowserSession(entry.content.session.id);
    if (result.ok || result.status === 404) {
      toast.add({
        type: "success",
        title: `${windowLabel(entry)} closed`,
        description: "Its session has ended; a profile that keeps its data saved it.",
      });
    } else {
      toast.add({ type: "error", title: "Couldn’t end it", description: result.error.message });
    }
  }

  function dragWindow(
    event: ReactPointerEvent<HTMLElement>,
    entry: DesktopWindow,
    kind: "move" | "resize",
  ) {
    focusWindow(entry.id);
    setDragging(true);
    const set = (rect: Rect) => {
      setWindows((current) =>
        current.map((candidate) =>
          candidate.id === entry.id ? { ...candidate, rect } : candidate,
        ),
      );
    };
    trackPointer(
      event,
      kind,
      entry.rect,
      bounds,
      set,
      (snap) => {
        setDragging(false);
        if (snap) snapWindow(entry.id, snap);
      },
      (snap) => {
        setSnapHint(snap ? snapRect(snap, workArea()) : null);
      },
    );
  }

  function dashboardRect(): Rect {
    if (dashboard.rect) return dashboard.rect;
    const shell = bounds();
    const box = dashboardRef.current?.getBoundingClientRect() ?? shell;
    return {
      left: box.left - shell.left,
      top: box.top - shell.top,
      width: box.width,
      height: box.height,
    };
  }

  function dragDashboard(event: ReactPointerEvent<HTMLElement>, kind: "move" | "resize") {
    showDashboard();
    setDragging(true);
    trackPointer(
      event,
      kind,
      dashboardRect(),
      bounds,
      (rect) => {
        setDashboard((current) => ({ ...current, rect }));
      },
      (snap) => {
        setDragging(false);
        if (snap) {
          const rect = snapRect(snap, workArea());
          setDashboard((current) => ({ ...current, restore: current.rect ?? "auto", rect }));
        }
      },
      (snap) => {
        setSnapHint(snap ? snapRect(snap, workArea()) : null);
      },
    );
  }

  function zoomDashboard() {
    setDashboard((current) =>
      current.restore
        ? { ...current, rect: current.restore === "auto" ? null : current.restore, restore: null }
        : { ...current, restore: current.rect ?? "auto", rect: workArea() },
    );
  }

  // The window switcher: the dashboard and every window, most recently used first.
  const switchable = useMemo(() => {
    const entries: { z: number; entry: "dashboard" | DesktopWindow }[] = [
      ...(dashHidden ? [] : [{ z: dashboard.z, entry: "dashboard" as const }]),
      ...windows.map((entry) => ({ z: entry.min ? 0 : entry.z, entry })),
    ];
    return entries.sort((a, b) => b.z - a.z).map((item) => item.entry);
  }, [windows, dashboard, dashHidden]);
  const keys = useRef({ switchable, switcher, focusWindow, focused, minimise, hideDashboard });
  useEffect(() => {
    keys.current = { switchable, switcher, focusWindow, focused, minimise, hideDashboard };
  });

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isLocked()) return;
      // ⌘M or Ctrl+M: the window in front goes to the Dock.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "m") {
        const { focused: front, minimise: tuck, hideDashboard: hide } = keys.current;
        if (front === "desktop") return;
        event.preventDefault();
        if (front === "dashboard") hide();
        else tuck(front);
        return;
      }
      if (!event.altKey || event.code !== "Backquote") return;
      event.preventDefault();
      const { switchable: list, switcher: current } = keys.current;
      if (list.length === 0) return;
      const step = event.shiftKey ? -1 : 1;
      setSwitcher(((current ?? 0) + step + list.length) % list.length);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const { switchable: list, switcher: current, focusWindow: focus } = keys.current;
      if (current === null) return;
      if (event.key === "Escape") {
        setSwitcher(null);
        return;
      }
      if (event.key !== "Alt") return;
      const chosenEntry = list[current];
      setSwitcher(null);
      if (chosenEntry === "dashboard") focus("dashboard");
      else if (chosenEntry) focus(chosenEntry.id);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active]);

  // ── Menus, as the prototype's ──────────────────────────────────────────

  const go = (href: Route) => {
    router.push(href);
    showDashboard();
  };

  const appInfo = (app: AppId) => {
    toast.add({
      type: "info",
      title: apps[app].name,
      description: `${apps[app].description} It runs in Brawzer; nothing installs on this computer.`,
    });
  };

  const dashboardMenu = (): MenuEntry[] => [
    {
      label: dashHidden ? "Show Brawzer" : "Hide Brawzer",
      onSelect: dashHidden ? showDashboard : hideDashboard,
    },
    { heading: "Go to" },
    ...(
      [
        ["Home", "/app"],
        ["Browser", "/app/browser"],
        ["Drive", "/app/drive"],
        ["Shield", "/app/shield"],
        ["Sessions", "/app/sessions"],
        ["Account", "/app/account"],
      ] as const
    ).map(([label, href]) => ({
      label,
      onSelect: () => {
        go(href);
      },
    })),
  ];

  const appMenu = (app: AppId): MenuEntry[] => {
    if (app === "trash") {
      return [
        {
          label: "Open",
          onSelect: () => {
            openApp("trash");
          },
        },
        {
          label: "Empty Trash",
          danger: true,
          onSelect: () => {
            void emptyTrash().then((result) => {
              if (result.ok) {
                playSound("trash");
                toast.add({ type: "success", title: "Trash emptied" });
              } else {
                toast.add({
                  type: "error",
                  title: "Couldn’t empty Trash",
                  description: result.error.message,
                });
              }
            });
          },
        },
      ];
    }
    const own = windows.filter(
      (entry) => entry.content.kind === "app" && entry.content.app === app,
    );
    const items: MenuEntry[] = [];
    if (own.length > 0) {
      items.push({ heading: "Windows" });
      for (const entry of own) {
        items.push({
          label: windowTitle(entry),
          checked: focused === entry.id && !entry.min,
          onSelect: () => {
            focusWindow(entry.id);
          },
        });
      }
      items.push("-");
    }
    if (own.length === 0 || !apps[app].single) {
      items.push({
        label: own.length > 0 ? "New window" : "Open",
        onSelect: () => {
          openApp(app);
        },
      });
    }
    if (own.length > 0) {
      items.push(
        {
          label: "Show all windows",
          onSelect: () => {
            for (const entry of own) focusWindow(entry.id);
          },
        },
        {
          label: "Minimise all",
          onSelect: () => {
            for (const entry of own) minimise(entry.id);
          },
        },
      );
    }
    items.push("-");
    if (!dockSystemApps.includes(app)) {
      const kept = pinned.includes(app);
      items.push({
        label: kept
          ? style === "windows"
            ? "Unpin from taskbar"
            : "Remove from Dock"
          : style === "windows"
            ? "Pin to taskbar"
            : "Keep in Dock",
        onSelect: () => {
          setPinned(app, !kept);
        },
      });
    }
    items.push({
      label: "App info",
      onSelect: () => {
        appInfo(app);
      },
    });
    if (own.length > 0) {
      items.push("-", {
        label: "Quit",
        onSelect: () => {
          for (const entry of own) void close(entry);
        },
      });
    }
    return items;
  };

  const browserMenu = (engine: BrowserEngine): MenuEntry[] => {
    const own = windows.filter(
      (entry) => entry.content.kind === "browser" && entry.content.session.engine === engine,
    );
    return [
      ...(own.length > 0
        ? ([
            { heading: "Windows" },
            ...own.map((entry) => ({
              label: windowTitle(entry),
              checked: focused === entry.id && !entry.min,
              onSelect: () => {
                focusWindow(entry.id);
              },
            })),
            "-",
          ] satisfies MenuEntry[])
        : []),
      {
        label: "New window",
        onSelect: () => void launch(engine),
      },
      {
        label: "Extensions…",
        onSelect: () => {
          go("/app/extensions");
        },
      },
      ...(own.length > 0
        ? ([
            {
              label: "Minimise all",
              onSelect: () => {
                for (const entry of own) minimise(entry.id);
              },
            },
            "-",
            {
              label: "Quit",
              onSelect: () => {
                for (const entry of own) void close(entry);
              },
            },
          ] satisfies MenuEntry[])
        : []),
    ];
  };

  const windowMenu = (entry: DesktopWindow): MenuEntry[] => [
    {
      label: "Minimise",
      shortcut: style === "mac" ? "⌘M" : "Ctrl+M",
      onSelect: () => {
        minimise(entry.id);
      },
    },
    {
      label: entry.restore ? "Restore size" : "Zoom",
      onSelect: () => {
        zoom(entry.id);
      },
    },
    {
      label: "Snap",
      children: [
        {
          label: "Left half",
          onSelect: () => {
            snapWindow(entry.id, "left");
          },
        },
        {
          label: "Right half",
          onSelect: () => {
            snapWindow(entry.id, "right");
          },
        },
        {
          label: "Fill the screen",
          onSelect: () => {
            snapWindow(entry.id, "max");
          },
        },
      ],
    },
    "-",
    ...(entry.content.kind === "app"
      ? ([
          {
            label: `About ${apps[entry.content.app].name}`,
            onSelect: () => {
              if (entry.content.kind === "app") appInfo(entry.content.app);
            },
          },
          "-",
        ] satisfies MenuEntry[])
      : []),
    {
      label: "Close window",
      onSelect: () => void close(entry),
    },
  ];

  /** New → a file in Drive's "Desktop" folder, opened in its app. */
  const newOnDesktop = async (name: string, content: string, type: string) => {
    const result = await saveToDrive({ name, content, type, folder: "Desktop" });
    if (!result.ok) {
      toast.add({ type: "error", title: "Couldn’t make it", description: result.error.message });
      return;
    }
    loadDesk();
    const app = appFor(result.data);
    if (app) openApp(app, { file: result.data.id, name: result.data.name });
  };

  const uploadToDesktop = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])];
      void Promise.all(
        files.map((file) =>
          saveToDrive({ name: file.name, content: file, type: file.type, folder: "Desktop" }),
        ),
      ).then((results) => {
        const failed = results.find((result) => !result.ok);
        if (failed) {
          toast.add({
            type: "error",
            title: "Some files didn’t upload",
            description: failed.error.message,
          });
        } else {
          toast.add({
            type: "success",
            title: `${String(files.length)} file${files.length === 1 ? "" : "s"} on the desktop`,
            description: "They’re in Drive’s “Desktop” folder, scanned and encrypted.",
          });
        }
        loadDesk();
      });
    });
    input.click();
  };

  const desktopMenu = (): MenuEntry[] => {
    const cut = readCutFile();
    const placed = Object.keys(readIconPositions()).length > 0;
    return [
      {
        label: "New",
        children: [
          {
            label: "Text file",
            icon: <Tile glyph="note" colour="yellow" size={18} />,
            // A newline, not nothing: Drive reads an empty file as unknown, and text opens in its app.
            onSelect: () => void newOnDesktop("Untitled.txt", "\n", "text/plain"),
          },
          {
            label: "Document",
            icon: <Tile glyph="doc" colour="blue" size={18} />,
            onSelect: () =>
              void newOnDesktop(
                "Untitled document.html",
                '<!doctype html><html><head><meta charset="utf-8"><title>Untitled document</title></head><body><p></p></body></html>',
                "text/html",
              ),
          },
          {
            label: "Spreadsheet",
            icon: <Tile glyph="table" colour="green" size={18} />,
            onSelect: () => void newOnDesktop("Untitled sheet.csv", "\n", "text/csv"),
          },
        ],
      },
      {
        label: "Paste",
        shortcut: keyOf("V"),
        disabled: !cut,
        sub: cut ? `“${cut.name}”, cut` : undefined,
        onSelect: () => void pasteOnDesktop(),
      },
      { label: "Upload files to the desktop…", onSelect: uploadToDesktop },
      "-",
      {
        label: dashHidden ? "Show dashboard" : "Hide dashboard",
        onSelect: dashHidden ? showDashboard : hideDashboard,
      },
      {
        label: "Open Files",
        onSelect: () => {
          openApp("files");
        },
      },
      { label: "Recent files", children: recentMenu() },
      { label: "Favourites", children: favouritesMenu() },
      {
        label: "Search inside files…",
        shortcut: keyOf("⇧F"),
        onSelect: () => {
          openApp("files", { search: "1" });
        },
      },
      { label: "All apps", onSelect: openLauncher },
      "-",
      { label: "Clean up icons", disabled: !placed, onSelect: clearIconPositions },
      { label: "Change wallpaper…", onSelect: chooseWallpaper },
      {
        label: "View",
        children: [
          {
            label: "Dark",
            checked: dark,
            onSelect: () => {
              setThemePreference("dark");
            },
          },
          {
            label: "Light",
            checked: !dark,
            onSelect: () => {
              setThemePreference("light");
            },
          },
          "-",
          {
            label: "Mac style",
            checked: style === "mac",
            onSelect: () => {
              chooseDesktopStyle("mac");
            },
          },
          {
            label: "Windows style",
            checked: style === "windows",
            onSelect: () => {
              chooseDesktopStyle("windows");
            },
          },
        ],
      },
      "-",
      {
        label: "Settings…",
        onSelect: () => {
          openApp("settings");
        },
      },
      { label: "Lock screen", shortcut: "Ctrl+Shift+L", onSelect: () => void lockNow() },
      "-",
      { label: "Control Centre", onSelect: toggleControlCentre },
      {
        label: "Leave no trace…",
        onSelect: () => {
          setNoTrace("ask");
        },
      },
    ];
  };

  /** A key with the style's modifier, as the prototype writes shortcuts. */
  const keyOf = (key: string) => (style === "mac" ? `⌘${key}` : `Ctrl+${key}`);

  /** The files marked as favourites, kept with the account. */
  const favouritesMenu = (): MenuEntry[] => {
    if (prefs.favourites.length === 0)
      return [{ label: "Right-click a file and choose Add to Favourites", disabled: true }];
    return prefs.favourites.map((entry) => ({
      label: entry.name,
      onSelect: () => {
        const app = appFor(entry);
        if (app) openApp(app, { file: entry.id, name: entry.name });
        else openApp("files");
      },
    }));
  };

  /** A file's menu on the desktop, as the prototype's. */
  const deskFileMenu = (file: DriveFile): MenuEntry[] => {
    const app = appFor(file);
    const favourite = prefs.favourites.some((entry) => entry.id === file.id);
    const folders = deskFolders.filter(
      (folder) => folder.parentId === null && folder.id !== file.folderId,
    );
    return [
      {
        label: "Open",
        disabled: !app,
        onSelect: () => {
          if (app) openApp(app, { file: file.id, name: file.name });
        },
      },
      {
        label: "Show in Files",
        onSelect: () => {
          openApp("files", file.folderId ? { folder: file.folderId } : {});
        },
      },
      "-",
      {
        label: "Rename…",
        shortcut: "F2",
        onSelect: () => {
          setRenaming(file);
        },
      },
      {
        label: "Move to",
        children: [
          ...folders.map((folder) => ({
            label: folder.name,
            onSelect: () => void moveDeskFile(file, folder.id, folder.name),
          })),
          ...(folders.length > 0 ? ["-" as const] : []),
          { label: "Drive", onSelect: () => void moveDeskFile(file, null, "Drive") },
        ],
      },
      "-",
      {
        label: "Cut",
        shortcut: keyOf("X"),
        onSelect: () => {
          cutFile({ id: file.id, name: file.name, folderId: file.folderId });
          toast.add({
            type: "info",
            title: `Cut “${file.name}”`,
            description: "Paste it into another folder, or on the desktop.",
          });
        },
      },
      "-",
      {
        label: "Send to phone",
        icon: <Tile glyph="phone" colour="green" size={18} />,
        onSelect: () => {
          openApp("send-to-phone", { file: file.id, name: file.name });
        },
      },
      {
        label: "Get info",
        shortcut: keyOf("I"),
        onSelect: () => {
          setInfo(file);
        },
      },
      {
        label: favourite ? "Remove from Favourites" : "Add to Favourites",
        onSelect: () => {
          toggleFavourite({
            id: file.id,
            name: file.name,
            contentType: file.contentType,
            status: file.status,
          });
        },
      },
      "-",
      {
        label: "Move to Trash",
        shortcut: style === "mac" ? "⌘⌫" : "Delete",
        danger: true,
        onSelect: () => void trashDeskFile(file),
      },
    ];
  };

  /** The files opened in this tab, newest first; a shared computer keeps nothing longer. */
  const recentMenu = (): MenuEntry[] => {
    const recent = readRecentFiles();
    if (recent.length === 0) return [{ label: "Nothing opened yet", disabled: true }];
    return [
      ...recent.map((entry) => ({
        label: entry.name,
        onSelect: () => {
          const app = appFor(entry);
          if (app) openApp(app, { file: entry.id, name: entry.name });
          else openApp("files");
        },
      })),
      "-",
      { label: "Clear recent", onSelect: clearRecentFiles },
    ];
  };

  function showMenu(event: ReactMouseEvent<HTMLElement>, entries: () => MenuEntry[]) {
    event.stopPropagation();
    openContextMenu(event, entries());
  }

  // ── Leave no trace and Wipe ────────────────────────────────────────────

  async function leaveNoTrace() {
    const count = windows.length;
    setWindows([]);
    setFocused("dashboard");
    const [ended] = await Promise.all([endEverySession(), clearClipboard()]);
    setNoTrace({ windows: count, sessions: ended });
  }

  const browserCount = windows.filter(isBrowserWindow).length;
  const dockActions: DockActions = {
    windows,
    focused,
    engines,
    pinned,
    webApps: installedWebApps,
    dashboardHidden: dashHidden,
    onDashboard: dockHome,
    onDashboardMenu: (event: ReactMouseEvent<HTMLElement>) => {
      showMenu(event, dashboardMenu);
    },
    onFocus: focusWindow,
    onMinimise: minimise,
    onOpenApp: (app: AppId) => {
      openApp(app);
    },
    onAppMenu: (event, app) => {
      showMenu(event, () => appMenu(app));
    },
    onBrowserMenu: (event, engine) => {
      showMenu(event, () => browserMenu(engine));
    },
    onWebApp: openWebApp,
    onLaunchpad: openLauncher,
    onLaunchpadMenu: (event: ReactMouseEvent<HTMLElement>) => {
      showMenu(event, () => [
        { label: "Show all apps", onSelect: openLauncher },
        {
          label: "App Store",
          onSelect: () => {
            openApp("app-store");
          },
        },
      ]);
    },
    onMinimisedMenu: (event, id) => {
      const entry = windows.find((candidate) => candidate.id === id);
      showMenu(event, () => [
        {
          label: "Restore",
          onSelect: () => {
            focusWindow(id);
          },
        },
        {
          label: "Close",
          onSelect: () => {
            if (entry) void close(entry);
          },
        },
      ]);
    },
    onBarMenu: (event: ReactMouseEvent<HTMLElement>) => {
      showMenu(event, () => [
        {
          label: "Settings",
          onSelect: () => {
            openApp("settings");
          },
        },
        { label: "Show desktop", onSelect: showDesktop },
      ]);
    },
    onStartMenu: (event: ReactMouseEvent<HTMLElement>) => {
      showMenu(event, () => [
        {
          label: "Settings",
          onSelect: () => {
            openApp("settings");
          },
        },
        {
          label: "Files",
          onSelect: () => {
            openApp("files");
          },
        },
        { label: "All apps", onSelect: openLauncher },
        "-",
        { label: "Lock", onSelect: () => void lockNow() },
        { label: "Wipe this computer…", onSelect: askWipe },
      ]);
    },
  };

  const pickerOpen = active && prefsLoaded && prefs.style === null && chosen === null && !booting;

  return (
    <DesktopContext.Provider value={api}>
      <div
        ref={shellRef}
        className="ad-shell dt-shell min-h-dvh lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden"
        data-dragging={dragging || undefined}
      >
        {/* The wallpaper: right-click it for the desktop's menu (the menu's items are all elsewhere too). */}
        <div
          className="dt-desk"
          aria-hidden="true"
          onContextMenu={(event: ReactMouseEvent<HTMLElement>) => {
            showMenu(event, desktopMenu);
          }}
          onPointerDown={() => {
            if (focused !== "desktop" && active) {
              setFocused("desktop");
            }
          }}
        />
        {active && (
          <DesktopIcons
            style={style}
            files={deskFiles}
            onOpenDrive={() => {
              openApp("files");
            }}
            onOpenTrash={() => {
              openApp("trash");
            }}
            onOpenFile={(file) => {
              const app = appFor(file);
              if (app) openApp(app, { file: file.id, name: file.name });
              else
                toast.add({
                  type: "info",
                  title: "No app here opens this kind of file",
                  description: "Open it from Drive to save it to this computer.",
                });
            }}
            onFileMenu={(event, file) => {
              showMenu(event, () => deskFileMenu(file));
            }}
            onIconMenu={(event, open) => {
              showMenu(event, () => [{ label: "Open", onSelect: open }]);
            }}
          />
        )}
        {menuBar}

        <div
          ref={dashboardRef}
          className="ad-window dt-dash"
          data-hidden={dashHidden || undefined}
          data-placed={dashboard.rect ? true : undefined}
          data-focused={focused === "dashboard" || undefined}
          style={
            active
              ? {
                  zIndex: dashboard.z,
                  ...(dashboard.rect
                    ? {
                        left: dashboard.rect.left,
                        top: dashboard.rect.top,
                        width: dashboard.rect.width,
                        height: dashboard.rect.height,
                      }
                    : {}),
                }
              : undefined
          }
          onPointerDownCapture={() => {
            if (active && focused !== "dashboard") showDashboard();
          }}
        >
          <DashboardBar
            focused={focused === "dashboard"}
            issues={issues}
            admin={admin}
            engines={engines}
            onClose={hideDashboard}
            onZoom={zoomDashboard}
            onDragStart={(event) => {
              dragDashboard(event, "move");
            }}
            onMenu={(event: ReactMouseEvent<HTMLElement>) => {
              showMenu(event, () => [
                { label: "Minimise", onSelect: hideDashboard },
                { label: dashboard.restore ? "Restore size" : "Zoom", onSelect: zoomDashboard },
                "-",
                { label: "Close", onSelect: hideDashboard },
              ]);
            }}
            onPage={showDashboard}
            onOpenApp={(app) => {
              openApp(app);
            }}
            onLauncher={openLauncher}
            onWipe={askWipe}
          />
          <div className="dt-dash-body lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
            {children}
          </div>
          <div className="dt-status" aria-label="Status">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  cloud === "unavailable" ? "bg-danger-fill" : "bg-success",
                )}
              />
              {cloud === "unavailable"
                ? "Cloud unreachable"
                : `Cloud connected${latency === null ? "" : ` · ${String(latency)} ms`}`}
            </span>
            <span>
              {String(browserCount)} of {String(limit)} browsers running
            </span>
            <span className="flex-1" />
            {drive && (
              <button
                type="button"
                className="dt-status-link"
                onClick={() => {
                  router.push("/app/drive");
                  showDashboard();
                }}
              >
                Drive {formatBytes(drive.used)} of {formatBytes(drive.limit)}
              </button>
            )}
            <button
              type="button"
              className="dt-status-link"
              data-tone={issues > 0 ? "warning" : "good"}
              onClick={() => {
                router.push("/app/shield");
                showDashboard();
              }}
            >
              Shield: {issues > 0 ? `${String(issues)} to do` : "all clear"}
            </button>
          </div>
          <span
            aria-hidden="true"
            className="dt-resize"
            onPointerDown={(event) => {
              dragDashboard(event, "resize");
            }}
          />
        </div>

        {active &&
          windows.map((entry) => {
            const label = windowLabel(entry);
            const isFocused = focused === entry.id;
            return (
              <section
                key={entry.id}
                ref={(element) => {
                  if (element) windowElements.current.set(entry.id, element);
                  else windowElements.current.delete(entry.id);
                }}
                aria-label={`${label} window`}
                className="dt-win"
                data-kind={entry.content.kind}
                data-min={entry.min || undefined}
                data-focused={isFocused || undefined}
                data-zoomed={entry.restore ? true : undefined}
                style={{
                  zIndex: entry.z,
                  left: entry.rect.left,
                  top: entry.rect.top,
                  width: entry.rect.width,
                  height: entry.rect.height,
                }}
                onPointerDownCapture={() => {
                  if (!isFocused) focusWindow(entry.id);
                }}
              >
                <TitleBar
                  label={label}
                  title={windowTitle(entry)}
                  icon={
                    entry.content.kind === "browser" ? (
                      <EngineLogo engine={entry.content.session.engine} size="sm" />
                    ) : (
                      <AppIcon app={entry.content.app} size={16} />
                    )
                  }
                  focused={isFocused}
                  onClose={() => void close(entry)}
                  onMinimise={() => {
                    minimise(entry.id);
                  }}
                  onZoom={() => {
                    zoom(entry.id);
                  }}
                  onDragStart={(event) => {
                    dragWindow(event, entry, "move");
                  }}
                  onMenu={(event: ReactMouseEvent<HTMLElement>) => {
                    showMenu(event, () => windowMenu(entry));
                  }}
                />
                {entry.content.kind === "browser" ? (
                  locked ? (
                    <div className="dt-frame" />
                  ) : (
                    <iframe
                      ref={(element) => {
                        if (element) frames.current.set(entry.id, element);
                        else frames.current.delete(entry.id);
                      }}
                      title={`${label}, streamed from Brawzer’s cloud`}
                      src={frameSource(entry.id, entry.content.open)}
                      className="dt-frame"
                      allow="clipboard-read; clipboard-write; autoplay; fullscreen"
                    />
                  )
                ) : (
                  <AppWindowFrame
                    entry={entry}
                    onTitle={(title) => {
                      setWindows((current) =>
                        current.map((candidate) =>
                          candidate.id === entry.id ? { ...candidate, title } : candidate,
                        ),
                      );
                    }}
                    onClose={() => void close(entry)}
                    onOpenApp={openApp}
                  />
                )}
                <span
                  aria-hidden="true"
                  className="dt-resize"
                  onPointerDown={(event) => {
                    dragWindow(event, entry, "resize");
                  }}
                />
              </section>
            );
          })}

        {snapHint && (
          <div
            aria-hidden="true"
            className="dt-snap"
            style={{
              left: snapHint.left,
              top: snapHint.top,
              width: snapHint.width,
              height: snapHint.height,
            }}
          />
        )}

        <Dock {...dockActions} dashboardRef={dockTile} />
        <Taskbar
          {...dockActions}
          dashboardRef={taskbarTile}
          startOpen={launcherOpen && style === "windows"}
          onStart={() => {
            setLauncherOpen((current) => !current);
          }}
          onControlCentre={toggleControlCentre}
          onShowDesktop={showDesktop}
        />
        <Launchpad
          open={launcherOpen && style === "mac"}
          onOpenChange={setLauncherOpen}
          engines={engines}
          webApps={installedWebApps}
          onWebApp={openWebApp}
          onOpenApp={(app) => {
            openApp(app);
          }}
        />
        <StartMenu
          open={launcherOpen && style === "windows"}
          onOpenChange={setLauncherOpen}
          engines={engines}
          webApps={installedWebApps}
          email={email}
          onWebApp={openWebApp}
          onOpenApp={(app) => {
            openApp(app);
          }}
          onPage={() => {
            showDashboard();
          }}
          onWipe={askWipe}
        />
        <ControlCentre
          open={controlOpen}
          onOpenChange={setControlOpen}
          onNetwork={() => {
            go("/app/proxy");
          }}
          onScreenshot={() => {
            openApp("screenshot");
          }}
          onLock={() => void lockNow()}
          onUsage={() => {
            openApp("usage");
          }}
          onLeaveNoTrace={() => {
            setNoTrace("ask");
          }}
        />
        {switcher !== null && <WindowSwitcher entries={switchable} selected={switcher} />}
        {exam && active && (
          <button
            type="button"
            className="dt-exam"
            onClick={() => {
              openApp("exam-mode");
            }}
          >
            Exam Mode · {examLeft} min left
          </button>
        )}
        <WallpaperDialog open={wallpaperOpen} onOpenChange={setWallpaperOpen} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <WipeDialog
          open={wipeOpen}
          onOpenChange={setWipeOpen}
          onWipe={() => {
            setWipeOpen(false);
            void wipeThisComputer();
          }}
        />
        <LeaveNoTraceDialog
          state={noTrace}
          onOpenChange={(open) => {
            if (!open) setNoTrace(null);
          }}
          onConfirm={() => void leaveNoTrace()}
        />
        <NameDialog
          open={renaming !== null}
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
          title={renaming ? `Rename “${renaming.name}”` : "Rename"}
          description="On the desktop and in Drive."
          label="Name"
          initial={renaming?.name ?? ""}
          submitLabel="Rename"
          onSubmit={(name) =>
            updateFile(renaming?.id ?? "", { name }).then((result) => {
              if (result.ok) loadDesk();
              return result;
            })
          }
        />
        <FileInfoDialog
          file={info}
          folderName={deskFolders.find((folder) => folder.id === info?.folderId)?.name ?? "Desktop"}
          onOpenChange={(open) => {
            if (!open) setInfo(null);
          }}
          onOpen={() => {
            if (!info) return;
            const app = appFor(info);
            setInfo(null);
            if (app) openApp(app, { file: info.id, name: info.name });
          }}
        />
        <OsPicker
          open={pickerOpen}
          onChoose={(picked) => {
            chooseDesktopStyle(picked);
            playSound("pop");
          }}
        />
        {active && prefs.brightness < 100 && (
          <div
            aria-hidden="true"
            className="dt-bright"
            style={{ opacity: ((100 - prefs.brightness) / 100) * 0.85 }}
          />
        )}
        {/* The prototype's start-up: shown once per tab, chosen before first paint (see the theme script). */}
        <div className="dt-boot" aria-hidden="true">
          <Logo size={40} className="text-white" />
          <span className="dt-boot-bar">
            <i />
          </span>
        </div>
        <ContextMenuHost />
        {overlays}
      </div>
    </DesktopContext.Provider>
  );
}

/** An app's window body: the app, told which window it's in. */
function AppWindowFrame({
  entry,
  onTitle,
  onClose,
  onOpenApp,
}: {
  entry: DesktopWindow;
  onTitle: (title: string | null) => void;
  onClose: () => void;
  onOpenApp: (app: AppId, params?: Record<string, string>) => void;
}) {
  const content = entry.content;
  const handlers = useRef({ onTitle, onClose });
  useEffect(() => {
    handlers.current = { onTitle, onClose };
  });
  const params = content.kind === "app" ? content.params : EMPTY_PARAMS;
  const api = useMemo<AppWindowApi>(
    () => ({
      id: entry.id,
      params,
      setTitle: (title) => {
        handlers.current.onTitle(title);
      },
      close: () => {
        handlers.current.onClose();
      },
      openApp: onOpenApp,
    }),
    [entry.id, params, onOpenApp],
  );
  if (content.kind !== "app") return null;
  const App = apps[content.app].component;
  return (
    <div className="dt-app">
      <AppWindowContext.Provider value={api}>
        <App />
      </AppWindowContext.Provider>
    </div>
  );
}

const EMPTY_PARAMS: Readonly<Record<string, string>> = {};
