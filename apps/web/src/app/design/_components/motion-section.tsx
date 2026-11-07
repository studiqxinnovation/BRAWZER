"use client";

import { Button } from "@brawzer/ui/components/button";
import { cn } from "@brawzer/ui/lib/cn";
import { Play, RotateCcw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Section, SubHeading } from "./section";

const durations = [
  { name: "Instant", ms: 90, use: "Press feedback" },
  { name: "Fast", ms: 150, use: "Hover, menus, tooltips" },
  { name: "Base", ms: 220, use: "Dialogs, toggles, tabs" },
  { name: "Slow", ms: 360, use: "Large movements" },
];

const easings = [
  {
    name: "Standard",
    className: "ease-standard",
    curve: "cubic-bezier(0.2, 0, 0, 1)",
    use: "Most interface changes",
  },
  {
    name: "Emphasized",
    className: "ease-emphasized",
    curve: "cubic-bezier(0.32, 0.72, 0, 1)",
    use: "Panels and dialogs that travel",
  },
  {
    name: "Exit",
    className: "ease-exit",
    curve: "cubic-bezier(0.4, 0, 1, 1)",
    use: "Things leaving the screen",
  },
];

function subscribeToMotionPreference(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function MotionSection() {
  const [moved, setMoved] = useState(false);
  const reduced = usePrefersReducedMotion();

  return (
    <Section
      id="motion"
      index="05"
      title="Motion"
      description="Short and quiet: motion explains where something came from and where it went, never decoration for its own sake. With reduced motion turned on in the operating system, every transition becomes instant."
    >
      <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <SubHeading>Durations</SubHeading>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {durations.map((duration) => (
              <li key={duration.name} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="text-callout font-medium text-ink">{duration.name}</span>
                <span className="text-footnote text-ink-tertiary">{duration.use}</span>
                <code className="text-footnote text-ink-secondary">{duration.ms} ms</code>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SubHeading>Easing</SubHeading>
            <Button size="sm" onClick={() => setMoved((value) => !value)}>
              {moved ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
              {moved ? "Reset" : "Play"}
            </Button>
          </div>
          <ul className="space-y-4 rounded-xl border border-line bg-surface p-5">
            {easings.map((easing) => (
              <li key={easing.name}>
                <div className="mb-2 flex items-baseline justify-between gap-4">
                  <span className="text-callout font-medium text-ink">{easing.name}</span>
                  <code className="truncate text-caption text-ink-tertiary">{easing.curve}</code>
                </div>
                <div className="relative h-8 rounded-full bg-canvas-subtle">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-1 size-6 rounded-full bg-accent shadow-sm transition-[left] duration-(--bw-duration-slow)",
                      easing.className,
                      moved ? "left-[calc(100%-1.75rem)]" : "left-1",
                    )}
                  />
                </div>
                <p className="mt-1.5 text-footnote text-ink-tertiary">{easing.use}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-footnote text-ink-tertiary" aria-live="polite">
            {reduced
              ? "Reduced motion is on for this device, so these move instantly."
              : "Reduced motion is off for this device."}
          </p>
        </div>
      </div>
    </Section>
  );
}
