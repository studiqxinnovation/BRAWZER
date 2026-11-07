import { describe, expect, it } from "vitest";
import {
  emailLinkTokenSchema,
  emailSchema,
  loginRequestSchema,
  newPasswordSchema,
  registerRequestSchema,
  sessionCookieName,
} from "./auth.ts";

describe("emailSchema", () => {
  it("normalises case and surrounding spaces", () => {
    expect(emailSchema.parse("  Ana.Silva@Example.COM ")).toBe("ana.silva@example.com");
  });

  it("rejects things that are not email addresses", () => {
    for (const value of ["", "ana", "ana@", "@example.com", "ana silva@example.com"]) {
      expect(emailSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("rejects absurdly long addresses", () => {
    expect(emailSchema.safeParse(`${"a".repeat(250)}@example.com`).success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  it("requires 10 to 128 characters", () => {
    expect(newPasswordSchema.safeParse("short").success).toBe(false);
    expect(newPasswordSchema.safeParse("long enough pass").success).toBe(true);
    expect(newPasswordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("explains the rule in plain words", () => {
    const result = newPasswordSchema.safeParse("short");
    expect(result.error?.issues[0]?.message).toBe("Use at least 10 characters.");
  });
});

describe("loginRequestSchema", () => {
  it("defaults to shared-computer mode", () => {
    const parsed = loginRequestSchema.parse({ email: "a@example.com", password: "x" });
    expect(parsed.keepSignedIn).toBe(false);
  });
});

describe("registerRequestSchema", () => {
  it("strips unexpected fields", () => {
    const parsed = registerRequestSchema.parse({
      email: "a@example.com",
      password: "long enough pass",
      isAdmin: true,
    });
    expect(parsed).not.toHaveProperty("isAdmin");
  });
});

describe("emailLinkTokenSchema", () => {
  it("accepts 43-character base64url tokens only", () => {
    expect(emailLinkTokenSchema.safeParse("A".repeat(43)).success).toBe(true);
    expect(emailLinkTokenSchema.safeParse("A".repeat(42)).success).toBe(false);
    expect(emailLinkTokenSchema.safeParse(`${"A".repeat(42)}=`).success).toBe(false);
  });
});

describe("sessionCookieName", () => {
  it("uses the __Host- prefix only over HTTPS", () => {
    expect(sessionCookieName(true)).toBe("__Host-brawzer_session");
    expect(sessionCookieName(false)).toBe("brawzer_session");
  });
});
