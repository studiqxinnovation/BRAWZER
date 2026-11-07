import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, findInWorkspace, parseConfig } from "./env.js";

const minimal = {
  DATABASE_URL: "postgres://brawzer:local@127.0.0.1:5433/brawzer",
  REDIS_URL: "redis://127.0.0.1:6380",
};

const production = {
  ...minimal,
  NODE_ENV: "production",
  WEB_ORIGIN: "https://brawzer.example",
  EMAIL_TRANSPORT: "resend",
  RESEND_API_KEY: "re_not_a_real_key",
};

function issuesOf(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    parseConfig(env, "1.2.3");
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected parseConfig to throw");
}

describe("parseConfig", () => {
  it("applies local development defaults", () => {
    const config = parseConfig(minimal, "1.2.3");
    expect(config).toMatchObject({
      env: "development",
      isProduction: false,
      version: "1.2.3",
      apiHost: "127.0.0.1",
      apiPort: 4100,
      webOrigin: "http://localhost:3100",
      logLevel: "info",
      logFormat: "json",
      apiDocsEnabled: true,
      trustProxy: false,
    });
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(parseConfig(minimal, "1.2.3"))).toBe(true);
  });

  it("turns API docs off in production unless explicitly enabled", () => {
    expect(parseConfig(production, "1").apiDocsEnabled).toBe(false);
    expect(parseConfig({ ...production, API_DOCS_ENABLED: "true" }, "1").apiDocsEnabled).toBe(true);
  });

  it("appends a short build SHA to the version", () => {
    const config = parseConfig({ ...minimal, BUILD_SHA: "0123456789abcdef0123" }, "1.2.3");
    expect(config.version).toBe("1.2.3+0123456789ab");
  });

  it("reports every missing required variable", () => {
    expect(issuesOf({})).toEqual(["DATABASE_URL: is required", "REDIS_URL: is required"]);
  });

  it("rejects URLs with the wrong protocol", () => {
    expect(issuesOf({ ...minimal, DATABASE_URL: "mysql://user:pw@db/app" })).toEqual([
      "DATABASE_URL: must be a postgres:// URL",
    ]);
  });

  it("never echoes the offending value, which may contain a password", () => {
    const secret = "correct-horse-battery-staple";
    const issues = issuesOf({ ...minimal, DATABASE_URL: `mysql://admin:${secret}@db/app` });
    expect(issues.join("\n")).not.toContain(secret);
  });

  it("rejects an out-of-range port", () => {
    expect(issuesOf({ ...minimal, API_PORT: "70000" })[0]).toMatch(/^API_PORT:/);
  });

  it("parses boolean flags strictly", () => {
    expect(parseConfig({ ...minimal, TRUST_PROXY: "true" }, "1").trustProxy).toBe(true);
    expect(issuesOf({ ...minimal, TRUST_PROXY: "maybe" })[0]).toMatch(/^TRUST_PROXY:/);
  });

  it("accepts a list of trusted proxy addresses", () => {
    expect(
      parseConfig({ ...minimal, TRUST_PROXY: "loopback, 10.0.0.0/8, 2001:db8::1" }, "1").trustProxy,
    ).toEqual(["loopback", "10.0.0.0/8", "2001:db8::1"]);
    expect(issuesOf({ ...minimal, TRUST_PROXY: "10.0.0.0/33" })[0]).toMatch(/^TRUST_PROXY:/);
    expect(issuesOf({ ...minimal, TRUST_PROXY: "proxy.internal" })[0]).toMatch(/^TRUST_PROXY:/);
  });

  it("allows the web origin plus any extra origins for state-changing requests", () => {
    expect(parseConfig(minimal, "1").allowedOrigins).toEqual(["http://localhost:3100"]);
    const config = parseConfig(
      { ...minimal, ALLOWED_ORIGINS: "http://127.0.0.1:3100, http://localhost:3100" },
      "1",
    );
    expect(config.allowedOrigins).toEqual(["http://localhost:3100", "http://127.0.0.1:3100"]);
    expect(issuesOf({ ...minimal, ALLOWED_ORIGINS: "http://localhost:3100/app" })).toEqual([
      "ALLOWED_ORIGINS: each entry must be an http(s) origin",
    ]);
  });

  it("uses Secure __Host- cookies whenever the site is served over HTTPS", () => {
    expect(parseConfig(minimal, "1").secureCookies).toBe(false);
    expect(
      parseConfig({ ...minimal, WEB_ORIGIN: "https://staging.brawzer.example" }, "1").secureCookies,
    ).toBe(true);
  });

  it("relaxes rate limits outside production only", () => {
    expect(parseConfig(minimal, "1").rateLimitScale).toBe(20);
    expect(parseConfig({ ...minimal, RATE_LIMIT_SCALE: "1" }, "1").rateLimitScale).toBe(1);
    expect(parseConfig({ ...production, RATE_LIMIT_SCALE: "50" }, "1").rateLimitScale).toBe(1);
  });

  it("requires HTTPS and a real email provider in production", () => {
    expect(issuesOf({ ...minimal, NODE_ENV: "production" })).toEqual([
      "WEB_ORIGIN: must use https in production",
      "EMAIL_TRANSPORT: must be resend in production",
    ]);
    expect(issuesOf({ ...production, RESEND_API_KEY: undefined })).toEqual([
      "RESEND_API_KEY: is required when EMAIL_TRANSPORT is resend",
    ]);
  });

  it("delivers email to Mailpit by default in development", () => {
    expect(parseConfig(minimal, "1").email).toEqual({
      transport: "mailpit",
      from: "Brawzer <no-reply@brawzer.localhost>",
      mailpitApiUrl: "http://127.0.0.1:8125",
      resendApiKey: undefined,
    });
  });
});

describe("findInWorkspace", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function workspace(): { root: string; app: string } {
    const root = mkdtempSync(path.join(tmpdir(), "brawzer-ws-"));
    roots.push(root);
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const app = path.join(root, "apps", "api");
    mkdirSync(app, { recursive: true });
    return { root, app };
  }

  it("finds the workspace-root .env from inside an app", () => {
    const { root, app } = workspace();
    writeFileSync(path.join(root, ".env"), "X=1\n");
    expect(findInWorkspace(app, ".env")).toBe(path.join(root, ".env"));
  });

  it("stops at the workspace root instead of reading files above it", () => {
    const { app } = workspace();
    expect(findInWorkspace(app, ".env")).toBeUndefined();
  });
});
