import { describe, expect, it } from "vitest";
import { FREE_PLAN_LIMITS, planLimitsSchema, planSchema } from "./billing.ts";

describe("plans", () => {
  it("has a free plan with today's limits and no price", () => {
    expect(planLimitsSchema.safeParse(FREE_PLAN_LIMITS).success).toBe(true);
    expect(
      planSchema.safeParse({ code: "free", name: "Free", limits: FREE_PLAN_LIMITS, price: null })
        .success,
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
