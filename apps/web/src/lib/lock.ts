"use client";

import { apiRequest, LOCKED_EVENT } from "./api/client";
import { broadcast, onSessionMessage } from "./session-channel";

/**
 * Whether this sign-in is locked (the desktop's lock screen). The server
 * enforces it: while locked, every request but unlocking and signing out
 * answers 423, and the browsers' streams close. This only mirrors it, so the
 * page knows to show the lock screen and to stop and restart its streams.
 */
let locked = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (locked === next) return;
  locked = next;
  for (const listener of listeners) listener();
}

export const isLocked = () => locked;

let wired = false;
/** Follows the server (any 423 answer) and the other Brawzer tabs and windows. */
function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  // A frame or tab that learns of the lock from the server tells the others.
  window.addEventListener(LOCKED_EVENT, () => {
    if (locked) return;
    set(true);
    broadcast({ type: "locked" });
  });
  onSessionMessage((message) => {
    if (message.type === "locked") set(true);
    else if (message.type === "unlocked") set(false);
  });
}

export function subscribeToLock(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The page loaded on a locked sign-in (the server said so); the other tabs follow. */
export function startLocked() {
  wire();
  set(true);
  broadcast({ type: "locked" });
}

/** Locks this sign-in on the server, then here and in every other tab. */
export async function lockNow(): Promise<boolean> {
  const result = await apiRequest<undefined>("/auth/session/lock", { method: "POST" });
  if (!result.ok) return false;
  set(true);
  broadcast({ type: "locked" });
  return true;
}

/** The owner confirmed it's them, which unlocked the sign-in on the server. */
export function markUnlocked() {
  set(false);
  broadcast({ type: "unlocked" });
}
