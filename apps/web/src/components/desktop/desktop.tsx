"use client";

import { type BrowserEngine, type BrowserSession, engineDetails } from "@brawzer/contracts";
import { Mark } from "@brawzer/ui/brand";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Button } from "@brawzer/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@brawzer/ui/components/menu";
import { useToast } from "@brawzer/ui/components/toast";
import { cn } from "@brawzer/ui/lib/cn";
import {
  AppWindow,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  LayoutDashboard,
  Lock,
  LogOut,
  Moon,
  Search,
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
import { openCommandPalette } from "@/components/app-shell/command-palette";
import { AppIconArt, EngineLogo } from "@/components/browser/engine-logo";
import { appNav } from "@/content/app";
import { endBrowserSession, fetchBrowserOverview } from "@/lib/api/browser";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { subscribeToClock, taskbarClock } from "@/lib/clock";
import {
  type DesktopStyle,
  desktopActive,
  readDesktopStyle,
  readWallpaper,
  setDesktopOn,
  setDesktopStyle,
  setWallpaper,
  subscribeToDesktop,
  type Wallpaper,
  wallpapers,
} from "@/lib/desktop";
import { isLocked, lockNow, subscribeToLock } from "@/lib/lock";
import { signOut } from "@/lib/session-channel";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";
import { type DesktopApi, DesktopContext, type DesktopMessage } from "./desktop-context";
import { type Rect, type Snap, snapRect, TitleBar, trackPointer } from "./window-chrome";
import "@/components/browser/launcher.css";
import "./desktop.css";

interface BrowserWindow {
  session: BrowserSession;
  min: boolean;
  /** The rectangle to go back to after a zoom or snap. */
  restore: Rect | null;
  rect: Rect;
  z: number;
}

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
const useStyle = () =>
  useSyncExternalStore<DesktopStyle>(subscribeToDesktop, readDesktopStyle, () => "mac");
const useDark = () =>
  useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );

const sessionLabel = (session: BrowserSession) => engineDetails[session.engine].short;

/**
 * Where the nth new window goes: cascaded down and right by a title bar's
 * height, so every window behind keeps its title and buttons in view.
 */
function cascade(area: Rect, index: number): Rect {
  const step = index % 4;
  const top = area.top + CASCADE_Y * (step + 1);
  const width = Math.min(1180, area.width - 80);
  const height = Math.min(780, area.height - (top - area.top) - 8);
  return {
    left: Math.max(area.left, area.left + (area.width - width) / 2 - 60 + step * 30),
    top,
    width,
    height,
  };
}
/** A title bar's height (2.375rem) and a little more. */
const CASCADE_Y = 42;

