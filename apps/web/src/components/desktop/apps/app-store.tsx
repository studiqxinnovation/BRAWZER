"use client";

import { type BrowserEngine, engineDetails } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { type CSSProperties, useEffect, useState, useSyncExternalStore } from "react";
import { AppIconArt } from "@/components/browser/engine-logo";
import { fetchBrowserOverview } from "@/lib/api/browser";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import {
  defaultDesktopPrefs,
  readDesktopPrefs,
  setPinned,
  setWebAppInstalled,
  subscribeToDesktopPrefs,
} from "@/lib/desktop-prefs";
import { useAppWindow } from "./app-window";
import { type AppCategory, AppIcon, appIds, apps } from "./registry";
import { WebAppIcon } from "./web-app-icon";
import { type WebApp, webApps } from "./web-apps";

type Category = "All" | "Browsers" | AppCategory | "Web apps";
const CATEGORIES: readonly Category[] = [
  "All",
  "Browsers",
  "Brawzer",
  "Brawzer Suite",
  "Productivity",
  "Education",
  "Business",
  "Web apps",
];

/** The prototype's packs: several web apps installed at once. */
const PACKS: {
  name: string;
  description: string;
  colour: string;
  apps: readonly WebApp["category"][];
}[] = [
  {
    name: "Student pack",
    description: "Classes, research, languages and reading.",
    colour: "#5E5CE6",
    apps: ["Study", "Watch and read"],
  },
  {
    name: "Work pack",
    description: "Email, chat, documents and meetings.",
    colour: "#FF9F0A",
    apps: ["Mail and chat", "Work"],
  },
  {
    name: "AI pack",
    description: "ChatGPT, Claude, Gemini and Perplexity, each in its own tab.",
    colour: "#10a37f",
    apps: ["AI"],
  },
  {
    name: "Social pack",
    description: "Discord, X, Instagram, Facebook and Reddit.",
    colour: "#FF375F",
    apps: ["Social"],
  },
];

const matches = (query: string, ...text: readonly string[]) =>
  !query || text.some((value) => value.toLowerCase().includes(query));

/**
 * The App Store, as the prototype's: categories down the side, a banner,
 * search, packs, and a card for each app. Brawzer's apps are built in (keep
 * them in the Dock or not); web apps install as shortcuts in the Dock and
 * Launchpad, kept with the account, and open in a cloud browser.
 */
