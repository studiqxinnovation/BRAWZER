"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;
const utc = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });
const utcTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/**
 * A date in the viewer's own language and time zone (with the time of day
 * when `time` is set). The server can't know the time zone, so it renders
 * the UTC date (labelled) and the browser replaces it after hydration.
 */
export function LocalDate({ iso, time = false }: { iso: string; time?: boolean }) {
  const local = useSyncExternalStore(
    subscribe,
    () =>
      new Intl.DateTimeFormat(
        undefined,
        time ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "long" },
      ).format(new Date(iso)),
    () => null,
  );
  return (
    <time dateTime={iso}>{local ?? `${(time ? utcTime : utc).format(new Date(iso))} (UTC)`}</time>
  );
}
