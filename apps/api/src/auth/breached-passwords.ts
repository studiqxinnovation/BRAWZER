import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";

const RANGE_API = "https://api.pwnedpasswords.com/range/";
const logger = new Logger("BreachedPasswords");

/**
 * Whether `suffix` appears in a Pwned Passwords range response with a count
 * above zero. Padding lines, which hide the response size, have a count of 0.
 */
export function suffixInRange(body: string, suffix: string): boolean {
  for (const line of body.split(/\r?\n/)) {
    const [candidate = "", count = "0"] = line.trim().split(":");
    if (candidate.toUpperCase() === suffix && Number(count) > 0) return true;
  }
  return false;
}

/**
 * Refuses passwords that appear in known data breaches, using the Pwned
 * Passwords range API with k-anonymity: only the first 5 characters of the
 * password's SHA-1 hash leave Brawzer, never the password or its full hash,
 * and padded responses keep the answer's size from revealing anything. If the
 * service can't be reached, the check is skipped (and logged) rather than
 * blocking sign-up.
 */
@Injectable()
export class BreachedPasswordCheck {
  constructor(
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, "breachedPasswordCheck">,
  ) {}

  async isBreached(password: string): Promise<boolean> {
    if (!this.config.breachedPasswordCheck) return false;
    // SHA-1 because the API is indexed by it; this hash is never stored.
    const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    try {
      const response = await fetch(`${RANGE_API}${hash.slice(0, 5)}`, {
        headers: { "Add-Padding": "true", "User-Agent": "Brawzer-password-check" },
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new Error(`responded ${String(response.status)}`);
      return suffixInRange(await response.text(), hash.slice(5));
    } catch (error) {
      logger.warn(
        `Breached-password check skipped: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return false;
    }
  }

  /** Throws the same field-level validation error as the other password rules. */
  async assertNotBreached(password: string, field = "password"): Promise<void> {
    if (await this.isBreached(password)) {
      throw new ApiException("validation_failed", 400, "Choose a different password.", {
        details: [
          `${field}: This password has appeared in a data breach, so attackers try it. Choose a different one.`,
        ],
      });
    }
  }
}
