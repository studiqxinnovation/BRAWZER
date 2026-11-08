import type { Plan, PlanLimits, PlanPrice, Usage } from "@brawzer/contracts";
import { formatBytes } from "./drive";

/** A price as Stripe states it, in the person's locale. */
export function formatPrice(price: PlanPrice, locale = "en"): string {
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: price.currency.toUpperCase(),
  }).format(price.amount / 100);
  return `${amount} / ${price.interval}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** Each limit as a row: what is used, what the plan allows. */
export function describeLimits(
  limits: PlanLimits,
  usage?: Usage,
): { label: string; used: string | null; allowed: string; ratio: number | null }[] {
  const ratio = (used: number | undefined, limit: number | null) =>
    used === undefined || limit === null ? null : Math.min(1, used / limit);
  return [
    {
      label: "Profiles",
      used: usage ? String(usage.profiles) : null,
      allowed: String(limits.profiles),
      ratio: ratio(usage?.profiles, limits.profiles),
    },
    {
      label: "Proxies",
      used: usage ? String(usage.proxies) : null,
      allowed: String(limits.proxies),
      ratio: ratio(usage?.proxies, limits.proxies),
    },
    {
      label: "Drive storage",
      used: usage ? formatBytes(usage.driveBytes) : null,
      allowed: formatBytes(limits.driveBytes),
      ratio: ratio(usage?.driveBytes, limits.driveBytes),
    },
    {
      label: "Drive files",
      used: usage ? String(usage.driveFiles) : null,
      allowed: String(limits.driveFiles),
      ratio: ratio(usage?.driveFiles, limits.driveFiles),
    },
    {
      label: "Browsing this month",
      used: usage ? formatMinutes(usage.browsingMinutesThisMonth) : null,
      allowed:
        limits.browsingMinutesPerMonth === null
          ? "No monthly cap"
          : formatMinutes(limits.browsingMinutesPerMonth),
      ratio: ratio(usage?.browsingMinutesThisMonth, limits.browsingMinutesPerMonth),
    },
    {
      label: "Browser sessions at once",
      used: null,
      allowed: String(limits.liveSessions),
      ratio: null,
    },
  ];
}

export function planLabel(plan: Plan): string {
  return plan.price ? `${plan.name} · ${formatPrice(plan.price)}` : plan.name;
}
