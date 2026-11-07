import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";
import { proxies } from "./proxies.ts";

/** Must match `profileColors` in @brawzer/contracts (a test in the API enforces this). */
export const profileColor = pgEnum("profile_color", [
  "indigo",
  "teal",
  "copper",
  "violet",
  "navy",
  "rose",
  "green",
  "slate",
]);

/** Must match `browserEngines` in @brawzer/contracts. Firefox is accepted from Phase 3b. */
export const browserEngine = pgEnum("browser_engine", ["chromium", "firefox"]);

/**
 * A browser profile. In Phase 2 a profile is organisation only (name, colour,
 * order); its browsing data arrives with the cloud browser (Phase 3) and
 * persistent encrypted storage (Phase 4).
 */
export const profiles = pgTable(
  "profiles",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Trimmed; unique per account, ignoring case. */
    name: text().notNull(),
    color: profileColor().notNull(),
    engine: browserEngine().notNull().default("chromium"),
    /** Order in the account's list, lowest first. Gaps are allowed. */
    position: integer().notNull(),
    /** Cleared when the proxy is deleted. Traffic goes through it from Phase 5. */
    proxyId: uuid().references(() => proxies.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("profiles_user_name_unique").on(table.userId, sql`lower(${table.name})`),
    index("profiles_user_position_idx").on(table.userId, table.position),
    index("profiles_proxy_idx").on(table.proxyId),
  ],
);

export type ProfileRow = typeof profiles.$inferSelect;
