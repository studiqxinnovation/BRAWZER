"use client";

import { Button } from "@brawzer/ui/components/button";
import { useSyncExternalStore } from "react";
import { useDesktop } from "@/components/desktop/desktop-context";
import { type DesktopStyle, readDesktopStyle, subscribeToDesktop } from "@/lib/desktop";
import { chooseDesktopStyle } from "@/lib/desktop-prefs";

/** Mac or Windows style, as the prototype's Preferences segment; kept with the account. */
export function DesktopStyleSegment() {
  const style = useSyncExternalStore<DesktopStyle>(
    subscribeToDesktop,
    readDesktopStyle,
    () => "mac",
  );
  return (
    <span className="ap-segment" role="radiogroup" aria-label="Desktop style">
      {(
        [
          ["mac", "Mac"],
          ["windows", "Windows"],
        ] as const
      ).map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={style === option}
          onClick={() => {
            chooseDesktopStyle(option);
          }}
        >
          {text}
        </button>
      ))}
    </span>
  );
}

/** "Change…": the desktop's wallpaper picker; the classic layout has no wallpaper. */
export function WallpaperButton() {
  const desktop = useDesktop();
  if (!desktop) return <span className="ad-li-sub">Only on the desktop</span>;
  return (
    <Button variant="secondary" size="sm" onClick={desktop.chooseWallpaper}>
      Change…<span className="sr-only"> the wallpaper</span>
    </Button>
  );
}
