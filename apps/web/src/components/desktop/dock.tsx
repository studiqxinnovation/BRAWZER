"use client";

import { type BrowserEngine, engineDetails } from "@brawzer/contracts";
import { Mark } from "@brawzer/ui/brand";
import { type MouseEvent, type ReactNode, type Ref, useSyncExternalStore } from "react";
import { openCommandPalette } from "@/components/app-shell/command-palette";
import { AppIconArt, EngineLogo } from "@/components/browser/engine-logo";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { lockNow } from "@/lib/lock";
import { subscribeToClock, taskbarClock } from "@/lib/clock";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";
import { type AppId, AppIcon, apps, dockSystemApps, Tile } from "./apps/registry";
import { WebAppIcon } from "./apps/web-app-icon";
import type { WebApp } from "./apps/web-apps";
import { type DesktopWindow, windowLabel } from "./windows";

function subscribeToOnline(changed: () => void) {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
}

const useDark = () =>
  useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );

/**
 * Brawzer's tile, as the prototype's dashboard icon: its mark on the warm
 * yellow tile (the prototype's own colours, with Brawzer's logo).
 */
export function BrawzerTile({ size }: { size: number }) {
  return (
    <span
      aria-hidden="true"
      className="dt-brand"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}
    >
      <Mark size={Math.round(size * 0.5)} />
    </span>
  );
}

export interface DockActions {
  windows: readonly DesktopWindow[];
  focused: string;
  engines: readonly BrowserEngine[];
  pinned: readonly AppId[];
  webApps: readonly WebApp[];
  dashboardHidden: boolean;
  onDashboard: () => void;
  onDashboardMenu: (event: MouseEvent<HTMLElement>) => void;
  onFocus: (id: string) => void;
  onMinimise: (id: string) => void;
  onOpenApp: (app: AppId) => void;
  onAppMenu: (event: MouseEvent<HTMLElement>, app: AppId) => void;
  onBrowserMenu: (event: MouseEvent<HTMLElement>, engine: BrowserEngine) => void;
  onWebApp: (app: WebApp) => void;
  onLaunchpad: () => void;
  onLaunchpadMenu: (event: MouseEvent<HTMLElement>) => void;
  onMinimisedMenu: (event: MouseEvent<HTMLElement>, id: string) => void;
  /** Right-click on the bar itself. */
  onBarMenu: (event: MouseEvent<HTMLElement>) => void;
  onStartMenu?: (event: MouseEvent<HTMLElement>) => void;
}

/** Clicking a browser or app: open it, bring it forward, or tuck it away if it's in front. */
function useOpenOrToggle({ windows, focused, onFocus, onMinimise, onOpenApp }: DockActions) {
  const { launch } = useLaunchBrowser();
  const toggle = (own: readonly DesktopWindow[], open: () => void) => {
    if (own.length === 0) {
      open();
      return;
    }
    const front = own.filter((entry) => !entry.min).sort((a, b) => b.z - a.z)[0];
    const target = front ?? own.at(-1);
    if (!target) return;
    if (front?.id === focused) onMinimise(target.id);
    else onFocus(target.id);
  };
  return {
    browser: (engine: BrowserEngine) => {
      toggle(
        windows.filter(
          (entry) => entry.content.kind === "browser" && entry.content.session.engine === engine,
        ),
        () => void launch(engine),
      );
    },
    app: (app: AppId) => {
      toggle(
        windows.filter((entry) => entry.content.kind === "app" && entry.content.app === app),
        () => {
          onOpenApp(app);
        },
      );
    },
  };
}

const runningEngine = (windows: readonly DesktopWindow[], engine: BrowserEngine) =>
  windows.some(
    (entry) => entry.content.kind === "browser" && entry.content.session.engine === engine,
  );
const runningApp = (windows: readonly DesktopWindow[], app: AppId) =>
  windows.some((entry) => entry.content.kind === "app" && entry.content.app === app);

