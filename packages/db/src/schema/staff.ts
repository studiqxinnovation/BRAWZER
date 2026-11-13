import { boolean, index, integer, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/**
 * The admin console's own records (Phase 11): every staff action, and the
 * notes staff keep about an account. Roles live on `users.role`.
 */

/** Every staff action, including pages refused by permissions. Never edited or deleted. */
export const staffActions = pgTable(
  "staff_actions",
  {
    id: id(),
    actorId: uuid().references(() => users.id, { onDelete: "set null" }),
    /** The actor's role at the time: a role can change later. */
    actorRole: text().notNull(),
    action: text().notNull(),
    target: text().notNull().default(""),
    detail: text().notNull().default(""),
    ipAddress: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    index("staff_actions_created_idx").on(table.createdAt),
    index("staff_actions_target_idx").on(table.target),
  ],
);

/** A note staff keep about an account; the customer never sees it. */
export const staffNotes = pgTable(
  "staff_notes",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid().references(() => users.id, { onDelete: "set null" }),
    body: text().notNull(),
    pinned: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("staff_notes_user_idx").on(table.userId)],
);

/* Must match `approvalKinds` / `approvalStatuses` in @brawzer/contracts (billing-console.ts). */
export const approvalKind = pgEnum("approval_kind", ["refund", "coupon"]);
export const approvalStatus = pgEnum("approval_status", ["waiting", "approved", "declined"]);

/**
 * The "four eyes" rule (Phase 11.3): an action over a role's limit waits here
 * for a founder. Approving carries it out; nobody approves their own request.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    kind: approvalKind().notNull(),
    requestedById: uuid().references(() => users.id, { onDelete: "set null" }),
    /** One line a person reads: "Refund £139.44 of invoice 0042". */
    what: text().notNull(),
    /** The account, invoice or code it concerns. */
    target: text().notNull().default(""),
    amountMinor: integer(),
    currency: text(),
    /** What approving needs to carry the action out. */
    payload: jsonb()
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    status: approvalStatus().notNull().default("waiting"),
    decidedById: uuid().references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamptz(),
    reason: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("approvals_status_idx").on(table.status, table.createdAt)],
);
