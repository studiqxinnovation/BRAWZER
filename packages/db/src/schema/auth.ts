import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** Time-ordered UUIDs (PostgreSQL 18's built-in uuidv7) keep indexes compact. */
const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);
const timestamptz = () => timestamp({ withTimezone: true });

export const users = pgTable("users", {
  id: id(),
  /** Stored trimmed and lower-cased; unique. */
  email: text().notNull().unique("users_email_unique"),
  emailVerifiedAt: timestamptz(),
  /** argon2id hash. Nullable for future passkey-only accounts. */
  passwordHash: text(),
  /**
   * Random WebAuthn user handle (base64url), created with the first passkey.
   * Passkeys store this instead of the email address or database ID.
   */
  webauthnUserId: text().unique("users_webauthn_user_id_unique"),
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz().notNull().defaultNow(),
});

/**
 * One row per signed-in device. Only a SHA-256 hash of the session token is
 * stored, so a database leak does not reveal usable session cookies.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique("auth_sessions_token_hash_unique"),
    /**
     * Set when the token is rotated. The previous token keeps working for a
     * few seconds so requests already in flight don't sign the person out.
     */
    previousTokenHash: text(),
    rotatedAt: timestamptz(),
    /** "Keep me signed in" was chosen; otherwise shared-computer rules apply. */
    persistent: boolean().notNull().default(false),
    /** How this session signed in: password, password_totp, passkey, phone, sign_up_link. */
    authMethod: text().notNull().default("password"),
    /** When the owner last proved who they are; sensitive actions need this to be recent. */
    reauthenticatedAt: timestamptz().notNull().defaultNow(),
    userAgent: text(),
    ipAddress: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    lastSeenAt: timestamptz().notNull().defaultNow(),
    /** Absolute expiry; idle expiry is derived from lastSeenAt. */
    expiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    revokedReason: text(),
  },
  (table) => [
    index("auth_sessions_user_id_idx").on(table.userId),
    index("auth_sessions_previous_token_hash_idx").on(table.previousTokenHash),
  ],
);

export const emailTokenPurpose = pgEnum("email_token_purpose", [
  "verify_email",
  "reset_password",
  "change_email",
]);

/** Single-use links sent by email. Only the token's hash is stored. */
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: emailTokenPurpose().notNull(),
    tokenHash: text().notNull().unique("email_tokens_token_hash_unique"),
    /**
     * Sign-up only: the argon2id hash of the password chosen with this link.
     * It becomes the account's password only when the person who opens the
     * link enters that same password, which defeats account pre-hijacking.
     */
    pendingPasswordHash: text(),
    /** Email change only: the new address this link confirms. */
    newEmail: text(),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("email_tokens_user_id_idx").on(table.userId)],
);

export const securityEventType = pgEnum("security_event_type", [
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
  "data.exported",
  "profile.created",
  "profile.deleted",
  "proxy.created",
  "proxy.updated",
  "proxy.deleted",
  "phone_sign_in.approved",
  "sign_in.new_device",
]);

/**
 * Account security history: sign-ins, sign-outs, resets. Never contains
 * browsing activity, passwords or tokens.
 */
export const securityEvents = pgTable(
  "security_events",
  {
    id: id(),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    type: securityEventType().notNull(),
    sessionId: uuid(),
    ipAddress: text(),
    userAgent: text(),
    metadata: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
    occurredAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("security_events_user_occurred_idx").on(table.userId, table.occurredAt)],
);

/** Passkeys. Only public keys are stored; private keys never leave the authenticator. */
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The authenticator's credential ID, base64url. */
    credentialId: text().notNull().unique("webauthn_credentials_credential_id_unique"),
    /** COSE public key, base64url. */
    publicKey: text().notNull(),
    /** Signature counter, to notice cloned authenticators (0 for most synced passkeys). */
    counter: bigint({ mode: "number" }).notNull().default(0),
    transports: jsonb().$type<string[]>().notNull().default([]),
    /** "multiDevice" for synced passkeys, "singleDevice" for device-bound ones. */
    deviceType: text().notNull(),
    backedUp: boolean().notNull().default(false),
    /** Authenticator model identifier, when reported. */
    aaguid: text(),
    /** The owner's label, such as "iPhone". */
    name: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    lastUsedAt: timestamptz(),
  },
  (table) => [index("webauthn_credentials_user_id_idx").on(table.userId)],
);

/**
 * Browser-and-network combinations an account has signed in from, to notice
 * sign-ins from somewhere new. Only a hash is kept; rows expire after 90 days.
 */
export const knownDevices = pgTable(
  "known_devices",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of browser family, operating system and network prefix. */
    deviceKey: text().notNull(),
    firstSeenAt: timestamptz().notNull().defaultNow(),
    lastSeenAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [unique("known_devices_user_device_unique").on(table.userId, table.deviceKey)],
);

/** Authenticator-app two-factor authentication. One factor per account. */
export const totpFactors = pgTable("totp_factors", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** The TOTP secret, sealed with envelope encryption (context `totp:<user id>`). */
  secret: text().notNull(),
  /** Null while setup isn't finished; two-factor is on once confirmed with a first code. */
  confirmedAt: timestamptz(),
  /** Last accepted 30-second time step: codes at or before it are refused (no replays). */
  lastTimeStep: bigint({ mode: "number" }).notNull().default(0),
  createdAt: timestamptz().notNull().defaultNow(),
});

/** Single-use recovery codes, stored as SHA-256 hashes. */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text().notNull(),
    usedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("recovery_codes_user_id_idx").on(table.userId)],
);

export const authChallengePurpose = pgEnum("auth_challenge_purpose", [
  "passkey_registration",
  "passkey_authentication",
  "mfa",
  "phone_approval",
]);

/**
 * Short-lived, single-use steps of a sign-in or confirmation: passkey
 * challenges, two-factor tickets, phone approvals. Removed by the retention
 * job once expired.
 */
export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: id(),
    purpose: authChallengePurpose().notNull(),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid(),
    /** Random value the client must prove it holds (for passkeys, the WebAuthn challenge). */
    challenge: text().notNull(),
    /** Purpose-specific facts, never secrets in plain text. */
    data: jsonb().$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    attempts: integer().notNull().default(0),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("auth_challenges_expires_idx").on(table.expiresAt)],
);

export type User = typeof users.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
export type EmailToken = typeof emailTokens.$inferSelect;
export type SecurityEventType = (typeof securityEventType.enumValues)[number];
export type EmailTokenPurpose = (typeof emailTokenPurpose.enumValues)[number];
export type AuthChallenge = typeof authChallenges.$inferSelect;
export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
export type TotpFactor = typeof totpFactors.$inferSelect;
export type AuthChallengePurpose = (typeof authChallengePurpose.enumValues)[number];
