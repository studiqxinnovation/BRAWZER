import type { Metadata } from "next";
import { PlannedModulePage } from "@/components/app-shell/planned-module-page";
import { plannedModules } from "@/content/app";

export const metadata: Metadata = { title: "Profiles", robots: { index: false, follow: false } };

export default function ProfilesPage() {
  return <PlannedModulePage plan={plannedModules.profiles} />;
}