export default function AppStoreApp() {
  const window = useAppWindow();
  const { launch } = useLaunchBrowser();
  const prefs = useSyncExternalStore(
    subscribeToDesktopPrefs,
    readDesktopPrefs,
    defaultDesktopPrefs,
  );
  const [category, setCategory] = useState<Category>("All");
  const [query, setQuery] = useState("");
  const [engines, setEngines] = useState<readonly BrowserEngine[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchBrowserOverview().then((result) => {
      if (!cancelled && result.ok) setEngines(result.data.engines);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const shows = (of: Category) => category === "All" || category === of;
  const builtIn = appIds.filter(
    (app) =>
      app !== "app-store" &&
      shows(apps[app].category) &&
      matches(q, apps[app].name, apps[app].description),
  );
  const web = shows("Web apps")
    ? webApps.filter((app) => matches(q, app.name, app.description, app.category))
    : [];
  const browsers = shows("Browsers")
    ? engines.filter((engine) => matches(q, engineDetails[engine].name, "browser"))
    : [];

  return (
    <div className="ap-split">
      <nav className="ap-side" aria-label="App Store">
        <span className="ap-side-h" aria-hidden="true">
          App Store
        </span>
        {CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            className="ap-side-item"
            aria-current={category === item ? "page" : undefined}
            onClick={() => {
              setCategory(item);
            }}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="ap-sto-main">
        <div className="ap-sto-hero">
          <b>Your cloud computer, your apps</b>
          <span>
            Add the apps you use every day. They run in the cloud, so nothing installs on this
            device.
          </span>
        </div>
        <label className="sr-only" htmlFor={`${window.id}-q`}>
          Search apps
        </label>
        <input
          id={`${window.id}-q`}
          className="ap-input ap-sto-q"
          type="search"
          placeholder="Search apps"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        {category === "All" && !q && (
          <div className="ap-sto-packs">
            {PACKS.map((pack) => {
              const members = webApps.filter((app) => pack.apps.includes(app.category));
              const missing = members.filter((app) => !prefs.webApps.includes(app.id));
              return (
                <div
                  key={pack.name}
                  className="ap-sto-pack"
                  style={{ "--pc": pack.colour } as CSSProperties}
                >
                  <b>{pack.name}</b>
                  <span className="ap-sto-desc">{pack.description}</span>
                  <span className="ap-sto-pack-i" aria-hidden="true">
                    {members.slice(0, 8).map((app) => (
                      <WebAppIcon key={app.id} app={app} size={26} />
                    ))}
                  </span>
                  <Button
                    size="sm"
                    variant={missing.length > 0 ? "primary" : "secondary"}
                    disabled={missing.length === 0}
                    onClick={() => {
                      for (const app of missing) setWebAppInstalled(app.id, true);
                    }}
                  >
                    {missing.length > 0
                      ? `Install ${String(missing.length)} app${missing.length === 1 ? "" : "s"}`
                      : "Installed"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <ul className="ap-sto-grid" aria-label={category === "All" ? "Apps" : category}>
          {browsers.map((engine) => (
            <li key={engine} className="ap-sto-card">
              <span className="ap-sto-art" aria-hidden="true">
                <AppIconArt engine={engine} />
              </span>
              <span className="ap-sto-text">
                <b>{engineDetails[engine].short}</b>
                <span className="ap-sto-cat">Browsers</span>
                <span className="ap-sto-desc">
                  {engineDetails[engine].name}, in Brawzer’s cloud.
                </span>
                <span className="ap-row">
                  <Button size="sm" variant="primary" onClick={() => void launch(engine)}>
                    Open
                  </Button>
                  <span className="ap-sto-pill">Built in</span>
                </span>
              </span>
            </li>
          ))}
          {builtIn.map((app) => {
            const pinned = prefs.pinned.includes(app);
            return (
              <li key={app} className="ap-sto-card">
                <AppIcon app={app} size={52} />
                <span className="ap-sto-text">
                  <b>{apps[app].name}</b>
                  <span className="ap-sto-cat">{apps[app].category}</span>
                  <span className="ap-sto-desc">{apps[app].description}</span>
                  <span className="ap-row">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        window.openApp(app);
                      }}
                    >
                      Open
                    </Button>
                    <Button
                      size="sm"
                      aria-pressed={pinned}
                      aria-label={`Keep in Dock: ${apps[app].name}`}
                      onClick={() => {
                        setPinned(app, !pinned);
                      }}
                    >
                      Keep in Dock
                    </Button>
                  </span>
                </span>
              </li>
            );
          })}
          {web.map((app) => {
            const installed = prefs.webApps.includes(app.id);
            return (
              <li key={app.id} className="ap-sto-card">
                <WebAppIcon app={app} size={52} />
                <span className="ap-sto-text">
                  <b>{app.name}</b>
                  <span className="ap-sto-cat">{app.category}</span>
                  <span className="ap-sto-desc">
                    {app.description} {new URL(app.url).hostname}
                  </span>
                  <span className="ap-row">
                    {installed ? (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void launch("bee", undefined, { open: { url: app.url } })}
                        >
                          Open
                        </Button>
                        <Button
                          size="sm"
                          aria-label={`Remove ${app.name}`}
                          onClick={() => {
                            setWebAppInstalled(app.id, false);
                          }}
                        >
                          Remove
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          aria-label={`Install ${app.name}`}
                          onClick={() => {
                            setWebAppInstalled(app.id, true);
                          }}
                        >
                          Install
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void launch("bee", undefined, { open: { url: app.url } })}
                        >
                          Open
                        </Button>
                      </>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        {browsers.length + builtIn.length + web.length === 0 && (
          <p className="ap-empty">No apps match “{query}”.</p>
        )}
      </div>
    </div>
  );
}
