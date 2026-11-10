"use client";

import { useSyncExternalStore } from "react";

const never = () => () => undefined;

/** Sessions started since midnight on the person's own clock. */
export function SessionsToday({ starts }: { starts: readonly string[] }) {
  const count = useSyncExternalStore(
    never,
    () => {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      return starts.filter((start) => new Date(start) >= midnight).length;
    },
    () => null,
  );
  return <>{count === null ? "–" : String(count)}</>;
}
