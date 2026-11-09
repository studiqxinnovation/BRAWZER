import { z } from "zod";
import { browserEngineSchema } from "./profiles.ts";

/**
 * Report a page (Phase 8, idea 12): someone tells Brawzer's team that a page
 * doesn't work in the cloud browser. Nothing is captured unless they send
 * it: the address only if they leave it in, a picture only if they attach
 * one. Must match the database enum `page_report_kind`.
 */
export const pageReportKinds = ["broken", "blocked", "other"] as const;
export const pageReportKindSchema = z.enum(pageReportKinds, { error: "Choose what went wrong." });
export type PageReportKind = z.infer<typeof pageReportKindSchema>;

export const MAX_REPORT_MESSAGE_CHARS = 2000;
/** A JPEG of what the page showed, small enough for one request. */
export const MAX_REPORT_PICTURE_BYTES = 600 * 1024;
/** An attached picture is deleted when the report is closed, or after this many days. */
export const REPORT_PICTURE_DAYS = 30;
/** A closed report is deleted after this many days. */
export const CLOSED_REPORT_DAYS = 90;

const pictureSchema = z
  .string()
  .max(Math.ceil(MAX_REPORT_PICTURE_BYTES / 3) * 4, "The picture is too large.")
  // Base64 of a JPEG: the first three bytes FF D8 FF encode as "/9j/".
  .regex(/^\/9j\/[A-Za-z0-9+/]*={0,2}$/, "The picture must be a JPEG.");

export const createPageReportRequestSchema = z.object({
  kind: pageReportKindSchema,
  message: z
    .string({ error: "Say what went wrong." })
    .trim()
    .min(1, "Say what went wrong.")
    .max(MAX_REPORT_MESSAGE_CHARS, `Keep it under ${String(MAX_REPORT_MESSAGE_CHARS)} characters.`),
  /** The page's address, when the person leaves it in. */
  url: z.string().max(2048).nullable(),
  title: z.string().max(300).nullable(),
  /** The tab's error code (Brawzer's or the engine's) when it shows an error page. */
  errorCode: z
    .string()
    .max(100)
    .regex(/^[A-Z0-9_:.-]*$/i)
    .nullable(),
  /** The session the page is open in; the API checks it is the person's own. */
  sessionId: z.uuid().nullable(),
  picture: pictureSchema.nullable(),
});
export type CreatePageReportRequest = z.input<typeof createPageReportRequestSchema>;

export const pageReportCreatedSchema = z.object({ id: z.uuid(), createdAt: z.iso.datetime() });
export type PageReportCreated = z.infer<typeof pageReportCreatedSchema>;

export const pageReportStates = ["open", "closed"] as const;

export const adminPageReportSchema = z.object({
  id: z.uuid(),
  kind: pageReportKindSchema,
  message: z.string(),
  url: z.string().nullable(),
  title: z.string().nullable(),
  errorCode: z.string().nullable(),
  engine: browserEngineSchema.nullable(),
  account: z.object({ id: z.uuid(), email: z.string() }),
  createdAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  hasPicture: z.boolean(),
});
export type AdminPageReport = z.infer<typeof adminPageReportSchema>;

export const adminPageReportListSchema = z.object({
  reports: z.array(adminPageReportSchema),
  /** Open reports in all, however many are listed. */
  open: z.number().int().nonnegative(),
});
export type AdminPageReportList = z.infer<typeof adminPageReportListSchema>;

export const adminPageReportQuerySchema = z.object({
  state: z.enum(pageReportStates).default("open"),
});

export const adminPageReportPictureSchema = z.object({
  /** Base64 of the JPEG the person attached. */
  picture: z.string(),
});
export type AdminPageReportPicture = z.infer<typeof adminPageReportPictureSchema>;
