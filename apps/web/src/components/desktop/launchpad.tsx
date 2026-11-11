"use client";

import { type BrowserEngine, engineDetails } from "@brawzer/contracts";
import { Dialog, DialogContent, DialogTitle } from "@brawzer/ui/components/dialog";
import { Search } from "lucide-react";
import { useState } from "react";
import { AppIconArt } from "@/components/browser/engine-logo";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { type AppCategory, type AppId, AppIcon, appIds, apps } from "./apps/registry";
import { WebAppIcon } from "./apps/web-app-icon";
import type { WebApp } from "./apps/web-apps";
import { PowerButtons } from "./dock";

const CATEGORIES: readonly AppCategory[] = ["Brawzer", "Productivity", "Education", "Business"];

/**
 * Every app and browser in one place, found by typing: Launchpad in Mac
 * style (the whole screen), the Start panel in Windows style (above the
 * taskbar, with Lock and Sign out).
 */
export function AppLauncher({
  variant,
  open,
  onOpenChange,
  engines,
  webApps,
  onWebApp,
  onOpenApp,
}: {
  variant: "launchpad" | "start";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engines: readonly BrowserEngine[];
  webApps: readonly WebApp[];
  onWebApp: (app: WebApp) => void;
  onOpenApp: (app: AppId) => void;
}) {
  const { launch } = useLaunchBrowser();
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((word) => text.toLowerCase().includes(word));
  const browsers = engines.filter((engine) =>
    matches(`${engineDetails[engine].name} ${engineDetails[engine].short} browser`),
  );
  const found = appIds.filter((app) =>
    matches(`${apps[app].name} ${apps[app].description} ${apps[app].category}`),
  );

  function close() {
    onOpenChange(false);
    setQuery("");
  }

  const groups = [
    { label: "Browsers", items: browsers.map((engine) => ({ kind: "browser" as const, engine })) },
    {
      label: "Web apps",
      items: webApps
        .filter((app) => matches(`${app.name} ${app.description} web`))
        .map((app) => ({ kind: "web" as const, app })),
    },
    ...CATEGORIES.map((category) => ({
      label: category,
      items: found
        .filter((app) => apps[app].category === category)
        .map((app) => ({ kind: "app" as const, app })),
    })),
  ].filter((group) => group.items.length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className={variant === "launchpad" ? "dt-launchpad" : "dt-start"}>
        <DialogTitle className="sr-only">
          {variant === "launchpad" ? "Launchpad" : "Start"}
        </DialogTitle>
        <label className="dt-lp-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search apps and browsers</span>
          <input
            // Launchpad is there to be typed into, as on a Mac.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            type="search"
            value={query}
            placeholder="Search"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <div className="dt-lp-groups">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="dt-lp-group">
              <h2 className="dt-lp-heading">{group.label}</h2>
              <ul className="dt-lp-grid">
                {group.items.map((item) =>
                  item.kind === "web" ? (
                    <li key={item.app.id}>
                      <button
                        type="button"
                        className="dt-lp-item"
                        title={item.app.description}
                        onClick={() => {
                          close();
                          onWebApp(item.app);
                        }}
                      >
                        <WebAppIcon app={item.app} size={variant === "launchpad" ? 64 : 40} />
                        <span>{item.app.name}</span>
                      </button>
                    </li>
                  ) : item.kind === "browser" ? (
                    <li key={item.engine}>
                      <button
                        type="button"
                        className="dt-lp-item"
                        onClick={() => {
                          close();
                          void launch(item.engine);
                        }}
                      >
                        <span className="dt-lp-art">
                          <AppIconArt engine={item.engine} />
                        </span>
                        <span>{engineDetails[item.engine].short}</span>
                      </button>
                    </li>
                  ) : (
                    <li key={item.app}>
                      <button
                        type="button"
                        className="dt-lp-item"
                        title={apps[item.app].description}
                        onClick={() => {
                          close();
                          onOpenApp(item.app);
                        }}
                      >
                        <AppIcon app={item.app} size={variant === "launchpad" ? 64 : 40} />
                        <span>{apps[item.app].name}</span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
          {groups.length === 0 && <p className="dt-lp-none">Nothing matches “{query.trim()}”.</p>}
        </div>
        {variant === "start" && (
          <div className="dt-start-power">
            <PowerButtons />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
