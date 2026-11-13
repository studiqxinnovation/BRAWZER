import { FREE_PLAN_LIMITS } from "@brawzer/contracts";
import { describe, expect, it } from "vitest";
import { FREE_PLAN, parsePlanDefinitions, PlanCatalogue } from "./plans.js";

const plus = {
  code: "plus",
  name: "Plus",
  stripePriceId: "price_123",
  limits: { ...FREE_PLAN_LIMITS, profiles: 25, browsingMinutesPerMonth: 6000 },
};

describe("plan definitions", () => {
  it("accepts configured plans and refuses the free code, duplicates and bad price ids", () => {
    expect(parsePlanDefinitions(JSON.stringify([plus]))).toEqual([plus]);
    expect(parsePlanDefinitions(undefined)).toEqual([]);
    expect(() => parsePlanDefinitions(JSON.stringify([{ ...plus, code: "free" }]))).toThrow();
    expect(() => parsePlanDefinitions(JSON.stringify([plus, plus]))).toThrow(/twice/);
    expect(() => parsePlanDefinitions(JSON.stringify([{ ...plus, stripePriceId: "x" }]))).toThrow();
  });

  it("falls back to the free plan's limits for unknown codes", () => {
    const catalogue = new PlanCatalogue([plus]);
    expect(catalogue.limits("plus").profiles).toBe(25);
    expect(catalogue.limits("gone")).toEqual(FREE_PLAN_LIMITS);
    expect(catalogue.describe("gone")).toEqual(FREE_PLAN);
    expect(
      catalogue.describe("plus", { amount: 900, currency: "eur", interval: "month" }),
    ).toMatchObject({ code: "plus", price: { amount: 900 } });
    expect(catalogue.byPrice("price_123")?.code).toBe("plus");
    expect(catalogue.has("free")).toBe(true);
  });
});
