import { randomUUID } from "node:crypto";
import { createDatabase, type DatabaseHandle } from "@brawzer/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.factory.js";
import { hashPassword } from "../src/auth/password.js";
import { loadLocalEnvFile, parseConfig } from "../src/config/env.js";

// The API as it runs in production: HTTPS origin, Secure __Host- cookie,
// HSTS, no API docs, no dependency details. Uses the local services; sends no
// email (accounts are created directly in the database).
loadLocalEnvFile();
const ORIGIN = "https://brawzer.example";
const config = parseConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  NODE_ENV: "production",
  WEB_ORIGIN: ORIGIN,
  EMAIL_TRANSPORT: "resend",
  RESEND_API_KEY: "re_test_not_a_real_key",
  BREACHED_PASSWORD_CHECK: "false",
  // The local OpenBao from `pnpm infra:up` stands in for the production key service.
  KEY_PROVIDER: "vault",
  VAULT_ADDR: process.env.VAULT_ADDR,
  VAULT_TOKEN: process.env.VAULT_TOKEN,
  PROXY_TEST_URL: "https://echo.brawzer.example/ip",
  BROWSER_STREAM_URL: "wss://brawzer.example",
});

let app: NestFastifyApplication;
let database: DatabaseHandle;
let ipCount = 0;

beforeAll(async () => {
  database = createDatabase({ url: config.databaseUrl, applicationName: "brawzer-api-tests" });
  app = await createApp(config, { logger: pino({ level: "silent" }) });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

async function confirmedAccount(password: string): Promise<string> {
  const email = `production-${randomUUID().slice(0, 8)}@example.com`;
  await database.pool.query(
    `insert into users (email, email_verified_at, password_hash) values ($1, now(), $2)`,
    [email, await hashPassword(password)],
  );
  return email;
}

function post(url: string, payload?: object, cookie?: string) {
  ipCount += 1;
  return app.inject({
    method: "POST",
    url,
    remoteAddress: `203.0.113.${String(ipCount)}`,
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    ...(payload ? { payload } : {}),
  });
}

describe("production configuration", () => {
  it("sets a Secure, host-only __Host- session cookie and clears every cookie on sign-out", async () => {
    const email = await confirmedAccount("violet-harbor-lantern");
    const signIn = await post("/api/v1/auth/login", { email, password: "violet-harbor-lantern" });
    expect(signIn.statusCode).toBe(200);
    const cookie = signIn.cookies.find((entry) => entry.name === "__Host-brawzer_session");
    expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax", path: "/" });
    expect(cookie?.domain).toBeUndefined();
    expect(signIn.cookies.find((entry) => entry.name === "brawzer_session")).toBeUndefined();

    const signOut = await post(
      "/api/v1/auth/logout",
      undefined,
      `__Host-brawzer_session=${cookie?.value ?? ""}`,
    );
    expect(signOut.statusCode).toBe(204);
    expect(signOut.headers["clear-site-data"]).toBe('"cache", "cookies", "storage"');
  });

  it("only accepts state-changing requests from the HTTPS site", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { origin: "http://brawzer.example" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("sends HSTS and hides API docs and dependency details", async () => {
    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(health.headers["strict-transport-security"]).toMatch(/max-age=63072000/);
    expect(health.json()).not.toHaveProperty("checks");
    expect((await app.inject({ method: "GET", url: "/api/docs" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/docs/openapi.json" })).statusCode).toBe(
      404,
    );
  });

  it("checks passwords against breaches by default", () => {
    const defaults = parseConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      NODE_ENV: "production",
      WEB_ORIGIN: ORIGIN,
      EMAIL_TRANSPORT: "resend",
      RESEND_API_KEY: "re_test_not_a_real_key",
      KEY_PROVIDER: "vault",
      VAULT_ADDR: process.env.VAULT_ADDR,
      VAULT_TOKEN: process.env.VAULT_TOKEN,
      PROXY_TEST_URL: "https://echo.brawzer.example/ip",
      BROWSER_STREAM_URL: "wss://brawzer.example",
    });
    expect(defaults.breachedPasswordCheck).toBe(true);
    expect(defaults.rateLimitScale).toBe(1);
  });
});
