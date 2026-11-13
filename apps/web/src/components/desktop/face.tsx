"use client";

import { useSyncExternalStore } from "react";
import { photoWallpaperUrl } from "@/lib/desktop";
import {
  defaultDesktopPrefs,
  readDesktopPrefs,
  subscribeToDesktopPrefs,
} from "@/lib/desktop-prefs";

/** The person's Drive picture, if they chose one in Settings. */
export function useFacePhoto(): string | null {
  const prefs = useSyncExternalStore(
    subscribeToDesktopPrefs,
    readDesktopPrefs,
    defaultDesktopPrefs,
  );
  const id = prefs.avatar?.startsWith("photo:") ? prefs.avatar.slice(6) : null;
  return id ? photoWallpaperUrl(id) : null;
}

/**
 * The person, as a computer shows them: their picture from Drive, chosen in
 * Settings, or their initial. Never anything kept on this device.
 */
export function Face({
  email,
  className,
  size,
}: {
  email: string;
  className: string;
  size: number;
}) {
  const photo = useFacePhoto();
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- the person's own picture, from Drive
    <img
      src={photo}
      alt=""
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, objectFit: "cover" }}
      data-testid="face"
    />
  ) : (
    <span className={className} aria-hidden="true">
      {email.slice(0, 1).toUpperCase()}
    </span>
  );
}
