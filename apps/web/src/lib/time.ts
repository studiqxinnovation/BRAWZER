const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const steps: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60_000],
  ["month", 30 * 24 * 60 * 60_000],
  ["week", 7 * 24 * 60 * 60_000],
  ["day", 24 * 60 * 60_000],
  ["hour", 60 * 60_000],
  ["minute", 60_000],
];

/**
 * "just now", "5 minutes ago", "yesterday". Computed against a fixed `now`
 * (the time the page was rendered) so server and browser agree.
 */
export function timeAgo(iso: string, now: number): string {
  const elapsed = now - new Date(iso).getTime();
  if (elapsed < 60_000) return "just now";
  for (const [unit, size] of steps) {
    if (elapsed >= size) return relative.format(-Math.floor(elapsed / size), unit);
  }
  return "just now";
}
