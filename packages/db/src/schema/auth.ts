import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const emailTokenPurpose = pgEnum("email_token_purpose", ["verify_email", "reset_password"]);

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

export type User = typeof users.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
export type EmailToken = typeof emailTokens.$inferSelect;
export type SecurityEventType = (typeof securityEventType.enumValues)[number];
export type EmailTokenPurpose = (typeof emailTokenPurpose.enumValues)[number];
