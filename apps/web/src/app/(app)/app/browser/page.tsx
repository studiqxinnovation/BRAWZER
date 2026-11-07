import type { Metadata } from "next";
import { PlannedModulePage } from "@/components/app-shell/planned-module-page";
import { plannedModules } from "@/content/app";

export const metadata: Metadata = { title: "Browser", robots: { index: false, follow: false } };

export default function BrowserPage() {
  return <PlannedModulePage plan={plannedModules.browser} />;
}
