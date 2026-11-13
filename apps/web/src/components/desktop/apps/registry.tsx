"use client";

import { cn } from "@brawzer/ui/lib/cn";
import dynamic from "next/dynamic";
import { type GlyphName, glyphs, type TileColour, tileColours } from "../glyphs";
import { appIcons } from "./app-icons";
import type { ComponentType } from "react";

/**
 * The desktop's apps, as the prototype has them. Each is real: it keeps what
 * it makes in Drive or in the account's encrypted app records, never on this
 * computer. An app is listed here only once it works.
 */
export const appIds = [
  "files",
  "trash",
  "settings",
  "photos",
  "pdf-viewer",
  "music",
  "notepad",
  "writer",
  "calc",
  "slides",
  "code",
  "templates",
  "app-store",
  "web-store",
  "passwords",
  "usage",
  "screenshot",
  "send-to-phone",
  "terminal",
  "mail",
  "assistant",
  "study-notes",
  "calculator",
  "assignments",
  "citations",
  "focus-timer",
  "exam-mode",
  "money",
  "invoices",
] as const;
export type AppId = (typeof appIds)[number];

export type AppCategory = "Brawzer" | "Brawzer Suite" | "Productivity" | "Education" | "Business";

export interface AppDefinition {
  id: AppId;
  name: string;
  /** One line, for the App Store and Launchpad's search. */
  description: string;
  category: AppCategory;
  /** The prototype's symbol and tile colour. */
  glyph: GlyphName;
  colour: TileColour;
  /** The window's size when it opens. */
  width: number;
  height: number;
  /** One window at most: opening it again brings that window forward. */
  single?: boolean;
  component: ComponentType;
}

const loading = () => <div className="ap-loading" aria-busy="true" />;

