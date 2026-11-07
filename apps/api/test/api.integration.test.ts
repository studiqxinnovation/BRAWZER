import { apiErrorSchema, type HealthResponse, healthResponseSchema } from "@brawzer/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.factory.js";
import { loadConfig } from "../src/config/env.js";

// Requires the local services: `pnpm infra:up`.
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApp(loadConfig(), { logger: pino({ level: "silent" }) });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/v1/health", () => {
  it("reports the database and Redis as reachable", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    const body = healthResponseSchema.parse(response.json<HealthResponse>());

    expect(response.statusCode, "is `pnpm infra:up` running?").toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks?.database.status).toBe("up");
    expect(body.checks?.redis.status).toBe("up");
  });

  it("forbids caching and sets security headers", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("errors", () => {
  it("returns the standard error envelope for unknown routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/does-not-exist" });
    const body = apiErrorSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("not_found");
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not trust a client-supplied request ID", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/does-not-exist",
      headers: { "request-id": "attacker-chosen", "x-request-id": "attacker-chosen" },
    });
    expect(apiErrorSchema.parse(response.json()).error.requestId).not.toBe("attacker-chosen");
  });
});

describe("API docs", () => {
  it("publishes an OpenAPI document that includes the health contract", async () => {
    const response = await app.inject({ method: "GET", url: "/api/docs/openapi.json" });
    expect(response.statusCode).toBe(200);
    const document = response.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(document.paths)).toContain("/api/v1/health");
  });
});
