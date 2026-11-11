"use client";

import { ArrowRight } from "lucide-react";
import { useSyncExternalStore } from "react";
import { type AppId, AppIcon, apps } from "@/components/desktop/apps/registry";
import { useDesktop } from "@/components/desktop/desktop-context";
import { desktopActive, subscribeToDesktop } from "@/lib/desktop";

const HOME_APPS: readonly { app: AppId; line: string }[] = [
  { app: "music", line: "Play your own songs" },
  { app: "writer", line: "Documents" },
  { app: "calc", line: "Spreadsheets" },
  { app: "notepad", line: "Plain text" },
  { app: "calculator", line: "Quick sums" },
];

/**
 * Home's "Apps", as the prototype has it: five everyday apps that open in
 * their own windows, and "All apps" for the rest. Apps are the desktop's,
 * so the classic layout and phones don't show them.
 */
export function HomeApps() {
  const desktop = useDesktop();
  const onDesktop = useSyncExternalStore(subscribeToDesktop, desktopActive, () => false);
  if (!desktop || !onDesktop) return null;
  return (
    <section aria-label="Apps" className="hm-card hm-rise flex flex-col">
      <div className="hm-panel-head">
        <h2 className="flex items-center gap-2 text-body font-semibold text-ink">Apps</h2>
        <button type="button" className="hm-link" onClick={desktop.openLauncher}>
          All apps
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <ul className="hm-apps">
        {HOME_APPS.map(({ app, line }) => (
          <li key={app}>
            <button
              type="button"
              className="hm-tile"
              onClick={() => {
                desktop.openApp(app);
              }}
            >
              <AppIcon app={app} size={56} />
              <b>{apps[app].name}</b>
              <span>{line}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
