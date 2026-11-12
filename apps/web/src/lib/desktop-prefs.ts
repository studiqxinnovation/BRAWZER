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
export interface DesktopPrefs {
  pinned: readonly AppId[];
  webApps: readonly string[];
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
}

const prefsSchema = z.object({
  pinned: z.array(z.string()).optional(),
  webApps: z.array(z.string()).optional(),
  style: z.enum(["mac", "windows"]).nullable().optional(),
  dnd: z.boolean().optional(),
  sounds: z.boolean().optional(),
  volume: z.number().min(0).max(100).optional(),
  brightness: z.number().min(15).max(100).optional(),
  defaultEngine: browserEngineSchema.nullable().optional(),
  driveSetUp: z.boolean().optional(),
});

const DEFAULT: DesktopPrefs = {
  pinned: defaultPinnedApps,
  webApps: [],
  style: null,
  dnd: false,
  sounds: true,
  volume: 60,
  brightness: 100,
  defaultEngine: null,
  driveSetUp: false,
};

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
      webApps: (data.webApps ?? []).filter((id) => webAppById(id) !== undefined),
      style: data.style ?? null,
      dnd: data.dnd ?? DEFAULT.dnd,
      sounds: data.sounds ?? DEFAULT.sounds,
      volume: data.volume ?? DEFAULT.volume,
      brightness: data.brightness ?? DEFAULT.brightness,
      defaultEngine: data.defaultEngine ?? null,
      driveSetUp: data.driveSetUp ?? false,
    };
  }
  loaded = "yes";
  changed();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function updateDesktopPrefs(patch: Partial<DesktopPrefs>) {
  prefs = { ...prefs, ...patch };
  changed();
  // Sliders change many times a second: the record is written once they settle.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Until the account's own choices arrive, a change applies here only (it mustn't overwrite them).
    if (loaded === "yes") void putAppRecord("desktop", "state", prefs);
  }, 400);
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
