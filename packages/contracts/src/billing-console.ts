import { z } from "zod";
import type { StaffRole } from "./staff.ts";

/* ── The console's money pages (Phase 11.3) ── */

const money = z.object({ amount: z.number().int(), currency: z.string() });
export type Money = z.infer<typeof money>;

const customerRef = z.object({
  id: z.uuid(),
  handle: z.string(),
  /** Masked unless the viewer is a founder. */
  email: z.string(),
  planName: z.string(),
});

/* Subscriptions: Brawzer's own records of what Stripe told it. */

export const staffSubscriptionSchema = z.object({
  id: z.uuid(),
  customer: customerRef,
  planCode: z.string(),
  planName: z.string(),
  /** Stripe's status word: active, trialing, past_due, canceled, … */
  status: z.string(),
  currentPeriodEnd: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  createdAt: z.iso.datetime(),
  /** Monthly revenue from it, from the plan's price; null when the plan has no price here. */
  mrr: money.nullable(),
});
export type StaffSubscription = z.infer<typeof staffSubscriptionSchema>;

export const subscriptionViews = ["all", "past_due", "trialing", "cancelling"] as const;
export const subscriptionViewSchema = z.enum(subscriptionViews);
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;

export const subscriptionListSchema = z.object({
  stripeConfigured: z.boolean(),
  subscriptions: z.array(staffSubscriptionSchema),
  counts: z.object({
    all: z.number().int(),
    past_due: z.number().int(),
    trialing: z.number().int(),
    cancelling: z.number().int(),
  }),
  /** Monthly revenue on subscriptions whose payment is failing. */
  atRisk: money,
  /** Accounts on a paid plan set by hand, which Stripe doesn't bill. */
  setByHand: z.number().int(),
});
export type SubscriptionList = z.infer<typeof subscriptionListSchema>;

/* Invoices and refunds: Stripe's records, read live. */

export const staffInvoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  customer: customerRef.nullable(),
  stripeCustomerId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  status: z.string(),
  total: money,
  amountPaid: z.number().int(),
  amountRefunded: z.number().int(),
  /** Stripe's hosted page and PDF, for the customer's own copy. */
  hostedUrl: z.string().nullable(),
  pdfUrl: z.string().nullable(),
  /** What a refund is made against. */
  paymentIntentId: z.string().nullable(),
});
export type StaffInvoice = z.infer<typeof staffInvoiceSchema>;

export const invoiceQuerySchema = z.object({
  /** One account's invoices only. */
  customer: z.uuid().optional(),
  /** Stripe's cursor: the last invoice id of the previous page. */
  after: z.string().max(80).optional(),
});

export const invoiceListSchema = z.object({
  stripeConfigured: z.boolean(),
  invoices: z.array(staffInvoiceSchema),
  hasMore: z.boolean(),
});
export type InvoiceList = z.infer<typeof invoiceListSchema>;

/**
 * How much each role may refund without a founder's approval, in the price's
 * minor units. Null means no limit.
 */
export const refundLimitsMinor: Readonly<Record<StaffRole, number | null>> = {
  admin: null,
  billing: 50_000,
  care: 5_000,
  sales: 0,
  technical: 0,
  security: 0,
};

