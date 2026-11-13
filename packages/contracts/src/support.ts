import { z } from "zod";
import { customerSchema } from "./staff.ts";

/* ── Support requests (Phase 11.2) ── */

/** Must match `ticket_category` in @brawzer/db. */
export const ticketCategories = [
  "account",
  "billing",
  "drive",
  "technical",
  "how_to",
  "privacy",
  "security",
  "sales",
] as const;
export const ticketCategorySchema = z.enum(ticketCategories, {
  error: "Choose what the request is about.",
});
export type TicketCategory = z.infer<typeof ticketCategorySchema>;
export const ticketCategoryNames: Readonly<Record<TicketCategory, string>> = {
  account: "Account",
  billing: "Billing",
  drive: "Drive",
  technical: "Technical",
  how_to: "How-to",
  privacy: "Privacy",
  security: "Security",
  sales: "Sales",
};

/** Must match `ticket_priority` in @brawzer/db. */
export const ticketPriorities = ["urgent", "high", "normal", "low"] as const;
export const ticketPrioritySchema = z.enum(ticketPriorities);
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;
export const ticketPriorityNames: Readonly<Record<TicketPriority, string>> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * How soon a first reply should come, in minutes, by priority. These are
 * Brawzer's own targets; the inbox sorts by what is closest to missing one.
 */
export const responseTargetMinutes: Readonly<Record<TicketPriority, number>> = {
  urgent: 60,
  high: 240,
  normal: 480,
  low: 1440,
};

/** Must match `ticket_status` in @brawzer/db. */
export const ticketStatuses = ["open", "pending", "solved"] as const;
export const ticketStatusSchema = z.enum(ticketStatuses);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export const ticketStatusNames: Readonly<Record<TicketStatus, string>> = {
  open: "Open",
  pending: "Waiting on customer",
  solved: "Solved",
};

/** Must match `ticket_message_kind` in @brawzer/db. */
export const ticketMessageKinds = ["customer", "staff", "note", "system"] as const;
export const ticketMessageKindSchema = z.enum(ticketMessageKinds);
export type TicketMessageKind = z.infer<typeof ticketMessageKindSchema>;

export const TICKET_SUBJECT_MAX = 140;
export const TICKET_BODY_MAX = 5000;

const subjectSchema = z
  .string()
  .trim()
  .min(3, { error: "Give the request a short subject." })
  .max(TICKET_SUBJECT_MAX, {
    error: `Keep the subject under ${String(TICKET_SUBJECT_MAX)} characters.`,
  });
const bodySchema = z
  .string()
  .trim()
  .min(2, { error: "Write a message." })
  .max(TICKET_BODY_MAX, { error: `Keep it under ${String(TICKET_BODY_MAX)} characters.` });

/** One message in a request, as its customer sees it. Internal notes never leave the console. */
export const ticketMessageSchema = z.object({
  id: z.uuid(),
  kind: ticketMessageKindSchema,
  /** Who wrote it, as shown: the customer's handle, a staff member's name, or "Brawzer". */
  author: z.string(),
  body: z.string(),
  at: z.iso.datetime(),
});
export type TicketMessage = z.infer<typeof ticketMessageSchema>;

