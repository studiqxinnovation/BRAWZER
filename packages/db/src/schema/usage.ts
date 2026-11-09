import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/**
 * Usage emails already sent (Phase 8, idea 20), so each threshold is said
 * once: per month for browsing hours, and per crossing for Drive (the rows
 * go when usage falls back under the warning line).
 */
export const usageNotices = pgTable(
  "usage_notices",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** browsing, storage or files. */
    kind: text().notNull(),
    /** "2026-11" for browsing hours; "current" for Drive. */
    period: text().notNull(),
    /** 80 or 100. */
    threshold: integer().notNull(),
    sentAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_notices_unique").on(table.userId, table.kind, table.period, table.threshold),
  ],
);
