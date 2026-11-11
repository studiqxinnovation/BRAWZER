"use client";

import { type BrowserSession, engineDetails } from "@brawzer/contracts";
import {
  Menu,
  Menubar,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@brawzer/ui/components/menu";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { EngineLogo } from "@/components/browser/engine-logo";
import { type AppId, Tile } from "@/components/desktop/apps/registry";
import { useDesktop } from "@/components/desktop/desktop-context";
import type { GlyphName, TileColour } from "@/components/desktop/glyphs";
import { endBrowserSession, fetchBrowserOverview } from "@/lib/api/browser";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { menuBarClock, subscribeToClock } from "@/lib/clock";
import {
  type DesktopStyle,
  desktopActive,
  readDesktopOn,
  readDesktopStyle,
  setDesktopOn,
  subscribeToDesktop,
} from "@/lib/desktop";
import { readFocusedName, subscribeToFocusedName } from "@/lib/desktop-focus";
import { chooseDesktopStyle } from "@/lib/desktop-prefs";
import { lockNow } from "@/lib/lock";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";

const TRIGGER = "ad-mb-mi";

const useDark = () =>
  useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );

const Check = ({ on }: { on: boolean }) => (
  <span className="ad-mb-ck" aria-hidden="true">
    {on && (
      <svg viewBox="0 0 24 24">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )}
  </span>
);

const Glyph = ({ glyph, colour }: { glyph: GlyphName; colour: TileColour }) => (
  <Tile glyph={glyph} colour={colour} size={18} />
);

function subscribeToOnline(changed: () => void) {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
}

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}

/** This computer's battery, where the browser tells a page (Chrome and Edge do; others don't). */
function useBattery(): { level: number; charging: boolean } | null {
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (!nav.getBattery) return;
    let manager: BatteryManager | null = null;
    const read = () => {
      if (manager) setBattery({ level: manager.level, charging: manager.charging });
    };
    void nav.getBattery().then((found) => {
      manager = found;
      read();
      found.addEventListener("levelchange", read);
      found.addEventListener("chargingchange", read);
    });
    return () => {
      manager?.removeEventListener("levelchange", read);
      manager?.removeEventListener("chargingchange", read);
    };
  }, []);
  return battery;
}

function Status() {
  const online = useSyncExternalStore(
    subscribeToOnline,
    () => navigator.onLine,
    () => true,
  );
  const battery = useBattery();
  return (
    <>
      <svg
        className="ad-mb-ic"
        viewBox="0 0 24 24"
        role="img"
        aria-label={online ? "Online" : "Offline"}
        data-off={online ? undefined : true}
      >
        <title>{online ? "Online" : "Offline"}</title>
        <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
      </svg>
      {battery && (
        <svg
          className="ad-mb-ic"
          viewBox="0 0 24 24"
          role="img"
          aria-label={`Battery ${String(Math.round(battery.level * 100))}%${battery.charging ? ", charging" : ""}`}
        >
          <title>{`Battery ${String(Math.round(battery.level * 100))}%`}</title>
          <rect x="1" y="6" width="18" height="12" rx="2" />
          <path d="M23 13v-2" />
          <rect
            x="3"
            y="8"
            width={Math.max(1, Math.round(14 * battery.level))}
            height="8"
            rx="1"
            fill="currentColor"
            opacity=".5"
          />
        </svg>
      )}
    </>
  );
}

