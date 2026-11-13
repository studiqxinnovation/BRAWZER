import type { SecurityEvent } from "@brawzer/contracts";
import { describeEvent } from "@/content/app";
import { timeAgo } from "@/lib/time";
import type { Notice } from "./header-actions";

/** Where a security-history entry comes from, as a notification names it. */
export function noticeSource(
  type: string,
  tone: string,
): Pick<Notice, "source" | "glyph" | "colour" | "tone"> {
  if (type.startsWith("browser."))
    return { source: "Brawzer · Sessions", glyph: "play", colour: "green", tone: "success" };
  if (type.startsWith("drive."))
    return { source: "Brawzer · Drive", glyph: "folder", colour: "blue", tone: "accent" };
  if (type.startsWith("profile"))
    return { source: "Brawzer · Profiles", glyph: "user", colour: "blue", tone: "accent" };
  if (type.startsWith("team."))
    return { source: "Brawzer · Team", glyph: "people", colour: "indigo", tone: "accent" };
  const warning = tone === "warning" || tone === "danger";
  return {
    source: "Shield · Security",
    glyph: warning ? "warn" : "bell",
    colour: warning ? "orange" : "red",
    tone: tone === "success" ? "success" : "danger",
  };
}

/** A line under the notice's title, for the entries that have more to say. */
function noticeLine(type: string): string | undefined {
  switch (type) {
    case "browser.session_started":
      return "A new browser session launched on this device.";
    case "browser.session_ended":
      return "Its cookies, history and files were wiped with it.";
    case "profile.created":
      return "A browsing profile with its own cookies, logins and history.";
    case "sign_in.succeeded":
    case "sign_in.new_device":
      return "If this wasn’t you, review it in Shield.";
    case "session.locked":
      return "Until you unlock it, nothing else answers.";
    default:
      return undefined;
  }
}

/** The bell's notices, from the latest security-history entries. */
export function toNotices(events: readonly SecurityEvent[], now: number): Notice[] {
  return events.map((event) => {
    const { title, tone } = describeEvent(event);
    return {
      id: event.id,
      ...noticeSource(event.type, tone),
      title,
      description: noticeLine(event.type),
      when: timeAgo(event.occurredAt, now),
      at: event.occurredAt,
    };
  });
}

/** The prototype's first notice: shared-computer mode, when this sign-in isn't kept. */
export function sharedComputerNotice(signedInAt: string): Notice {
  return {
    id: "shared-computer",
    source: "Shield · Security",
    glyph: "bell",
    colour: "red",
    tone: "danger",
    title: "You’re in shared-computer mode",
    description: "Session data cleared on close or 30 min idle.",
    when: "Just now",
    at: signedInAt,
  };
}
