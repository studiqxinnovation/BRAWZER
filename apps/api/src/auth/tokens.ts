import { createHash, randomBytes } from "node:crypto";

/** The shape of every token Brawzer issues: 32 random bytes, base64url (43 characters). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new session or email-link token with 256 bits of randomness. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Only this hash is stored. Tokens are random and long, so a plain SHA-256
 * makes a leaked database useless for signing in. Passwords, which people
 * choose, need a slow hash instead (see password.ts).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Rejects malformed values before they reach the database. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
