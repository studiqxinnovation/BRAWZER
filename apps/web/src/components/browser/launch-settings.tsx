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
export function LaunchSettings({
  engines,
  region,
}: {
  engines: readonly BrowserEngine[];
  /** Where this installation runs its browsers, as it names it; null when it doesn't say. */
  region: string | null;
}) {
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
        <Select
          label="Region"
          value="here"
          disabled
          options={[{ value: "here", label: region ?? "Where this installation runs" }]}
        />
        <Select
          label="Screen size"
          value="window"
          disabled
          options={[{ value: "window", label: "Matches the window" }]}
        />
      </Grid>
      <p className="ad-stat-small">
        “Start Browsing” and “Launch default” open the default browser with its first free profile.
        Every browser runs in this installation’s region and fills its window; a profile’s proxy
        changes where websites see it from.
      </p>
    </Card>
  );
}
