"use client";

import type { BrowserEngine, BrowserSession } from "@brawzer/contracts";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  MenuItem,
  MenuSeparator,
} from "@brawzer/ui/components/menu";
import { useToast } from "@brawzer/ui/components/toast";
import { cn } from "@brawzer/ui/lib/cn";
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  Moon,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { EngineLogo } from "@/components/browser/engine-logo";
import { appNav } from "@/content/app";
import { endBrowserSession, fetchBrowserOverview } from "@/lib/api/browser";
import {
  type DesktopStyle,
  desktopActive,
  readDesktopStyle,
  setDesktopOn,
  setDesktopStyle,
  subscribeToDesktop,
} from "@/lib/desktop";
import { isLocked, lockNow, subscribeToLock } from "@/lib/lock";
import { subscribeToClock } from "@/lib/clock";
import { currentExam, endExam, examAllows, loadExam, subscribeToExam } from "@/lib/exam";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";
import { type AppWindowApi, AppWindowContext } from "./apps/app-window";
import { type AppId, AppIcon, apps } from "./apps/registry";
import { type WebApp, webAppById } from "./apps/web-apps";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import {
  defaultDesktopPrefs,
  loadDesktopPrefs,
  readDesktopPrefs,
  subscribeToDesktopPrefs,
} from "@/lib/desktop-prefs";
import { ControlCentre } from "./control-centre";
import {
  type BrowserOpen,
  type DesktopApi,
  DesktopContext,
  type DesktopMessage,
} from "./desktop-context";
import { Dock, Taskbar } from "./dock";
import { AppLauncher } from "./launchpad";
import { WindowSwitcher } from "./switcher";
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

/** What Exam Mode calls a window's content: "app:notepad", "browser:chrome". */
const examTarget = (content: WindowContent) =>
  content.kind === "browser" ? `browser:${content.session.engine}` : `app:${content.app}`;
const useStyle = () =>
  useSyncExternalStore<DesktopStyle>(subscribeToDesktop, readDesktopStyle, () => "mac");
const useDark = () =>
  useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );

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

/**
 * The signed-in app as a desktop (wide screens, unless switched off): the
 * dashboard (the app's pages) in a window of its own, each cloud browser and
 * each app in a window, a dock (Mac style) or taskbar (Windows style),
 * Launchpad or Start, Control Centre, a window switcher and a wallpaper. On
 * phones and with the desktop off, the app is as it was: the stylesheet
 * hides these extras.
 */