function Clock() {
  const time = useSyncExternalStore(subscribeToClock, menuBarClock, () => "");
  return <time className="ad-mb-clock">{time}</time>;
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="ad-mb-b" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The prototype's menu bar: the window's dots, the app in front (Brawzer's
 * menu), File, View, Sessions, Shield and Help, then whether this computer
 * is online, its battery where the browser says, the clock, Lock, the
 * style switch, the theme and Control Centre. Every item does what it says.
 */
export function MenuBar() {
  const router = useRouter();
  const desktop = useDesktop();
  const dark = useDark();
  const { launch } = useLaunchBrowser();
  const appName = useSyncExternalStore(subscribeToFocusedName, readFocusedName, () => "Brawzer");
  const desktopOn = useSyncExternalStore(subscribeToDesktop, readDesktopOn, () => true);
  const style = useSyncExternalStore<DesktopStyle>(
    subscribeToDesktop,
    readDesktopStyle,
    () => "mac",
  );
  const [sessions, setSessions] = useState<readonly BrowserSession[] | null>(null);
  const [engines, setEngines] = useState<readonly BrowserSession["engine"][]>([]);
  const onDesktop = () => desktop !== null && desktopActive();
  const go = (href: string) => {
    router.push(href as Route);
    desktop?.showDashboard();
  };
  /** An app's window on the desktop; in the classic layout, its page where there is one. */
  const app = (id: AppId, fallback: string, params?: Record<string, string>) => {
    if (desktop && onDesktop()) desktop.openApp(id, params);
    else go(fallback);
  };
  const loadSessions = () => {
    void fetchBrowserOverview().then((result) => {
      setSessions(result.ok ? result.data.sessions : []);
      if (result.ok) setEngines(result.data.engines);
    });
  };

  return (
    <div className="ad-menubar">
      <span aria-hidden="true" className="ad-lights">
        <span className="bg-[#ff5f57]" />
        <span className="bg-[#febc2e]" />
        <span className="bg-[#28c840]" />
      </span>

      <Menubar className="ad-mb-menu" aria-label="Brawzer menu bar">
        <Menu>
          <MenuTrigger className="ad-mb-mi ad-mb-app">{appName}</MenuTrigger>
          <MenuContent className="ad-mb-pop">
            <MenuItem
              onClick={() => {
                app("settings", "/app/account", { section: "about" });
              }}
            >
              About Brawzer
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<Glyph glyph="gear" colour="gray" />}
              onClick={() => {
                app("settings", "/app/account");
              }}
            >
              Settings…
            </MenuItem>
            <MenuItem
              icon={<Glyph glyph="bag" colour="blue" />}
              onClick={() => {
                app("app-store", "/app/extensions");
              }}
            >
              App Store…
            </MenuItem>
            {desktop && desktopOn && (
              <>
                <MenuSeparator />
                <MenuItem onClick={desktop.hideDashboard}>Hide Brawzer</MenuItem>
                <MenuItem onClick={desktop.showDesktop}>Show desktop</MenuItem>
              </>
            )}
            <MenuSeparator />
            <MenuItem shortcut="Ctrl+Shift+L" onClick={() => void lockNow()}>
              Lock screen
            </MenuItem>
            {desktop && <MenuItem onClick={desktop.wipe}>Wipe this computer…</MenuItem>}
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger className={TRIGGER}>File</MenuTrigger>
          <MenuContent className="ad-mb-pop">
            <MenuItem
              icon={<Glyph glyph="doc" colour="blue" />}
              onClick={() => {
                app("writer", "/app/drive");
              }}
            >
              New document
            </MenuItem>
            <MenuItem
              icon={<Glyph glyph="note" colour="yellow" />}
              onClick={() => {
                app("notepad", "/app/drive");
              }}
            >
              New note
            </MenuItem>
            <MenuItem
              icon={<Glyph glyph="table" colour="green" />}
              onClick={() => {
                app("calc", "/app/drive");
              }}
            >
              New spreadsheet
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<Glyph glyph="folder" colour="blue" />}
              onClick={() => {
                app("files", "/app/drive");
              }}
            >
              Open Files
            </MenuItem>
            <MenuItem
              icon={<Glyph glyph="drive" colour="gray" />}
              onClick={() => {
                go("/app/drive");
              }}
            >
              Upload to Drive…
            </MenuItem>
            <MenuSeparator />
            <MenuItem shortcut="Ctrl+Shift+L" onClick={() => void lockNow()}>
              Lock screen
            </MenuItem>
            {desktop && <MenuItem onClick={desktop.wipe}>Wipe this computer…</MenuItem>}
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger className={TRIGGER}>View</MenuTrigger>
          <MenuContent className="ad-mb-pop">
            {desktop && desktopOn && (
              <>
                <MenuItem onClick={desktop.toggleDashboard}>
                  {desktop.dashboardHidden() ? "Show Brawzer" : "Hide Brawzer"}
                </MenuItem>
                <MenuItem onClick={desktop.openLauncher}>All apps</MenuItem>
                <MenuItem onClick={desktop.showDesktop}>Show desktop</MenuItem>
                <MenuSeparator />
              </>
            )}
            <MenuGroup>
              <MenuGroupLabel className="ad-mb-h">Appearance</MenuGroupLabel>
              <MenuItem
                icon={<Check on={dark} />}
                onClick={() => {
                  setThemePreference("dark");
                }}
              >
                Dark
              </MenuItem>
              <MenuItem
                icon={<Check on={!dark} />}
                onClick={() => {
                  setThemePreference("light");
                }}
              >
                Light
              </MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel className="ad-mb-h">Desktop style</MenuGroupLabel>
              <MenuItem
                icon={<Check on={desktopOn && style === "mac"} />}
                onClick={() => {
                  setDesktopOn(true);
                  chooseDesktopStyle("mac");
                }}
              >
                Mac
              </MenuItem>
              <MenuItem
                icon={<Check on={desktopOn && style === "windows"} />}
                onClick={() => {
                  setDesktopOn(true);
                  chooseDesktopStyle("windows");
                }}
              >
                Windows
              </MenuItem>
              <MenuItem
                icon={<Check on={!desktopOn} />}
                onClick={() => {
                  setDesktopOn(!desktopOn);
                }}
              >
                {desktopOn ? "Use the classic layout" : "Use the desktop"}
              </MenuItem>
            </MenuGroup>
            {desktop && desktopOn && (
              <>
                <MenuSeparator />
                <MenuItem onClick={desktop.chooseWallpaper}>Change wallpaper…</MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>

        <Menu
          onOpenChange={(open) => {
            if (open) loadSessions();
          }}
        >
          <MenuTrigger className={TRIGGER}>Sessions</MenuTrigger>
          <MenuContent className="ad-mb-pop">
            <MenuGroup>
              <MenuGroupLabel className="ad-mb-h">Launch a browser</MenuGroupLabel>
              {engines.map((engine) => (
                <MenuItem
                  key={engine}
                  icon={<EngineLogo engine={engine} size="sm" />}
                  onClick={() => void launch(engine)}
                >
                  {engineDetails[engine].short}
                </MenuItem>
              ))}
              {engines.length === 0 && (
                <MenuItem
                  onClick={() => {
                    go("/app/browser?new=1");
                  }}
                >
                  Open a browser…
                </MenuItem>
              )}
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              {sessions === null ? (
                <MenuItem disabled>Looking…</MenuItem>
              ) : sessions.length === 0 ? (
                <MenuItem disabled>No sessions running</MenuItem>
              ) : (
                <>
                  <MenuGroupLabel className="ad-mb-h">Running now</MenuGroupLabel>
                  {sessions.map((session) => (
                    <MenuItem
                      key={session.id}
                      icon={<EngineLogo engine={session.engine} size="sm" />}
                      shortcut={`Started ${new Date(session.startedAt ?? session.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                      onClick={() => {
                        if (desktop && onDesktop()) desktop.openSession(session);
                        else go(`/app/browser?session=${session.id}`);
                      }}
                    >
                      {engineDetails[session.engine].short}
                    </MenuItem>
                  ))}
                  <MenuItem
                    onClick={() => {
                      void Promise.all(
                        sessions.map((session) => endBrowserSession(session.id)),
                      ).then(() => {
                        router.refresh();
                      });
                    }}
                  >
                    End all sessions
                  </MenuItem>
                </>
              )}
            </MenuGroup>
            <MenuSeparator />
            <MenuItem
              onClick={() => {
                go("/app/sessions");
              }}
            >
              Signed-in devices
            </MenuItem>
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger className={TRIGGER}>Shield</MenuTrigger>
          <MenuContent className="ad-mb-pop">
            <MenuGroup>
              <MenuGroupLabel className="ad-mb-h">Protection</MenuGroupLabel>
              <MenuItem
                icon={<Glyph glyph="shield" colour="blue" />}
                onClick={() => {
                  go("/app/shield");
                }}
              >
                Open Shield
              </MenuItem>
              <MenuItem
                onClick={() => {
                  go("/app/site-rules");
                }}
              >
                Site rules
              </MenuItem>
              <MenuItem
                onClick={() => {
                  go("/app");
                }}
              >
                Ad blocker for each profile
              </MenuItem>
            </MenuGroup>
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger className={TRIGGER}>Help</MenuTrigger>
          <MenuContent className="ad-mb-pop">
            {desktop && <MenuItem onClick={desktop.showShortcuts}>Keyboard shortcuts</MenuItem>}
            <MenuItem
              onClick={() => {
                app("settings", "/app/account", { section: "about" });
              }}
            >
              About Brawzer
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onClick={() => {
                go("/security");
              }}
            >
              How Brawzer keeps you safe
            </MenuItem>
            <MenuItem
              onClick={() => {
                go("/privacy");
              }}
            >
              Privacy
            </MenuItem>
          </MenuContent>
        </Menu>
      </Menubar>

      <div className="ad-mb-right">
        <Status />
        <Clock />
        <IconButton label="Lock screen" onClick={() => void lockNow()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </IconButton>
        {desktopOn && (
          <IconButton
            label="Switch to Windows style"
            onClick={() => {
              chooseDesktopStyle("windows");
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <path d="M3 15h18M9 21h6" />
            </svg>
          </IconButton>
        )}
        <IconButton
          label={dark ? "Use the light theme" : "Use the dark theme"}
          onClick={() => {
            setThemePreference(dark ? "light" : "dark");
          }}
        >
          <span aria-hidden="true" className="ad-emoji">
            {dark ? "☀️" : "🌙"}
          </span>
        </IconButton>
        {desktop && desktopOn && (
          <IconButton label="Control Centre" onClick={desktop.toggleControlCentre}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="5" rx="2.5" />
              <circle cx="8" cy="7.5" r="1.2" fill="currentColor" />
              <rect x="3" y="14" width="18" height="5" rx="2.5" />
              <circle cx="16" cy="16.5" r="1.2" fill="currentColor" />
            </svg>
          </IconButton>
        )}
      </div>
    </div>
  );
}
