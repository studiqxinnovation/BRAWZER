import { z } from "zod";
import { accountRoleSchema } from "./staff.ts";

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

/** The optional emails a person may turn off; security and billing emails are always sent. */
export const emailCategories = ["usageNotices", "teamUpdates"] as const;
export const emailCategorySchema = z.enum(emailCategories);
export type EmailCategory = z.infer<typeof emailCategorySchema>;
export const emailPreferencesSchema = z.object({
  usageNotices: z.boolean(),
  teamUpdates: z.boolean(),
});
export type EmailPreferences = z.infer<typeof emailPreferencesSchema>;
/** Why email to the account's address stopped: the provider reported a bounce or a spam complaint. */
export const emailDeliveryProblemSchema = z.enum(["bounced", "complained"]);

export const accountSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  /** Administrators see the Admin page. */
  role: accountRoleSchema,
  /** The plan the account is on (Phase 6). */
  planCode: z.string(),
  createdAt: z.iso.datetime(),
});

/** GET /account/email: what the account's address receives, and whether it can be reached. */
export const accountEmailSchema = z.object({
  preferences: emailPreferencesSchema,
  /** Set while nothing can be delivered to the address; null when email works. */
  deliveryProblem: emailDeliveryProblemSchema.nullable(),
});
export type AccountEmail = z.infer<typeof accountEmailSchema>;

export const updateEmailPreferencesRequestSchema = emailPreferencesSchema.partial();
export type UpdateEmailPreferencesRequest = z.infer<typeof updateEmailPreferencesRequestSchema>;

/** One click from an email's footer; the token says which account and which emails. */
export const unsubscribeRequestSchema = z.object({ token: z.string().min(20).max(128) });
export const unsubscribeResponseSchema = z.object({
  category: emailCategorySchema,
  /** Masked, for the page to say whose preference changed. */
  email: z.string(),
});
export type UnsubscribeResponse = z.infer<typeof unsubscribeResponseSchema>;

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
  /**
   * Locked from the desktop: until the owner confirms it's them, the API
   * answers nothing but unlocking and signing out, and no browser streams.
   */
  locked: z.boolean(),
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
  /** Required when two-factor authentication is on. */
  code: z.string().trim().max(40).optional(),
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

// ── Sign in with your phone (milestone 2.7) ───────────────────────────────

/** How long a computer's request waits for the phone. */
export const PHONE_SIGN_IN_SECONDS = 120;

const phoneTokenSchema = z.string().min(20).max(128);
const phoneCodeSchema = z.string().regex(/^[1-9][0-9]$/, "A two-digit number.");

/** What the computer shows: the QR code (as SVG), the number to match, and how to poll. */
export const phoneSignInStartResponseSchema = z.object({
  requestId: z.uuid(),
  pollToken: phoneTokenSchema,
  code: phoneCodeSchema,
  expiresAt: z.iso.datetime(),
  qrSvg: z.string(),
  /** What the QR code encodes; shown nowhere, but tests read it from the page. */
  approvalUrl: z.url(),
});

export const phoneSignInPollRequestSchema = z.object({ pollToken: phoneTokenSchema });

export const phoneSignInStates = ["pending", "approved", "denied", "expired"] as const;

export const phoneSignInPollResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }),
  z.object({ state: z.literal("denied") }),
  z.object({ state: z.literal("expired") }),
  z.object({ state: z.literal("approved"), account: accountSchema, session: sessionInfoSchema }),
]);

/** What the phone sees before approving: where the request came from, and the numbers to choose from. */
export const phoneApprovalSchema = z.object({
  requestId: z.uuid(),
  state: z.enum(phoneSignInStates),
  device: z.string().nullable(),
  ipAddress: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  /** The computer's number and two decoys, in a fixed order. */
  codes: z.array(phoneCodeSchema).length(3),
});

export const phoneApproveRequestSchema = z.object({
  key: phoneTokenSchema,
  code: phoneCodeSchema,
});

export const phoneDenyRequestSchema = z.object({ key: phoneTokenSchema });

export type PhoneSignInStart = z.infer<typeof phoneSignInStartResponseSchema>;
export type PhoneSignInPoll = z.infer<typeof phoneSignInPollResponseSchema>;
export type PhoneApproval = z.infer<typeof phoneApprovalSchema>;
export type PhoneSignInState = (typeof phoneSignInStates)[number];