export const ticketSummarySchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  subject: z.string(),
  category: ticketCategorySchema,
  status: ticketStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** The newest message's first line, for the list. */
  preview: z.string(),
  rating: z.number().int().min(1).max(5).nullable(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const ticketSchema = ticketSummarySchema.extend({
  messages: z.array(ticketMessageSchema),
});
export type Ticket = z.infer<typeof ticketSchema>;

export const ticketListSchema = z.object({ tickets: z.array(ticketSummarySchema) });
export type TicketList = z.infer<typeof ticketListSchema>;

export const createTicketRequestSchema = z.object({
  subject: subjectSchema,
  category: ticketCategorySchema,
  body: bodySchema,
});
export type CreateTicketRequest = z.infer<typeof createTicketRequestSchema>;

export const ticketReplyRequestSchema = z.object({ body: bodySchema });
export type TicketReplyRequest = z.infer<typeof ticketReplyRequestSchema>;

export const ticketRatingRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
export type TicketRatingRequest = z.infer<typeof ticketRatingRequestSchema>;

/* ── The console's inbox ── */

export const staffTicketSummarySchema = ticketSummarySchema.extend({
  priority: ticketPrioritySchema,
  lastCustomerMessageAt: z.iso.datetime(),
  firstResponseAt: z.iso.datetime().nullable(),
  solvedAt: z.iso.datetime().nullable(),
  ratingComment: z.string().nullable(),
  /** When a first reply is due, until there has been one. */
  responseDueAt: z.iso.datetime().nullable(),
  assignee: z.object({ id: z.uuid(), email: z.string() }).nullable(),
  customer: z.object({
    id: z.uuid(),
    handle: z.string(),
    /** Masked unless the viewer is a founder. */
    email: z.string(),
    planName: z.string(),
    teamName: z.string().nullable(),
  }),
});
export type StaffTicketSummary = z.infer<typeof staffTicketSummarySchema>;

export const staffTicketSchema = staffTicketSummarySchema.extend({
  /** Every message, internal notes included. Staff authors are their addresses. */
  messages: z.array(ticketMessageSchema),
  /** The customer's account as the console shows it, for the side panel. */
  account: customerSchema,
});
export type StaffTicket = z.infer<typeof staffTicketSchema>;

export const ticketViews = ["open", "pending", "solved", "all"] as const;
export const ticketViewSchema = z.enum(ticketViews);
export type TicketView = z.infer<typeof ticketViewSchema>;

export const staffTicketQuerySchema = z.object({
  view: ticketViewSchema.default("open"),
  mine: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  q: z.string().trim().max(120).optional(),
});

export const staffTicketListSchema = z.object({
  tickets: z.array(staffTicketSummarySchema),
  counts: z.object({
    open: z.number().int(),
    pending: z.number().int(),
    solved: z.number().int(),
    all: z.number().int(),
  }),
});
export type StaffTicketList = z.infer<typeof staffTicketListSchema>;

export const updateTicketRequestSchema = z
  .object({
    status: ticketStatusSchema.optional(),
    priority: ticketPrioritySchema.optional(),
    category: ticketCategorySchema.optional(),
    /** A staff member's account id, or null to leave it unassigned. */
    assigneeId: z.uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to change." });
export type UpdateTicketRequest = z.infer<typeof updateTicketRequestSchema>;

export const staffReplyRequestSchema = z.object({
  body: bodySchema,
  /** A reply goes to the customer by email; a note stays in the console. */
  kind: z.enum(["reply", "note"]).default("reply"),
  /** What a reply leaves the request as; notes never change it. */
  setStatus: z.enum(["pending", "solved"]).nullable().default(null),
});
export type StaffReplyRequest = z.infer<typeof staffReplyRequestSchema>;

export const savedReplySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  body: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string().nullable(),
});
export type SavedReply = z.infer<typeof savedReplySchema>;
export const savedReplyListSchema = z.object({ replies: z.array(savedReplySchema) });
export type SavedReplyList = z.infer<typeof savedReplyListSchema>;
export const savedReplyRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  body: bodySchema,
});
export type SavedReplyRequest = z.infer<typeof savedReplyRequestSchema>;

/** Support performance, every figure from the requests themselves. */
export const supportStatsSchema = z.object({
  open: z.number().int(),
  pending: z.number().int(),
  /** Open requests with no reply yet, past their target. */
  pastTarget: z.number().int(),
  solved7d: z.number().int(),
  /** First replies in the last 7 days: the median wait in minutes, and how many met their target. */
  firstResponse: z.object({
    count: z.number().int(),
    medianMinutes: z.number().nullable(),
    withinTargetPercent: z.number().nullable(),
  }),
  ratings: z.object({
    count: z.number().int(),
    average: z.number().nullable(),
    low: z.number().int(),
  }),
  byCategory: z.array(z.object({ category: ticketCategorySchema, open: z.number().int() })),
  byAgent: z.array(
    z.object({ email: z.string(), open: z.number().int(), solved7d: z.number().int() }),
  ),
  /** The last 14 days, oldest first. */
  perDay: z.array(
    z.object({ day: z.iso.date(), opened: z.number().int(), solved: z.number().int() }),
  ),
  /** Ratings of 3 or less, newest first, with whether anyone has followed up. */
  lowRatings: z.array(
    z.object({
      id: z.uuid(),
      number: z.number().int(),
      subject: z.string(),
      rating: z.number().int(),
      comment: z.string().nullable(),
      ratedAt: z.iso.datetime(),
      customer: z.string(),
      assignee: z.string().nullable(),
      followedUp: z.boolean(),
    }),
  ),
});
export type SupportStats = z.infer<typeof supportStatsSchema>;
