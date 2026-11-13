"use client";

import { endBrowserSession, fetchBrowserOverview } from "./api/browser";
import { signOut } from "./session-channel";

/** Ends every cloud browser session the account has; how many ended. */
export async function endEverySession(): Promise<number> {
  const overview = await fetchBrowserOverview();
  if (!overview.ok) return 0;
  const results = await Promise.all(
    overview.data.sessions.map((session) => endBrowserSession(session.id)),
  );
  return results.filter((result) => result.ok || result.status === 404).length;
}

/** Empties this computer's clipboard, where the browser lets a page write to it. */
export async function clearClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText("");
  } catch {
    // Not allowed (no focus, or blocked): there's nothing more a page can do.
  }
}

/**
 * File → Wipe this computer: every browser session ends, the clipboard is
 * emptied, what this tab kept is removed, and the account signs out. The
 * page then reloads, which stops anything still playing.
 */
export async function wipeThisComputer(): Promise<void> {
  await endEverySession();
  await clearClipboard();
  try {
    sessionStorage.clear();
  } catch {
    // Storage blocked: there was nothing kept.
  }
  await signOut("wiped");
}