/**
 * The signed-in app as a desktop (wide screens, unless switched off): the
 * dashboard (the app's pages) in a window of its own, each cloud browser in
 * a window that streams its session, a dock (Mac style) or taskbar (Windows
 * style), and a wallpaper. On phones and with the desktop off, the app is as
 * it was: these extras are hidden by the stylesheet.
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
  const shellRef = useRef<HTMLDivElement>(null);
  const zTop = useRef(10);
  const [dragging, setDragging] = useState(false);
  const [windows, setWindows] = useState<BrowserWindow[]>([]);
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
  const [wallpaperOpen, setWallpaperOpen] = useState(false);

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

  const openSession = useCallback(
    (session: BrowserSession) => {
      setWindows((current) => {
        const existing = current.find((entry) => entry.session.id === session.id);
        zTop.current += 1;
        const z = zTop.current;
        if (existing) {
          return current.map((entry) =>
            entry === existing ? { ...entry, session, min: false, z } : entry,
          );
        }
        return [
          ...current,
          { session, min: false, restore: null, z, rect: cascade(workArea(), current.length) },
        ];
      });
      setFocused(session.id);
    },
    [workArea],
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

  const api = useMemo<DesktopApi>(
    () => ({ openSession, showDashboard, showDesktop, chooseWallpaper }),
    [openSession, showDashboard, showDesktop, chooseWallpaper],
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
        const kept = current.filter((entry) => live.has(entry.session.id));
        const known = new Set(kept.map((entry) => entry.session.id));
        const area = workArea();
        const added = result.data.sessions
          .filter((session) => !known.has(session.id))
          .map((session, index) => ({
            session,
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

  // Framed browser windows say when they're done.
  useEffect(() => {
    const onMessage = (event: MessageEvent<DesktopMessage>) => {
      if (event.origin !== window.location.origin) return;
      const message = event.data;
      if (message.type === "brawzer:close-window") {
        setWindows((current) => current.filter((entry) => entry.session.id !== message.session));
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  function focusWindow(id: string) {
    const z = raise();
    setWindows((current) =>
      current.map((entry) => (entry.session.id === id ? { ...entry, min: false, z } : entry)),
    );
    setFocused(id);
  }

  function minimise(id: string) {
    setWindows((current) =>
      current.map((entry) => (entry.session.id === id ? { ...entry, min: true } : entry)),
    );
    setFocused("dashboard");
  }

  function zoom(id: string) {
    setWindows((current) =>
      current.map((entry) => {
        if (entry.session.id !== id) return entry;
        if (entry.restore) return { ...entry, rect: entry.restore, restore: null };
        return { ...entry, restore: entry.rect, rect: workArea() };
      }),
    );
  }

  async function close(entry: BrowserWindow) {
    setWindows((current) => current.filter((candidate) => candidate !== entry));
    const result = await endBrowserSession(entry.session.id);
    if (result.ok || result.status === 404) {
      toast.add({
        type: "success",
        title: `${sessionLabel(entry.session)} closed`,
        description: "Its session has ended; a profile that keeps its data saved it.",
      });
    } else {
      toast.add({ type: "error", title: "Couldn’t end it", description: result.error.message });
    }
  }

  function snapped(snap: Snap | null, apply: (rect: Rect) => void) {
    if (snap) apply(snapRect(snap, workArea()));
  }

  function dragWindow(
    event: ReactPointerEvent<HTMLElement>,
    entry: BrowserWindow,
    kind: "move" | "resize",
  ) {
    focusWindow(entry.session.id);
    setDragging(true);
    const set = (rect: Rect) => {
      setWindows((current) =>
        current.map((candidate) =>
          candidate.session.id === entry.session.id ? { ...candidate, rect } : candidate,
        ),
      );
    };
    trackPointer(event, kind, entry.rect, bounds, set, (snap) => {
      setDragging(false);
      snapped(snap, (rect) => {
        setWindows((current) =>
          current.map((candidate) =>
            candidate.session.id === entry.session.id
              ? { ...candidate, restore: candidate.rect, rect }
              : candidate,
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

  const runningEngines = new Set(windows.map((entry) => entry.session.engine));

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
          onWallpaper={() => {
            setWallpaperOpen(true);
          }}
          onShowDesktop={showDesktop}
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
              {String(windows.length)} of {String(limit)} browsers open
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
            const label = sessionLabel(entry.session);
            const isFocused = focused === entry.session.id;
            return (
              <section
                key={entry.session.id}
                aria-label={`${label} window`}
                className="dt-win"
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
                  if (!isFocused) focusWindow(entry.session.id);
                }}
              >
                <TitleBar
                  label={label}
                  title={`${engineDetails[entry.session.engine].name} · in Brawzer’s cloud`}
                  icon={<EngineLogo engine={entry.session.engine} size="sm" />}
                  focused={isFocused}
                  onClose={() => void close(entry)}
                  onMinimise={() => {
                    minimise(entry.session.id);
                  }}
                  onZoom={() => {
                    zoom(entry.session.id);
                  }}
                  onDragStart={(event) => {
                    dragWindow(event, entry, "move");
                  }}
                />
                {locked ? (
                  <div className="dt-frame" />
                ) : (
                  <iframe
                    title={`${engineDetails[entry.session.engine].name}, streamed from Brawzer’s cloud`}
                    src={`/app/browser/window?session=${entry.session.id}&embedded=1`}
                    className="dt-frame"
                    allow="clipboard-read; clipboard-write; autoplay; fullscreen"
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

        <Dock
          engines={engines}
          windows={windows}
          running={runningEngines}
          focused={focused}
          dashboardHidden={dashboard.hidden}
          onDashboard={() => {
            if (dashboard.hidden || focused !== "dashboard") showDashboard();
            else setDashboard((current) => ({ ...current, hidden: true }));
          }}
          onFocus={focusWindow}
          onMinimise={minimise}
        />
        <Taskbar
          engines={engines}
          windows={windows}
          running={runningEngines}
          focused={focused}
          onDashboard={showDashboard}
          onFocus={focusWindow}
          onMinimise={minimise}
          onShowDesktop={showDesktop}
          onWallpaper={() => {
            setWallpaperOpen(true);
          }}
        />
        <WallpaperDialog open={wallpaperOpen} onOpenChange={setWallpaperOpen} />
        {overlays}
      </div>
    </DesktopContext.Provider>
  );
}

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

/** Brawzer's own icon, for the dock and taskbar: its mark on the accent colour. */
function BrawzerIcon({ size }: { size: number }) {
  return (
    <span
      aria-hidden="true"
      className="dt-brand"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}
    >
      <Mark size={Math.round(size * 0.52)} />
    </span>
  );
}

