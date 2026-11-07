import type { Metadata } from "next";
import { PlannedModulePage } from "@/components/app-shell/planned-module-page";
import { plannedModules } from "@/content/app";

export const metadata: Metadata = { title: "Proxy", robots: { index: false, follow: false } };

export default function ProxyPage() {
  return <PlannedModulePage plan={plannedModules.proxy} />;
}
