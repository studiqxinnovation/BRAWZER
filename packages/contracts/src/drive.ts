import { z } from "zod";

/** Must match the database enums of the same names (a test in the API enforces this). */
export const driveFileStatuses = ["clean", "infected"] as const;
/** Where a file came from: this device, or the cloud browser (a download or a printed page). */
export const driveFileSources = ["upload", "browser"] as const;

/** Temporary limits until plans exist (Phase 6). */
export const DRIVE_LIMITS = {
  /** 100 MiB per file. */
  maxFileBytes: 100 * 1024 * 1024,
  /** 2 GiB per account. */
  maxAccountBytes: 2 * 1024 * 1024 * 1024,
  maxFiles: 2000,
  maxFolders: 500,
} as const;

/** Content types Drive can show in the browser. Everything else is download-only. */
export const PREVIEWABLE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "text/plain",
  // Audio, for Music (Phase 9): it plays, and can't run as a page.
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/flac",
  "audio/x-flac",
] as const;

/** What the desktop's viewers list across Drive: Photos, PDF Viewer, Music, the editors. */
export const driveFileKinds = ["images", "pdfs", "audio", "text"] as const;
export type DriveFileKind = (typeof driveFileKinds)[number];

export const isPreviewable = (contentType: string): boolean =>
  (PREVIEWABLE_TYPES as readonly string[]).includes(contentType);

export const driveFileStatusSchema = z.enum(driveFileStatuses);
export const driveFileSourceSchema = z.enum(driveFileSources);

/** How long a download ticket can be used for, in seconds. */
export const DOWNLOAD_TICKET_SECONDS = 60;

/** A file or folder name: one path segment, no control or direction-override characters. */
export const driveNameSchema = z
  .string({ error: "Give it a name." })
  .trim()
  .min(1, "Give it a name.")
  .max(255, "Use at most 255 characters.")
  .refine((value) => !/[\p{Cc}‪-‮⁦-⁩]/u.test(value), {
    error: "Use letters, numbers, spaces and punctuation.",
  })
  .refine((value) => !/[/\\]/.test(value), { error: "A name can’t contain slashes." })
  .refine((value) => value !== "." && value !== "..", { error: "That isn’t a usable name." });

/** Whose Drive: the person's own, or their team's shared space (Phase 8, idea 19). */
export const driveSpaces = ["personal", "team"] as const;
export const driveSpaceSchema = z.enum(driveSpaces, { error: "Choose personal or team." });
export type DriveSpace = z.infer<typeof driveSpaceSchema>;

export const driveFolderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Null at the top level. */
  parentId: z.uuid().nullable(),
  /** In a team's space: whether the signed-in person may delete it (who made it, owner, admins). */
  canDelete: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** How long a file stays in Trash before it's removed for good. */
export const DRIVE_TRASH_DAYS = 30;

export const driveFileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Null at the top level. */
  folderId: z.uuid().nullable(),
  size: z.number().int().nonnegative(),
  /** Sniffed from the content by the server. */
  contentType: z.string(),
  status: driveFileStatusSchema,
  /** The malware signature a quarantined file matched. */
  threat: z.string().nullable(),
  /** Clean and of a type the browser can show. */
  previewable: z.boolean(),
  source: driveFileSourceSchema,
  /** In a team's space: whether the signed-in person may delete it (who added it, owner, admins). */
  canDelete: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** In Trash since then; it's removed for good DRIVE_TRASH_DAYS later. */
  trashedAt: z.iso.datetime().nullable(),
});

export const driveUsageSchema = z.object({
  usedBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().positive(),
  fileCount: z.number().int().nonnegative(),
  fileLimit: z.number().int().positive(),
  folderCount: z.number().int().nonnegative(),
  folderLimit: z.number().int().positive(),
  maxFileBytes: z.number().int().positive(),
});

/** GET /drive: every folder (accounts are small) and how much is used. */
export const driveOverviewSchema = z.object({
  folders: z.array(driveFolderSchema),
  usage: driveUsageSchema,
  space: driveSpaceSchema,
  /** The person's team, whose space they can switch to; null outside a team. */
  team: z.object({ name: z.string() }).nullable(),
});

export const driveSpaceQuerySchema = z.object({
  space: driveSpaceSchema.default("personal"),
});

export const driveFileListSchema = z.object({
  files: z.array(driveFileSchema),
});

/** Without `q`: the files in one folder (none means the top level). With `q`: a search everywhere. */
export const driveFileQuerySchema = z.object({
  folderId: z.uuid({ error: "That isn’t a folder ID." }).optional(),
  q: z.string().trim().max(100, "Use at most 100 characters.").optional(),
  /** Every clean file of this kind, wherever it is (the desktop's viewers). */
  kind: z.enum(driveFileKinds, { error: "That isn’t a kind of file." }).optional(),
  /** For the top level and searches; a folder belongs to its own space. */
  space: driveSpaceSchema.default("personal"),
});

export const createFolderRequestSchema = z.object({
  name: driveNameSchema,
  parentId: z.uuid({ error: "That isn’t a folder ID." }).nullable().optional(),
  /** Where a top-level folder goes; a subfolder goes where its parent is. */
  space: driveSpaceSchema.default("personal"),
});

export const updateFolderRequestSchema = z
  .object({
    name: driveNameSchema.optional(),
    /** Null moves it to the top level. */
    parentId: z.uuid({ error: "That isn’t a folder ID." }).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: "Change at least one thing." });

export const updateFileRequestSchema = z
  .object({
    name: driveNameSchema.optional(),
    /** Null moves it to the top level. */
    folderId: z.uuid({ error: "That isn’t a folder ID." }).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: "Change at least one thing." });

export const downloadTicketSchema = z.object({
  /** Path of the content, with the ticket; valid once, for DOWNLOAD_TICKET_SECONDS. */
  url: z.string(),
  expiresAt: z.iso.datetime(),
});

export const downloadTicketQuerySchema = z.object({
  ticket: z
    .string({ error: "A ticket is required." })
    .regex(/^[A-Za-z0-9_-]{43}$/, "That isn’t a ticket."),
});

export type DriveFileStatus = z.infer<typeof driveFileStatusSchema>;
export type DriveFolder = z.infer<typeof driveFolderSchema>;
export type DriveFile = z.infer<typeof driveFileSchema>;
export type DriveFileSource = z.infer<typeof driveFileSourceSchema>;
export type DriveUsage = z.infer<typeof driveUsageSchema>;
export type DriveOverview = z.infer<typeof driveOverviewSchema>;
export type DriveFileList = z.infer<typeof driveFileListSchema>;
export type CreateFolderRequest = z.input<typeof createFolderRequestSchema>;
export type UpdateFolderRequest = z.input<typeof updateFolderRequestSchema>;
export type UpdateFileRequest = z.input<typeof updateFileRequestSchema>;
export type DownloadTicket = z.infer<typeof downloadTicketSchema>;
