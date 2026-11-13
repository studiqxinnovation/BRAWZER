import { index, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/* Each enum must match its list in @brawzer/contracts (security-console.ts). */
export const abuseKind = pgEnum("abuse_kind", ["phishing", "spam", "fraud", "bots", "other"]);
export const abuseStatus = pgEnum("abuse_status", ["open", "warned", "suspended", "dismissed"]);
export const legalRequestStatus = pgEnum("legal_request_status", [
  "verifying",
  "answered",
  "refused",
]);

/**
 * Addresses and networks that may not sign in or register (Phase 11.5).
 * Checked on every sign-in and registration; a block can expire.
 */
export const blockedAddresses = pgTable(
  "blocked_addresses",
  {
    id: id(),
    /** An address or a network in CIDR form, as given. */
    cidr: text().notNull(),
    reason: text().notNull(),
    createdById: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
    expiresAt: timestamptz(),
  },
  (table) => [index("blocked_addresses_cidr_idx").on(table.cidr)],
);

/** A report that an account misuses Brawzer, and what staff did about it. */
export const abuseReports = pgTable(
  "abuse_reports",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: abuseKind().notNull(),
    /** Who told us: a website, a provider, a customer, our own checks. */
    source: text().notNull(),
    detail: text().notNull(),
    status: abuseStatus().notNull().default("open"),
    note: text(),
    createdById: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
    decidedById: uuid().references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamptz(),
  },
  (table) => [index("abuse_reports_status_idx").on(table.status, table.createdAt)],
);

/** A hold stops every deletion of the account's data until it is released. */
export const legalHolds = pgTable("legal_holds", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  why: text().notNull(),
  createdById: uuid().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamptz().notNull().defaultNow(),
});

/** A request from police or a court, logged with what was done. */
export const legalRequests = pgTable(
  "legal_requests",
  {
    id: id(),
    fromWhom: text().notNull(),
    kind: text().notNull(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    status: legalRequestStatus().notNull().default("verifying"),
    dueAt: timestamptz(),
    note: text(),
    createdById: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
    decidedAt: timestamptz(),
  },
  (table) => [index("legal_requests_status_idx").on(table.status, table.createdAt)],
);
