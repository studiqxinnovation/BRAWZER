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

/** These must match @brawzer/contracts (a test in the API enforces this). */
export const driveFileStatus = pgEnum("drive_file_status", ["clean", "infected"]);
export const driveFileSource = pgEnum("drive_file_source", ["upload", "browser"]);

/** Root-level rows have no parent; the unique indexes treat them as one folder. */
const ROOT = sql`'00000000-0000-0000-0000-000000000000'::uuid`;

/** A folder in Brawzer Drive. Deleting one deletes everything in it. */
export const driveFolders = pgTable(
  "drive_folders",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid().references((): AnyPgColumn => driveFolders.id, { onDelete: "cascade" }),
    /** Trimmed; unique among its siblings, ignoring case. */
    name: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("drive_folders_sibling_name_unique").on(
      table.userId,
      sql`coalesce(${table.parentId}, ${ROOT})`,
      sql`lower(${table.name})`,
    ),
    index("drive_folders_user_idx").on(table.userId),
    index("drive_folders_parent_idx").on(table.parentId),
  ],
);

/**
 * A file in Brawzer Drive. The content lives in the object store under
 * `objectKey`, encrypted with its own key (ADR 0011); `wrappedKey` is that
 * key sealed by the key service and bound to this account and object.
 */
export const driveFiles = pgTable(
  "drive_files",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
  },
  (table) => [
    uniqueIndex("drive_files_sibling_name_unique").on(
      table.userId,
      sql`coalesce(${table.folderId}, ${ROOT})`,
      sql`lower(${table.name})`,
    ),
    index("drive_files_user_idx").on(table.userId),
    index("drive_files_folder_idx").on(table.folderId),
    check("drive_files_size_nonnegative", sql`${table.size} >= 0`),
  ],
);

export type DriveFolderRow = typeof driveFolders.$inferSelect;
export type DriveFileRow = typeof driveFiles.$inferSelect;
