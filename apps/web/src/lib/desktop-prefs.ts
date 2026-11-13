"use client";

import { type BrowserEngine, browserEngineSchema } from "@brawzer/contracts";
import { z } from "zod";
import { type AppId, defaultPinnedApps, isAppId } from "@/components/desktop/apps/registry";
import { webAppById } from "@/components/desktop/apps/web-apps";
import { fetchAppRecords, putAppRecord } from "./api/app-records";
import { type DesktopStyle, setDesktopStyle } from "./desktop";

/**
 * What the desktop keeps with the account (Phase 9), so it's the same on any
 * computer and nothing of it stays on this one: the Dock's apps and web
 * apps, the style chosen when it was first opened, and Control Centre's
 * Do Not Disturb, sounds, volume and brightness.
 */
/** The web apps every desktop starts with; the App Store adds and removes the rest. */
export const starterWebApps: readonly string[] = [
  "whatsapp",
  "telegram",
  "chatgpt",
  "claude",
  "youtube",
  "spotify",
];

export interface DesktopPrefs {
  pinned: readonly AppId[];
  webApps: readonly string[];
  /** The starter web apps were put in once; removing them after that sticks. */
  webAppsSeeded: boolean;
  /** Null until the person picks one ("Choose your desktop"). */
  style: "mac" | "windows" | null;
  dnd: boolean;
  sounds: boolean;
  /** 0 to 100. */
  volume: number;
  /** 15 to 100. */
  brightness: number;
  /** What "Start Browsing" opens; null: Bee Browser, or the first offered. */
  defaultEngine: BrowserEngine | null;
  /** Drive's starting folders and the welcome note were made (once per account). */
  driveSetUp: boolean;
  /** Files marked as favourites, for the desktop's menu. */
  favourites: readonly Favourite[];
  /** The one-time hint that the dashboard waits in the Dock was shown. */
  deskHinted: boolean;
  /** The wallpaper: a name, or "photo:<Drive file id>"; null: Brawzer's own. */
  wallpaper: string | null;
  /** Minutes without use before the screen dims, the screen saver starts and the screen locks; 0: never. */
  dimAfter: number;
  saverAfter: number;
  lockAfter: number;
  /** Where each app's window was last, by app id (or "browser"), so it opens there again. */
  windowRects: Readonly<Record<string, WindowRect>>;
  /** The person's picture: "photo:<Drive file id>", or null for their initial. */
  avatar: string | null;
}

export interface WindowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The choices Settings offers for the idle times, in minutes; 0 is never. */
export const IDLE_CHOICES = [0, 1, 2, 5, 10, 15, 20, 30, 60] as const;
const MAX_REMEMBERED_WINDOWS = 40;

export interface Favourite {
  id: string;
  name: string;
  contentType: string;
  status: "clean" | "infected";
}

const prefsSchema = z.object({
  pinned: z.array(z.string()).optional(),
  webApps: z.array(z.string()).optional(),
  webAppsSeeded: z.boolean().optional(),
  style: z.enum(["mac", "windows"]).nullable().optional(),
  dnd: z.boolean().optional(),
  sounds: z.boolean().optional(),
  volume: z.number().min(0).max(100).optional(),
  brightness: z.number().min(15).max(100).optional(),
  defaultEngine: browserEngineSchema.nullable().optional(),
  driveSetUp: z.boolean().optional(),
  favourites: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        contentType: z.string(),
        status: z.enum(["clean", "infected"]),
      }),
    )
    .max(40)
    .optional(),
  deskHinted: z.boolean().optional(),
  wallpaper: z.string().max(60).nullable().optional(),
  dimAfter: z.number().int().min(0).max(1440).optional(),
  saverAfter: z.number().int().min(0).max(1440).optional(),
  lockAfter: z.number().int().min(0).max(1440).optional(),
  avatar: z.string().max(60).nullable().optional(),
  windowRects: z
    .record(
      z.string().max(40),
      z.object({
        left: z.number(),
        top: z.number(),
        width: z.number().min(1),
        height: z.number().min(1),
      }),
    )
    .optional(),
});

const DEFAULT: DesktopPrefs = {
  pinned: defaultPinnedApps,
  webApps: starterWebApps,
  webAppsSeeded: true,
  style: null,
  dnd: false,
  sounds: true,
  volume: 60,
  brightness: 100,
  defaultEngine: null,
  driveSetUp: false,
  favourites: [],
  deskHinted: false,
  wallpaper: null,
  dimAfter: 10,
  saverAfter: 15,
  // Never, unless chosen: a shared computer already warns and signs out on its own.
  lockAfter: 0,
  windowRects: {},
  avatar: null,
};