/** The Dock's middle group: pinned apps, then apps that are open but not pinned. */
function middleApps(pinned: readonly AppId[], windows: readonly DesktopWindow[]): AppId[] {
  const fixed = new Set<AppId>([...dockSystemApps, "trash"]);
  const extra = windows.flatMap((entry) =>
    entry.content.kind === "app" &&
    !pinned.includes(entry.content.app) &&
    !fixed.has(entry.content.app)
      ? [entry.content.app]
      : [],
  );
  return [...pinned.filter((app) => !fixed.has(app)), ...new Set(extra)];
}

function WindowThumb({ window }: { window: DesktopWindow }) {
  return (
    <span className="dt-thumb" aria-hidden="true">
      <span className="dt-thumb-bar">
        <i />
        <i />
        <i />
      </span>
      {window.content.kind === "browser" ? (
        <EngineLogo engine={window.content.session.engine} size="sm" />
      ) : (
        <AppIcon app={window.content.app} size={20} />
      )}
    </span>
  );
}

function DockItem({
  label,
  running,
  onClick,
  onMenu,
  buttonRef,
  dock,
  children,
}: {
  label: string;
  running: boolean;
  onClick: () => void;
  onMenu?: (event: MouseEvent<HTMLElement>) => void;
  buttonRef?: Ref<HTMLButtonElement>;
  dock?: string;
  children: ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="dt-dk"
      data-dock={dock}
      data-running={running || undefined}
      aria-label={running ? `${label}, open` : label}
      onClick={onClick}
      onContextMenu={onMenu}
    >
      {children}
      <span className="dt-dk-tip" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

const Sep = () => <span className="dt-dk-sep" aria-hidden="true" />;

/**
 * Mac style: the prototype's Dock along the bottom. Brawzer, the browsers,
 * the apps kept in it (and any other app that's open), Launchpad, the App
 * Store and Settings, Trash, then minimised windows. Each magnifies under
 * the pointer; right-click for its menu.
 */
export function Dock({
  dashboardRef,
  ...actions
}: DockActions & { dashboardRef: Ref<HTMLButtonElement> }) {
  const { windows, engines, pinned, webApps, dashboardHidden, onLaunchpad } = actions;
  const open = useOpenOrToggle(actions);
  const minimised = windows.filter((entry) => entry.min);
  return (
    // Right-click on the bar itself: Settings and Show desktop, both also in the bar.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <nav
      aria-label="Dock"
      className="dt-dock"
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) actions.onBarMenu(event);
      }}
    >
      <DockItem
        label="Brawzer"
        dock="dashboard"
        running={!dashboardHidden}
        buttonRef={dashboardRef}
        onClick={actions.onDashboard}
        onMenu={actions.onDashboardMenu}
      >
        <BrawzerTile size={46} />
      </DockItem>
      <Sep />
      {engines.map((engine) => (
        <DockItem
          key={engine}
          dock={`browser:${engine}`}
          label={engineDetails[engine].short}
          running={runningEngine(windows, engine)}
          onClick={() => {
            open.browser(engine);
          }}
          onMenu={(event) => {
            actions.onBrowserMenu(event, engine);
          }}
        >
          <span className="dt-dk-art">
            <AppIconArt engine={engine} />
          </span>
        </DockItem>
      ))}
      <Sep />
      {middleApps(pinned, windows).map((app) => (
        <DockItem
          key={app}
          dock={`app:${app}`}
          label={apps[app].name}
          running={runningApp(windows, app)}
          onClick={() => {
            open.app(app);
          }}
          onMenu={(event) => {
            actions.onAppMenu(event, app);
          }}
        >
          <AppIcon app={app} size={46} />
        </DockItem>
      ))}
      {webApps.map((app) => (
        <DockItem
          key={`web-${app.id}`}
          label={app.name}
          running={false}
          onClick={() => {
            actions.onWebApp(app);
          }}
        >
          <WebAppIcon app={app} size={46} />
        </DockItem>
      ))}
      <Sep />
      <DockItem
        label="Launchpad"
        dock="launchpad"
        running={false}
        onClick={onLaunchpad}
        onMenu={actions.onLaunchpadMenu}
      >
        <Tile glyph="grid" colour="indigo" size={46} />
      </DockItem>
      {dockSystemApps.map((app) => (
        <DockItem
          key={app}
          dock={`app:${app}`}
          label={apps[app].name}
          running={runningApp(windows, app)}
          onClick={() => {
            open.app(app);
          }}
          onMenu={(event) => {
            actions.onAppMenu(event, app);
          }}
        >
          <AppIcon app={app} size={46} />
        </DockItem>
      ))}
      <Sep />
      <DockItem
        label="Trash"
        dock="app:trash"
        running={runningApp(windows, "trash")}
        onClick={() => {
          open.app("trash");
        }}
        onMenu={(event) => {
          actions.onAppMenu(event, "trash");
        }}
      >
        <AppIcon app="trash" size={46} />
      </DockItem>
      {minimised.length > 0 && <Sep />}
      {minimised.map((entry) => (
        <DockItem
          key={entry.id}
          dock={`win:${entry.id}`}
          label={`${windowLabel(entry)}, minimised`}
          running={false}
          onClick={() => {
            actions.onFocus(entry.id);
          }}
          onMenu={(event) => {
            actions.onMinimisedMenu(event, entry.id);
          }}
        >
          <WindowThumb window={entry} />
        </DockItem>
      ))}
    </nav>
  );
}

