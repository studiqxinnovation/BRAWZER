"use client";

import type { BrowserSession } from "@brawzer/contracts";
import { Dialog, DialogContent, DialogTitle } from "@brawzer/ui/components/dialog";
import { useToast } from "@brawzer/ui/components/toast";
import {
  AppWindow,
  Image as ImageIcon,
  Monitor,
  Moon,
  PanelsTopLeft,
  Power,
  Sun,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { endBrowserSession } from "@/lib/api/browser";
import {
  type DesktopStyle,
  readDesktopStyle,
  setDesktopOn,
  setDesktopStyle,
  subscribeToDesktop,
} from "@/lib/desktop";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";
import { PowerButtons } from "./dock";

/**
 * Control Centre: only switches that do something real here, as tiles
 * (theme, the desktop's style, wallpaper, the classic layout), the cloud
 * browsers running now with a way to end them all, and Lock and Sign out.
 */
export function ControlCentre({
  open,
  onOpenChange,
  sessions,
  limit,
  onWallpaper,
  onShowDesktop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: readonly BrowserSession[];
  limit: number;
  onWallpaper: () => void;
  onShowDesktop: () => void;
}) {
  const toast = useToast();
  const [ending, setEnding] = useState(false);
  const dark = useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );
  const style = useSyncExternalStore<DesktopStyle>(
    subscribeToDesktop,
    readDesktopStyle,
    () => "mac",
  );

  async function endAll() {
    setEnding(true);
    const results = await Promise.all(sessions.map((session) => endBrowserSession(session.id)));
    setEnding(false);
    const failed = results.filter((result) => !result.ok && result.status !== 404).length;
    toast.add(
      failed === 0
        ? {
            type: "success",
            title: "Every browser ended",
            description: "Profiles that keep their data saved it.",
          }
        : {
            type: "error",
            title: `${String(failed)} couldn’t be ended`,
            description: "Try again.",
          },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={style === "mac" ? "dt-cc dt-cc-mac" : "dt-cc dt-cc-windows"}>
        <DialogTitle className="sr-only">Control Centre</DialogTitle>
        <div className="dt-cc-tiles">
          <button
            type="button"
            className="dt-cc-tile"
            aria-pressed={dark}
            onClick={() => {
              setThemePreference(dark ? "light" : "dark");
            }}
          >
            {dark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            <span>Dark mode</span>
          </button>
          <button
            type="button"
            className="dt-cc-tile"
            onClick={() => {
              setDesktopStyle(style === "mac" ? "windows" : "mac");
            }}
          >
            <Monitor aria-hidden="true" />
            <span>{style === "mac" ? "Use Windows style" : "Use Mac style"}</span>
          </button>
          <button
            type="button"
            className="dt-cc-tile"
            onClick={() => {
              onOpenChange(false);
              onWallpaper();
            }}
          >
            <ImageIcon aria-hidden="true" />
            <span>Wallpaper</span>
          </button>
          <button
            type="button"
            className="dt-cc-tile"
            onClick={() => {
              onOpenChange(false);
              onShowDesktop();
            }}
          >
            <PanelsTopLeft aria-hidden="true" />
            <span>Show the desktop</span>
          </button>
        </div>
        <div className="dt-cc-panel">
          <div className="dt-cc-row">
            <AppWindow aria-hidden="true" />
            <span className="flex-1">
              <b className="block text-callout font-semibold text-ink">Cloud browsers</b>
              <span className="text-footnote text-ink-secondary">
                {String(sessions.length)} of {String(limit)} open
              </span>
            </span>
            <button
              type="button"
              className="dt-cc-small"
              disabled={sessions.length === 0 || ending}
              onClick={() => void endAll()}
            >
              <Power aria-hidden="true" />
              End all
            </button>
          </div>
        </div>
        <div className="dt-cc-power">
          <PowerButtons />
          <button
            type="button"
            className="dt-power"
            onClick={() => {
              onOpenChange(false);
              setDesktopOn(false);
            }}
          >
            Classic layout
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
