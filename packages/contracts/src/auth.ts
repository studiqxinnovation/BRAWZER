import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Emails are compared trimmed and lower-cased everywhere. */
export const emailSchema = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email({ error: "Enter a valid email address, like name@example.com." }));

/** Rules for choosing a password. Length matters most (NIST SP 800-63B). */
export const newPasswordSchema = z
  .string({ error: "Choose a password." })
  .min(PASSWORD_MIN_LENGTH, `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${String(PASSWORD_MAX_LENGTH)} characters.`);

/** Opaque single-use token from an email link: 32 random bytes, base64url. */
export const emailLinkTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "This link isn’t valid. Request a new one.");

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: "Enter your password." })
    .min(1, "Enter your password.")
    .max(PASSWORD_MAX_LENGTH, "Enter your password."),
  /** Off by default: shared-computer rules apply unless the person opts in. */
  keepSignedIn: z.boolean().default(false),
});

export const emailRequestSchema = z.object({ email: emailSchema });

/**
 * Confirming an email also proves knowledge of the password chosen at sign-up,
 * so a link alone (or an attacker who registered someone else's address) can
 * never activate an account. Success signs the person in.
 */
export const verifyEmailRequestSchema = z.object({
  token: emailLinkTokenSchema,
  password: z
    .string({ error: "Enter the password you chose." })
    .min(1, "Enter the password you chose.")
    .max(PASSWORD_MAX_LENGTH, "Enter the password you chose."),
  keepSignedIn: z.boolean().default(false),
});

export const resetPasswordRequestSchema = z.object({
  token: emailLinkTokenSchema,
  password: newPasswordSchema,
});

/** How a session signed in. */
export const authMethodSchema = z.enum([
  "password",
  "password_totp",
  "passkey",
  "phone",
  "sign_up_link",
]);

export const accountSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const sessionInfoSchema = z.object({
  id: z.uuid(),
  /** True when "Keep me signed in" was chosen. */
  persistent: z.boolean(),
  createdAt: z.iso.datetime(),
  /** When the session ends regardless of activity. */
  expiresAt: z.iso.datetime(),
  /** Minutes of inactivity after which the session ends. */
  idleTimeoutMinutes: z.number().int().positive(),
  authMethod: authMethodSchema,
});

export const currentSessionResponseSchema = z.object({
  account: accountSchema,
  session: sessionInfoSchema,
});

/** Responses that only confirm a request was accepted. */
export const messageResponseSchema = z.object({ message: z.string().min(1) });

export const changePasswordRequestSchema = z.object({
  currentPassword: z
    .string({ error: "Enter your current password." })
    .min(1, "Enter your current password.")
    .max(PASSWORD_MAX_LENGTH, "Enter your current password."),
  newPassword: newPasswordSchema,
});

/** Proves who you are again before a sensitive change. */
export const reauthenticateRequestSchema = z.object({
  password: z
    .string({ error: "Enter your password." })
    .min(1, "Enter your password.")
    .max(PASSWORD_MAX_LENGTH, "Enter your password."),
});

export const reauthenticateResponseSchema = z.object({
  /** Sensitive changes are allowed without asking again until this time. */
  confirmedUntil: z.iso.datetime(),
});

/** A device that is signed in to the account (one sign-in session). */
export const deviceSessionSchema = z.object({
  id: z.uuid(),
  /** The session making this request. */
  current: z.boolean(),
  persistent: z.boolean(),
  /** Such as "Chrome on Windows"; null when the browser didn't say. */
  device: z.string().nullable(),
  authMethod: authMethodSchema,
  ipAddress: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const deviceSessionListSchema = z.object({ sessions: z.array(deviceSessionSchema) });

export const revokeOtherSessionsResponseSchema = z.object({
  revoked: z.number().int().nonnegative(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.input<typeof loginRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type VerifyEmailRequest = z.input<typeof verifyEmailRequestSchema>;
export type Account = z.infer<typeof accountSchema>;
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
export type CurrentSessionResponse = z.infer<typeof currentSessionResponseSchema>;
export type MessageResponse = z.infer<typeof messageResponseSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type ReauthenticateRequest = z.infer<typeof reauthenticateRequestSchema>;
export type ReauthenticateResponse = z.infer<typeof reauthenticateResponseSchema>;
export type AuthMethod = z.infer<typeof authMethodSchema>;
export type DeviceSession = z.infer<typeof deviceSessionSchema>;
export type DeviceSessionList = z.infer<typeof deviceSessionListSchema>;
export type RevokeOtherSessionsResponse = z.infer<typeof revokeOtherSessionsResponseSchema>;

/**
 * Session cookie name. The __Host- prefix makes browsers refuse the cookie
 * unless it is Secure, host-only and scoped to "/", which needs HTTPS. Plain
 * http://localhost development uses an unprefixed name.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-brawzer_session" : "brawzer_session";
}