export const refundRequestSchema = z.object({
  /** In the invoice's minor units; at most what is still refundable. */
  amount: z.number().int().positive(),
  reason: z.string().trim().min(4).max(300),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;

export const refundResultSchema = z.object({
  /** Done now, or waiting for a founder. */
  outcome: z.enum(["refunded", "awaiting_approval"]),
  approvalId: z.uuid().nullable(),
});
export type RefundResult = z.infer<typeof refundResultSchema>;

/* Coupons: Stripe promotion codes. */

export const staffCouponSchema = z.object({
  /** The promotion code's id. */
  id: z.string(),
  code: z.string(),
  active: z.boolean(),
  /** What it gives, in words, from the coupon. */
  gives: z.string(),
  percentOff: z.number().nullable(),
  amountOff: money.nullable(),
  duration: z.string(),
  durationInMonths: z.number().int().nullable(),
  timesRedeemed: z.number().int(),
  maxRedemptions: z.number().int().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type StaffCoupon = z.infer<typeof staffCouponSchema>;

export const couponListSchema = z.object({
  stripeConfigured: z.boolean(),
  coupons: z.array(staffCouponSchema),
});
export type CouponList = z.infer<typeof couponListSchema>;

/** Discounts above this need a founder's approval unless a founder makes them. */
export const COUPON_APPROVAL_PERCENT = 15;

export const createCouponRequestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,20}$/, { error: "Codes are 3 to 20 letters and digits." }),
    percentOff: z.number().min(1).max(100).optional(),
    amountOff: z.number().int().positive().optional(),
    currency: z.string().length(3).optional(),
    duration: z.enum(["once", "repeating", "forever"]),
    durationInMonths: z.number().int().min(1).max(36).optional(),
    maxRedemptions: z.number().int().positive().optional(),
    expiresAt: z.iso.datetime().optional(),
  })
  .refine((value) => (value.percentOff === undefined) !== (value.amountOff === undefined), {
    error: "Give a percentage or an amount, not both.",
  })
  .refine((value) => value.amountOff === undefined || value.currency !== undefined, {
    error: "An amount needs a currency.",
  })
  .refine((value) => value.duration !== "repeating" || value.durationInMonths !== undefined, {
    error: "Say for how many months.",
  });
export type CreateCouponRequest = z.infer<typeof createCouponRequestSchema>;

export const couponResultSchema = z.object({
  outcome: z.enum(["created", "awaiting_approval"]),
  approvalId: z.uuid().nullable(),
  list: couponListSchema,
});
export type CouponResult = z.infer<typeof couponResultSchema>;

export const couponToggleSchema = z.object({ active: z.boolean() });

/* Finance: monthly revenue movements, from Brawzer's own subscription records. */

export const financeMonthSchema = z.object({
  month: z.string(),
  /** Monthly revenue in force at the start and the end. */
  start: z.number().int(),
  end: z.number().int(),
  newAmount: z.number().int(),
  newCount: z.number().int(),
  upgrades: z.number().int(),
  downgrades: z.number().int(),
  lostAmount: z.number().int(),
  lostCount: z.number().int(),
  /** Plan changes recorded before Brawzer kept the previous plan: counted, not valued. */
  unvaluedChanges: z.number().int(),
});
export const financeSchema = z.object({
  currency: z.string(),
  months: z.array(financeMonthSchema),
  stripeConfigured: z.boolean(),
  /** Paid accounts set by hand: revenue Stripe doesn't bill. */
  setByHand: z.number().int(),
});
export type Finance = z.infer<typeof financeSchema>;

/* Approvals: the "four eyes" rule. */

/** Must match `approval_kind` / `approval_status` in @brawzer/db. */
export const approvalKinds = ["refund", "coupon"] as const;
export const approvalKindSchema = z.enum(approvalKinds);
export type ApprovalKind = z.infer<typeof approvalKindSchema>;
export const approvalStatuses = ["waiting", "approved", "declined"] as const;
export const approvalStatusSchema = z.enum(approvalStatuses);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalSchema = z.object({
  id: z.uuid(),
  kind: approvalKindSchema,
  requestedBy: z.string().nullable(),
  what: z.string(),
  target: z.string(),
  amount: money.nullable(),
  status: approvalStatusSchema,
  createdAt: z.iso.datetime(),
  decidedBy: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  reason: z.string().nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;
export const approvalListSchema = z.object({ approvals: z.array(approvalSchema) });
export type ApprovalList = z.infer<typeof approvalListSchema>;
export const approvalDecisionSchema = z.object({ reason: z.string().trim().max(300).default("") });

/* Accounts likely to upgrade: free accounts by what they do, no invented score. */

export const upgradeSignalSchema = z.object({
  customer: customerRef,
  browsingMinutes30d: z.number().int(),
  driveBytes: z.number().int(),
  driveLimitBytes: z.number().int(),
  liveSessionsNow: z.number().int(),
  lastActiveAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type UpgradeSignal = z.infer<typeof upgradeSignalSchema>;
export const upgradeSignalListSchema = z.object({ accounts: z.array(upgradeSignalSchema) });
export type UpgradeSignalList = z.infer<typeof upgradeSignalListSchema>;
