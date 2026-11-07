import { randomUUID } from "node:crypto";
import { createDatabase, type DatabaseHandle } from "@brawzer/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.factory.js";
import { loadConfig } from "../src/config/env.js";
import { RetentionService } from "../src/maintenance/retention.js";

// Requires the local services: `pnpm infra:up`.
let app: NestFastifyApplication;
let database: DatabaseHandle;

beforeAll(async () => {
  const config = loadConfig();
  database = createDatabase({ url: config.databaseUrl, applicationName: "brawzer-api-tests" });
  app = await createApp(config, { logger: pino({ level: "silent" }) });
  await app.init();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function insertUser(options: { verified: boolean; createdAt: Date }): Promise<string> {
  const { rows } = await database.pool.query<{ id: string }>(
    `insert into users (email, email_verified_at, created_at) values ($1, $2, $3) returning id`,
    [
      `retention-${randomUUID().slice(0, 8)}@example.com`,
      options.verified ? options.createdAt : null,
      options.createdAt,
    ],
  );
  return rows[0]?.id ?? "";
}

async function exists(table: string, id: string): Promise<boolean> {
  const { rowCount } = await database.pool.query(`select 1 from ${table} where id = $1`, [id]);
  return rowCount === 1;
}

describe("retention", () => {
  it("deletes data past its retention period and keeps everything else", async () => {
    const owner = await insertUser({ verified: true, createdAt: daysAgo(500) });
    const insertEvent = async (occurredAt: Date) =>
      (
        await database.pool.query<{ id: string }>(
          `insert into security_events (user_id, type, occurred_at) values ($1, 'sign_out', $2) returning id`,
          [owner, occurredAt],
        )
      ).rows[0]?.id ?? "";
    const oldEvent = await insertEvent(daysAgo(400));
    const recentEvent = await insertEvent(daysAgo(10));

    const insertSession = async (expiresAt: Date, revokedAt: Date | null) =>
      (
        await database.pool.query<{ id: string }>(
          `insert into auth_sessions (user_id, token_hash, expires_at, revoked_at)
           values ($1, $2, $3, $4) returning id`,
          [owner, randomUUID(), expiresAt, revokedAt],
        )
      ).rows[0]?.id ?? "";
    const longRevoked = await insertSession(daysAgo(-1), daysAgo(40));
    const longExpired = await insertSession(daysAgo(31), null);
    const active = await insertSession(daysAgo(-1), null);

    const insertToken = async (userId: string, expiresAt: Date, usedAt: Date | null) =>
      (
        await database.pool.query<{ id: string }>(
          `insert into email_tokens (user_id, purpose, token_hash, expires_at, used_at)
           values ($1, 'verify_email', $2, $3, $4) returning id`,
          [userId, randomUUID(), expiresAt, usedAt],
        )
      ).rows[0]?.id ?? "";
    const usedLink = await insertToken(owner, daysAgo(-1), daysAgo(8));
    const liveLink = await insertToken(owner, daysAgo(-1), null);

    const abandoned = await insertUser({ verified: false, createdAt: daysAgo(40) });
    const stillTrying = await insertUser({ verified: false, createdAt: daysAgo(40) });
    await insertToken(stillTrying, daysAgo(-1), null);
    const newSignUp = await insertUser({ verified: false, createdAt: daysAgo(2) });

    const result = await app.get(RetentionService).run();
    expect(result).not.toBeNull();

    expect(await exists("security_events", oldEvent)).toBe(false);
    expect(await exists("security_events", recentEvent)).toBe(true);
    expect(await exists("auth_sessions", longRevoked)).toBe(false);
    expect(await exists("auth_sessions", longExpired)).toBe(false);
    expect(await exists("auth_sessions", active)).toBe(true);
    expect(await exists("email_tokens", usedLink)).toBe(false);
    expect(await exists("email_tokens", liveLink)).toBe(true);
    expect(await exists("users", abandoned)).toBe(false);
    expect(await exists("users", stillTrying)).toBe(true);
    expect(await exists("users", newSignUp)).toBe(true);
    expect(await exists("users", owner)).toBe(true);
  });

  it("lets only one instance run at a time", async () => {
    const service = app.get(RetentionService);
    const holder = await database.pool.connect();
    try {
      await holder.query("select pg_advisory_lock($1)", [0x62_72_7a_72]);
      expect(await service.run()).toBeNull();
    } finally {
      await holder.query("select pg_advisory_unlock($1)", [0x62_72_7a_72]);
      holder.release();
    }
    expect(await service.run()).not.toBeNull();
  });
});
