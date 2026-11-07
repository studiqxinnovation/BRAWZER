import { healthResponseSchema } from "@brawzer/contracts";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/env.js";
import { HealthService, probe } from "./health.service.js";

const env = {
  DATABASE_URL: "postgres://u:p@127.0.0.1:5433/db",
  REDIS_URL: "redis://127.0.0.1:6380",
};
const devConfig = parseConfig(env, "1.0.0");
const prodConfig = parseConfig(
  {
    ...env,
    NODE_ENV: "production",
    WEB_ORIGIN: "https://brawzer.example",
    EMAIL_TRANSPORT: "resend",
    RESEND_API_KEY: "re_not_a_real_key",
  },
  "1.0.0",
);

const databaseUp = { ping: () => Promise.resolve() };
const redisUp = { ping: () => Promise.resolve("PONG" as const) };
const down = { ping: () => Promise.reject(new Error("ECONNREFUSED")) };

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
    const report = await new HealthService(databaseUp, redisUp, devConfig).check();
    expect(report.status).toBe("ok");
    expect(report.checks?.database.status).toBe("up");
    expect(report.checks?.redis.status).toBe("up");
    expect(healthResponseSchema.safeParse(report).success).toBe(true);
  });

  it("is degraded when the database is unreachable", async () => {
    const report = await new HealthService(down, redisUp, devConfig).check();
    expect(report.status).toBe("degraded");
    expect(report.checks?.database).toEqual({ status: "down", latencyMs: null });
  });

  it("is degraded when Redis is unreachable", async () => {
    const report = await new HealthService(databaseUp, down, devConfig).check();
    expect(report.status).toBe("degraded");
    expect(report.checks?.redis.status).toBe("down");
  });

  it("omits dependency details in production", async () => {
    const report = await new HealthService(databaseUp, redisUp, prodConfig).check();
    expect(report).not.toHaveProperty("checks");
    expect(report.environment).toBe("production");
  });
});
