import { beforeEach, describe, expect, it } from "vitest";
import {
  clearNotifications,
  dismissNotification,
  notify,
  readNotifications,
  whenLabel,
} from "./notifications";

const base = { source: "Test", glyph: "bell", colour: "blue", tone: "accent", title: "Hello" } as const;

describe("notifications", () => {
  beforeEach(() => {
    clearNotifications();
  });

  it("keeps the newest first and dismisses by id", () => {
    const first = notify({ ...base, title: "One" });
    const second = notify({ ...base, title: "Two" });
    expect(readNotifications().map((entry) => entry.title)).toEqual(["Two", "One"]);
    dismissNotification(first.id);
    expect(readNotifications().map((entry) => entry.id)).toEqual([second.id]);
  });

  it("replaces one with the same id in place of a duplicate", () => {
    notify({ ...base, id: "dl-1", title: "Downloading" });
    notify({ ...base, id: "dl-1", title: "Downloaded" });
    expect(readNotifications()).toHaveLength(1);
    expect(readNotifications()[0]?.title).toBe("Downloaded");
  });

  it("says when, as a person would", () => {
    const now = new Date("2026-11-12T15:00:00").getTime();
    expect(whenLabel(new Date(now - 10_000).toISOString(), now)).toBe("Just now");
    expect(whenLabel(new Date(now - 4 * 60_000).toISOString(), now)).toBe("4 min ago");
    expect(whenLabel(new Date(now - 3 * 3600_000).toISOString(), now)).toMatch(/12:00/);
    expect(whenLabel(new Date(now - 26 * 3600_000).toISOString(), now)).toMatch(/^Yesterday /);
  });
});
