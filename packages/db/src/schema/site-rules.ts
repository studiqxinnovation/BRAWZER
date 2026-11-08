import { index, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/** Must match `siteRuleKinds` in @brawzer/contracts (a test in the API enforces this). */
export const siteRuleKind = pgEnum("site_rule_kind", ["allow", "block"]);

/**
 * An account's own destination rules, applied by every session's egress
 * (Phase 8, idea 8): a blocked host never opens; once any allowed host
 * exists, only allowed hosts open. A host matches itself and its subdomains.
 */
export const siteRules = pgTable(
  "site_rules",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: siteRuleKind().notNull(),
    /** Lower-cased ASCII host name or IP address (IPv6 without brackets). */
    host: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("site_rules_user_kind_host_unique").on(table.userId, table.kind, table.host),
    index("site_rules_user_idx").on(table.userId),
  ],
);

export type SiteRuleRow = typeof siteRules.$inferSelect;
