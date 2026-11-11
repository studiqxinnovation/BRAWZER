"use client";

import { logout } from "./api/auth";
import type { ApiResult } from "./api/client";

export type SignOutReason = "user" | "idle" | "expired" | "deleted" | "wiped";

const REASONS: readonly unknown[] = [
  "user",
  "idle",
  "expired",
  "deleted",
  "wiped",
] satisfies SignOutReason[];

type SessionMessage =
  | { type: "activity"; at: number }
  | { type: "reported"; at: number }
  | { type: "signed-out"; reason: SignOutReason }
  /** The sign-in was locked or unlocked (the desktop's lock screen); every tab follows. */
  | { type: "locked" }
  | { type: "unlocked" };

let channel: BroadcastChannel | null | undefined;

/** Brawzer tabs in this browser talk to each other, so they sign out together. */
function getChannel(): BroadcastChannel | null {
  channel ??=
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("brawzer-session");
  return channel;
}

function isSessionMessage(value: unknown): value is SessionMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === "activity" || message.type === "reported") {
    return typeof message.at === "number";
  }
  if (message.type === "locked" || message.type === "unlocked") return true;
  return message.type === "signed-out" && REASONS.includes(message.reason);
}

export function broadcast(message: SessionMessage): void {
  getChannel()?.postMessage(message);
}

export function onSessionMessage(listener: (message: SessionMessage) => void): () => void {
  const current = getChannel();
  if (!current) return () => undefined;
  const handler = (event: MessageEvent) => {
    if (isSessionMessage(event.data)) listener(event.data);
  };
  current.addEventListener("message", handler);
  return () => {
    current.removeEventListener("message", handler);
  };
}

export function signInPathFor(reason: SignOutReason, from?: string): string {
  if (reason === "user") return "/sign-in?signed_out=1";
  if (reason === "idle") return "/sign-in?signed_out=idle";
  if (reason === "deleted") return "/sign-in?signed_out=deleted";
  if (reason === "wiped") return "/sign-in?signed_out=wiped";
  const params = new URLSearchParams({ expired: "1", ...(from ? { next: from } : {}) });
  return `/sign-in?${params.toString()}`;
}

/**
 * Leaves the signed-in area in every open tab. A full page load (not client
 * navigation) drops everything the app held in memory, and `replace` keeps
 * the signed-in page out of Back.
 */
export function leaveSignedInArea(reason: SignOutReason): void {
  broadcast({ type: "signed-out", reason });
  window.location.replace(signInPathFor(reason, window.location.pathname));
}

/**
 * Ends the session on the server, then leaves. After an idle timeout or a
 * wipe the page leaves even if the server can't be reached: the screen must
 * clear, and the server ends the session on its own soon after.
 */
export async function signOut(reason: "user" | "idle" | "wiped"): Promise<ApiResult<undefined>> {
  const result = await logout();
  if (result.ok || reason !== "user") leaveSignedInArea(reason);
  return result;
}
