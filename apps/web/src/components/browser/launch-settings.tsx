"use client";

import { type BrowserEngine, engineDetails } from "@brawzer/contracts";
import { Select } from "@brawzer/ui/components/select";
import { useSyncExternalStore } from "react";
import { Card, Grid } from "@/components/app-shell/page";
import { readDesktopPrefs, subscribeToDesktopPrefs, updateDesktopPrefs } from "@/lib/desktop-prefs";
// The cards' styles: the launcher also shows in the browser's own window, outside the app shell.
import "@/components/app-shell/desktop.css";

/**
 * The prototype's "Launch settings" card: which browser "Start Browsing" and
 * "Launch default" open. Kept with the account, so every device agrees.
 */
export function LaunchSettings({ engines }: { engines: readonly BrowserEngine[] }) {
  const chosen = useSyncExternalStore(
    subscribeToDesktopPrefs,
    () => readDesktopPrefs().defaultEngine,
    () => null,
  );
  const value = chosen && engines.includes(chosen) ? chosen : (engines[0] ?? "bee");
  return (
    <Card label="Launch settings" className="mb-[14px]">
      <Grid cols={3}>
        <Select
          label="Default browser"
          value={value}
          onValueChange={(engine: BrowserEngine) => {
            updateDesktopPrefs({ defaultEngine: engine });
          }}
          options={engines.map((engine) => ({ value: engine, label: engineDetails[engine].name }))}
        />
      </Grid>
      <p className="ad-stat-small">
        What “Start Browsing” and “Launch default” open, with its first free profile.
      </p>
    </Card>
  );
}
