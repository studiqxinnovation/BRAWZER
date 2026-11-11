import { z } from "zod";

/** Stable, machine-readable error codes returned by every Brawzer API. */
export const apiErrorCodeSchema = z.enum([
  "bad_request",
  "validation_failed",
  "unauthorized",
  "invalid_credentials",
  "email_not_verified",
  "token_invalid",
  "reauthentication_required",
  /** The session is locked (423): only unlocking or signing out works until it's unlocked. */
  "session_locked",
  "forbidden",
  "not_found",
  "method_not_allowed",
  "conflict",
  "limit_reached",
  "payload_too_large",
  "unsupported_media_type",
  "rate_limited",
  "service_unavailable",
  "internal_error",
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/**
 * The single error shape every endpoint returns.
 *
 * Messages are written for people and never include stack traces, SQL, file
 * paths or other internals. `requestId` lets support correlate a report with
 * server logs without the user having to share anything else.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    details: z.array(z.string()).optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
