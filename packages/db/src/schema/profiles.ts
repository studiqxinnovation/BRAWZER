import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
 * A browser profile: a name, a colour, a place in the list, and (since the
 * cloud browser) the browsing data kept between sessions. That data lives in
 * the object store under `dataObjectKey`, encrypted with its own key (ADR
 * 0011, as for Drive files); `dataWrappedKey` is that key sealed by the key
 * service and bound to this account and profile.
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
    /** Whether browsing data (cookies, history, site data) is saved when a session ends. */
    keepData: boolean().notNull().default(true),
    dataObjectKey: text().unique("profiles_data_object_key_unique"),
    dataWrappedKey: text(),
    /** Size of the saved data as stored (compressed, before encryption). */
    dataBytes: bigint({ mode: "number" }),
    dataSavedAt: timestamptz(),
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
