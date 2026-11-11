"use client";

import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { useSyncExternalStore } from "react";
import {
  readWallpaper,
  setWallpaper,
  subscribeToDesktop,
  type Wallpaper,
  wallpapers,
} from "@/lib/desktop";

/** The wallpapers, each a preview to pick. */
export function WallpaperPicker() {
  const current = useSyncExternalStore<Wallpaper>(
    subscribeToDesktop,
    readWallpaper,
    () => "brawzer",
  );
  return (
    <div role="radiogroup" aria-label="Wallpapers" className="grid grid-cols-3 gap-2.5">
      {(Object.keys(wallpapers) as Wallpaper[]).map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={current === key}
          className="dt-wp-tile"
          data-wallpaper-preview={key}
          onClick={() => {
            setWallpaper(key);
          }}
        >
          <span>{wallpapers[key].name}</span>
        </button>
      ))}
    </div>
  );
}

/** The wallpaper picker as a dialog, from the desktop's menus. Kept for this tab, like the theme. */
export function WallpaperDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(34rem,calc(100vw-2rem))]">
        <DialogTitle>Wallpaper</DialogTitle>
        <DialogDescription>Kept for this tab only, like the theme.</DialogDescription>
        <div className="mt-5">
          <WallpaperPicker />
        </div>
        <div className="mt-6 flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
