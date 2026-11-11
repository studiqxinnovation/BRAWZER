"use client";

import { cn } from "@brawzer/ui/lib/cn";
import {
  Calculator,
  ClipboardList,
  type LucideIcon,
  Quote,
  ReceiptText,
  Settings,
  ShieldCheck,
  Timer,
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
  "settings",
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
export const defaultPinnedApps: readonly AppId[] = ["settings", "calculator"];

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
