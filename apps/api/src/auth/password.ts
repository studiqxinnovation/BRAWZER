import { hash, parseOptions, verify } from "@node-rs/argon2";
import { ApiException } from "../common/api-exception.js";
import { generateToken } from "./tokens.js";

/**
 * argon2id with OWASP's recommended minimum: 19 MiB of memory, 2 passes,
 * 1 lane. The library's default algorithm is argon2id (its `Algorithm`
 * const enum cannot be referenced under isolatedModules).
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** False for a wrong password and for a malformed stored hash. */
export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** True when a stored hash predates the current parameters and should be upgraded. */
export function needsRehash(hashed: string): boolean {
  try {
    const options = parseOptions(hashed);
    return (
      !hashed.startsWith("$argon2id$") ||
      options.memoryCost < ARGON2_OPTIONS.memoryCost ||
      options.timeCost < ARGON2_OPTIONS.timeCost ||
      options.outputLen < ARGON2_OPTIONS.outputLen
    );
  } catch {
    return true;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Does the work of a real password check when there is no account to check
 * against, so response times don't reveal which emails have accounts.
 */
export async function burnPasswordCheck(password: string): Promise<false> {
  dummyHash ??= hashPassword(generateToken());
  await verifyPassword(await dummyHash, password);
  return false;
}

/**
 * Passwords that meet the length rule but appear near the top of every
 * breached-password list. A full breached-password check (for example the
 * k-anonymity Pwned Passwords API) is planned; see docs/SECURITY.md.
 */
const COMMON_PASSWORDS = new Set([
  "0123456789",
  "1234567890",
  "12345678910",
  "123456789a",
  "a123456789",
  "1234567890a",
  "1q2w3e4r5t",
  "1q2w3e4r5t6y",
  "1qaz2wsx3edc",
  "1qazxsw23edc",
  "zaq12wsxcde",
  "qazwsxedc123",
  "qwertyuiop",
  "qwerty1234",
  "qwerty12345",
  "qwerty123456",
  "asdfghjkl1",
  "asdfghjkl123",
  "zxcvbnm123",
  "abcdefghij",
  "abc1234567",
  "abcd123456",
  "password12",
  "password123",
  "password1234",
  "password12345",
  "password!!",
  "password1!",
  "passw0rd123",
  "p@ssw0rd123",
  "p@ssword123",
  "iloveyou12",
  "iloveyou123",
  "letmein123",
  "welcome123",
  "welcome1234",
  "changeme123",
  "administrator",
  "admin12345",
  "football12",
  "football123",
  "baseball12",
  "princess12",
  "sunshine12",
  "superman12",
  "trustno1234",
  "monkey1234",
  "dragon1234",
  "starwars12",
  "123123123a",
  "1234512345",
  "1122334455",
]);

function isSequence(value: string): boolean {
  if (value.length < 2) return false;
  const step = value.charCodeAt(1) - value.charCodeAt(0);
  if (Math.abs(step) !== 1) return false;
  for (let index = 2; index < value.length; index += 1) {
    if (value.charCodeAt(index) - value.charCodeAt(index - 1) !== step) return false;
  }
  return true;
}

/** Explains why a new password would be easy to guess, or returns null when it is acceptable. */
export function passwordProblem(password: string, email: string): string | null {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower))
    return "That password is too common. Choose something harder to guess.";
  if (/^(.)\1+$/u.test(password)) return "Don’t use one character repeated.";
  if (isSequence(lower)) return "Avoid simple sequences like 1234567890.";
  if (lower === email) return "Don’t use your email address as your password.";
  const localPart = email.split("@")[0] ?? "";
  if (localPart.length >= 4 && lower.includes(localPart)) {
    return "Don’t include your email address in your password.";
  }
  if (/^[\d\W_]*brawzer[\d\W_]*$/u.test(lower))
    return "Don’t build your password around the word Brawzer.";
  return null;
}

/** Throws a validation error, in the same shape as schema failures, for a guessable password. */
export function assertAcceptablePassword(password: string, email: string): void {
  const problem = passwordProblem(password, email);
  if (problem) {
    throw new ApiException("validation_failed", 400, "Choose a stronger password.", {
      details: [`password: ${problem}`],
    });
  }
}
