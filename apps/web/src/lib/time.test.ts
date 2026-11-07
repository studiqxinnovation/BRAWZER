import { describe, expect, it } from "vitest";
import { timeAgo } from "./time";

const now = Date.parse("2026-11-06T16:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("timeAgo", () => {
  it("reads naturally", () => {
    expect(timeAgo(ago(10_000), now)).toBe("just now");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(timeAgo(ago(60 * 60_000), now)).toBe("1 hour ago");
    expect(timeAgo(ago(26 * 60 * 60_000), now)).toBe("yesterday");
    expect(timeAgo(ago(40 * 24 * 60 * 60_000), now)).toBe("last month");
  });

  it("treats a future time (clock skew) as now", () => {
    expect(timeAgo(ago(-5_000), now)).toBe("just now");
  });
});
