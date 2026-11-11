"use client";

import type { BrowserSession } from "@brawzer/contracts";
import { createContext, useContext } from "react";
import type { AppId } from "./apps/registry";

/** What the rest of the app may ask of the desktop. */
export interface DesktopApi {
  /** Shows a running cloud browser in its own window, or brings its window forward. */
  openSession: (session: BrowserSession) => void;
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
}

export const DesktopContext = createContext<DesktopApi | null>(null);

/** The desktop, when the app is inside one (wide screens, desktop not switched off). */
export function useDesktop(): DesktopApi | null {
  return useContext(DesktopContext);
}

/** Messages a framed browser window sends the desktop around it (same origin only). */
export type DesktopMessage =
  | { type: "brawzer:close-window"; session: string }
  | { type: "brawzer:focus-window"; session: string };

export function postToDesktop(message: DesktopMessage) {
  if (window.parent === window) return;
  window.parent.postMessage(message, window.location.origin);
}
