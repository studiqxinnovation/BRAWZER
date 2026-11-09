import {
  FREE_PLAN_CODE,
  FREE_PLAN_LIMITS,
  type Plan,
  type PlanLimits,
  planCodeSchema,
  planLimitsSchema,
} from "@brawzer/contracts";
import { z } from "zod";

/** A paid plan as the installation configures it (`BILLING_PLANS`). */
export const planDefinitionSchema = z.object({
  code: planCodeSchema.refine((code) => code !== FREE_PLAN_CODE, {
    error: "The free plan is built in.",
  }),
  name: z.string().trim().min(1).max(40),
  /** The Stripe Price this plan is sold as; its amount is what people see. */
  stripePriceId: z.string().regex(/^price_[A-Za-z0-9_]+$/, "must be a Stripe price id"),
  limits: planLimitsSchema,
  /** A first subscription starts with this many free days (Stripe's own trial); none when absent. */
  trialDays: z.number().int().min(1).max(90).optional(),
});

export type PlanDefinition = z.infer<typeof planDefinitionSchema>;

export const FREE_PLAN: Plan = {
  code: FREE_PLAN_CODE,
  name: "Free",
  limits: FREE_PLAN_LIMITS,
  price: null,
  trialDays: null,
};

/** Parses `BILLING_PLANS`; an empty value means only the free plan exists. */
export function parsePlanDefinitions(json: string | undefined): PlanDefinition[] {
  if (!json?.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("BILLING_PLANS: must be a JSON list of plans");
  }
  const parsed = z.array(planDefinitionSchema).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `BILLING_PLANS: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid"}`,
    );
  }
  const plans = parsed.data;
  const codes = new Set<string>();
  for (const plan of plans) {
    if (codes.has(plan.code)) throw new Error(`BILLING_PLANS: plan ${plan.code} appears twice`);
    codes.add(plan.code);
  }
  return plans;
}

/** The plans an installation offers, by code: the free plan plus what is configured. */
export class PlanCatalogue {
  private readonly byCode = new Map<string, PlanDefinition>();

  constructor(definitions: readonly PlanDefinition[]) {
    for (const plan of definitions) this.byCode.set(plan.code, plan);
  }

  get paid(): readonly PlanDefinition[] {
    return [...this.byCode.values()];
  }

  definition(code: string): PlanDefinition | null {
    return this.byCode.get(code) ?? null;
  }

  /** A plan's limits; an unknown code (a plan removed from the configuration) falls back to free. */
  limits(code: string): PlanLimits {
    return this.byCode.get(code)?.limits ?? FREE_PLAN_LIMITS;
  }

  has(code: string): boolean {
    return code === FREE_PLAN_CODE || this.byCode.has(code);
  }

  /** The plan with the price Stripe reports for it, or none when Stripe isn't asked. */
  describe(code: string, price: Plan["price"] = null): Plan {
    const definition = this.byCode.get(code);
    if (!definition) return FREE_PLAN;
    return {
      code: definition.code,
      name: definition.name,
      limits: definition.limits,
      price,
      trialDays: definition.trialDays ?? null,
    };
  }

  /** The plan a Stripe price belongs to. */
  byPrice(stripePriceId: string): PlanDefinition | null {
    return this.paid.find((plan) => plan.stripePriceId === stripePriceId) ?? null;
  }
}
