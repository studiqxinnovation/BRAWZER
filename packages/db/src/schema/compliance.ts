import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/* Each enum must match its list in @brawzer/contracts (compliance.ts). */
export const privacyKind = pgEnum("privacy_kind", ["copy", "correct", "delete"]);
export const privacyStatus = pgEnum("privacy_status", ["open", "completed"]);

/**
 * A privacy request (Phase 11.5): a copy, a correction or a deletion asked
 * for by a person, with the one-month deadline the law gives.
 */
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: id(),
    /** Null once a deletion request was carried out: the record stays, the account doesn't. */
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    kind: privacyKind().notNull(),
    receivedAt: timestamptz().notNull().defaultNow(),
    deadlineAt: timestamptz().notNull(),
    status: privacyStatus().notNull().default("open"),
    note: text(),
    createdById: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
    completedById: uuid().references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamptz(),
  },
  (table) => [index("privacy_requests_status_idx").on(table.status, table.deadlineAt)],
);

/** A control the team keeps itself honest about: done, by whom, when. */
export const complianceItems = pgTable(
  "compliance_items",
  {
    id: id(),
    framework: text().notNull(),
    item: text().notNull(),
    sortOrder: integer().notNull().default(0),
    done: boolean().notNull().default(false),
    doneById: uuid().references(() => users.id, { onDelete: "set null" }),
    doneAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("compliance_items_framework_idx").on(table.framework, table.sortOrder)],
);

/** A quarterly goal with a number to reach. */
export const goals = pgTable("goals", {
  id: id(),
  name: text().notNull(),
  /** "", "GBP", "%", "min": how the number is shown. */
  unit: text().notNull().default(""),
  current: doublePrecision().notNull().default(0),
  target: doublePrecision().notNull(),
  lowerIsBetter: boolean().notNull().default(false),
  ownerId: uuid().references(() => users.id, { onDelete: "set null" }),
  quarterEnd: timestamptz().notNull(),
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz().notNull().defaultNow(),
});

/** Small settings the console keeps, such as the weekly email's recipients. */
export const consoleSettings = pgTable("console_settings", {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamptz().notNull().defaultNow(),
});
