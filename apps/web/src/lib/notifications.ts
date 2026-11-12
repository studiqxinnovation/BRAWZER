"use client";

import type { GlyphName, TileColour } from "@/components/desktop/glyphs";

/**
 * What an app tells the person about, as a computer's notifications do: a
 * download finished, a focus ended, a file uploaded. Kept for this tab only
 * (a shared computer keeps nothing), shown once as a banner unless Do Not
 * Disturb is on, and listed in Notification Centre until dismissed.
 */
export interface AppNotification {
  id: string;
  /** Where it comes from: "Bee Browser · Downloads". */
  source: string;
  glyph: GlyphName;
  colour: TileColour;
  tone: "danger" | "success" | "accent";
  title: string;
  description?: string;
  /** When it happened, ISO. */
  at: string;
  /** What choosing it does, such as opening the file. */
  action?: { label: string; run: () => void };
}

export type NotificationInput = Omit<AppNotification, "id" | "at"> & { id?: string; at?: string };

/** A notification as it travels between windows (a framed browser window and the desktop): no function. */
export type PostedNotification = Omit<NotificationInput, "action">;

const MAX_KEPT = 60;
let kept: readonly AppNotification[] = [];
let counter = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Every notification not yet dismissed, newest first. A stable snapshot until something changes. */
export const readNotifications = () => kept;

export function subscribeToNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Adds one, newest first; one with an id already listed replaces it in place. */
export function notify(input: NotificationInput): AppNotification {
  counter += 1;
  const notification: AppNotification = {
    ...input,
    id: input.id ?? `n-${String(Date.now())}-${String(counter)}`,
    at: input.at ?? new Date().toISOString(),
  };
  const others = kept.filter((entry) => entry.id !== notification.id);
  kept = [notification, ...others].slice(0, MAX_KEPT);
  emit();
  return notification;
}

export function dismissNotification(id: string) {
  const next = kept.filter((entry) => entry.id !== id);
  if (next.length === kept.length) return;
  kept = next;
  emit();
}

export function clearNotifications() {
  if (kept.length === 0) return;
  kept = [];
  emit();
}

/** "Just now", "4 min ago", "Yesterday 14:02": when it happened, as a notification says it. */
export function whenLabel(at: string, now = Date.now()): string {
  const then = new Date(at).getTime();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "Just now";
  if (seconds < 3600) return `${String(Math.round(seconds / 60))} min ago`;
  const date = new Date(then);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return time;
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}
