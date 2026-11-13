import { z } from "zod";
import { securityEventTypeSchema } from "./security.ts";

/* ── The console's security pages (Phase 11.5) ── */

const customerRef = z.object({
  id: z.uuid(),
  handle: z.string(),
  /** Masked unless the viewer is a founder. */
  email: z.string(),
  planName: z.string(),
});

/* Threats & sign-ins */

export const threatEventSchema = z.object({
  id: z.uuid(),
  type: securityEventTypeSchema,
  at: z.iso.datetime(),
  /** The account it concerns, or null for an unknown address. */
  customer: customerRef.nullable(),
  staff: z.boolean(),
  ipAddress: z.string().nullable(),
  /** Whether the address is blocked right now. */
  blocked: z.boolean(),
  device: z.string().nullable(),
  detail: z.string().nullable(),
});
export type ThreatEvent = z.infer<typeof threatEventSchema>;

export const blockedAddressSchema = z.object({
  id: z.uuid(),
  cidr: z.string(),
  reason: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
});
export type BlockedAddress = z.infer<typeof blockedAddressSchema>;

export const threatsSchema = z.object({
  /** Failed sign-ins in each of the last 24 hours, oldest first. */
  failedPerHour: z.array(z.object({ hour: z.iso.datetime(), count: z.number().int() })),
  failed24h: z.number().int(),
  /** Accounts refused right now for too many failures. */
  lockedNow: z.number().int(),
  blocked: z.array(blockedAddressSchema),
  /** Share of accounts with a passkey or an authenticator, in percent. */
  secondFactorPercent: z.number(),
  staffWithSecondFactor: z.number().int(),
  staffTotal: z.number().int(),
  /** The last 200 events worth a look, newest first. */
  events: z.array(threatEventSchema),
  /** Staff sign-ins over the last 30 days, newest first. */
  staffSignIns: z.array(
    z.object({
      at: z.iso.datetime(),
      email: z.string(),
      role: z.string(),
      ipAddress: z.string().nullable(),
      device: z.string().nullable(),
      ok: z.boolean(),
    }),
  ),
});
export type Threats = z.infer<typeof threatsSchema>;

export const blockAddressRequestSchema = z.object({
  /** An IPv4 or IPv6 address, or a network such as 203.0.113.0/24. */
  cidr: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, {
      error: "Give an address, or a network like 203.0.113.0/24.",
    })
    .max(64),
  reason: z.string().trim().min(4).max(300),
  /** Hours until it lifts itself; empty means until removed. */
  hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .optional(),
});
export type BlockAddressRequest = z.infer<typeof blockAddressRequestSchema>;

/* Abuse reports */

/** Must match `abuse_kind` / `abuse_status` in @brawzer/db. */
export const abuseKinds = ["phishing", "spam", "fraud", "bots", "other"] as const;
export const abuseKindSchema = z.enum(abuseKinds);
export type AbuseKind = z.infer<typeof abuseKindSchema>;
export const abuseKindNames: Readonly<Record<AbuseKind, string>> = {
  phishing: "Phishing",
  spam: "Spam",
  fraud: "Fraud",
  bots: "Bots or scraping",
  other: "Other",
};
export const abuseStatuses = ["open", "warned", "suspended", "dismissed"] as const;
export const abuseStatusSchema = z.enum(abuseStatuses);
export type AbuseStatus = z.infer<typeof abuseStatusSchema>;
export const abuseStatusNames: Readonly<Record<AbuseStatus, string>> = {
  open: "Open",
  warned: "Warned",
  suspended: "Suspended",
  dismissed: "Not abuse",
};

export const abuseReportSchema = z.object({
  id: z.uuid(),
  customer: customerRef,
  kind: abuseKindSchema,
  source: z.string(),
  detail: z.string(),
  status: abuseStatusSchema,
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  decidedBy: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  /** The account is under a legal hold (evidence kept). */
  held: z.boolean(),
});
export type AbuseReport = z.infer<typeof abuseReportSchema>;
export const abuseReportListSchema = z.object({ reports: z.array(abuseReportSchema) });
export type AbuseReportList = z.infer<typeof abuseReportListSchema>;

export const logAbuseRequestSchema = z.object({
  customerId: z.uuid(),
  kind: abuseKindSchema,
  source: z.string().trim().min(2).max(120),
  detail: z.string().trim().min(4).max(2000),
});
export type LogAbuseRequest = z.infer<typeof logAbuseRequestSchema>;

export const abuseDecisionSchema = z.object({
  action: z.enum(["warn", "suspend", "dismiss"]),
  /** Goes into the warning email, or the suspension and hold reasons. */
  note: z.string().trim().min(4).max(600),
});
export type AbuseDecision = z.infer<typeof abuseDecisionSchema>;

/* Legal requests and holds */

/** Must match `legal_request_status` in @brawzer/db. */
export const legalRequestStatuses = ["verifying", "answered", "refused"] as const;
export const legalRequestStatusSchema = z.enum(legalRequestStatuses);
export type LegalRequestStatus = z.infer<typeof legalRequestStatusSchema>;
export const legalRequestKinds = [
  "Request for subscriber information",
  "Data preservation request",
  "Court order",
  "Other",
] as const;

export const legalRequestSchema = z.object({
  id: z.uuid(),
  fromWhom: z.string(),
  kind: z.string(),
  customer: customerRef.nullable(),
  status: legalRequestStatusSchema,
  dueAt: z.iso.datetime().nullable(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type LegalRequest = z.infer<typeof legalRequestSchema>;

export const legalHoldSchema = z.object({
  customer: customerRef,
  why: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type LegalHold = z.infer<typeof legalHoldSchema>;

export const legalSchema = z.object({
  requests: z.array(legalRequestSchema),
  holds: z.array(legalHoldSchema),
});
export type Legal = z.infer<typeof legalSchema>;

export const logLegalRequestSchema = z.object({
  fromWhom: z.string().trim().min(2).max(120),
  kind: z.enum(legalRequestKinds),
  customerId: z.uuid().nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  note: z.string().trim().max(600).optional(),
  /** Put the account under a legal hold at the same time. */
  hold: z.boolean().default(false),
});
export type LogLegalRequest = z.infer<typeof logLegalRequestSchema>;

export const legalDecisionSchema = z.object({
  status: z.enum(["answered", "refused"]),
  note: z.string().trim().max(600).default(""),
});

export const holdRequestSchema = z.object({
  customerId: z.uuid(),
  why: z.string().trim().min(4).max(300),
});
