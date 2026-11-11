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
