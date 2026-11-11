import type { SecurityEvent } from "@brawzer/contracts";
import { describeEvent } from "@/content/app";
import { timeAgo } from "@/lib/time";
import type { Notice } from "./header-actions";

/** Where a security-history entry comes from, as a notification names it. */
export function noticeSource(
  type: string,
  tone: string,
): Pick<Notice, "source" | "emoji" | "tone"> {
  if (type.startsWith("browser."))
    return { source: "Brawzer · Sessions", emoji: "▶️", tone: "success" };
  if (type.startsWith("drive.")) return { source: "Brawzer · Drive", emoji: "📁", tone: "accent" };
  if (type.startsWith("profile"))
    return { source: "Brawzer · Profiles", emoji: "👤", tone: "accent" };
  if (type.startsWith("team.")) return { source: "Brawzer · Team", emoji: "👥", tone: "accent" };
  return {
    source: "Shield · Security",
    emoji: tone === "warning" || tone === "danger" ? "⚠️" : "🔔",
    tone: tone === "success" ? "success" : "danger",
  };
}

/** The bell's notices, from the latest security-history entries. */
export function toNotices(events: readonly SecurityEvent[], now: number): Notice[] {
  return events.map((event) => {
    const { title, tone } = describeEvent(event);
    return {
      id: event.id,
      ...noticeSource(event.type, tone),
      title,
      when: timeAgo(event.occurredAt, now),
      at: event.occurredAt,
    };
  });
}
