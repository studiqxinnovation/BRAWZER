import { index, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/* Each enum must match its list in @brawzer/contracts (support.ts). */
export const ticketCategory = pgEnum("ticket_category", [
  "account",
  "billing",
  "drive",
  "technical",
  "how_to",
  "privacy",
  "security",
  "sales",
]);
export const ticketPriority = pgEnum("ticket_priority", ["urgent", "high", "normal", "low"]);
export const ticketStatus = pgEnum("ticket_status", ["open", "pending", "solved"]);
export const ticketMessageKind = pgEnum("ticket_message_kind", [
  "customer",
  "staff",
  "note",
  "system",
]);

/**
 * A support request (Phase 11.2): a customer writes from Help, staff answer
 * from the console's inbox, and every reply also goes by email. The number
 * is what people quote; the id is what links point at.
 */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: id(),
    number: integer().notNull().generatedAlwaysAsIdentity(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text().notNull(),
    category: ticketCategory().notNull(),
    priority: ticketPriority().notNull().default("normal"),
    status: ticketStatus().notNull().default("open"),
    assigneeId: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
    /** When the customer last wrote; the inbox sorts by what waits longest. */
    lastCustomerMessageAt: timestamptz().notNull().defaultNow(),
    /** The first staff reply, for response-time reporting. */
    firstResponseAt: timestamptz(),
    solvedAt: timestamptz(),
    /** 1 to 5, given by the customer once solved. */
    rating: integer(),
    ratingComment: text(),
    ratedAt: timestamptz(),
  },
  (table) => [
    index("support_tickets_status_idx").on(table.status, table.lastCustomerMessageAt),
    index("support_tickets_user_idx").on(table.userId, table.createdAt),
  ],
);

export const supportMessages = pgTable(
  "support_messages",
  {
    id: id(),
    ticketId: uuid()
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    /** The customer or the staff member; null once that account is gone. */
    authorId: uuid().references(() => users.id, { onDelete: "set null" }),
    kind: ticketMessageKind().notNull(),
    body: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("support_messages_ticket_idx").on(table.ticketId, table.createdAt)],
);

/** Replies staff reuse, kept here so the whole team has the same wording. */
export const supportSavedReplies = pgTable("support_saved_replies", {
  id: id(),
  name: text().notNull(),
  body: text().notNull(),
  updatedById: uuid().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz().notNull().defaultNow(),
});
