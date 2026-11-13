"use client";

import { useSyncExternalStore } from "react";

function everySecond(changed: () => void) {
  const timer = setInterval(changed, 1000);
  return () => {
    clearInterval(timer);
  };
}

const two = (value: number) => String(value).padStart(2, "0");

/** "12:04", "01:12:04": time since the last browser was launched, ticking. */
function elapsed(since: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours > 0 ? `${two(hours)}:` : ""}${two(minutes)}:${two(seconds % 60)}`;
}

/** The browser panel's title, as the design has it: when one was last launched. */
export function LaunchedAgo({ since }: { since: string | null }) {
  const text = useSyncExternalStore(
    everySecond,
    () => (since ? elapsed(since) : null),
    () => null,
  );
  if (!since) return <>Recent cloud browser — not launched yet</>;
  return (
    <>
      Recent cloud browser — launched <span className="tabular-nums">{text ?? "…"}</span> ago
    </>
  );
}
