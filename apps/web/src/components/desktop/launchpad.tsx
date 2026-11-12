"use client";

import { type BrowserEngine, engineDetails } from "@brawzer/contracts";
import { Dialog, DialogContent, DialogTitle } from "@brawzer/ui/components/dialog";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppIconArt } from "@/components/browser/engine-logo";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { chooseDesktopStyle } from "@/lib/desktop-prefs";
import { lockNow } from "@/lib/lock";
import { Face } from "./face";
import { type AppId, AppIcon, apps, launchpadOrder, Tile } from "./apps/registry";
import { WebAppIcon } from "./apps/web-app-icon";
import type { WebApp } from "./apps/web-apps";
import type { GlyphName, TileColour } from "./glyphs";

type Entry =
  | { kind: "browser"; engine: BrowserEngine; name: string }
  | { kind: "app"; app: AppId; name: string }
  | { kind: "web"; app: WebApp; name: string };

/** Every app in the prototype's order: the browsers, the apps, then web apps from the App Store. */
function useEntries(engines: readonly BrowserEngine[], webApps: readonly WebApp[]): Entry[] {
  return [
    ...engines.map((engine) => ({
      kind: "browser" as const,
      engine,
      name: engineDetails[engine].short,
    })),
    ...launchpadOrder.map((app) => ({ kind: "app" as const, app, name: apps[app].name })),
    ...webApps.map((app) => ({ kind: "web" as const, app, name: app.name })),
  ];
}

function EntryIcon({ entry, size }: { entry: Entry; size: number }) {
  if (entry.kind === "browser") {
    return (
      <span className="dt-lp-art" style={{ width: size, height: size }}>
        <AppIconArt engine={entry.engine} />
      </span>
    );
  }
  if (entry.kind === "web") return <WebAppIcon app={entry.app} size={size} />;
  return <AppIcon app={entry.app} size={size} />;
}

function useOpen(onOpenApp: (app: AppId) => void, onWebApp: (app: WebApp) => void) {
  const { launch } = useLaunchBrowser();
  return (entry: Entry) => {
    if (entry.kind === "browser") void launch(entry.engine);
    else if (entry.kind === "web") onWebApp(entry.app);
    else onOpenApp(entry.app);
  };
}

/** Launchpad (Mac style): every app over the blurred desktop, found by typing. */
export function Launchpad({
  open,
  onOpenChange,
  engines,
  webApps,
  onOpenApp,
  onWebApp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engines: readonly BrowserEngine[];
  webApps: readonly WebApp[];
  onOpenApp: (app: AppId) => void;
  onWebApp: (app: WebApp) => void;
}) {
  const [query, setQuery] = useState("");
  const all = useEntries(engines, webApps);
  const run = useOpen(onOpenApp, onWebApp);
  const shown = all.filter((entry) =>
    entry.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const close = () => {
    onOpenChange(false);
    setQuery("");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className="dt-lp">
        <DialogTitle className="sr-only">Launchpad</DialogTitle>
        <label className="sr-only" htmlFor="launchpad-search">
          Search apps
        </label>
        <input
          id="launchpad-search"
          className="dt-lp-q"
          type="search"
          value={query}
          placeholder="Search apps"
          spellCheck={false}
          // Launchpad is there to be typed into, as on a Mac.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && shown[0]) {
              close();
              run(shown[0]);
            }
          }}
        />
        <ul className="dt-lp-grid" aria-label="Apps">
          {shown.map((entry) => (
            <li key={`${entry.kind}-${entry.name}`}>
              <button
                type="button"
                className="dt-lp-app"
                onClick={() => {
                  close();
                  run(entry);
                }}
              >
                <EntryIcon entry={entry} size={68} />
                <span>{entry.name}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="dt-lp-none">No apps match</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

const PAGES: { label: string; href: Route; glyph: GlyphName; colour: TileColour }[] = [
  { label: "Shield", href: "/app/shield", glyph: "shield", colour: "blue" },
  { label: "Drive", href: "/app/drive", glyph: "drive", colour: "gray" },
  { label: "Sessions", href: "/app/sessions", glyph: "list", colour: "orange" },
  { label: "Profiles", href: "/app/profiles", glyph: "user", colour: "indigo" },
  { label: "Proxy", href: "/app/proxy", glyph: "globe", colour: "teal" },
  { label: "Account", href: "/app/account", glyph: "user", colour: "purple" },
];

/** Start (Windows style): every app, Brawzer's pages, and Lock and Wipe. */
export function StartMenu({
  open,
  onOpenChange,
  engines,
  webApps,
  email,
  onOpenApp,
  onWebApp,
  onPage,
  onWipe,
  onPower,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engines: readonly BrowserEngine[];
  webApps: readonly WebApp[];
  /** Start's power buttons: Restart or Shut down. */
  onPower?: (action: "shut-down" | "restart") => void;
  email: string;
  onOpenApp: (app: AppId) => void;
  onWebApp: (app: WebApp) => void;
  onPage: (href: Route) => void;
  onWipe: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const all = useEntries(engines, webApps);
  const run = useOpen(onOpenApp, onWebApp);
  const shown = all.filter((entry) =>
    entry.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const close = () => {
    onOpenChange(false);
    setQuery("");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className="dt-start">
        <DialogTitle className="sr-only">Start</DialogTitle>
        <label className="sr-only" htmlFor="start-search">
          Search apps
        </label>
        <input
          id="start-search"
          className="dt-start-q"
          type="search"
          value={query}
          placeholder="Search apps"
          spellCheck={false}
          // Start is there to be typed into, as on Windows.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <h2 className="dt-start-h">All apps</h2>
        <ul className="dt-start-grid" aria-label="All apps">
          {shown.map((entry) => (
            <li key={`${entry.kind}-${entry.name}`}>
              <button
                type="button"
                className="dt-start-app"
                onClick={() => {
                  close();
                  run(entry);
                }}
              >
                <EntryIcon entry={entry} size={32} />
                <span>{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <h2 className="dt-start-h">Brawzer</h2>
        <ul className="dt-start-grid" aria-label="Brawzer">
          {PAGES.map((page) => (
            <li key={page.href}>
              <button
                type="button"
                className="dt-start-app"
                onClick={() => {
                  close();
                  router.push(page.href);
                  onPage(page.href);
                }}
              >
                <Tile glyph={page.glyph} colour={page.colour} size={32} />
                <span>{page.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="dt-start-foot">
          <span className="dt-start-me">
            <Face email={email} className="dt-avatar" size={32} />
            <span className="truncate">{email}</span>
          </span>
          <span className="flex gap-1.5">
            <button
              type="button"
              className="dt-btn"
              onClick={() => {
                close();
                chooseDesktopStyle("mac");
              }}
            >
              Mac style
            </button>
            <button
              type="button"
              className="dt-btn"
              onClick={() => {
                close();
                void lockNow();
              }}
            >
              Lock
            </button>
            {onPower && (
              <>
                <button
                  type="button"
                  className="dt-btn"
                  onClick={() => {
                    close();
                    onPower("restart");
                  }}
                >
                  Restart
                </button>
                <button
                  type="button"
                  className="dt-btn"
                  onClick={() => {
                    close();
                    onPower("shut-down");
                  }}
                >
                  Shut down
                </button>
              </>
            )}
            <button
              type="button"
              className="dt-btn"
              data-danger="true"
              onClick={() => {
                close();
                onWipe();
              }}
            >
              Wipe
            </button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