/** The saved web apps, with the starter ones added the first time an account is seen since they exist. */
function seedWebApps(saved: readonly string[], seeded: boolean): readonly string[] {
  const known = saved.filter((id) => webAppById(id) !== undefined);
  if (seeded) return known;
  return [...known, ...starterWebApps.filter((id) => !known.includes(id))];
}

let prefs: DesktopPrefs = DEFAULT;
let loaded: "no" | "loading" | "yes" = "no";
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

export const readDesktopPrefs = () => prefs;
export const defaultDesktopPrefs = () => DEFAULT;
/** Whether the account's choices have arrived (the style picker waits for them). */
export const desktopPrefsLoaded = () => loaded === "yes";

export function subscribeToDesktopPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadDesktopPrefs(): Promise<void> {
  if (loaded !== "no") return;
  loaded = "loading";
  const result = await fetchAppRecords("desktop");
  if (!result.ok) {
    loaded = "no";
    return;
  }
  const record = result.data.records.find((candidate) => candidate.key === "state");
  const parsed = record ? prefsSchema.safeParse(record.data) : null;
  if (parsed?.success) {
    const data = parsed.data;
    prefs = {
      pinned: data.pinned ? data.pinned.filter(isAppId) : DEFAULT.pinned,
      webApps: seedWebApps(data.webApps ?? [], data.webAppsSeeded ?? false),
      webAppsSeeded: true,
      style: data.style ?? null,
      dnd: data.dnd ?? DEFAULT.dnd,
      sounds: data.sounds ?? DEFAULT.sounds,
      volume: data.volume ?? DEFAULT.volume,
      brightness: data.brightness ?? DEFAULT.brightness,
      defaultEngine: data.defaultEngine ?? null,
      driveSetUp: data.driveSetUp ?? false,
      favourites: data.favourites ?? [],
      deskHinted: data.deskHinted ?? false,
      wallpaper: data.wallpaper ?? null,
      dimAfter: data.dimAfter ?? DEFAULT.dimAfter,
      saverAfter: data.saverAfter ?? DEFAULT.saverAfter,
      lockAfter: data.lockAfter ?? DEFAULT.lockAfter,
      windowRects: data.windowRects ?? {},
      avatar: data.avatar ?? null,
    };
  }
  loaded = "yes";
  changed();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function savePrefs(leaving = false) {
  saveTimer = null;
  // Until the account's own choices arrive, a change applies here only (it mustn't overwrite them).
  if (loaded === "yes") void putAppRecord("desktop", "state", prefs, { keepalive: leaving });
}
export function updateDesktopPrefs(patch: Partial<DesktopPrefs>) {
  prefs = { ...prefs, ...patch };
  changed();
  // Sliders change many times a second: the record is written once they settle.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(savePrefs, 400);
}
// A change made just before the tab reloads or closes is still written.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      savePrefs(true);
    }
  });
}

/** Mac or Windows style, for this tab and kept with the account. */
export function chooseDesktopStyle(style: DesktopStyle) {
  setDesktopStyle(style);
  updateDesktopPrefs({ style });
}

export function setPinned(app: AppId, on: boolean) {
  const without = prefs.pinned.filter((candidate) => candidate !== app);
  updateDesktopPrefs({ pinned: on ? [...without, app] : without });
}

export function setWebAppInstalled(id: string, on: boolean) {
  const without = prefs.webApps.filter((candidate) => candidate !== id);
  updateDesktopPrefs({ webApps: on ? [...without, id] : without });
}

/** Adds a file to the favourites, or takes it out when it's there. */
export function toggleFavourite(file: Favourite) {
  const without = prefs.favourites.filter((entry) => entry.id !== file.id);
  updateDesktopPrefs({
    favourites:
      without.length === prefs.favourites.length ? [file, ...without].slice(0, 40) : without,
  });
}

/** Keeps where a window was, by its app (or "browser"), the oldest forgotten past the limit. */
export function rememberWindowRect(key: string, rect: WindowRect) {
  const current = prefs.windowRects[key];
  if (
    current?.left === rect.left &&
    current.top === rect.top &&
    current.width === rect.width &&
    current.height === rect.height
  ) {
    return;
  }
  const entries = Object.entries(prefs.windowRects).filter(([candidate]) => candidate !== key);
  const kept = entries.slice(Math.max(0, entries.length - (MAX_REMEMBERED_WINDOWS - 1)));
  updateDesktopPrefs({
    windowRects: Object.fromEntries([
      ...kept,
      [
        key,
        {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      ],
    ]),
  });
}