/** Clicking a browser: open it, bring it forward, or tuck it away if it's in front. */
function useBrowserClick(
  windows: readonly BrowserWindow[],
  focused: string,
  onFocus: (id: string) => void,
  onMinimise: (id: string) => void,
) {
  const { launch } = useLaunchBrowser();
  return (engine: BrowserEngine) => {
    const own = windows.filter((entry) => entry.session.engine === engine);
    if (own.length === 0) {
      void launch(engine);
      return;
    }
    const front = [...own].filter((entry) => !entry.min).sort((a, b) => b.z - a.z)[0];
    const target = front ?? own.at(-1);
    if (!target) return;
    if (front?.session.id === focused) onMinimise(target.session.id);
    else onFocus(target.session.id);
  };
}

/** Mac style: the dock along the bottom, magnifying under the pointer. */
function Dock({
  engines,
  windows,
  running,
  focused,
  dashboardHidden,
  onDashboard,
  onFocus,
  onMinimise,
}: {
  engines: readonly BrowserEngine[];
  windows: readonly BrowserWindow[];
  running: ReadonlySet<BrowserEngine>;
  focused: string;
  dashboardHidden: boolean;
  onDashboard: () => void;
  onFocus: (id: string) => void;
  onMinimise: (id: string) => void;
}) {
  const click = useBrowserClick(windows, focused, onFocus, onMinimise);
  const minimised = windows.filter((entry) => entry.min);
  return (
    <nav aria-label="Dock" className="dt-dock">
      <DockItem label="Brawzer" running={!dashboardHidden} onClick={onDashboard}>
        <BrawzerIcon size={46} />
      </DockItem>
      <span className="dt-sep" aria-hidden="true" />
      {engines.map((engine) => (
        <DockItem
          key={engine}
          label={engineDetails[engine].short}
          running={running.has(engine)}
          onClick={() => {
            click(engine);
          }}
        >
          <span className="dt-dock-art">
            <AppIconArt engine={engine} />
          </span>
        </DockItem>
      ))}
      {minimised.length > 0 && <span className="dt-sep" aria-hidden="true" />}
      {minimised.map((entry) => (
        <DockItem
          key={entry.session.id}
          label={`${sessionLabel(entry.session)}, minimised`}
          running={false}
          onClick={() => {
            onFocus(entry.session.id);
          }}
        >
          <span className="dt-thumb" aria-hidden="true">
            <span className="dt-thumb-bar">
              <i />
              <i />
              <i />
            </span>
            <EngineLogo engine={entry.session.engine} size="sm" />
          </span>
        </DockItem>
      ))}
    </nav>
  );
}

