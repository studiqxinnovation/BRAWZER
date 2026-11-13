"use client";

import { z } from "zod";
import { fetchAppRecords, putAppRecord } from "./api/app-records";

/**
 * Screen time per app, as the prototype's Usage shows it: the seconds each
 * app (or browser) spends in front on the desktop, day by day, while the tab
 * is visible and not locked. Kept with the account (the "usage" app record),
 * the last 14 days only.
 */
export type ScreenTime = Record<string, Record<string, number>>;

const schema = z.object({ days: z.record(z.string(), z.record(z.string(), z.number())) });
const KEEP_DAYS = 14;

let days: ScreenTime = {};
let loaded: "no" | "loading" | "yes" = "no";
let dirty = false;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

export const today = (at = new Date()) =>
  `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

export const readScreenTime = () => days;

export function subscribeToScreenTime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadScreenTime(): Promise<void> {
  if (loaded !== "no") return;
  loaded = "loading";
  const result = await fetchAppRecords("usage");
  if (!result.ok) {
    loaded = "no";
    return;
  }
  const record = result.data.records.find((candidate) => candidate.key === "days");
  const parsed = record ? schema.safeParse(record.data) : null;
  // What was counted before the record arrived is added to it.
  const counted = days;
  days = parsed?.success ? parsed.data.days : {};
  for (const [day, apps] of Object.entries(counted)) {
    for (const [app, seconds] of Object.entries(apps)) add(app, seconds, day);
  }
  loaded = "yes";
  changed();
}

/** Counts seconds for an app ("files", "browser:chrome", "brawzer"). */
export function add(app: string, seconds: number, day = today()) {
  const forDay = { ...(days[day] ?? {}) };
  forDay[app] = (forDay[app] ?? 0) + seconds;
  days = { ...days, [day]: forDay };
  dirty = true;
  changed();
}

/** Writes what was counted to the account (at most every minute or so, from the desktop). */
export async function flushScreenTime(): Promise<void> {
  if (!dirty || loaded !== "yes") return;
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
  days = Object.fromEntries(keep.map((day) => [day, days[day] ?? {}]));
  dirty = false;
  const result = await putAppRecord("usage", "days", { days });
  if (!result.ok) dirty = true;
}

/** Usage's Reset: forgets every day counted, here and with the account. */
export async function resetScreenTime(): Promise<void> {
  days = {};
  dirty = true;
  changed();
  await flushScreenTime();
}
