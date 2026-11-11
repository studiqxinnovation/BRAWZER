"use client";

import { z } from "zod";
import { type AppId, defaultPinnedApps, isAppId } from "@/components/desktop/apps/registry";
import { webAppById } from "@/components/desktop/apps/web-apps";
import { fetchAppRecords, putAppRecord } from "./api/app-records";

/**
 * What the dock keeps (Phase 9): the apps pinned to it and the web apps
 * installed from the App Store. Kept with the account, so the dock is the
 * same on any computer, and nothing about it stays on this one.
 */
export interface DesktopPrefs {
  pinned: readonly AppId[];
  webApps: readonly string[];
}

const prefsSchema = z.object({ pinned: z.array(z.string()), webApps: z.array(z.string()) });
const DEFAULT: DesktopPrefs = { pinned: defaultPinnedApps, webApps: [] };

let prefs: DesktopPrefs = DEFAULT;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

export const readDesktopPrefs = () => prefs;
export const defaultDesktopPrefs = () => DEFAULT;

export function subscribeToDesktopPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadDesktopPrefs(): Promise<void> {
  const result = await fetchAppRecords("desktop");
  if (!result.ok) return;
  const record = result.data.records.find((candidate) => candidate.key === "state");
  const parsed = record ? prefsSchema.safeParse(record.data) : null;
  if (!parsed?.success) return;
  prefs = {
    pinned: parsed.data.pinned.filter(isAppId),
    webApps: parsed.data.webApps.filter((id) => webAppById(id) !== undefined),
  };
  changed();
}

function save(next: DesktopPrefs) {
  prefs = next;
  changed();
  void putAppRecord("desktop", "state", { pinned: next.pinned, webApps: next.webApps });
}

export function setPinned(app: AppId, on: boolean) {
  const without = prefs.pinned.filter((candidate) => candidate !== app);
  save({ ...prefs, pinned: on ? [...without, app] : without });
}

export function setWebAppInstalled(id: string, on: boolean) {
  const without = prefs.webApps.filter((candidate) => candidate !== id);
  save({ ...prefs, webApps: on ? [...without, id] : without });
}
