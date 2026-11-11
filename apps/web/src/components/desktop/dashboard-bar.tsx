"use client";

import type { BrowserEngine } from "@brawzer/contracts";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Play,
  Search,
  ShieldEllipsis,
} from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { type Notice, Notifications } from "@/components/home/header-actions";
import { toNotices } from "@/components/home/notices";
import { openCommandPalette } from "@/components/app-shell/command-palette";
import { appNav } from "@/content/app";
import { fetchSecurityEvents } from "@/lib/api/security";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { lockNow } from "@/lib/lock";
import { signOut } from "@/lib/session-channel";
import { type AppId, Tile } from "./apps/registry";
import { type MenuEntry, openContextMenu } from "./context-menu";
import { TitleBar } from "./window-chrome";
import "@/components/home/home.css";

/** Each page's name and what it's for, as the title bar shows them (the prototype's PAGES). */
const PAGES: Record<string, { name: string; line: string }> = {
  "/app": { name: "Overview", line: "Your cloud computer at a glance" },
  "/app/browser": { name: "Browsers", line: "Launch and manage cloud browsers" },
  "/app/profiles": { name: "Profiles", line: "Separate cookies, logins and history" },
  "/app/drive": { name: "Drive", line: "Cloud storage for your files" },
  "/app/proxy": { name: "Proxy", line: "Choose where you connect from" },
  "/app/extensions": { name: "Extensions", line: "Add-ons for every browser" },
  "/app/shield": { name: "Shield", line: "Protection, advice and your security history" },
  "/app/site-rules": { name: "Site rules", line: "Allow or block websites" },
  "/app/sessions": { name: "Sessions", line: "Devices signed in to your account" },
  "/app/team": { name: "Team", line: "Invite people and share a plan" },
  "/app/account": { name: "Account", line: "Profile, plan and security" },
  "/app/admin": { name: "Admin", line: "Accounts, plans and the cloud" },
};

/** The page for a path, the longest match winning ("/app/profiles/x/history" is Profiles). */
function pageFor(pathname: string): { href: string; name: string; line: string } {
  const href =
    Object.keys(PAGES)
      .filter((path) => (path === "/app" ? pathname === "/app" : pathname.startsWith(path)))
      .sort((a, b) => b.length - a.length)[0] ?? "/app";
  return { href, ...(PAGES[href] ?? { name: "Brawzer", line: "" }) };
}

const never = () => () => undefined;

/**
 * The dashboard window's title bar, as the prototype draws it: the lights,
 * back and forward, the Browse, Protect and Account menus (the pages that
 * were the sidebar's), the page's name and what it's for, then search, the
 * bell and Start Browsing; on Windows, the window's controls at the end.
 */
