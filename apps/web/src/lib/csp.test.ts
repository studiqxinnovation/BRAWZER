import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateNonce, needsStrictCsp, strictContentSecurityPolicy } from "./csp";
import { themeBootstrapScript } from "./theme";

const scriptSrc = (policy: string) =>
  policy.split("; ").find((directive) => directive.startsWith("script-src ")) ?? "";

describe("strict content security policy", () => {
  it("applies to account pages and the signed-in app only", () => {
    for (const path of [
      "/app",
      "/app/sessions",
      "/sign-in",
      "/verify-email",
      "/reset-password",
      "/confirm-email-change",
    ]) {
      expect(needsStrictCsp(path), path).toBe(true);
    }
    for (const path of ["/", "/apple-icon", "/application", "/security", "/sign-input"]) {
      expect(needsStrictCsp(path), path).toBe(false);
    }
  });

  it("allows scripts only by nonce, by strict-dynamic, or the theme script's hash", () => {
    const policy = strictContentSecurityPolicy("abc123", { development: false, https: true });
    const scripts = scriptSrc(policy);
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    const hash = createHash("sha256").update(themeBootstrapScript).digest("base64");
    expect(scripts).toContain(`'sha256-${hash}'`);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("relaxes only what the development server needs", () => {
    const policy = strictContentSecurityPolicy("abc123", { development: true, https: false });
    expect(scriptSrc(policy)).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws: wss:");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("uses a fresh, unguessable nonce each time", () => {
    const nonces = new Set(Array.from({ length: 20 }, generateNonce));
    expect(nonces.size).toBe(20);
    for (const nonce of nonces) expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });
});
