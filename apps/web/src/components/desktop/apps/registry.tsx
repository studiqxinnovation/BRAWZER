"use client";

import { cn } from "@brawzer/ui/lib/cn";
import {
  BarChart3,
  BookOpen,
  Sparkles,
  Calculator,
  Camera,
  KeyRound,
  Puzzle,
  ShoppingBag,
  Smartphone,
  SquareTerminal,
  ClipboardList,
  Code2,
  FileText,
  Folder,
  Image as ImageIcon,
  LayoutTemplate,
  type LucideIcon,
  Music,
  NotebookPen,
  PenLine,
  Quote,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sheet,
  Timer,
  Trash2,
  Wallet,
} from "lucide-react";
import dynamic from "next/dynamic";
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
  "code",
  "templates",
  "app-store",
  "web-store",
  "passwords",
  "usage",
  "screenshot",
  "send-to-phone",
  "terminal",
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

export type AppTone =
  | "blue"
  | "indigo"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "gray"
  | "black";

export type AppCategory = "Brawzer" | "Productivity" | "Education" | "Business";

export interface AppDefinition {
  id: AppId;
  name: string;
  /** One line, for the App Store and Launchpad's search. */
  description: string;
  category: AppCategory;
  icon: LucideIcon;
  tone: AppTone;
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
    icon: Folder,
    tone: "blue",
    width: 880,
    height: 560,
    component: dynamic(() => import("./files"), { loading }),
  },
  trash: {
    id: "trash",
    name: "Trash",
    description: "Deleted Drive files, kept 30 days to put back.",
    category: "Brawzer",
    icon: Trash2,
    tone: "gray",
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
    icon: ImageIcon,
    tone: "pink",
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
    icon: FileText,
    tone: "red",
    width: 920,
    height: 680,
    component: dynamic(() => import("./pdf-viewer"), { loading }),
  },
  music: {
    id: "music",
    name: "Music",
    description: "Plays the audio files in your Drive.",
    category: "Productivity",
    icon: Music,
    tone: "pink",
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
    icon: NotebookPen,
    tone: "yellow",
    width: 680,
    height: 480,
    component: dynamic(() => import("./notepad"), { loading }),
  },
  writer: {
    id: "writer",
    name: "Writer",
    description: "Documents with headings, lists and emphasis, saved to Drive.",
    category: "Productivity",
    icon: PenLine,
    tone: "blue",
    width: 860,
    height: 640,
    component: dynamic(() => import("./writer"), { loading }),
  },
  calc: {
    id: "calc",
    name: "Calc",
    description: "Sheets with formulas, saved to Drive as CSV.",
    category: "Productivity",
    icon: Sheet,
    tone: "green",
    width: 920,
    height: 580,
    component: dynamic(() => import("./calc"), { loading }),
  },
  code: {
    id: "code",
    name: "Code",
    description: "An editor for source files, with line numbers, saved to Drive.",
    category: "Productivity",
    icon: Code2,
    tone: "indigo",
    width: 960,
    height: 620,
    component: dynamic(() => import("./code"), { loading }),
  },
  "app-store": {
    id: "app-store",
    name: "App Store",
    description: "Apps for the Dock, and web apps that open in a cloud browser.",
    category: "Brawzer",
    icon: ShoppingBag,
    tone: "blue",
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
    icon: Puzzle,
    tone: "teal",
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
    icon: KeyRound,
    tone: "indigo",
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
    icon: BarChart3,
    tone: "teal",
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
    icon: Camera,
    tone: "purple",
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
    icon: Smartphone,
    tone: "green",
    width: 560,
    height: 600,
    single: true,
    component: dynamic(() => import("./send-to-phone"), { loading }),
  },
  assistant: {
    id: "assistant",
    name: "Assistant",
    description: "Ask Claude anything: explain, write, plan. Brawzer keeps none of it.",
    category: "Productivity",
    icon: Sparkles,
    tone: "purple",
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
    icon: BookOpen,
    tone: "indigo",
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
    icon: SquareTerminal,
    tone: "black",
    width: 760,
    height: 460,
    component: dynamic(() => import("./terminal"), { loading }),
  },
  templates: {
    id: "templates",
    name: "Templates",
    description: "Business plans, pitches, budgets and study plans to start from.",
    category: "Business",
    icon: LayoutTemplate,
    tone: "orange",
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
    icon: Calculator,
    tone: "orange",
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
    icon: Settings,
    tone: "gray",
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
    icon: ClipboardList,
    tone: "blue",
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
    icon: Quote,
    tone: "orange",
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
    icon: Timer,
    tone: "red",
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
    icon: ShieldCheck,
    tone: "purple",
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
    icon: Wallet,
    tone: "green",
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
    icon: ReceiptText,
    tone: "teal",
    width: 960,
    height: 660,
    single: true,
    component: dynamic(() => import("./invoices"), { loading }),
  },
};

export const isAppId = (value: string): value is AppId =>
  (appIds as readonly string[]).includes(value);

/** The apps in the dock (Mac) and on the taskbar (Windows) to begin with. */
export const defaultPinnedApps: readonly AppId[] = [
  "files",
  "notepad",
  "writer",
  "calc",
  "calculator",
  "app-store",
  "settings",
  "trash",
];

/** An app's icon: its symbol on a coloured tile, as the prototype draws them. */
export function AppIcon({
  app,
  size = 44,
  className,
}: {
  app: AppId;
  size?: number;
  className?: string;
}) {
  const { icon: Icon, tone } = apps[app];
  return (
    <span
      aria-hidden="true"
      className={cn("ap-icon", className)}
      data-tone={tone}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}
    >
      <Icon style={{ width: Math.round(size * 0.52), height: Math.round(size * 0.52) }} />
    </span>
  );
}