export function DesktopShell({
  menuBar,
  overlays,
  children,
}: {
  menuBar: ReactNode;
  overlays?: ReactNode;
  children: ReactNode;
}) {
  const toast = useToast();
  const active = useDesktopActive();
  // Locked, no window streams: the frames come back, and reconnect, on unlocking.
  const locked = useLocked();
  const style = useStyle();
  const exam = useExam();
  const examTick = useSyncExternalStore(subscribeToClock, quarterMinute, () => 0);
  const shellRef = useRef<HTMLDivElement>(null);
  const zTop = useRef(10);
  const appCount = useRef(0);
  /** Each browser window's frame, to pass it what to open. */
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const [dragging, setDragging] = useState(false);
  const [windows, setWindows] = useState<DesktopWindow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardState>({
    hidden: false,
    rect: null,
    restore: null,
    z: 5,
  });
  const [focused, setFocused] = useState<string>("dashboard");
  const [engines, setEngines] = useState<readonly BrowserEngine[]>([]);
  const [sessions, setSessions] = useState<readonly BrowserSession[]>([]);
  const [limit, setLimit] = useState(3);
  const [cloud, setCloud] = useState<"available" | "unavailable" | null>(null);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);
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
    const top = windowsStyle ? 6 : 34;
    const bottom = windowsStyle ? 54 : 88;
    return { left: 6, top, width: box.width - 12, height: box.height - top - bottom };
  }, [bounds]);

  const raise = () => {
    zTop.current += 1;
    return zTop.current;
  };

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
        const size = content.kind === "app" ? apps[content.app] : undefined;
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

  const showDashboard = useCallback(() => {
    zTop.current += 1;
    const z = zTop.current;
    setDashboard((current) => ({ ...current, hidden: false, z }));
    setFocused("dashboard");
  }, []);

  const showDesktop = useCallback(() => {
    setWindows((current) => current.map((entry) => ({ ...entry, min: true })));
    setDashboard((current) => ({ ...current, hidden: true }));
  }, [setWindows, setDashboard]);

  const chooseWallpaper = useCallback(() => {
    setWallpaperOpen(true);
  }, [setWallpaperOpen]);

  const toggleControlCentre = useCallback(() => {
    setControlOpen((current) => !current);
  }, [setControlOpen]);

  const openLauncher = useCallback(() => {
    setLauncherOpen(true);
  }, [setLauncherOpen]);

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
      setSessions(result.data.sessions);
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

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () => {
      void fetchBrowserOverview().then((result) => {
        if (!cancelled) apply(result);
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, apply]);

  // Exam Mode and the dock's apps: read on arrival. When Exam Mode starts, what it doesn't allow is tucked away.
  useEffect(() => {
    if (!active) return;
    void loadExam();
    void loadDesktopPrefs();
  }, [active]);
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
    setWindows((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, min: false, z } : entry)),
    );
    setFocused(id);
  }

  function minimise(id: string) {
    setWindows((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, min: true } : entry)),
    );
    setFocused("dashboard");
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

  async function close(entry: DesktopWindow) {
    setWindows((current) => current.filter((candidate) => candidate.id !== entry.id));
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

  function snapped(snap: Snap | null, then: (rect: Rect) => void) {
    if (snap) then(snapRect(snap, workArea()));
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
    trackPointer(event, kind, entry.rect, bounds, set, (snap) => {
      setDragging(false);
      snapped(snap, (rect) => {
        setWindows((current) =>
          current.map((candidate) =>
            candidate.id === entry.id ? { ...candidate, restore: candidate.rect, rect } : candidate,
          ),
        );
      });
    });
  }

  const dashboardRef = useRef<HTMLDivElement>(null);
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
        snapped(snap, (rect) => {
          setDashboard((current) => ({ ...current, restore: current.rect ?? "auto", rect }));
        });
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
      ...(dashboard.hidden ? [] : [{ z: dashboard.z, entry: "dashboard" as const }]),
      ...windows.map((entry) => ({ z: entry.min ? 0 : entry.z, entry })),
    ];
    return entries.sort((a, b) => b.z - a.z).map((item) => item.entry);
  }, [windows, dashboard]);
  const switchRef = useRef({ switchable, switcher, focusWindow });
  useEffect(() => {
    switchRef.current = { switchable, switcher, focusWindow };
  });

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.code !== "Backquote" || isLocked()) return;
      event.preventDefault();
      const { switchable: list, switcher: current } = switchRef.current;
      if (list.length === 0) return;
      const step = event.shiftKey ? -1 : 1;
      setSwitcher(((current ?? 0) + step + list.length) % list.length);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const { switchable: list, switcher: current, focusWindow: focus } = switchRef.current;
      if (current === null) return;
      if (event.key === "Escape") {
        setSwitcher(null);
        return;
      }
      if (event.key !== "Alt") return;
      const chosen = list[current];
      setSwitcher(null);
      if (chosen === "dashboard") focus("dashboard");
      else if (chosen) focus(chosen.id);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active]);

  const browserCount = windows.filter(isBrowserWindow).length;
  const dockActions = {
    windows,
    focused,
    engines,
    pinned,
    dashboardHidden: dashboard.hidden,
    onDashboard: () => {
      if (dashboard.hidden || focused !== "dashboard") showDashboard();
      else setDashboard((current) => ({ ...current, hidden: true }));
    },
    onFocus: focusWindow,
    onMinimise: minimise,
    onOpenApp: (app: AppId) => {
      openApp(app);
    },
    onLaunchpad: openLauncher,
    webApps: installedWebApps,
    onWebApp: openWebApp,
  };

  return (
    <DesktopContext.Provider value={api}>
      <div
        ref={shellRef}
        className="ad-shell dt-shell min-h-dvh lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden"
        data-dragging={dragging || undefined}
      >
        <DesktopBackground
          dashboardHidden={dashboard.hidden}
          onToggleDashboard={() => {
            if (dashboard.hidden) showDashboard();
            else setDashboard((current) => ({ ...current, hidden: true }));
          }}
          onWallpaper={chooseWallpaper}
          onShowDesktop={showDesktop}
          onLauncher={openLauncher}
          onControlCentre={toggleControlCentre}
        />
        {menuBar}

        <div
          ref={dashboardRef}
          className="ad-window dt-dash"
          data-hidden={dashboard.hidden || undefined}
          data-placed={dashboard.rect ? true : undefined}
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
            onClose={() => {
              setDashboard((current) => ({ ...current, hidden: true }));
            }}
            onZoom={zoomDashboard}
            onDragStart={(event) => {
              dragDashboard(event, "move");
            }}
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
              {cloud === "unavailable" ? "Cloud unreachable" : "Cloud connected"}
            </span>
            <span>
              {String(browserCount)} of {String(limit)} browsers open
            </span>
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
                aria-label={`${label} window`}
                className="dt-win"
                data-kind={entry.content.kind}
                data-min={entry.min || undefined}
                data-focused={isFocused || undefined}
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

        <Dock {...dockActions} />
        <Taskbar
          {...dockActions}
          startOpen={launcherOpen && style === "windows"}
          onStart={() => {
            setLauncherOpen((current) => !current);
          }}
          onControlCentre={toggleControlCentre}
          onShowDesktop={showDesktop}
        />
        <AppLauncher
          variant={style === "windows" ? "start" : "launchpad"}
          open={launcherOpen}
          onOpenChange={setLauncherOpen}
          engines={engines}
          webApps={installedWebApps}
          onWebApp={openWebApp}
          onOpenApp={(app) => {
            openApp(app);
          }}
        />
        <ControlCentre
          open={controlOpen}
          onOpenChange={setControlOpen}
          sessions={sessions}
          limit={limit}
          onWallpaper={chooseWallpaper}
          onShowDesktop={showDesktop}
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

/** The dashboard's title bar: what page this is, and back and forward. */
function DashboardBar({
  focused,
  onClose,
  onZoom,
  onDragStart,
}: {
  focused: boolean;
  onClose: () => void;
  onZoom: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const page =
    appNav
      .flatMap((group) => group.items)
      .filter((item) =>
        item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href),
      )
      .at(-1)?.label ?? "Brawzer";
  return (
    <TitleBar
      className="dt-chrome"
      label="Brawzer"
      title={
        <>
          <b className="font-semibold text-ink">Brawzer</b>
          <span className="text-ink-tertiary"> — {page}</span>
        </>
      }
      focused={focused}
      onClose={onClose}
      onMinimise={onClose}
      onZoom={onZoom}
      onDragStart={onDragStart}
    >
      <span className="dt-nav">
        <button
          type="button"
          className="dt-nav-button"
          aria-label="Back"
          onClick={() => {
            router.back();
          }}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className="dt-nav-button"
          aria-label="Forward"
          onClick={() => {
            router.forward();
          }}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </span>
    </TitleBar>
  );
}

/** The wallpaper, and the desktop's own right-click menu. */
function DesktopBackground({
  dashboardHidden,
  onToggleDashboard,
  onWallpaper,
  onShowDesktop,
  onLauncher,
  onControlCentre,
}: {
  dashboardHidden: boolean;
  onToggleDashboard: () => void;
  onWallpaper: () => void;
  onShowDesktop: () => void;
  onLauncher: () => void;
  onControlCentre: () => void;
}) {
  const style = useStyle();
  const dark = useDark();
  return (
    <ContextMenu>
      <ContextMenuTrigger className="dt-desk" aria-hidden="true" />
      <ContextMenuContent>
        <MenuItem icon={<LayoutDashboard />} onClick={onToggleDashboard}>
          {dashboardHidden ? "Show Brawzer" : "Hide Brawzer"}
        </MenuItem>
        <MenuItem icon={<LayoutGrid />} onClick={onLauncher}>
          {style === "mac" ? "Open Launchpad" : "Open Start"}
        </MenuItem>
        <MenuItem onClick={onShowDesktop}>Show the desktop</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<ImageIcon />} onClick={onWallpaper}>
          Change wallpaper…
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDesktopStyle(style === "mac" ? "windows" : "mac");
          }}
        >
          {style === "mac" ? "Use the Windows style" : "Use the Mac style"}
        </MenuItem>
        <MenuItem
          icon={dark ? <Sun /> : <Moon />}
          onClick={() => {
            setThemePreference(dark ? "light" : "dark");
          }}
        >
          {dark ? "Light theme" : "Dark theme"}
        </MenuItem>
        <MenuItem icon={<SlidersHorizontal />} onClick={onControlCentre}>
          Control Centre
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Lock />} onClick={() => void lockNow()}>
          Lock screen
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDesktopOn(false);
          }}
        >
          Use the classic layout
        </MenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
