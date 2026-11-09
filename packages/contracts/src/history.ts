import { z } from "zod";

/** An http or https address, as a tab can open it (kept here: browser.ts imports this file). */
const pageUrlSchema = z
  .string()
  .max(2048, "That address is too long.")
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { error: "Enter a web address that starts with http:// or https://." },
  );

/**
 * History, bookmarks and open tabs as Brawzer's own records (Phase 8, ideas
 * 2 and 3; ADR 0020). Kept per profile, encrypted with the profile's own
 * key, never shown to administrators and never written to logs.
 */
export const HISTORY_LIMITS = {
  /** Entries a profile keeps; the oldest go first. */
  maxEntries: 5000,
  /** An entry not visited for this long is deleted. */
  retentionDays: 90,
  maxBookmarks: 1000,
  /** Tabs a session hands to the next one. */
  maxOpenTabs: 20,
  /** Saved tabs are offered for this long after the session that left them. */
  openTabsDays: 7,
  /** History entries per page. */
  pageSize: 100,
} as const;

export const historyEntrySchema = z.object({
  id: z.uuid(),
  url: z.string(),
  title: z.string(),
  firstVisitedAt: z.iso.datetime(),
  lastVisitedAt: z.iso.datetime(),
  visits: z.number().int().positive(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const historyPageSchema = z.object({
  entries: z.array(historyEntrySchema),
  /** Pass back as `cursor` for the next page; null on the last one. */
  next: z.string().nullable(),
  /** The profile's own switch. */
  keepHistory: z.boolean(),
  /** Whether new visits are recorded: the switch, and the profile keeping its data. */
  recording: z.boolean(),
});
export type HistoryPage = z.infer<typeof historyPageSchema>;

export const historyQuerySchema = z.object({
  q: z.string().trim().max(200, "Use at most 200 characters.").optional(),
  cursor: z
    .string()
    .regex(/^\d{1,5}$/, "That isn’t a page of history.")
    .optional(),
});

export const bookmarkSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  title: z.string(),
  createdAt: z.iso.datetime(),
});
export type Bookmark = z.infer<typeof bookmarkSchema>;

export const bookmarkListSchema = z.object({
  bookmarks: z.array(bookmarkSchema),
  limit: z.number().int().positive(),
});
export type BookmarkList = z.infer<typeof bookmarkListSchema>;

const bookmarkTitleSchema = z.string().trim().max(300, "Keep the name under 300 characters.");

export const createBookmarkRequestSchema = z.object({
  url: pageUrlSchema,
  title: bookmarkTitleSchema.default(""),
});
export type CreateBookmarkRequest = z.input<typeof createBookmarkRequestSchema>;

export const updateBookmarkRequestSchema = z.object({ title: bookmarkTitleSchema });

/** Tabs a profile's last session left open, offered to the next one (idea 3). */
export const savedTabsSchema = z.object({
  profileId: z.uuid(),
  savedAt: z.iso.datetime(),
  /** Whether the session that left them was handed off on purpose. */
  handedOff: z.boolean(),
  tabs: z.array(z.object({ url: z.string(), title: z.string() })),
});
export type SavedTabs = z.infer<typeof savedTabsSchema>;
