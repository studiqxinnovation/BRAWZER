import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/**
 * What the desktop's apps keep for an account (Phase 9): assignments, money,
 * invoices, the dock's apps. `sealed` is the record's JSON sealed with its
 * own data key (SecretBox), bound to the account, the app and the key.
 */
export const appRecords = pgTable(
  "app_records",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** One of `appRecordApps` in @brawzer/contracts. */
    app: text().notNull(),
    key: text().notNull(),
    sealed: text().notNull(),
    /** The JSON's length before sealing, for the limits. */
    bytes: integer().notNull(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("app_records_user_app_key_unique").on(table.userId, table.app, table.key),
    index("app_records_user_idx").on(table.userId),
  ],
);
