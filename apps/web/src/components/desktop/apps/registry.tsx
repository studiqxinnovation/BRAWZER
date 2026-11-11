"use client";

import { cn } from "@brawzer/ui/lib/cn";
import { Calculator, type LucideIcon, Settings } from "lucide-react";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/**
 * The desktop's apps, as the prototype has them. Each is real: it keeps what
 * it makes in Drive or in the account's encrypted app records, never on this
 * computer. An app is listed here only once it works.
 */
export const appIds = ["calculator", "settings"] as const;
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
