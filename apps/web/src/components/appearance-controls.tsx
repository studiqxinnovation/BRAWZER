"use client";

import { SegmentedControl } from "@brawzer/ui/components/segmented-control";
import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  type AccentName,
  DEFAULT_ACCENT,
  readAccent,
  readThemePreference,
  setAccent,
  setThemePreference,
  subscribeToAppearance,
  type ThemePreference,
} from "@/lib/theme";

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeToAppearance, readThemePreference, () => "system");
}

export function useAccent(): AccentName {
  return useSyncExternalStore(subscribeToAppearance, readAccent, () => DEFAULT_ACCENT);
}

export function ThemeControl() {
  const theme = useThemePreference();
  return (
    <SegmentedControl
      aria-label="Theme"
      value={theme}
      onValueChange={setThemePreference}
      options={[
        {
          value: "system",
          label: "System theme",
          icon: <Monitor aria-hidden="true" />,
          iconOnly: true,
        },
        { value: "light", label: "Light theme", icon: <Sun aria-hidden="true" />, iconOnly: true },
        { value: "dark", label: "Dark theme", icon: <Moon aria-hidden="true" />, iconOnly: true },
      ]}
    />
  );
}

/** Light-mode fill of each accent, used for the preview dots. */
const accentSwatches: Record<AccentName, string> = {
  cobalt: "#2b5be0",
  copper: "#b4592b",
  glacier: "#0f7a80",
};

function AccentDot({ accent }: { accent: AccentName }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 rounded-full ring-1 ring-black/10"
      style={{ backgroundColor: accentSwatches[accent] }}
    />
  );
}

export function AccentControl() {
  const accent = useAccent();
  return (
    <SegmentedControl
      aria-label="Accent colour"
      value={accent}
      onValueChange={setAccent}
      options={[
        { value: "cobalt", label: "Cobalt", icon: <AccentDot accent="cobalt" /> },
        { value: "copper", label: "Copper", icon: <AccentDot accent="copper" /> },
        { value: "glacier", label: "Glacier", icon: <AccentDot accent="glacier" /> },
      ]}
    />
  );
}
