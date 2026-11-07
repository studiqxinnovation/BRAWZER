"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;
const utc = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

/**
 * A date in the viewer's own language and time zone. The server can't know
 * the time zone, so it renders the UTC date (labelled) and the browser
 * replaces it after hydration.
 */
export function LocalDate({ iso }: { iso: string }) {
  const local = useSyncExternalStore(
    subscribe,
    () => new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(iso)),
    () => null,
  );
  return <time dateTime={iso}>{local ?? `${utc.format(new Date(iso))} (UTC)`}</time>;
}
