import { describe, expect, it } from "vitest";
import { formatCountdown, idleSettings, idleState, nextServerCall } from "./idle";

const MINUTE = 60_000;

describe("idleSettings", () => {
  it("signs out 2 minutes before the server would, warning 2 minutes ahead", () => {
    expect(idleSettings(30)).toEqual({ signOutAfterMs: 28 * MINUTE, warnBeforeMs: 2 * MINUTE });
  });

  it("stays sensible for very short timeouts", () => {
    expect(idleSettings(1)).toEqual({ signOutAfterMs: MINUTE, warnBeforeMs: MINUTE / 2 });
  });
});

describe("idleState", () => {
  const settings = idleSettings(30);

  it("is active, then warns, then expires", () => {
    expect(idleState(25 * MINUTE, 0, settings)).toEqual({ phase: "active" });
    expect(idleState(26 * MINUTE, 0, settings)).toEqual({
      phase: "warning",
      remainingMs: 2 * MINUTE,
    });
    expect(idleState(27.5 * MINUTE, 0, settings)).toEqual({
      phase: "warning",
      remainingMs: 0.5 * MINUTE,
    });
    expect(idleState(28 * MINUTE, 0, settings)).toEqual({ phase: "expired" });
  });

  it("measures from the latest activity", () => {
    expect(idleState(40 * MINUTE, 20 * MINUTE, settings)).toEqual({ phase: "active" });
  });
});

describe("nextServerCall", () => {
  const base = { now: 0, lastActivity: 0, lastReport: 0, lastRotation: 0, lastCheck: 0 };

  it("reports activity at most once a minute", () => {
    expect(nextServerCall({ ...base, now: 30_000, lastActivity: 20_000 })).toBe("check");
    expect(nextServerCall({ ...base, now: 61_000, lastActivity: 50_000 })).toBe("report");
  });

  it("rotates the token after 15 minutes of activity", () => {
    expect(
      nextServerCall({
        ...base,
        now: 15 * MINUTE,
        lastActivity: 15 * MINUTE - 1,
        lastReport: 14 * MINUTE,
      }),
    ).toBe("rotate");
  });

  it("only checks passively when nobody is using the page", () => {
    expect(nextServerCall({ ...base, now: 10 * MINUTE, lastCheck: 9.5 * MINUTE })).toBe("check");
    expect(nextServerCall({ ...base, now: 10 * MINUTE, lastCheck: 9.9 * MINUTE })).toBe("none");
  });
});

describe("formatCountdown", () => {
  it("shows minutes and seconds", () => {
    expect(formatCountdown(107_000)).toBe("1:47");
    expect(formatCountdown(5_000)).toBe("0:05");
    expect(formatCountdown(-1)).toBe("0:00");
  });
});