/**
 * Windows style: the prototype's taskbar. Start (Brawzer's logo), search,
 * Brawzer, the browsers and apps, and the tray: Control Centre, the theme,
 * the clock and "Show the desktop".
 */
export function Taskbar({
  dashboardRef,
  ...actions
}: DockActions & {
  dashboardRef: Ref<HTMLButtonElement>;
  startOpen: boolean;
  onStart: () => void;
  onControlCentre: () => void;
  onShowDesktop: () => void;
  onTaskView: () => void;
}) {
  const {
    windows,
    focused,
    engines,
    pinned,
    webApps,
    onStart,
    onControlCentre,
    onShowDesktop,
    onTaskView,
  } = actions;
  const open = useOpenOrToggle(actions);
  const dark = useDark();
  const online = useSyncExternalStore(
    subscribeToOnline,
    () => navigator.onLine,
    () => true,
  );
  const [time, date] = useSyncExternalStore(subscribeToClock, taskbarClock, () => "|").split("|");
  const focusedWindow = windows.find((entry) => entry.id === focused);
  const item = (
    key: string,
    label: string,
    running: boolean,
    active: boolean,
    onClick: () => void,
    icon: ReactNode,
    onMenu?: (event: MouseEvent<HTMLElement>) => void,
  ) => (
    <button
      key={key}
      type="button"
      className="dt-tb-item"
      data-dock={key.startsWith("web-") ? undefined : key}
      data-running={running || undefined}
      data-active={active || undefined}
      aria-label={running ? `${label}, open` : label}
      title={label}
      onClick={onClick}
      onContextMenu={onMenu}
    >
      {icon}
    </button>
  );
  return (
    // Right-click on the bar itself: Settings and Show desktop, both also in the bar.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <nav
      aria-label="Taskbar"
      className="dt-taskbar"
      onContextMenu={(event) => {
        if (
          event.target === event.currentTarget ||
          (event.target as HTMLElement).classList.contains("dt-tb-middle")
        )
          actions.onBarMenu(event);
      }}
    >
      <div className="dt-tb-middle">
        <button
          type="button"
          className="dt-tb-start"
          aria-label="Start"
          aria-expanded={actions.startOpen}
          data-active={actions.startOpen || undefined}
          onClick={onStart}
          onContextMenu={actions.onStartMenu}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="dt-tb-logo">
            <rect x="3" y="3" width="8.4" height="8.4" rx="1.3" fill="#3AA0F3" />
            <rect x="12.6" y="3" width="8.4" height="8.4" rx="1.3" fill="#2B8FE6" />
            <rect x="3" y="12.6" width="8.4" height="8.4" rx="1.3" fill="#1F7FD8" />
            <rect x="12.6" y="12.6" width="8.4" height="8.4" rx="1.3" fill="#1570C9" />
          </svg>
        </button>
        <button type="button" className="dt-tb-search" onClick={openCommandPalette}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          Search
        </button>
        <button
          type="button"
          className="dt-tb-item dt-tb-taskview"
          aria-label="Task View"
          title="Task View"
          onClick={onTaskView}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="8" height="6" rx="1.5" />
            <rect x="13" y="5" width="8" height="6" rx="1.5" />
            <rect x="3" y="13" width="8" height="6" rx="1.5" />
            <rect x="13" y="13" width="8" height="6" rx="1.5" />
          </svg>
        </button>
        <button
          ref={dashboardRef}
          type="button"
          className="dt-tb-item"
          data-dock="dashboard"
          data-running={!actions.dashboardHidden || undefined}
          aria-label="Brawzer"
          title="Brawzer"
          onClick={actions.onDashboard}
          onContextMenu={actions.onDashboardMenu}
        >
          <BrawzerTile size={24} />
        </button>
        {engines.map((engine) =>
          item(
            `browser:${engine}`,
            engineDetails[engine].short,
            runningEngine(windows, engine),
            focusedWindow?.content.kind === "browser" &&
              focusedWindow.content.session.engine === engine,
            () => {
              open.browser(engine);
            },
            <EngineLogo engine={engine} size="md" />,
            (event) => {
              actions.onBrowserMenu(event, engine);
            },
          ),
        )}
        {[...middleApps(pinned, windows), ...dockSystemApps].map((app) =>
          item(
            `app:${app}`,
            apps[app].name,
            runningApp(windows, app),
            focusedWindow?.content.kind === "app" && focusedWindow.content.app === app,
            () => {
              open.app(app);
            },
            <AppIcon app={app} size={24} />,
            (event) => {
              actions.onAppMenu(event, app);
            },
          ),
        )}
        {webApps.map((app) =>
          item(
            `web-${app.id}`,
            app.name,
            false,
            false,
            () => {
              actions.onWebApp(app);
            },
            <WebAppIcon app={app} size={24} />,
          ),
        )}
      </div>
      <div className="dt-tb-tray">
        <button
          type="button"
          className="dt-tb-tray-b"
          aria-label="Lock screen"
          title="Lock (Ctrl+Shift+L)"
          onClick={() => void lockNow()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </button>
        <span
          className="dt-tb-tray-b"
          role="img"
          aria-label={online ? "Connected" : "Offline"}
          title={online ? "Connected to the cloud" : "Offline"}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={online ? undefined : { opacity: 0.35 }}
          >
            <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
          </svg>
        </span>
        <button
          type="button"
          className="dt-tb-tray-b"
          aria-label="Control Centre"
          onClick={onControlCentre}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="5" rx="2.5" />
            <circle cx="8" cy="7.5" r="1.2" fill="currentColor" />
            <rect x="3" y="14" width="18" height="5" rx="2.5" />
            <circle cx="16" cy="16.5" r="1.2" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="dt-tb-tray-b"
          aria-label={dark ? "Use the light theme" : "Use the dark theme"}
          onClick={() => {
            setThemePreference(dark ? "light" : "dark");
          }}
        >
          {dark ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <span className="dt-tb-clock">
          <span>{time}</span>
          <span>{date}</span>
        </span>
        <button
          type="button"
          className="dt-tb-desk"
          aria-label="Show the desktop"
          title="Show the desktop"
          onClick={onShowDesktop}
        />
      </div>
    </nav>
  );
}
