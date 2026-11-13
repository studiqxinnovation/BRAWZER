"use client";

import { createContext, useContext } from "react";
import type { AppId } from "./registry";

/** What an app may ask of the window it runs in. */
export interface AppWindowApi {
  /** This window's id on the desktop. */
  id: string;
  /** What it was opened with: a Drive file, a folder, a template. */
  params: Readonly<Record<string, string>>;
  /** Names the window after what it shows: "notes.txt". Null goes back to the app's name. */
  setTitle: (title: string | null) => void;
  close: () => void;
  /** Opens another app, such as Writer with a template. */
  openApp: (app: AppId, params?: Record<string, string>) => void;
}

export const AppWindowContext = createContext<AppWindowApi | null>(null);

export function useAppWindow(): AppWindowApi {
  const api = useContext(AppWindowContext);
  if (!api) throw new Error("useAppWindow() needs an app window");
  return api;
}
