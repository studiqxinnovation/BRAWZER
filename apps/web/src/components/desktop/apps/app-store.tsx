"use client";

import { Button } from "@brawzer/ui/components/button";
import { Check, Plus } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
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
import { webApps } from "./web-apps";

const CATEGORIES: readonly AppCategory[] = ["Brawzer", "Productivity", "Education", "Business"];

/** The App Store: Brawzer's apps to keep in the dock, and web apps that open in a cloud browser. */
export default function AppStoreApp() {
  const window = useAppWindow();
  const { launch } = useLaunchBrowser();
  const prefs = useSyncExternalStore(
    subscribeToDesktopPrefs,
    readDesktopPrefs,
    defaultDesktopPrefs,
  );
  const [tab, setTab] = useState<"apps" | "web">("apps");

  return (
    <div className="ap-body">
      <div className="ap-toolbar">
        <div className="ap-segment" role="tablist" aria-label="App Store">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "apps"}
            onClick={() => {
              setTab("apps");
            }}
          >
            Brawzer apps
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "web"}
            onClick={() => {
              setTab("web");
            }}
          >
            Web apps
          </button>
        </div>
      </div>
      <div
        className="ap-main"
        role="tabpanel"
        aria-label={tab === "apps" ? "Brawzer apps" : "Web apps"}
      >
        {tab === "apps" ? (
          CATEGORIES.map((category) => (
            <section key={category} aria-label={category} className="ap-group">
              <h2 className="ap-group-title">{category}</h2>
              <ul className="ap-store-list">
                {appIds
                  .filter((app) => apps[app].category === category && app !== "app-store")
                  .map((app) => {
                    const pinned = prefs.pinned.includes(app);
                    return (
                      <li key={app} className="ap-store-item">
                        <AppIcon app={app} size={44} />
                        <span className="ap-list-main">
                          <b>{apps[app].name}</b>
                          <span>{apps[app].description}</span>
                        </span>
                        <Button
                          size="sm"
                          onClick={() => {
                            window.openApp(app);
                          }}
                        >
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant={pinned ? "secondary" : "primary"}
                          aria-pressed={pinned}
                          aria-label={`Keep in Dock: ${apps[app].name}`}
                          onClick={() => {
                            setPinned(app, !pinned);
                          }}
                        >
                          {pinned ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                          Keep in Dock
                        </Button>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))
        ) : (
          <>
            <p className="ap-note">
              Each opens in a cloud browser window like any website. Brawzer only keeps the
              shortcut; signing in is between you and the site.
            </p>
            {(["Mail and chat", "Work", "Study", "Watch and read"] as const).map((category) => (
              <section key={category} aria-label={category} className="ap-group">
                <h2 className="ap-group-title">{category}</h2>
                <ul className="ap-store-list">
                  {webApps
                    .filter((app) => app.category === category)
                    .map((app) => {
                      const installed = prefs.webApps.includes(app.id);
                      return (
                        <li key={app.id} className="ap-store-item">
                          <WebAppIcon app={app} size={44} />
                          <span className="ap-list-main">
                            <b>{app.name}</b>
                            <span>
                              {app.description} {new URL(app.url).hostname}
                            </span>
                          </span>
                          <Button
                            size="sm"
                            onClick={() =>
                              void launch("bee", undefined, { open: { url: app.url } })
                            }
                          >
                            Open
                          </Button>
                          <Button
                            size="sm"
                            variant={installed ? "secondary" : "primary"}
                            aria-pressed={installed}
                            aria-label={`Keep in Dock: ${app.name}`}
                            onClick={() => {
                              setWebAppInstalled(app.id, !installed);
                            }}
                          >
                            {installed ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                            Keep in Dock
                          </Button>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
