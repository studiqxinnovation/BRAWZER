import { z } from "zod";

/**
 * Everything recorded in an account's security history. Must match the
 * database enum `security_event_type` (a test in the API enforces this).
 */
export const securityEventTypes = [
  "account.created",
  "email.verified",
  "sign_in.succeeded",
  "sign_in.failed",
  "sign_out",
  "session.refreshed",
  "sessions.revoked",
  "password.reset_requested",
  "password.reset",
  "password.changed",
  "reauthenticated",
  "passkey.added",
  "passkey.removed",
  "mfa.enabled",
  "mfa.disabled",
  "mfa.recovery_codes_regenerated",
  "mfa.recovery_code_used",
  "mfa.failed",
  "email.change_requested",
  "email.changed",
  "email.change_undone",
  "data.exported",
  "profile.created",
  "profile.deleted",
  "proxy.created",
  "proxy.updated",
  "proxy.deleted",
  "drive.file_uploaded",
  "drive.file_quarantined",
  "drive.file_deleted",
  "drive.file_saved",
  "drive.folder_deleted",
  "browser.session_started",
  "browser.session_ended",
  "browser.file_saved",
  "browser.file_sent",
  "profile.data_cleared",
  "phone_sign_in.approved",
  "sign_in.new_device",
] as const;

export const securityEventTypeSchema = z.enum(securityEventTypes);

/** One entry in the security history. Never contains passwords, tokens or browsing. */
export const securityEventSchema = z.object({
  id: z.uuid(),
  type: securityEventTypeSchema,
  occurredAt: z.iso.datetime(),
  /** Such as "Chrome on Windows"; null when unknown. */
  device: z.string().nullable(),
  ipAddress: z.string().nullable(),
  /** Allow-listed facts about the event. */
  details: z.object({
    method: z.string().optional(),
    persistent: z.boolean().optional(),
    reason: z.string().optional(),
    count: z.number().int().nonnegative().optional(),
    /** For files from the cloud browser: "download" or "print". */
    kind: z.string().optional(),
  }),
});

export const securityEventPageSchema = z.object({
  events: z.array(securityEventSchema),
  /** Pass as `before` to get the next, older page; null on the last page. */
  nextCursor: z.uuid().nullable(),
});

export const securityEventQuerySchema = z.object({
  before: z.uuid({ error: "before must be an event ID." }).optional(),
  limit: z.coerce
    .number({ error: "limit must be a number." })
    .int()
    .min(1, "limit must be between 1 and 50.")
    .max(50, "limit must be between 1 and 50.")
    .default(20),
});

export type SecurityEventType = z.infer<typeof securityEventTypeSchema>;
export type SecurityEvent = z.infer<typeof securityEventSchema>;
export type SecurityEventPage = z.infer<typeof securityEventPageSchema>;
