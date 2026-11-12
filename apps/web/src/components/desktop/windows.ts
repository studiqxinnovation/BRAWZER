import { type BrowserSession, engineDetails } from "@brawzer/contracts";
import { type AppId, apps } from "./apps/registry";
import type { BrowserOpen } from "./desktop-context";
import type { Rect } from "./window-chrome";

/** What a desktop window shows: a cloud browser's stream, or one of the apps. */
export type WindowContent =
  | { kind: "browser"; session: BrowserSession; open?: BrowserOpen }
  | { kind: "app"; app: AppId; params: Readonly<Record<string, string>> };

export interface DesktopWindow {
  /** A browser window's id is its session's; an app window's is "app-<n>". */
  id: string;
  content: WindowContent;
  /** What the app says it shows ("notes.txt"); null: just its name. */
  title: string | null;
  min: boolean;
  /** The rectangle to go back to after a zoom or snap. */
  restore: Rect | null;
  rect: Rect;
  z: number;
  /** Which desktop (space) it is on, from 1. */
  space: number;
}

/** What the window is, for its buttons' names: "Chrome", "Calculator". */
export const windowLabel = (window: DesktopWindow) =>
  window.content.kind === "browser"
    ? engineDetails[window.content.session.engine].short
    : apps[window.content.app].name;

/** What its title bar says. */
export const windowTitle = (window: DesktopWindow) => {
  if (window.content.kind === "browser") {
    return `${engineDetails[window.content.session.engine].name} · in Brawzer’s cloud`;
  }
  const name = apps[window.content.app].name;
  return window.title ? `${window.title} — ${name}` : name;
};

export const isBrowserWindow = (
  window: DesktopWindow,
): window is DesktopWindow & { content: { kind: "browser"; session: BrowserSession } } =>
  window.content.kind === "browser";
