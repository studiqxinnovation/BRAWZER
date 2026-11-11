"use client";

import type { BrowserSession } from "@brawzer/contracts";
import { createContext, useContext } from "react";
import { isWebUrl } from "@/lib/web-url";
import type { AppId } from "./apps/registry";

/** What the rest of the app may ask of the desktop. */
export interface DesktopApi {
  /** Shows a running cloud browser in its own window, or brings its window forward; it can open a site or page there. */
  openSession: (session: BrowserSession, open?: BrowserOpen) => void;
  /** Asks a browser's window to save a screenshot of its page in Drive. */
  screenshot: (sessionId: string) => void;
  /** Brings the dashboard (the app's own window) forward. */
  showDashboard: () => void;
  /** Tucks every window away to show the wallpaper. */
  showDesktop: () => void;
  /** Opens the wallpaper picker. */
  chooseWallpaper: () => void;
  /** Opens one of the desktop's apps, or brings its window forward. */
  openApp: (app: AppId, params?: Record<string, string>) => void;
  /** Shows or hides Control Centre. */
  toggleControlCentre: () => void;
  /** Opens Launchpad (Mac style) or Start (Windows style). */
  openLauncher: () => void;
  /** Sends the dashboard back into its Dock icon. */
  hideDashboard: () => void;
  /** Shows the dashboard, or sends it back to the Dock (the Dock's Brawzer icon). */
  toggleDashboard: () => void;
  /** Whether the dashboard is tucked away, read when asked. */
  dashboardHidden: () => boolean;
  /** Asks to wipe this computer (File → Wipe this computer…). */
  wipe: () => void;
  /** Help → Keyboard shortcuts. */
  showShortcuts: () => void;
}

export const DesktopContext = createContext<DesktopApi | null>(null);

/** The desktop, when the app is inside one (wide screens, desktop not switched off). */
export function useDesktop(): DesktopApi | null {
  return useContext(DesktopContext);
}

/** What a browser window opens when asked: a site in a new tab, or the browser's own page. */
export interface BrowserOpen {
  url?: string;
  page?: "passwords" | "account";
}

/** What the desktop asks of a framed browser window. */
export type DesktopRequest =
  { type: "brawzer:open"; open: BrowserOpen } | { type: "brawzer:screenshot" };

export function parseDesktopRequest(data: unknown): DesktopRequest | null {
  if (typeof data !== "object" || data === null || !("type" in data)) return null;
  const message = data as Record<string, unknown>;
  if (message.type === "brawzer:screenshot") return { type: "brawzer:screenshot" };
  if (
    message.type !== "brawzer:open" ||
    typeof message.open !== "object" ||
    message.open === null
  ) {
    return null;
  }
  const open = message.open as Record<string, unknown>;
  const url = typeof open.url === "string" && isWebUrl(open.url) ? open.url : undefined;
  const page = open.page === "passwords" || open.page === "account" ? open.page : undefined;
  return url || page ? { type: "brawzer:open", open: { url, page } } : null;
}

/** Messages a framed browser window sends the desktop around it (same origin only). */
export type DesktopMessage =
  | { type: "brawzer:close-window"; session: string }
  | { type: "brawzer:focus-window"; session: string };

export function postToDesktop(message: DesktopMessage) {
  if (window.parent === window) return;
  window.parent.postMessage(message, window.location.origin);
}
