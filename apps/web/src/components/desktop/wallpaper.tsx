"use client";

import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { useToast } from "@brawzer/ui/components/toast";
import { type ChangeEvent, useRef, useState, useSyncExternalStore } from "react";
import { uploadDriveFile } from "@/lib/api/drive";
import {
  photoWallpaperUrl,
  readWallpaperChoice,
  setWallpaper,
  setWallpaperPhoto,
  subscribeToDesktop,
  type Wallpaper,
  type WallpaperChoice,
  wallpaperEntry,
  wallpaperUrl,
  wallpapers,
} from "@/lib/desktop";
import { updateDesktopPrefs } from "@/lib/desktop-prefs";
import { driveFolder } from "./apps/drive-save";

/** The wallpaper, chosen for this tab and kept with the account. */
export function chooseWallpaper(choice: WallpaperChoice) {
  if (choice.kind === "photo") {
    setWallpaperPhoto(choice.fileId);
    updateDesktopPrefs({ wallpaper: `photo:${choice.fileId}` });
  } else {
    setWallpaper(choice.key);
    updateDesktopPrefs({ wallpaper: choice.key });
  }
}

/** The account's kept wallpaper, as a choice to apply. */
export function wallpaperChoiceFrom(kept: string | null): WallpaperChoice | null {
  if (!kept) return null;
  if (kept.startsWith("photo:")) return { kind: "photo", fileId: kept.slice("photo:".length) };
  return kept in wallpapers ? { kind: "named", key: kept as Wallpaper } : null;
}

const DEFAULT_CHOICE: WallpaperChoice = { kind: "named", key: "brawzer" };
const PHOTO_TYPES = "image/png,image/jpeg,image/webp,image/avif,image/gif";
const PHOTO_LIMIT = 25 * 1024 * 1024;

/** The scenes first, by theme; the plain colours last. */
const GROUP_ORDER = [
  "Brawzer",
  "Space",
  "Nature",
  "Wildlife",
  "City",
  "Military",
  "Sport",
  "Gaming",
  "Tech",
  "Colours",
];
const groups = GROUP_ORDER.map((name) => ({
  name,
  keys: (Object.keys(wallpapers) as Wallpaper[]).filter((key) => wallpapers[key].group === name),
})).filter((group) => group.keys.length > 0);

/**
 * The wallpapers, each a preview to pick: Brawzer's own scenes, the colour
 * washes, and a photo of the person's own, uploaded into Drive's Wallpapers
 * folder (scanned and encrypted like any file there).
 */
export function WallpaperPicker() {
  const current = useSyncExternalStore<WallpaperChoice>(
    subscribeToDesktop,
    readWallpaperChoice,
    () => DEFAULT_CHOICE,
  );
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const photo = current.kind === "photo" ? current.fileId : null;

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!PHOTO_TYPES.split(",").includes(file.type)) {
      toast.add({
        type: "info",
        title: "Not a picture Brawzer can show",
        description: "Choose a PNG, JPEG, WebP, AVIF or GIF.",
      });
      return;
    }
    if (file.size > PHOTO_LIMIT) {
      toast.add({
        type: "info",
        title: "That picture is too large",
        description: "Wallpapers can be up to 25 MB.",
      });
      return;
    }
    setUploading(true);
    try {
      const folder = await driveFolder("Wallpapers");
      if (!folder.ok) {
        toast.add({
          type: "error",
          title: "Couldn’t open Drive",
          description: folder.error.message,
        });
        return;
      }
      const result = await uploadDriveFile(file, folder.data, () => undefined).result;
      if (!result.ok) {
        toast.add({
          type: "error",
          title: "Couldn’t save the picture",
          description: result.error.message,
        });
        return;
      }
      if (!result.data.previewable) {
        toast.add({
          type: "error",
          title: "That picture can’t be used",
          description: "The scan didn’t pass it. It’s in Drive’s Wallpapers folder, in quarantine.",
        });
        return;
      }
      chooseWallpaper({ kind: "photo", fileId: result.data.id });
      globalThis.dispatchEvent(new Event("brawzer:drive-changed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="dt-wp">
      <div role="radiogroup" aria-label="Your photo" className="dt-wp-grid">
        {photo && (
          <button
            type="button"
            role="radio"
            aria-checked
            className="dt-wp-tile"
            style={{ backgroundImage: `url("${photoWallpaperUrl(photo)}")` }}
          >
            <span>Your photo</span>
          </button>
        )}
        <button
          type="button"
          className="dt-wp-tile dt-wp-add"
          disabled={uploading}
          onClick={() => {
            input.current?.click();
          }}
        >
          <span>
            {uploading ? "Saving to Drive…" : photo ? "Choose another photo…" : "Choose a photo…"}
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept={PHOTO_TYPES}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            void pickPhoto(event);
          }}
        />
      </div>
      {groups.map((group) => (
        <div key={group.name} className="dt-wp-group">
          <div className="dt-wp-cap">{group.name}</div>
          <div role="radiogroup" aria-label={group.name} className="dt-wp-grid">
            {group.keys.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={current.kind === "named" && current.key === key}
                className="dt-wp-tile"
                data-wallpaper-preview={wallpapers[key].kind === "gradient" ? key : undefined}
                style={
                  wallpapers[key].kind === "image"
                    ? { backgroundImage: `url("${wallpaperUrl(key)}")` }
                    : undefined
                }
                title={creditLine(key)}
                onClick={() => {
                  chooseWallpaper({ kind: "named", key });
                }}
              >
                <span>{wallpapers[key].name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <PhotoCredits />
    </div>
  );
}

/** A tile's tooltip: who took the photo, under which licence. */
function creditLine(key: Wallpaper): string | undefined {
  const credit = wallpaperEntry(key).credit;
  return credit ? `Photo: ${credit.by} (${credit.licence})` : undefined;
}

/** The photographers, named as their licences ask; each name opens the photo's source page. */
function PhotoCredits() {
  const credited = (Object.keys(wallpapers) as Wallpaper[]).filter(
    (key) => wallpaperEntry(key).credit,
  );
  if (credited.length === 0) return null;
  return (
    <details className="dt-wp-credits">
      <summary>Photo credits</summary>
      <ul>
        {credited.map((key) => {
          const credit = wallpaperEntry(key).credit;
          if (!credit) return null;
          return (
            <li key={key}>
              <span className="font-medium">{wallpapers[key].name}</span>:{" "}
              <a href={credit.source} target="_blank" rel="noreferrer">
                {credit.by}
              </a>
              , {credit.licence}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The wallpaper picker as a dialog, from the desktop's menus. */
export function WallpaperDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(40rem,calc(100vw-2rem))]">
        <DialogTitle>Wallpaper</DialogTitle>
        <DialogDescription>
          Kept with your account. A photo of your own is saved in Drive’s Wallpapers folder.
        </DialogDescription>
        <div className="dt-wp-scroll mt-5">
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
