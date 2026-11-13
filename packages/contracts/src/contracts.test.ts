import { describe, expect, it } from "vitest";
import { apiErrorSchema, healthResponseSchema } from "./index.ts";

const healthy = {
  status: "ok",
  service: "brawzer-api",
  version: "0.0.0",
  environment: "development",
  uptimeSeconds: 12,
  timestamp: "2026-11-06T12:00:00.000Z",
  checks: {
    database: { status: "up", latencyMs: 1.2 },
    redis: { status: "up", latencyMs: 0.4 },
    storage: { status: "up", latencyMs: 3.1 },
    scanner: { status: "up", latencyMs: 0.9 },
  },
};

describe("healthResponseSchema", () => {
  it("accepts a complete health report", () => {
    expect(healthResponseSchema.parse(healthy)).toEqual(healthy);
  });

  it("accepts a production report without internal checks", () => {
    const { checks: _checks, ...publicReport } = healthy;
    expect(
      healthResponseSchema.safeParse({ ...publicReport, environment: "production" }).success,
    ).toBe(true);
  });

  it("strips fields that are not part of the contract", () => {
    const parsed = healthResponseSchema.parse({ ...healthy, databaseUrl: "postgres://secret" });
    expect(parsed).not.toHaveProperty("databaseUrl");
  });

  it("rejects an unknown status", () => {
    expect(healthResponseSchema.safeParse({ ...healthy, status: "fine" }).success).toBe(false);
  });

  it("rejects a failed probe that still reports latency as negative", () => {
    const broken = {
      ...healthy,
      checks: { ...healthy.checks, redis: { status: "down", latencyMs: -1 } },
    };
    expect(healthResponseSchema.safeParse(broken).success).toBe(false);
  });
});

describe("apiErrorSchema", () => {
  it("accepts the standard error envelope", () => {
    const body = {
      error: {
        code: "validation_failed",
        message: "Request validation failed.",
        details: ["email: Invalid email address"],
        requestId: "8d3c",
      },
    };
    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it("rejects unknown error codes", () => {
    expect(apiErrorSchema.safeParse({ error: { code: "oops", message: "x" } }).success).toBe(false);
  });
});
