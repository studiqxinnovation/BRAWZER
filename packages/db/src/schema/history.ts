import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./columns.ts";
import { profiles } from "./profiles.ts";

/**
 * A page a profile visited (Phase 8, idea 2; ADR 0020). One row per address:
 * `entry` holds the address and title, encrypted with the profile's history
 * key and bound to this row; `urlDigest` is a keyed digest of the address,
 * so a visit finds its row without the address being stored in the clear.
 */
export const profileHistory = pgTable(
  "profile_history",
  {
    /** Chosen by the API: the encryption is bound to it. */
    id: uuid().primaryKey(),
    profileId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    urlDigest: text().notNull(),
    entry: text().notNull(),
    firstVisitedAt: timestamptz().notNull().defaultNow(),
    lastVisitedAt: timestamptz().notNull().defaultNow(),
    visits: integer().notNull().default(1),
  },
  (table) => [
    uniqueIndex("profile_history_profile_digest_unique").on(table.profileId, table.urlDigest),
    index("profile_history_profile_visited_idx").on(table.profileId, table.lastVisitedAt),
  ],
);

/** A page a profile keeps a bookmark to, encrypted the same way as its history. */
export const profileBookmarks = pgTable(
  "profile_bookmarks",
  {
    id: uuid().primaryKey(),
    profileId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    urlDigest: text().notNull(),
    entry: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("profile_bookmarks_profile_digest_unique").on(table.profileId, table.urlDigest),
    index("profile_bookmarks_profile_created_idx").on(table.profileId, table.createdAt),
  ],
);

export type ProfileHistoryRow = typeof profileHistory.$inferSelect;
export type ProfileBookmarkRow = typeof profileBookmarks.$inferSelect;
