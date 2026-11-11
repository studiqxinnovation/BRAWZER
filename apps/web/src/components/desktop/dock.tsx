"use client";

import { type BrowserEngine, engineDetails } from "@brawzer/contracts";
import { Mark } from "@brawzer/ui/brand";
import { LayoutGrid, Lock, LogOut, Search, SlidersHorizontal, Sun, Moon } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { openCommandPalette } from "@/components/app-shell/command-palette";
import { AppIconArt, EngineLogo } from "@/components/browser/engine-logo";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { subscribeToClock, taskbarClock } from "@/lib/clock";
import { lockNow } from "@/lib/lock";
import { signOut } from "@/lib/session-channel";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";
import { type AppId, AppIcon, apps } from "./apps/registry";
import { type DesktopWindow, windowLabel } from "./windows";

const useDark = () =>
  useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );

/** Brawzer's own icon, for the dock and taskbar: its mark on the accent colour. */
export function BrawzerIcon({ size }: { size: number }) {
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

export interface DockActions {
  windows: readonly DesktopWindow[];
  focused: string;
  engines: readonly BrowserEngine[];
  pinned: readonly AppId[];
  dashboardHidden: boolean;
  onDashboard: () => void;
  onFocus: (id: string) => void;
  onMinimise: (id: string) => void;
  onOpenApp: (app: AppId) => void;
  onLaunchpad: () => void;
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
        <AppIcon app={window.content.app} size={18} />
      )}
    </span>
  );
}

/** Mac style: the dock along the bottom, magnifying under the pointer. */
export function Dock(actions: DockActions) {
  const { windows, engines, pinned, dashboardHidden, onDashboard, onFocus, onLaunchpad } = actions;
  const open = useOpenOrToggle(actions);
  const minimised = windows.filter((entry) => entry.min);
  // Apps open but not pinned show after the pinned ones, as a dock does.
  const extra = [
    ...new Set(
      windows.flatMap((entry) =>
        entry.content.kind === "app" && !pinned.includes(entry.content.app)
          ? [entry.content.app]
          : [],
      ),
    ),
  ];
  return (
    <nav aria-label="Dock" className="dt-dock">
      <DockItem label="Brawzer" running={!dashboardHidden} onClick={onDashboard}>
        <BrawzerIcon size={46} />
      </DockItem>
      <DockItem label="Launchpad" running={false} onClick={onLaunchpad}>
        <span className="dt-launchpad-icon" aria-hidden="true">
          <LayoutGrid />
        </span>
      </DockItem>
      <span className="dt-sep" aria-hidden="true" />
      {engines.map((engine) => (
        <DockItem
          key={engine}
          label={engineDetails[engine].short}
          running={runningEngine(windows, engine)}
          onClick={() => {
            open.browser(engine);
          }}
        >
          <span className="dt-dock-art">
            <AppIconArt engine={engine} />
          </span>
        </DockItem>
      ))}
      {(pinned.length > 0 || extra.length > 0) && <span className="dt-sep" aria-hidden="true" />}
      {[...pinned, ...extra].map((app) => (
        <DockItem
          key={app}
          label={apps[app].name}
          running={runningApp(windows, app)}
          onClick={() => {
            open.app(app);
          }}
        >
          <AppIcon app={app} size={46} />
        </DockItem>
      ))}
      {minimised.length > 0 && <span className="dt-sep" aria-hidden="true" />}
      {minimised.map((entry) => (
        <DockItem
          key={entry.id}
          label={`${windowLabel(entry)}, minimised`}
          running={false}
          onClick={() => {
            onFocus(entry.id);
          }}
        >
          <WindowThumb window={entry} />
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

/** Windows style: the taskbar, Start, search, and the tray. */
export function Taskbar(
  actions: DockActions & {
    startOpen: boolean;
    onStart: () => void;
    onControlCentre: () => void;
    onShowDesktop: () => void;
  },
) {
  const {
    windows,
    focused,
    engines,
    pinned,
    onDashboard,
    onStart,
    onControlCentre,
    onShowDesktop,
  } = actions;
  const open = useOpenOrToggle(actions);
  const dark = useDark();
  const [time, date] = useSyncExternalStore(subscribeToClock, taskbarClock, () => "|").split("|");
  const focusedWindow = windows.find((entry) => entry.id === focused);
  const extra = [
    ...new Set(
      windows.flatMap((entry) =>
        entry.content.kind === "app" && !pinned.includes(entry.content.app)
          ? [entry.content.app]
          : [],
      ),
    ),
  ];
  return (
    <nav aria-label="Taskbar" className="dt-taskbar">
      <div className="dt-taskbar-middle">
        <button
          type="button"
          className="dt-task"
          aria-label="Start"
          aria-expanded={actions.startOpen}
          data-active={actions.startOpen || undefined}
          onClick={onStart}
        >
          <BrawzerIcon size={26} />
        </button>
        <button type="button" className="dt-search" onClick={openCommandPalette}>
          <Search aria-hidden="true" />
          Search
        </button>
        <button type="button" className="dt-task" aria-label="Brawzer" onClick={onDashboard}>
          <BrawzerIcon size={26} />
        </button>
        {engines.map((engine) => {
          const running = runningEngine(windows, engine);
          return (
            <button
              key={engine}
              type="button"
              className="dt-task"
              data-running={running || undefined}
              data-active={
                (focusedWindow?.content.kind === "browser" &&
                  focusedWindow.content.session.engine === engine) ||
                undefined
              }
              aria-label={
                running ? `${engineDetails[engine].short}, open` : engineDetails[engine].short
              }
              title={engineDetails[engine].short}
              onClick={() => {
                open.browser(engine);
              }}
            >
              <EngineLogo engine={engine} size="md" />
            </button>
          );
        })}
        {[...pinned, ...extra].map((app) => {
          const running = runningApp(windows, app);
          return (
            <button
              key={app}
              type="button"
              className="dt-task"
              data-running={running || undefined}
              data-active={
                (focusedWindow?.content.kind === "app" && focusedWindow.content.app === app) ||
                undefined
              }
              aria-label={running ? `${apps[app].name}, open` : apps[app].name}
              title={apps[app].name}
              onClick={() => {
                open.app(app);
              }}
            >
              <AppIcon app={app} size={24} />
            </button>
          );
        })}
      </div>
      <div className="dt-tray">
        <button
          type="button"
          className="dt-tray-button"
          aria-label="Control Centre"
          onClick={onControlCentre}
        >
          <SlidersHorizontal aria-hidden="true" />
        </button>
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

/** The power choices the Start panel and Control Centre share. */
export function PowerButtons() {
  return (
    <>
      <button type="button" className="dt-power" onClick={() => void lockNow()}>
        <Lock aria-hidden="true" />
        Lock
      </button>
      <button type="button" className="dt-power" onClick={() => void signOut("user")}>
        <LogOut aria-hidden="true" />
        Sign out
      </button>
    </>
  );
}
