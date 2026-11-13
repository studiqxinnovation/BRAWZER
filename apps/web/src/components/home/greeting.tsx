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

function greetingFor(hour: number): string {
  if (hour < 0) return "Welcome back";
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Good morning", by the person's own clock, as the prototype greets. */
export function Greeting() {
  const text = greetingFor(useSyncExternalStore(subscribe, hourNow, noHour));
  return (
    <h1 className="flex items-center gap-2.5 text-title-1 font-bold tracking-[-0.02em] text-ink">
      {text}
    </h1>
  );
}
