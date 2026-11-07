/**
 * Shared-computer idle handling, as pure functions so it can be tested
 * without timers.
 *
 * The server ends a shared-computer session after 30 minutes without
 * activity, but it only hears about activity when the page reports it (at
 * most once a minute) and records it at most once a minute. The page
 * therefore signs out 2 minutes early, so it never shows account data for a
 * session the server has already ended.
 */

export const ACTIVITY_REPORT_INTERVAL_MS = 60_000;
export const STATUS_CHECK_INTERVAL_MS = 30_000;
export const ROTATE_INTERVAL_MS = 15 * 60_000;
const SAFETY_MARGIN_MS = 2 * 60_000;
const WARNING_MS = 2 * 60_000;

export interface IdleSettings {
  /** When the page signs out, measured from the last activity. */
  signOutAfterMs: number;
  /** How long before that the warning appears. */
  warnBeforeMs: number;
}

export function idleSettings(serverIdleMinutes: number): IdleSettings {
  const signOutAfterMs = Math.max(serverIdleMinutes * 60_000 - SAFETY_MARGIN_MS, 60_000);
  return { signOutAfterMs, warnBeforeMs: Math.min(WARNING_MS, signOutAfterMs / 2) };
}

export type IdleState =
  { phase: "active" } | { phase: "warning"; remainingMs: number } | { phase: "expired" };

export function idleState(now: number, lastActivity: number, settings: IdleSettings): IdleState {
  const idle = now - lastActivity;
  if (idle >= settings.signOutAfterMs) return { phase: "expired" };
  if (idle >= settings.signOutAfterMs - settings.warnBeforeMs) {
    return { phase: "warning", remainingMs: settings.signOutAfterMs - idle };
  }
  return { phase: "active" };
}

/** Which request, if any, the page should send on this tick. */
export function nextServerCall(input: {
  now: number;
  lastActivity: number;
  lastReport: number;
  lastRotation: number;
  lastCheck: number;
}): "rotate" | "report" | "check" | "none" {
  const { now, lastActivity, lastReport, lastRotation, lastCheck } = input;
  const activeSinceReport = lastActivity > lastReport;
  if (activeSinceReport && now - lastRotation >= ROTATE_INTERVAL_MS) return "rotate";
  if (activeSinceReport && now - lastReport >= ACTIVITY_REPORT_INTERVAL_MS) return "report";
  if (now - Math.max(lastCheck, lastReport) >= STATUS_CHECK_INTERVAL_MS) return "check";
  return "none";
}

/** 107_000 → "1:47" */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}
