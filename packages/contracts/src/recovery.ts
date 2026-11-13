import { z } from "zod";
import { emailSchema } from "./auth.ts";

/* ── Account recovery (Phase 11.2) ── */

/** Must match `recovery_status` in @brawzer/db. */
export const recoveryStatuses = ["verifying", "waiting", "released", "denied"] as const;
export const recoveryStatusSchema = z.enum(recoveryStatuses);
export type RecoveryStatus = z.infer<typeof recoveryStatusSchema>;
export const recoveryStatusNames: Readonly<Record<RecoveryStatus, string>> = {
  verifying: "Waiting for email confirmation",
  waiting: "Waiting period",
  released: "Released",
  denied: "Denied",
};

/** The 48-hour wait between confirming the request and the earliest release. */
export const RECOVERY_WAIT_HOURS = 48;

/**
 * Identity checks staff can record, and what each is worth. The email
 * confirmation and the device match are recorded by Brawzer itself.
 */
export const recoveryChecks = ["invoice", "card", "idDocument"] as const;
export const recoveryCheckSchema = z.enum(recoveryChecks);
export type RecoveryCheckKind = z.infer<typeof recoveryCheckSchema>;
export const recoveryCheckNames: Readonly<Record<RecoveryCheckKind, string>> = {
  invoice: "Named an invoice amount and date",
  card: "Named the last digits of the card on file",
  idDocument: "Showed an identity document",
};
export const recoveryPoints = {
  email: 2,
  device: 1,
  invoice: 2,
  card: 2,
  idDocument: 3,
} as const;
/** Points from which a case is usually safe to release. */
export const RECOVERY_SAFE_POINTS = 5;

/* Public: the person who lost their sign-in methods. */

export const recoveryStartRequestSchema = z.object({ email: emailSchema });
export const recoveryTokenRequestSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: "That link isn’t valid." }),
});
export const recoveryConfirmedSchema = z.object({
  /** When the account can be released at the earliest. */
  releaseAt: z.iso.datetime(),
});
export type RecoveryConfirmed = z.infer<typeof recoveryConfirmedSchema>;

/* The console. */

export const recoveryCheckRecordSchema = z.object({
  ok: z.boolean(),
  by: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
});

export const recoveryCaseSchema = z.object({
  id: z.uuid(),
  status: recoveryStatusSchema,
  customer: z.object({
    id: z.uuid(),
    handle: z.string(),
    /** Masked unless the viewer is a founder. */
    email: z.string(),
    planName: z.string(),
  }),
  openedAt: z.iso.datetime(),
  openedBy: z.string().nullable(),
  emailConfirmedAt: z.iso.datetime().nullable(),
  deviceKnown: z.boolean().nullable(),
  releaseAt: z.iso.datetime().nullable(),
  checks: z.record(recoveryCheckSchema, recoveryCheckRecordSchema.optional()),
  /** Points so far, from what has been confirmed and recorded as passed. */
  points: z.number().int(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  closedBy: z.string().nullable(),
  closedByOwner: z.boolean(),
  closedAt: z.iso.datetime().nullable(),
  closedReason: z.string().nullable(),
  releasedEarly: z.boolean(),
  /** What the sign-in looks like now: the methods a release would remove. */
  signIn: z.object({ passkeys: z.number().int(), authenticator: z.boolean() }),
});
export type RecoveryCase = z.infer<typeof recoveryCaseSchema>;

export const recoveryCaseListSchema = z.object({
  cases: z.array(recoveryCaseSchema),
  /** Across released cases: hours from confirmation to release. */
  averageHoursToRelease: z.number().nullable(),
});
export type RecoveryCaseList = z.infer<typeof recoveryCaseListSchema>;

export const recoveryStartForCustomerSchema = z.object({ customerId: z.uuid() });
export const recoveryCheckRequestSchema = z.object({
  check: recoveryCheckSchema,
  ok: z.boolean(),
  note: z.string().trim().max(300).default(""),
});
export type RecoveryCheckRequest = z.infer<typeof recoveryCheckRequestSchema>;
export const recoveryReleaseRequestSchema = z.object({
  reason: z.string().trim().min(4).max(500),
  /** Before the wait ends: emergencies only, and the reason is kept. */
  early: z.boolean().default(false),
});
export type RecoveryReleaseRequest = z.infer<typeof recoveryReleaseRequestSchema>;