export const apps: Readonly<Record<AppId, AppDefinition>> = {
  files: {
    id: "files",
    name: "Files",
    description: "Your Drive as folders and files, each opening in its app.",
    category: "Brawzer",
    glyph: "folder",
    colour: "blue",
    width: 880,
    height: 560,
    component: dynamic(() => import("./files"), { loading }),
  },
  trash: {
    id: "trash",
    name: "Trash",
    description: "Deleted Drive files, kept 30 days to put back.",
    category: "Brawzer",
    glyph: "trash",
    colour: "gray",
    width: 780,
    height: 500,
    single: true,
    component: dynamic(() => import("./trash"), { loading }),
  },
  photos: {
    id: "photos",
    name: "Photos",
    description: "Every picture in your Drive, and one at a time, larger.",
    category: "Productivity",
    glyph: "image",
    colour: "pink",
    width: 920,
    height: 620,
    single: true,
    component: dynamic(() => import("./photos"), { loading }),
  },
  "pdf-viewer": {
    id: "pdf-viewer",
    name: "PDF Viewer",
    description: "The PDFs in your Drive.",
    category: "Productivity",
    glyph: "file",
    colour: "red",
    width: 920,
    height: 680,
    component: dynamic(() => import("./pdf-viewer"), { loading }),
  },
  music: {
    id: "music",
    name: "Music",
    description: "Plays the audio files in your Drive.",
    category: "Productivity",
    glyph: "music",
    colour: "pink",
    width: 620,
    height: 520,
    single: true,
    component: dynamic(() => import("./music"), { loading }),
  },
  notepad: {
    id: "notepad",
    name: "Notepad",
    description: "Plain text, saved to Drive.",
    category: "Productivity",
    glyph: "note",
    colour: "yellow",
    width: 680,
    height: 480,
    component: dynamic(() => import("./notepad"), { loading }),
  },
  writer: {
    id: "writer",
    name: "Writer",
    description: "Documents with headings, lists and emphasis, saved to Drive.",
    category: "Brawzer Suite",
    glyph: "doc",
    colour: "blue",
    width: 860,
    height: 640,
    component: dynamic(() => import("./writer"), { loading }),
  },
  calc: {
    id: "calc",
    name: "Calc",
    description: "Sheets with formulas, saved to Drive as CSV.",
    category: "Brawzer Suite",
    glyph: "table",
    colour: "green",
    width: 920,
    height: 580,
    component: dynamic(() => import("./calc"), { loading }),
  },
  slides: {
    id: "slides",
    name: "Slides",
    description: "Presentations with themes and pictures from Drive, shown full screen.",
    category: "Brawzer Suite",
    glyph: "play",
    colour: "orange",
    width: 980,
    height: 640,
    component: dynamic(() => import("./slides"), { loading }),
  },
  code: {
    id: "code",
    name: "Code",
    description: "An editor for source files, with line numbers, saved to Drive.",
    category: "Productivity",
    glyph: "code",
    colour: "indigo",
    width: 960,
    height: 620,
    component: dynamic(() => import("./code"), { loading }),
  },
  "app-store": {
    id: "app-store",
    name: "App Store",
    description: "Apps for the Dock, and web apps that open in a cloud browser.",
    category: "Brawzer",
    glyph: "bag",
    colour: "blue",
    width: 880,
    height: 600,
    single: true,
    component: dynamic(() => import("./app-store"), { loading }),
  },
  "web-store": {
    id: "web-store",
    name: "Web Store",
    description: "Reviewed extensions for each profile’s browser.",
    category: "Brawzer",
    glyph: "bag",
    colour: "teal",
    width: 900,
    height: 620,
    single: true,
    component: dynamic(() => import("./web-store"), { loading }),
  },
  passwords: {
    id: "passwords",
    name: "Passwords",
    description: "Where your saved passwords are: your browsers’ accounts and password managers.",
    category: "Brawzer",
    glyph: "key",
    colour: "blue",
    width: 780,
    height: 560,
    single: true,
    component: dynamic(() => import("./passwords"), { loading }),
  },
  usage: {
    id: "usage",
    name: "Usage",
    description: "This month’s browsing by browser, and your plan’s limits.",
    category: "Brawzer",
    glyph: "chart",
    colour: "teal",
    width: 640,
    height: 600,
    single: true,
    component: dynamic(() => import("./usage"), { loading }),
  },
  screenshot: {
    id: "screenshot",
    name: "Screenshot",
    description: "Saves a cloud browser’s page to Drive as a picture.",
    category: "Brawzer",
    glyph: "camera",
    colour: "purple",
    width: 560,
    height: 460,
    single: true,
    component: dynamic(() => import("./screenshot"), { loading }),
  },
  "send-to-phone": {
    id: "send-to-phone",
    name: "Send to Phone",
    description: "A QR code that opens a Drive file on your phone, after signing in.",
    category: "Brawzer",
    glyph: "phone",
    colour: "green",
    width: 560,
    height: 600,
    single: true,
    component: dynamic(() => import("./send-to-phone"), { loading }),
  },
  mail: {
    id: "mail",
    name: "Mail",
    description: "Your email (Gmail, Outlook and others) in a cloud browser window.",
    category: "Productivity",
    glyph: "mail",
    colour: "blue",
    width: 640,
    height: 520,
    single: true,
    component: dynamic(() => import("./mail"), { loading }),
  },
  assistant: {
    id: "assistant",
    name: "Assistant",
    description: "Ask Claude anything: explain, write, plan. Brawzer keeps none of it.",
    category: "Productivity",
    glyph: "sparkle",
    colour: "purple",
    width: 620,
    height: 660,
    single: true,
    component: dynamic(() => import("./assistant"), { loading }),
  },
  "study-notes": {
    id: "study-notes",
    name: "Study Notes",
    description: "A summary, flashcards or a practice quiz from your notes.",
    category: "Education",
    glyph: "sparkle",
    colour: "purple",
    width: 940,
    height: 660,
    single: true,
    component: dynamic(() => import("./study-notes"), { loading }),
  },
  terminal: {
    id: "terminal",
    name: "Terminal",
    description: "Brawzer’s own commands for Drive, the apps and the cloud browsers.",
    category: "Productivity",
    glyph: "terminal",
    colour: "black",
    width: 760,
    height: 460,
    component: dynamic(() => import("./terminal"), { loading }),
  },
  templates: {
    id: "templates",
    name: "Templates",
    description: "Business plans, pitches, budgets and study plans to start from.",
    category: "Business",
    glyph: "grid",
    colour: "orange",
    width: 820,
    height: 600,
    single: true,
    component: dynamic(() => import("./templates-app"), { loading }),
  },
  calculator: {
    id: "calculator",
    name: "Calculator",
    description: "Sums, percentages and memory, typed or clicked.",
    category: "Productivity",
    glyph: "calc",
    colour: "orange",
    width: 320,
    height: 500,
    single: true,
    component: dynamic(() => import("./calculator"), { loading }),
  },
  settings: {
    id: "settings",
    name: "Settings",
    description: "Theme, accent, the desktop's look, and your account.",
    category: "Brawzer",
    glyph: "gear",
    colour: "gray",
    width: 780,
    height: 560,
    single: true,
    component: dynamic(() => import("./settings"), { loading }),
  },
  assignments: {
    id: "assignments",
    name: "Assignments",
    description: "Coursework and due dates, grouped as they come up.",
    category: "Education",
    glyph: "doc",
    colour: "blue",
    width: 720,
    height: 560,
    single: true,
    component: dynamic(() => import("./assignments"), { loading }),
  },
  citations: {
    id: "citations",
    name: "Citations",
    description: "Harvard, APA and MLA references, and the list they go into.",
    category: "Education",
    glyph: "pen",
    colour: "orange",
    width: 900,
    height: 620,
    single: true,
    component: dynamic(() => import("./citations"), { loading }),
  },
  "focus-timer": {
    id: "focus-timer",
    name: "Focus Timer",
    description: "Focus, then a break; your study time logged by subject.",
    category: "Education",
    glyph: "clock",
    colour: "red",
    width: 520,
    height: 660,
    single: true,
    component: dynamic(() => import("./focus-timer"), { loading }),
  },
  "exam-mode": {
    id: "exam-mode",
    name: "Exam Mode",
    description: "For a set time, only the apps and browsers you choose open.",
    category: "Education",
    glyph: "shield",
    colour: "red",
    width: 520,
    height: 620,
    single: true,
    component: dynamic(() => import("./exam-mode"), { loading }),
  },
  money: {
    id: "money",
    name: "Money",
    description: "Income and expenses, each month at a glance.",
    category: "Business",
    glyph: "table",
    colour: "green",
    width: 860,
    height: 640,
    single: true,
    component: dynamic(() => import("./money"), { loading }),
  },
  invoices: {
    id: "invoices",
    name: "Invoices",
    description: "Invoices and quotes, saved to Drive as PDFs.",
    category: "Business",
    glyph: "doc",
    colour: "green",
    width: 960,
    height: 660,
    single: true,
    component: dynamic(() => import("./invoices"), { loading }),
  },
};

