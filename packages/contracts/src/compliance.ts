import { z } from "zod";

/* ── Privacy requests, compliance, the data map, goals and the weekly email (Phase 11.5) ── */

const customerRef = z.object({
  id: z.uuid(),
  handle: z.string(),
  /** Masked unless the viewer is a founder. */
  email: z.string(),
  planName: z.string(),
});

/* Privacy requests */

/** Must match `privacy_kind` / `privacy_status` in @brawzer/db. */
export const privacyKinds = ["copy", "correct", "delete"] as const;
export const privacyKindSchema = z.enum(privacyKinds);
export type PrivacyKind = z.infer<typeof privacyKindSchema>;
export const privacyKindNames: Readonly<Record<PrivacyKind, string>> = {
  copy: "Copy of their data",
  correct: "Correction",
  delete: "Deletion",
};
export const privacyStatuses = ["open", "completed"] as const;
export const privacyStatusSchema = z.enum(privacyStatuses);
export type PrivacyStatus = z.infer<typeof privacyStatusSchema>;
/** The law gives one month; Brawzer counts 30 days from receipt. */
export const PRIVACY_DEADLINE_DAYS = 30;

export const privacyRequestSchema = z.object({
  id: z.uuid(),
  customer: customerRef.nullable(),
  kind: privacyKindSchema,
  receivedAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
  status: privacyStatusSchema,
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  completedBy: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  /** The account is under a legal hold, so a deletion must wait. */
  held: z.boolean(),
});
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>;
export const privacyRequestListSchema = z.object({ requests: z.array(privacyRequestSchema) });
export type PrivacyRequestList = z.infer<typeof privacyRequestListSchema>;

export const logPrivacyRequestSchema = z.object({
  customerId: z.uuid(),
  kind: privacyKindSchema,
  /** When it arrived, if not now. */
  receivedAt: z.iso.datetime().optional(),
  note: z.string().trim().max(600).optional(),
});
export type LogPrivacyRequest = z.infer<typeof logPrivacyRequestSchema>;

export const completePrivacyRequestSchema = z.object({
  note: z.string().trim().min(4).max(600),
});

/* Compliance checklist */

export const complianceItemSchema = z.object({
  id: z.uuid(),
  framework: z.string(),
  item: z.string(),
  done: z.boolean(),
  doneBy: z.string().nullable(),
  doneAt: z.iso.datetime().nullable(),
});
export type ComplianceItem = z.infer<typeof complianceItemSchema>;
export const complianceListSchema = z.object({ items: z.array(complianceItemSchema) });
export type ComplianceList = z.infer<typeof complianceListSchema>;
export const complianceItemRequestSchema = z.object({
  framework: z.string().trim().min(2).max(80),
  item: z.string().trim().min(3).max(200),
});
export const complianceToggleSchema = z.object({ done: z.boolean() });

/* Data map and suppliers: what the installation actually configures. */

export const dataMapSchema = z.object({
  suppliers: z.array(
    z.object({
      name: z.string(),
      purpose: z.string(),
      /** What of customers' data reaches them. */
      data: z.string(),
      /** From configuration, when known. */
      where: z.string().nullable(),
      configured: z.boolean(),
    }),
  ),
  retention: z.array(z.object({ data: z.string(), keptFor: z.string() })),
  /** Where each kind of data lives, from configuration. */
  locations: z.array(z.object({ data: z.string(), where: z.string() })),
});
export type DataMap = z.infer<typeof dataMapSchema>;

/* Goals */

export const goalUnits = ["", "GBP", "%", "min"] as const;
export const goalSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  unit: z.enum(goalUnits),
  current: z.number(),
  target: z.number(),
  lowerIsBetter: z.boolean(),
  owner: z.string().nullable(),
  quarterEnd: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Goal = z.infer<typeof goalSchema>;
export const goalListSchema = z.object({ goals: z.array(goalSchema) });
export type GoalList = z.infer<typeof goalListSchema>;
export const goalRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  unit: z.enum(goalUnits).default(""),
  current: z.number().default(0),
  target: z.number(),
  lowerIsBetter: z.boolean().default(false),
  ownerId: z.uuid().nullable().optional(),
  quarterEnd: z.iso.datetime(),
});
export type GoalRequest = z.infer<typeof goalRequestSchema>;
export const goalProgressSchema = z.object({
  current: z.number(),
  target: z.number().optional(),
});

/* The weekly founder email */

export const weeklySettingsSchema = z.object({
  on: z.boolean(),
  /** Monday at this hour, UTC. */
  hourUtc: z.number().int().min(0).max(23),
  recipients: z.array(
    z.object({
      email: z.email(),
      /** The short version carries no account handles. */
      version: z.enum(["full", "short"]),
    }),
  ),
});
export type WeeklySettings = z.infer<typeof weeklySettingsSchema>;

export const weeklyPreviewSchema = z.object({
  settings: weeklySettingsSchema,
  lastSentAt: z.iso.datetime().nullable(),
  nextAt: z.iso.datetime().nullable(),
  /** What Monday's email would say right now. */
  facts: z.array(z.tuple([z.string(), z.string()])),
  needsYou: z.array(z.string()),
});
export type WeeklyPreview = z.infer<typeof weeklyPreviewSchema>;
