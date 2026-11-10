"use client";

import { useSyncExternalStore } from "react";

/** Checks the clock each minute: a page left open into the evening says so. */
function subscribe(changed: () => void) {
  const timer = setInterval(changed, 60_000);
  return () => {
    clearInterval(timer);
  };
}

const hourNow = () => new Date().getHours();
/** The server doesn't know the person's clock; the page says hello until the browser does. */
const noHour = () => -1;

function greetingFor(hour: number): { text: string; emoji: string } {
  if (hour < 0) return { text: "Welcome back", emoji: "👋" };
  if (hour >= 5 && hour < 12) return { text: "Good morning", emoji: "☀️" };
  if (hour >= 12 && hour < 18) return { text: "Good afternoon", emoji: "🌤️" };
  return { text: "Good evening", emoji: "🌙" };
}

/** "Good morning ☀️", by the person's own clock. */
export function Greeting() {
  const { text, emoji } = greetingFor(useSyncExternalStore(subscribe, hourNow, noHour));
  return (
    <h1 className="flex items-center gap-2.5 text-title-1 font-bold tracking-[-0.02em] text-ink">
      {text}
      <span aria-hidden="true" className="hm-emoji text-[0.85em]">
        {emoji}
      </span>
    </h1>
  );
}