function DockItem({
  label,
  running,
  onClick,
  children,
}: {
  label: string;
  running: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="dt-dock-item"
      data-running={running || undefined}
      aria-label={running ? `${label}, open` : label}
      onClick={onClick}
    >
      {children}
      <span className="dt-tip" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

/** Windows style: the taskbar, the Start menu, search and the tray. */
function Taskbar({
  engines,
  windows,
  running,
  focused,
  onDashboard,
  onFocus,
  onMinimise,
  onShowDesktop,
  onWallpaper,
}: {
  engines: readonly BrowserEngine[];
  windows: readonly BrowserWindow[];
  running: ReadonlySet<BrowserEngine>;
  focused: string;
  onDashboard: () => void;
  onFocus: (id: string) => void;
  onMinimise: (id: string) => void;
  onShowDesktop: () => void;
  onWallpaper: () => void;
}) {
  const router = useRouter();
  const click = useBrowserClick(windows, focused, onFocus, onMinimise);
  const dark = useDark();
  const [time, date] = useSyncExternalStore(subscribeToClock, taskbarClock, () => "|").split("|");
  const focusedEngine = windows.find((entry) => entry.session.id === focused)?.session.engine;
  return (
    <nav aria-label="Taskbar" className="dt-taskbar">
      <div className="dt-taskbar-middle">
        <Menu>
          <MenuTrigger className="dt-task" aria-label="Start">
            <BrawzerIcon size={26} />
          </MenuTrigger>
          <MenuContent side="top" align="start" className="w-72">
            <MenuGroup>
              <MenuGroupLabel>Browsers</MenuGroupLabel>
              {engines.map((engine) => (
                <MenuItem
                  key={engine}
                  icon={<EngineLogo engine={engine} size="sm" />}
                  onClick={() => {
                    click(engine);
                  }}
                >
                  {engineDetails[engine].short}
                </MenuItem>
              ))}
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Brawzer</MenuGroupLabel>
              {appNav
                .flatMap((group) => group.items)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <MenuItem
                      key={item.href}
                      icon={<Icon />}
                      onClick={() => {
                        onDashboard();
                        router.push(item.href);
                      }}
                    >
                      {item.label}
                    </MenuItem>
                  );
                })}
            </MenuGroup>
            <MenuSeparator />
            <MenuItem icon={<ImageIcon />} onClick={onWallpaper}>
              Change wallpaper…
            </MenuItem>
            <MenuItem
              icon={<AppWindow />}
              onClick={() => {
                setDesktopStyle("mac");
              }}
            >
              Use the Mac style
            </MenuItem>
            <MenuItem icon={<Lock />} onClick={() => void lockNow()}>
              Lock
            </MenuItem>
            <MenuItem icon={<LogOut />} onClick={() => void signOut("user")}>
              Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
        <button type="button" className="dt-search" onClick={openCommandPalette}>
          <Search aria-hidden="true" />
          Search
        </button>
        <button type="button" className="dt-task" aria-label="Brawzer" onClick={onDashboard}>
          <BrawzerIcon size={26} />
        </button>
        {engines.map((engine) => (
          <button
            key={engine}
            type="button"
            className="dt-task"
            data-running={running.has(engine) || undefined}
            data-active={focusedEngine === engine || undefined}
            aria-label={
              running.has(engine)
                ? `${engineDetails[engine].short}, open`
                : engineDetails[engine].short
            }
            title={engineDetails[engine].short}
            onClick={() => {
              click(engine);
            }}
          >
            <EngineLogo engine={engine} size="md" />
          </button>
        ))}
      </div>
      <div className="dt-tray">
        <button
          type="button"
          className="dt-tray-button"
          aria-label={dark ? "Use the light theme" : "Use the dark theme"}
          onClick={() => {
            setThemePreference(dark ? "light" : "dark");
          }}
        >
          {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </button>
        <span className="dt-clock">
          <span>{time}</span>
          <span>{date}</span>
        </span>
        <button
          type="button"
          className="dt-show-desktop"
          aria-label="Show the desktop"
          title="Show the desktop"
          onClick={onShowDesktop}
        />
      </div>
    </nav>
  );
}

/** The wallpaper, and the desktop's own right-click menu. */
function DesktopBackground({
  dashboardHidden,
  onToggleDashboard,
  onWallpaper,
  onShowDesktop,
}: {
  dashboardHidden: boolean;
  onToggleDashboard: () => void;
  onWallpaper: () => void;
  onShowDesktop: () => void;
}) {
  const router = useRouter();
  const style = useStyle();
  const dark = useDark();
  return (
    <ContextMenu>
      <ContextMenuTrigger className="dt-desk" aria-hidden="true" />
      <ContextMenuContent>
        <MenuItem icon={<LayoutDashboard />} onClick={onToggleDashboard}>
          {dashboardHidden ? "Show Brawzer" : "Hide Brawzer"}
        </MenuItem>
        <MenuItem
          icon={<AppWindow />}
          onClick={() => {
            router.push("/app/browser?new=1");
          }}
        >
          Open a browser…
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

/** The wallpapers, each a preview to pick. Kept for this tab, like the theme. */
function WallpaperDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const current = useSyncExternalStore<Wallpaper>(
    subscribeToDesktop,
    readWallpaper,
    () => "brawzer",
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(34rem,calc(100vw-2rem))]">
        <DialogTitle>Wallpaper</DialogTitle>
        <DialogDescription>Kept for this tab only, like the theme.</DialogDescription>
        <div role="radiogroup" aria-label="Wallpapers" className="mt-5 grid grid-cols-3 gap-2.5">
          {(Object.keys(wallpapers) as Wallpaper[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={current === key}
              className="dt-wp-tile"
              data-wallpaper-preview={key}
              onClick={() => {
                setWallpaper(key);
              }}
            >
              <span>{wallpapers[key].name}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
