import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";
import { teams } from "./teams.ts";

/** These must match @brawzer/contracts (a test in the API enforces this). */
export const driveFileStatus = pgEnum("drive_file_status", ["clean", "infected"]);
export const driveFileSource = pgEnum("drive_file_source", ["upload", "browser"]);

/** Root-level rows have no parent; the unique indexes treat them as one folder. */
const ROOT = sql`'00000000-0000-0000-0000-000000000000'::uuid`;

/**
 * A folder in Brawzer Drive. Deleting one deletes everything in it. A team's
 * folder has `teamId`; `userId` is then who made it (the owner, once they leave).
 */
export const driveFolders = pgTable(
  "drive_folders",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid().references(() => teams.id, { onDelete: "cascade" }),
    parentId: uuid().references((): AnyPgColumn => driveFolders.id, { onDelete: "cascade" }),
    /** Trimmed; unique among its siblings, ignoring case. */
    name: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("drive_folders_owner_sibling_name_unique").on(
      sql`coalesce(${table.teamId}, ${table.userId})`,
      sql`coalesce(${table.parentId}, ${ROOT})`,
      sql`lower(${table.name})`,
    ),
    index("drive_folders_user_idx").on(table.userId),
    index("drive_folders_team_idx").on(table.teamId),
    index("drive_folders_parent_idx").on(table.parentId),
  ],
);

/**
 * A file in Brawzer Drive. The content lives in the object store under
 * `objectKey`, encrypted with its own key (ADR 0011); `wrappedKey` is that
 * key sealed by the key service and bound to this account (or, for a team's
 * file, the team: ADR 0019) and object. In a team's space `userId` is who
 * added it, handed to the owner when they leave.
 */
export const driveFiles = pgTable(
  "drive_files",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid().references(() => teams.id, { onDelete: "cascade" }),
    folderId: uuid().references(() => driveFolders.id, { onDelete: "cascade" }),
    /** Trimmed; unique within its folder, ignoring case. */
    name: text().notNull(),
    /** Plaintext size in bytes. */
    size: bigint({ mode: "number" }).notNull(),
    /** Sniffed from the content, never taken from the client. */
    contentType: text().notNull(),
    status: driveFileStatus().notNull(),
    /** The scanner's signature name for quarantined files. */
    threat: text(),
    source: driveFileSource().notNull().default("upload"),
    wrappedKey: text().notNull(),
    objectKey: text().notNull().unique("drive_files_object_key_unique"),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
    /** Moved to Trash (Phase 9): hidden from its folder, removed for good 30 days later. */
    trashedAt: timestamptz(),
  },
  (table) => [
    // Names are unique among the files not in Trash, so a trashed file's name can be used again.
    uniqueIndex("drive_files_owner_sibling_name_unique")
      .on(
        sql`coalesce(${table.teamId}, ${table.userId})`,
        sql`coalesce(${table.folderId}, ${ROOT})`,
        sql`lower(${table.name})`,
      )
      .where(sql`${table.trashedAt} is null`),
    index("drive_files_user_idx").on(table.userId),
    index("drive_files_team_idx").on(table.teamId),
    index("drive_files_folder_idx").on(table.folderId),
    check("drive_files_size_nonnegative", sql`${table.size} >= 0`),
  ],
);

export type DriveFolderRow = typeof driveFolders.$inferSelect;
export type DriveFileRow = typeof driveFiles.$inferSelect;
