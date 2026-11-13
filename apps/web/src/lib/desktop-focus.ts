"use client";

/**
 * The name of the app in front, for the menu bar (as a Mac shows it):
 * "Brawzer" for the dashboard or the bare desktop.
 */
let name = "Brawzer";
const listeners = new Set<() => void>();

export const readFocusedName = () => name;

export function setFocusedName(next: string) {
  if (next === name) return;
  name = next;
  for (const listener of listeners) listener();
}

export function subscribeToFocusedName(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the page in the dashboard window is a "not found": the window's
 * title says so then, instead of naming the page the address looked like.
 */
let missing = false;
const missingListeners = new Set<() => void>();

export const readPageMissing = () => missing;

export function setPageMissing(next: boolean) {
  if (next === missing) return;
  missing = next;
  for (const listener of missingListeners) listener();
}

export function subscribeToPageMissing(listener: () => void): () => void {
  missingListeners.add(listener);
  return () => {
    missingListeners.delete(listener);
  };
}
