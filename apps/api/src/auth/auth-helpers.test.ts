import { describe, expect, it } from "vitest";
import { ApiException } from "../common/api-exception.js";
import {
  assertAcceptablePassword,
  burnPasswordCheck,
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
} from "./password.js";
import {
  KEEP_SIGNED_IN_SESSION,
  SHARED_COMPUTER_SESSION,
  sessionLifetime,
} from "./session-policy.js";
import { generateToken, hashToken, isWellFormedToken } from "./tokens.js";
import { describeUserAgent } from "./user-agent.js";

describe("tokens", () => {
  it("generates 43-character URL-safe tokens that are all different", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(isWellFormedToken(token)).toBe(true);
  });

  it("hashes deterministically to hex and never returns the token itself", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it("rejects malformed tokens before any lookup", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "short",
      `${generateToken()}x`,
      "a".repeat(42) + "!",
    ]) {
      expect(isWellFormedToken(value)).toBe(false);
    }
  });
});

describe("passwords", () => {
  it("hashes with argon2id and verifies only the right password", async () => {
    const hashed = await hashPassword("violet-harbor-lantern");
    expect(hashed.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(await verifyPassword(hashed, "violet-harbor-lantern")).toBe(true);
    expect(await verifyPassword(hashed, "violet-harbor-lantern ")).toBe(false);
  });

  it("treats a malformed stored hash as a failed check, not a crash", async () => {
    expect(await verifyPassword("not-a-hash", "anything-at-all")).toBe(false);
  });

  it("asks for a rehash only when parameters are weaker than today's", async () => {
    expect(needsRehash(await hashPassword("violet-harbor-lantern"))).toBe(false);
    expect(
      needsRehash(
        "$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA",
      ),
    ).toBe(true);
    expect(needsRehash("garbage")).toBe(true);
  });

  it("does a full check even when there is no account", async () => {
    await expect(burnPasswordCheck("whatever-password")).resolves.toBe(false);
  });

  it.each([
    ["password1234", "too common"],
    ["QWERTYUIOP", "too common"],
    ["aaaaaaaaaaaa", "repeated"],
    ["abcdefghijkl", "sequences"],
    ["9876543210", "sequences"],
    ["ana.lopez@example.com", "as your password"],
    ["my-ana.lopez-2026", "include your email"],
    ["brawzer2026!", "Brawzer"],
  ])("rejects %s (%s)", (password, reason) => {
    expect(passwordProblem(password, "ana.lopez@example.com")).toContain(reason);
  });

  it("accepts a long, unrelated passphrase", () => {
    expect(passwordProblem("violet-harbor-lantern", "ana.lopez@example.com")).toBeNull();
    expect(passwordProblem("brawzer harbor violet", "ana.lopez@example.com")).toBeNull();
  });

  it("does not match very short email names inside passwords", () => {
    expect(passwordProblem("bobcat-harbor-lantern", "bob@example.com")).toBeNull();
  });

  it("reports problems in the same shape as schema validation", () => {
    try {
      assertAcceptablePassword("password1234", "ana@example.com");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      const exception = error as ApiException;
      expect(exception.code).toBe("validation_failed");
      expect(exception.getStatus()).toBe(400);
      expect(exception.details?.[0]).toMatch(/^password: /);
    }
  });
});

describe("session policy", () => {
  it("defaults to the shared-computer lifetime", () => {
    expect(sessionLifetime(false)).toBe(SHARED_COMPUTER_SESSION);
    expect(SHARED_COMPUTER_SESSION).toEqual({ idleSeconds: 1800, absoluteSeconds: 43_200 });
  });

  it("keeps a chosen device signed in for at most 30 days", () => {
    expect(sessionLifetime(true)).toBe(KEEP_SIGNED_IN_SESSION);
    expect(KEEP_SIGNED_IN_SESSION.absoluteSeconds).toBe(30 * 24 * 60 * 60);
  });
});

describe("describeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "Chrome on Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
      "Microsoft Edge on Windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
      "Safari on macOS",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0", "Firefox on Linux"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "Chrome on ChromeOS",
    ],
  ])("describes %s", (userAgent, expected) => {
    expect(describeUserAgent(userAgent)).toBe(expected);
  });

  it("returns null when there is nothing to describe", () => {
    expect(describeUserAgent(null)).toBeNull();
    expect(describeUserAgent("curl/8.9.1")).toBeNull();
  });
});
