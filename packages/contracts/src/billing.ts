import { z } from "zod";
import { BROWSER_LIMITS } from "./browser.ts";
import { DRIVE_LIMITS } from "./drive.ts";
import { MAX_PROFILES } from "./profiles.ts";
import { MAX_PROXIES } from "./proxies.ts";

/**
 * Plans (Phase 6, ADR 0015). What a plan allows is a set of limits; the
 * free plan is built in with today's limits, paid plans come from the
 * installation's configuration and their prices from Stripe. Nothing here
 * names a price.
 */
export const planLimitsSchema = z.object({
  profiles: z.number().int().positive(),
  proxies: z.number().int().positive(),
  driveBytes: z.number().int().positive(),
  driveFiles: z.number().int().positive(),
  driveFolders: z.number().int().positive(),
  /** Null: no monthly cap. */
  browsingMinutesPerMonth: z.number().int().positive().nullable(),
  liveSessions: z.number().int().positive(),
});

export const planCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/, "A plan code is lower-case letters, digits, - and _.");

export const FREE_PLAN_CODE = "free";

/** Today's limits, as the free plan. */
export const FREE_PLAN_LIMITS = {
  profiles: MAX_PROFILES,
  proxies: MAX_PROXIES,
  driveBytes: DRIVE_LIMITS.maxAccountBytes,
  driveFiles: DRIVE_LIMITS.maxFiles,
  driveFolders: DRIVE_LIMITS.maxFolders,
  browsingMinutesPerMonth: null,
  liveSessions: BROWSER_LIMITS.liveSessions,
} as const satisfies z.infer<typeof planLimitsSchema>;

/** A price as Stripe states it; shown only when it comes from there. */
export const planPriceSchema = z.object({
  /** Minor units (cents). */
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  interval: z.enum(["month", "year"]),
});

export const planSchema = z.object({
  code: planCodeSchema,
  name: z.string().min(1).max(40),
  limits: planLimitsSchema,
  /** Null for the free plan, and for paid plans until Stripe is configured. */
  price: planPriceSchema.nullable(),
});

/** Where the account's plan comes from. */
export const planSources = ["free", "stripe", "admin"] as const;
export const planSourceSchema = z.enum(planSources);

export const subscriptionStatuses = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export const subscriptionStatusSchema = z.enum(subscriptionStatuses);

export const subscriptionSchema = z.object({
  status: subscriptionStatusSchema,
  planCode: planCodeSchema,
  /** When the current paid period ends (and renews, unless cancelled). */
  currentPeriodEnd: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});

export const usageSchema = z.object({
  profiles: z.number().int().nonnegative(),
  proxies: z.number().int().nonnegative(),
  driveBytes: z.number().int().nonnegative(),
  driveFiles: z.number().int().nonnegative(),
  /** Cloud browser minutes used in the current calendar month (UTC). */
  browsingMinutesThisMonth: z.number().int().nonnegative(),
});

export const billingOverviewSchema = z.object({
  plan: planSchema,
  source: planSourceSchema,
  usage: usageSchema,
  subscription: subscriptionSchema.nullable(),
  /** The plans a person may move to, prices included when Stripe is configured. */
  plans: z.array(planSchema),
  /** Whether checkout and the billing portal work on this installation. */
  billing: z.enum(["available", "unavailable"]),
});

export const publicPlansSchema = z.object({ plans: z.array(planSchema) });

export const checkoutRequestSchema = z.object({
  planCode: planCodeSchema,
});

export const checkoutResponseSchema = z.object({
  /** Where to send the person: Stripe's hosted checkout or billing portal. */
  url: z.url({ protocol: /^https?$/ }),
});

// ── Administration ───────────────────────────────────────────────────────

export const accountRoles = ["user", "admin"] as const;
export const accountRoleSchema = z.enum(accountRoles);

export const adminAccountSummarySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  role: accountRoleSchema,
  planCode: planCodeSchema,
  source: planSourceSchema,
  createdAt: z.iso.datetime(),
});

export const adminAccountSchema = adminAccountSummarySchema.extend({
  usage: usageSchema,
  limits: planLimitsSchema,
  subscription: subscriptionSchema.nullable(),
  /** Signed-in devices right now. */
  activeSessions: z.number().int().nonnegative(),
  /** Why an administrator set the plan, if one did. */
  planNote: z.string().nullable(),
});

/** What the re-wrap job did (Phase 8, idea 13): rows per table, and rows it had to leave. */
export const rewrapResultSchema = z.object({
  rewrapped: z.record(z.string(), z.number().int().nonnegative()),
  failed: z.number().int().nonnegative(),
  /** False when another instance was already running it; nothing was done here. */
  ran: z.boolean(),
});
export type RewrapResult = z.infer<typeof rewrapResultSchema>;

export const adminAccountListSchema = z.object({
  accounts: z.array(adminAccountSummarySchema),
  nextCursor: z.uuid().nullable(),
});

export const adminAccountQuerySchema = z.object({
  /** Part of an email address. */
  q: z.string().trim().max(100).optional(),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminSetPlanRequestSchema = z.object({
  planCode: planCodeSchema,
  /** Kept with the account and in the security history. */
  reason: z.string().trim().min(3, "Say why, in a few words.").max(200),
});

export type PlanLimits = z.infer<typeof planLimitsSchema>;
export type Plan = z.infer<typeof planSchema>;
export type PlanPrice = z.infer<typeof planPriceSchema>;
export type PlanSource = z.infer<typeof planSourceSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type BillingOverview = z.infer<typeof billingOverviewSchema>;
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export type AccountRole = z.infer<typeof accountRoleSchema>;
export type AdminAccountSummary = z.infer<typeof adminAccountSummarySchema>;
export type AdminAccount = z.infer<typeof adminAccountSchema>;
export type AdminAccountList = z.infer<typeof adminAccountListSchema>;
export type AdminSetPlanRequest = z.infer<typeof adminSetPlanRequestSchema>;
