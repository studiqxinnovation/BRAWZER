import { describe, expect, it } from "vitest";
import { FREE_PLAN_LIMITS, planLimitsSchema, planSchema } from "./billing.ts";

describe("plans", () => {
  it("has a free plan with today's limits and no price", () => {
    expect(planLimitsSchema.safeParse(FREE_PLAN_LIMITS).success).toBe(true);
    expect(
      planSchema.safeParse({
        code: "free",
        name: "Free",
        limits: FREE_PLAN_LIMITS,
        price: null,
        trialDays: null,
      }).success,
    ).toBe(true);
    expect(FREE_PLAN_LIMITS.browsingMinutesPerMonth).toBeNull();
  });

  it("refuses a plan without every limit, or with a made-up price shape", () => {
    const { browsingMinutesPerMonth: _omitted, ...incomplete } = FREE_PLAN_LIMITS;
    expect(planLimitsSchema.safeParse(incomplete).success).toBe(false);
    expect(
      planSchema.safeParse({
        code: "Plus!",
        name: "Plus",
        limits: FREE_PLAN_LIMITS,
        price: { amount: 5, currency: "eur", interval: "month" },
      }).success,
    ).toBe(false);
  });
});

describe("usage warnings", () => {
  const limits = {
    profiles: 3,
    proxies: 5,
    driveBytes: 1000,
    driveFiles: 10,
    driveFolders: 10,
    browsingMinutesPerMonth: 600,
    liveSessions: 1,
  };
  const usage = {
    profiles: 3,
    proxies: 5,
    driveBytes: 0,
    driveFiles: 0,
    browsingMinutesThisMonth: 0,
  };

  it("speaks from 80% of a limit, and only of what has one", async () => {
    const { usageWarnings } = await import("./billing.ts");
    expect(usageWarnings(limits, usage)).toEqual([]);
    expect(usageWarnings(limits, { ...usage, browsingMinutesThisMonth: 479 })).toEqual([]);
    expect(usageWarnings(limits, { ...usage, browsingMinutesThisMonth: 480 })).toEqual([
      { kind: "browsing", used: 480, limit: 600, percent: 80 },
    ]);
    expect(
      usageWarnings(
        { ...limits, browsingMinutesPerMonth: null },
        { ...usage, browsingMinutesThisMonth: 9999 },
      ),
    ).toEqual([]);
    expect(usageWarnings(limits, { ...usage, driveBytes: 1200, driveFiles: 9 })).toEqual([
      { kind: "storage", used: 1200, limit: 1000, percent: 120 },
      { kind: "files", used: 9, limit: 10, percent: 90 },
    ]);
  });
});
