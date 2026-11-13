import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
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

/** Must match `browserEngines` in @brawzer/contracts: Bee (Brawzer's own, on Chromium), Firefox and Chrome. */
export const browserEngine = pgEnum("browser_engine", [
  "bee",
  "firefox",
  "chrome",
  "edge",
  "chromium",
]);

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
    engine: browserEngine().notNull().default("bee"),
    /** Order in the account's list, lowest first. Gaps are allowed. */
    position: integer().notNull(),
    /** Cleared when the proxy is deleted. Traffic goes through it from Phase 5. */
    proxyId: uuid().references(() => proxies.id, { onDelete: "set null" }),
    /** Whether browsing data (cookies, history, site data) is saved when a session ends. */
    keepData: boolean().notNull().default(true),
    /**
     * With a proxy: private and internal addresses are handed to the proxy
     * instead of refused, for intranets reached through one's own proxy. Off
     * by default; loopback stays refused either way (Phase 8, idea 9).
     */
    privateThroughProxy: boolean().notNull().default(false),
    /** Catalogue extensions (slugs) installed into the profile's sessions (ADR 0018). */
    extensions: jsonb().$type<string[]>().notNull().default([]),
    dataObjectKey: text().unique("profiles_data_object_key_unique"),
    dataWrappedKey: text(),
    /** Size of the saved data as stored (compressed, before encryption). */
    dataBytes: bigint({ mode: "number" }),
    dataSavedAt: timestamptz(),
    /** Brawzer keeps a searchable history while the profile keeps its data (ADR 0020). */
    keepHistory: boolean().notNull().default(true),
    /** The browser's password manager and own account sign-in, for this profile's sessions. */
    browserAccount: boolean().notNull().default(false),
    /**
     * The profile's own key for its history, bookmarks and open tabs: 32
     * random bytes sealed by the key service, bound to the account and profile.
     */
    historyKey: text(),
    /** The tabs its last session left open, encrypted with the history key (idea 3). */
    openTabs: text(),
    openTabsAt: timestamptz(),
    /** Those tabs were left on purpose, to continue on another device. */
    openTabsHandedOff: boolean().notNull().default(false),
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

/* Must match `extensionStatuses` in @brawzer/contracts (tech.ts). */
export const extensionStatus = pgEnum("extension_status", ["allowed", "review", "blocked"]);

/**
 * Moderation of the extension catalogue (Phase 11.4). A blocked extension
 * can't be installed and is removed from every profile; a reason is kept and
 * emailed to the people who had it.
 */
export const extensionPolicies = pgTable("extension_policies", {
  slug: text().primaryKey(),
  status: extensionStatus().notNull().default("allowed"),
  reason: text(),
  changedById: uuid().references(() => users.id, { onDelete: "set null" }),
  changedAt: timestamptz().notNull().defaultNow(),
});