export function DashboardBar({
  focused,
  issues,
  admin,
  engines,
  onClose,
  onZoom,
  onDragStart,
  onMenu,
  onPage,
  onOpenApp,
  onLauncher,
  onWipe,
}: {
  focused: boolean;
  /** Shield's recommendations not yet followed: the Protect menu's count. */
  issues: number;
  admin: boolean;
  engines: readonly BrowserEngine[];
  onClose: () => void;
  onZoom: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onPage: () => void;
  onOpenApp: (app: AppId) => void;
  onLauncher: () => void;
  onWipe: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { launch } = useLaunchBrowser();
  const page = pageFor(pathname);
  const group = appNav.find((candidate) =>
    candidate.items.some((item) => pageFor(item.href).href === page.href),
  )?.label;
  const mac = useSyncExternalStore(
    never,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  );

  // The bell's notices: the latest of the account's security history.
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchSecurityEvents(3).then((result) => {
      if (!cancelled && result.ok) setNotices(toNotices(result.data.events, Date.now()));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const go = (href: string) => {
    router.push(href as Route);
    onPage();
  };
  const pageItems = (label: string): MenuEntry[] =>
    (appNav.find((candidate) => candidate.label === label)?.items ?? []).map((item) => {
      const info = PAGES[item.href];
      const Icon = item.icon;
      return {
        label: info?.name ?? item.label,
        sub: info?.line,
        icon: <Icon aria-hidden="true" />,
        current: page.href === item.href,
        badge: item.href === "/app/shield" && issues > 0 ? String(issues) : undefined,
        onSelect: () => {
          go(item.href);
        },
      };
    });

  const menus: Record<"Browse" | "Protect" | "Account", () => MenuEntry[]> = {
    Browse: () => [
      ...pageItems("Browse"),
      "-",
      {
        label: "Open Files",
        sub: "Your Drive in its own window",
        icon: <Tile glyph="folder" colour="blue" size={18} />,
        onSelect: () => {
          onOpenApp("files");
        },
      },
      {
        label: "All apps",
        icon: <Tile glyph="grid" colour="indigo" size={18} />,
        onSelect: onLauncher,
      },
    ],
    Protect: () => [
      ...pageItems("Protect"),
      "-",
      {
        label: "Lock screen",
        icon: <Tile glyph="lock" colour="blue" size={18} />,
        shortcut: "Ctrl+Shift+L",
        onSelect: () => void lockNow(),
      },
      {
        label: "Wipe this computer…",
        icon: <Tile glyph="trash" colour="red" size={18} />,
        onSelect: onWipe,
      },
    ],
    Account: () => [
      ...pageItems("Account"),
      ...(admin
        ? [
            {
              label: "Admin",
              sub: PAGES["/app/admin"]?.line,
              icon: <ShieldEllipsis aria-hidden="true" />,
              current: page.href === "/app/admin",
              onSelect: () => {
                go("/app/admin");
              },
            },
          ]
        : []),
      "-",
      {
        label: "Settings",
        icon: <Tile glyph="gear" colour="gray" size={18} />,
        onSelect: () => {
          onOpenApp("settings");
        },
      },
      {
        label: "App Store",
        icon: <Tile glyph="bag" colour="blue" size={18} />,
        onSelect: () => {
          onOpenApp("app-store");
        },
      },
      "-",
      {
        label: "Sign out",
        icon: <LogOut aria-hidden="true" />,
        onSelect: () => void signOut("user"),
      },
    ],
  };

  const openMenu = (name: keyof typeof menus) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    openContextMenu(
      {
        clientX: box.left,
        clientY: box.bottom + 4,
        currentTarget: event.currentTarget,
        preventDefault: () => undefined,
      },
      menus[name](),
    );
  };

  return (
    <TitleBar
      className="dt-chrome"
      label="Brawzer"
      title={
        <>
          <b>{page.name}</b> {page.line}
        </>
      }
      focused={focused}
      onClose={onClose}
      onMinimise={onClose}
      onZoom={onZoom}
      onDragStart={onDragStart}
      onMenu={onMenu}
      trailing={
        <span className="dw-right">
          <button
            type="button"
            className="dw-tb"
            aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
            onClick={openCommandPalette}
          >
            <Search aria-hidden="true" />
            <span className="sr-only">Search Brawzer</span>
            <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          <Notifications notices={notices} compact />
          <button
            type="button"
            className="dw-start"
            onClick={() => void launch(engines.includes("bee") ? "bee" : (engines[0] ?? "bee"))}
          >
            <Play aria-hidden="true" />
            Start Browsing
          </button>
        </span>
      }
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
      <span className="dw-menus">
        {(["Browse", "Protect", "Account"] as const).map((name) => (
          <button
            key={name}
            type="button"
            className="dw-m"
            data-active={group === name || undefined}
            aria-haspopup="menu"
            onClick={openMenu(name)}
          >
            {name}
            {name === "Protect" && issues > 0 && (
              <>
                {" "}
                <span className="dw-badge">{issues}</span>
              </>
            )}
            <ChevronDown aria-hidden="true" className="dw-cv" />
          </button>
        ))}
      </span>
    </TitleBar>
  );
}
