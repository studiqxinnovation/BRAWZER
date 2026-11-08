import { healthResponseSchema } from "@brawzer/contracts";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/env.js";
import { HealthService, probe } from "./health.service.js";

const env = {
  DATABASE_URL: "postgres://u:p@127.0.0.1:5433/db",
  REDIS_URL: "redis://127.0.0.1:6380",
  ENCRYPTION_KEYS: `test-1:${"A".repeat(43)}=`,
};
const devConfig = parseConfig(env, "1.0.0");
const prodConfig = parseConfig(
  {
    ...env,
    NODE_ENV: "production",
    WEB_ORIGIN: "https://brawzer.example",
    EMAIL_TRANSPORT: "resend",
    RESEND_API_KEY: "re_not_a_real_key",
    KEY_PROVIDER: "vault",
    VAULT_ADDR: "https://vault.internal:8200",
    VAULT_TOKEN: "not-a-real-token",
    PROXY_TEST_URL: "https://echo.brawzer.example/ip",
    BROWSER_STREAM_URL: "wss://brawzer.example",
  },
  "1.0.0",
);

const databaseUp = { ping: () => Promise.resolve() };
const redisUp = { ping: () => Promise.resolve("PONG" as const) };
const down = { ping: () => Promise.reject(new Error("ECONNREFUSED")) };
const storeUp = { ping: () => Promise.resolve() };
const scannerUp = { ping: () => Promise.resolve() };
const runtimeUp = { ping: () => Promise.resolve() };

describe("probe", () => {
  it("reports latency when the check succeeds", async () => {
    const result = await probe(() => Promise.resolve());
    expect(result.status).toBe("up");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports down when the check fails", async () => {
    expect(await probe(() => Promise.reject(new Error("nope")))).toEqual({
      status: "down",
      latencyMs: null,
    });
  });

  it("reports down when the check exceeds its deadline", async () => {
    const hang = () => new Promise(() => undefined);
    expect(await probe(hang, 20)).toEqual({ status: "down", latencyMs: null });
  });
});

describe("HealthService", () => {
  it("is ok when every dependency responds", async () => {
    const report = await new HealthService(
      databaseUp,
      redisUp,
      devConfig,
      storeUp,
      scannerUp,
      runtimeUp,
    ).check();
    expect(report.status).toBe("ok");
    expect(report.checks?.database.status).toBe("up");
    expect(report.checks?.redis.status).toBe("up");
    expect(healthResponseSchema.safeParse(report).success).toBe(true);
  });

  it("is degraded when the database is unreachable", async () => {
    const report = await new HealthService(
      down,
      redisUp,
      devConfig,
      storeUp,
      scannerUp,
      runtimeUp,
    ).check();
    expect(report.status).toBe("degraded");
    expect(report.checks?.database).toEqual({ status: "down", latencyMs: null });
  });

  it("is degraded when Redis is unreachable", async () => {
    const report = await new HealthService(
      databaseUp,
      down,
      devConfig,
      storeUp,
      scannerUp,
      runtimeUp,
    ).check();
    expect(report.status).toBe("degraded");
    expect(report.checks?.redis.status).toBe("down");
  });

  it("omits dependency details in production", async () => {
    const report = await new HealthService(
      databaseUp,
      redisUp,
      prodConfig,
      storeUp,
      scannerUp,
      runtimeUp,
    ).check();
    expect(report).not.toHaveProperty("checks");
    expect(report.environment).toBe("production");
  });

  it("reports the object store and the scanner, and degrades when either is down", async () => {
    const healthy = await new HealthService(
      databaseUp,
      redisUp,
      devConfig,
      storeUp,
      scannerUp,
      runtimeUp,
    ).check();
    expect(healthy.checks?.storage.status).toBe("up");
    expect(healthy.checks?.scanner.status).toBe("up");
    const noStore = await new HealthService(
      databaseUp,
      redisUp,
      devConfig,
      down,
      scannerUp,
      runtimeUp,
    ).check();
    expect(noStore.status).toBe("degraded");
    expect(noStore.checks?.storage).toEqual({ status: "down", latencyMs: null });
    const noScanner = await new HealthService(
      databaseUp,
      redisUp,
      devConfig,
      storeUp,
      down,
      runtimeUp,
    ).check();
    expect(noScanner.status).toBe("degraded");
    expect(noScanner.checks?.scanner.status).toBe("down");
    const noRuntime = await new HealthService(
      databaseUp,
      redisUp,
      devConfig,
      storeUp,
      scannerUp,
      down,
    ).check();
    expect(noRuntime.status).toBe("degraded");
    expect(noRuntime.checks?.runtime.status).toBe("down");
  });
});
