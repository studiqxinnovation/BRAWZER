import { z } from "zod";
import { currentSessionResponseSchema } from "./auth.ts";

export const totpCodeSchema = z
  .string({ error: "Enter the 6-digit code from your authenticator app." })
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

/** Instead of a session: the password was right, now a second step is needed. */
export const mfaChallengeSchema = z.object({
  mfaRequired: z.literal(true),
  /** Single use, valid for 5 minutes, accepts at most 5 wrong codes. */
  ticket: z.string(),
  expiresAt: z.iso.datetime(),
});

/** Password sign-in returns either a session or a two-factor challenge. */
export const loginResponseSchema = z.union([currentSessionResponseSchema, mfaChallengeSchema]);

export const mfaVerifyRequestSchema = z.object({
  ticket: z.string({ error: "Sign in again." }).min(1, "Sign in again.").max(200),
  /** A 6-digit authenticator code or a recovery code. */
  code: z.string({ error: "Enter a code." }).trim().min(1, "Enter a code.").max(40),
});

export const totpSetupResponseSchema = z.object({
  /** For typing into the authenticator app instead of scanning. */
  secret: z.string(),
  uri: z.string(),
  /** The QR code as an SVG document. */
  qrSvg: z.string(),
});

export const totpConfirmRequestSchema = z.object({ code: totpCodeSchema });

export const recoveryCodesResponseSchema = z.object({ recoveryCodes: z.array(z.string()) });

export const mfaStatusSchema = z.object({
  totpEnabled: z.boolean(),
  enabledAt: z.iso.datetime().nullable(),
  recoveryCodesRemaining: z.number().int().nonnegative(),
});

export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type TotpSetupResponse = z.infer<typeof totpSetupResponseSchema>;
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponseSchema>;
export type MfaStatus = z.infer<typeof mfaStatusSchema>;
