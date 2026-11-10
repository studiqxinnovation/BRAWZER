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
import {
  AppWindow,
  FileText,
  HardDriveUpload,
  House,
  Keyboard,
  Layers,
  ListFilter,
  LogOut,
  Monitor,
  MonitorSmartphone,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { EngineLogo } from "@/components/browser/engine-logo";
import { useThemePreference } from "@/components/appearance-controls";
import { fetchBrowserOverview } from "@/lib/api/browser";
import { signOut } from "@/lib/session-channel";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";
import { openCommandPalette } from "./command-palette";

const TRIGGER =
  "rounded-[5px] px-2 py-0.5 text-[0.78rem] font-medium text-ink/80 outline-none data-popup-open:bg-hover hover:bg-hover focus-visible:bg-hover";

/** The time, as the computer's own clock says it, every 15 seconds. */
function subscribeToClock(changed: () => void) {
  const timer = setInterval(changed, 15_000);
  return () => {
    clearInterval(timer);
  };
}
const clockNow = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Clock() {
  const time = useSyncExternalStore(subscribeToClock, clockNow, () => "");
  return (
    <time className="min-w-[4.5rem] text-right text-[0.75rem] font-semibold text-ink tabular-nums">
      {time}
    </time>
  );
}

/** The light or dark switch in the bar, as a computer's menu bar has. */
function ThemeSwitch() {
  const dark = useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );
  return (
    <button
      type="button"
      onClick={() => {
        setThemePreference(dark ? "light" : "dark");
      }}
      aria-label={dark ? "Use the light theme" : "Use the dark theme"}
      className="grid size-[1.375rem] place-items-center rounded-md text-[0.8rem] outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true" className="ad-emoji">
        {dark ? "☀️" : "🌙"}
      </span>
    </button>
  );
}

/**
 * The menu bar above the app's window, as on a desktop computer: Brawzer's
 * menus (each item does what it says), the clock and the theme. The coloured
 * dots are the window's, for the look; closing is "Sign out" in File.
 */
export function MenuBar() {
  const router = useRouter();
  const theme = useThemePreference();
  const [sessions, setSessions] = useState<readonly BrowserSession[] | null>(null);
  const go = (href: string) => {
    router.push(href as Route);
  };

  return (
    <div className="ad-menubar">
      <span aria-hidden="true" className="ad-lights">
        <span className="bg-[#ff5f57]" />
        <span className="bg-[#febc2e]" />
        <span className="bg-[#28c840]" />
      </span>
      <span className="mr-3 text-[0.8rem] font-bold text-ink">Brawzer</span>

      <Menubar className="flex items-center gap-0.5" aria-label="Brawzer menu bar">
        <Menu>
          <MenuTrigger className={TRIGGER}>File</MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<AppWindow />}
              onClick={() => {
                go("/app/browser?new=1");
              }}
            >
              Open a browser…
            </MenuItem>
            <MenuItem
              icon={<Layers />}
              onClick={() => {
                go("/app/profiles");
              }}
            >
              New profile…
            </MenuItem>
            <MenuItem
              icon={<HardDriveUpload />}
              onClick={() => {
                go("/app/drive");
              }}
            >
              Upload to Drive…
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LogOut />} onClick={() => void signOut("user")}>
              Sign out
            </MenuItem>
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger className={TRIGGER}>View</MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<House />}
              onClick={() => {
                go("/app");
              }}
            >
              Home
            </MenuItem>
            <MenuItem
              icon={<Search />}
              shortcut="⌘K"
              onClick={() => {
                openCommandPalette();
              }}
            >
              Search…
            </MenuItem>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Theme</MenuGroupLabel>
              {(
                [
                  ["light", "Light", <Sun key="light" />],
                  ["dark", "Dark", <Moon key="dark" />],
                  ["system", "Same as this computer", <Monitor key="system" />],
                ] as const
              ).map(([value, label, icon]) => (
                <MenuItem
                  key={value}
                  icon={icon}
                  shortcut={theme === value ? "✓" : undefined}
                  onClick={() => {
                    setThemePreference(value);
                  }}
                >
                  {label}
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuContent>
        </Menu>

        <Menu
          onOpenChange={(open) => {
            if (!open) return;
            void fetchBrowserOverview().then((result) => {
              setSessions(result.ok ? result.data.sessions : []);
            });
          }}
        >
          <MenuTrigger className={TRIGGER}>Sessions</MenuTrigger>
          <MenuContent>
            <MenuGroup>
              <MenuGroupLabel>Browsers open now</MenuGroupLabel>
              {sessions === null ? (
                <MenuItem disabled>Looking…</MenuItem>
              ) : sessions.length === 0 ? (
                <MenuItem disabled>None open</MenuItem>
              ) : (
                sessions.map((session) => (
                  <MenuItem
                    key={session.id}
                    icon={<EngineLogo engine={session.engine} size="sm" />}
                    onClick={() => {
                      go(`/app/browser?session=${session.id}`);
                    }}
                  >
                    {engineDetails[session.engine].short}
                  </MenuItem>
                ))
              )}
            </MenuGroup>
            <MenuItem
              icon={<Plus />}
              onClick={() => {
                go("/app/browser?new=1");
              }}
            >
              Open another browser
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<MonitorSmartphone />}
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
          <MenuContent>
            <MenuItem
              icon={<ShieldCheck />}
              onClick={() => {
                go("/app/shield");
              }}
            >
              Security overview
            </MenuItem>
            <MenuItem
              icon={<ListFilter />}
              onClick={() => {
                go("/app/site-rules");
              }}
            >
              Site rules
            </MenuItem>
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger className={TRIGGER}>Help</MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<Keyboard />}
              shortcut="⌘K"
              onClick={() => {
                openCommandPalette();
              }}
            >
              Go to anything
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<ShieldCheck />}
              onClick={() => {
                go("/security");
              }}
            >
              How Brawzer keeps you safe
            </MenuItem>
            <MenuItem
              icon={<FileText />}
              onClick={() => {
                go("/privacy");
              }}
            >
              Privacy
            </MenuItem>
          </MenuContent>
        </Menu>
      </Menubar>

      <div className="ml-auto flex items-center gap-3">
        <Clock />
        <ThemeSwitch />
      </div>
    </div>
  );
}
