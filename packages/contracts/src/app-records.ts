import { z } from "zod";

/**
 * The desktop's apps that keep records with the account (Phase 9): what each
 * keeps is sealed with its own data key on the server, never on the device.
 * Files the apps make (documents, sheets, invoices) go to Drive instead.
 */
export const appRecordApps = [
  "desktop",
  "assignments",
  "citations",
  "focus-timer",
  "exam-mode",
  "money",
  "invoices",
  "study-notes",
  "usage",
] as const;
export const appRecordAppSchema = z.enum(appRecordApps, {
  error: "That isn’t an app with records.",
});
export type AppRecordApp = z.infer<typeof appRecordAppSchema>;

/** Per app and account. */
export const MAX_APP_RECORDS = 500;
/** Per record, as JSON text. */
export const MAX_APP_RECORD_BYTES = 256 * 1024;

export const appRecordKeySchema = z
  .string({ error: "A record key is needed." })
  .regex(
    /^[a-z0-9][a-z0-9-]{0,63}$/,
    "A record key is 1 to 64 lower-case letters, digits and hyphens.",
  );

/** Any JSON the app chooses; Brawzer only seals it. */
export const appRecordDataSchema = z.json();

export const appRecordSchema = z.object({
  key: appRecordKeySchema,
  data: appRecordDataSchema,
  updatedAt: z.iso.datetime(),
});

export const appRecordListSchema = z.object({
  records: z.array(appRecordSchema),
});

export const putAppRecordRequestSchema = z.object({
  data: appRecordDataSchema,
});

export type AppRecord = z.infer<typeof appRecordSchema>;
export type AppRecordList = z.infer<typeof appRecordListSchema>;