export const isAppId = (value: string): value is AppId =>
  (appIds as readonly string[]).includes(value);

/** The apps in the dock (Mac) and on the taskbar (Windows) to begin with. */
/** The Dock's own apps, as the prototype has them; the rest can be added from the App Store. */
export const defaultPinnedApps: readonly AppId[] = [
  "files",
  "music",
  "writer",
  "calc",
  "notepad",
  "assistant",
];

/** Launchpad's and Start's order, as the prototype lists its apps (after the browsers). */
export const launchpadOrder: readonly AppId[] = [
  "files",
  "music",
  "writer",
  "calc",
  "slides",
  "notepad",
  "calculator",
  "send-to-phone",
  "pdf-viewer",
  "photos",
  "screenshot",
  "passwords",
  "mail",
  "code",
  "terminal",
  "assistant",
  "app-store",
  "settings",
  "study-notes",
  "citations",
  "assignments",
  "focus-timer",
  "exam-mode",
  "invoices",
  "money",
  "templates",
  "web-store",
  "usage",
];

/** Always at the Dock's end: Launchpad, then these, then Trash. */
export const dockSystemApps: readonly AppId[] = ["app-store", "settings"];

/**
 * A symbol on a coloured tile, as the prototype draws every app: white
 * line art on an Apple system colour, lighter at the top, with rounded
 * corners and a soft highlight.
 */
export function Tile({
  glyph,
  colour,
  size = 44,
  className,
}: {
  glyph: GlyphName;
  colour: TileColour;
  size?: number;
  className?: string;
}) {
  const hex = tileColours[colour];
  return (
    <span
      aria-hidden="true"
      className={cn("ap-icon", className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(180deg, color-mix(in srgb, ${hex} 75%, #fff), ${hex})`,
      }}
    >
      {/* Static markup from glyphs.ts, never from data. */}
      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: glyphs[glyph] }} />
    </span>
  );
}

/** An app's icon: its own solid symbol on its tile, as Apple draws them. */
export function AppIcon({
  app,
  size = 44,
  className,
}: {
  app: AppId;
  size?: number;
  className?: string;
}) {
  const hex = tileColours[apps[app].colour];
  return (
    <span
      aria-hidden="true"
      className={cn("ap-icon ap-app-icon", className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(180deg, color-mix(in srgb, ${hex} 72%, #fff), ${hex} 55%, color-mix(in srgb, ${hex} 86%, #000))`,
      }}
    >
      {/* Static markup from app-icons.ts, never from data. */}
      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: appIcons[app] }} />
    </span>
  );
}
