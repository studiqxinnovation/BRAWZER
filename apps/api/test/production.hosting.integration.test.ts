import { Readable } from "node:stream";
import { driveFileSchema } from "@brawzer/contracts";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrphanService } from "../src/maintenance/orphans.js";
import type { ObjectStore } from "../src/storage/object-store.js";
import { OBJECT_STORE } from "../src/storage/storage.module.js";
import { createHarness, type Harness } from "./support/harness.js";

// Requires the local services (`pnpm infra:up`), the Docker engine and the
// images (`pnpm runtime:build`). Two API instances share the database and
// Valkey, as in production (ADR 0016).
let a: Harness;
let b: Harness;
let aUrl: string;
let bUrl: string;

beforeAll(async () => {
  b = await createHarness({ ipPrefix: "100.73.0", env: { BROWSER_TEST_SITE: "true" } });
  // The database is shared with whatever else runs sessions on this machine:
  // the limit leaves room for exactly one more.
  const live = await b.database.pool.query<{ count: string }>(
    "select count(*) from browser_sessions where status in ('starting', 'running')",
  );
  a = await createHarness({
    ipPrefix: "100.72.0",
    env: {
      BROWSER_TEST_SITE: "true",
      BROWSER_MAX_LIVE_SESSIONS: String(Number(live.rows[0]?.count ?? 0) + 1),
    },
  });
  aUrl = await a.listen();
  bUrl = await b.listen();
});

afterAll(async () => {
  await a.close();
  await b.close();
});

describe("several API instances", () => {
  it("cuts a viewer on one instance when the session ends on another, and bounds capacity", async () => {
    const client = a.browser();
    const email = a.uniqueEmail("hosting-a");
    await a.signUp(client, email);
    const started = await client.post("/browser/sessions", {});
    expect(started.statusCode, started.body).toBe(201);
    const session = started.json<{ id: string }>();

    // The whole installation is at its limit of one live session.
    const other = a.browser();
    await a.signUp(other, a.uniqueEmail("hosting-full"));
    const refused = await other.post("/browser/sessions", {});
    expect(refused.statusCode).toBe(503);
    expect(refused.headers["retry-after"]).toBe("60");
    expect(a.errorOf(refused).code).toBe("service_unavailable");

    // The viewer connects through instance B (same cookie jar, same database).
    const viewer = b.browser();
    viewer.session = client.session;
    const ticket = await viewer.post(`/browser/sessions/${session.id}/ticket`, {});
    expect(ticket.statusCode, ticket.body).toBe(200);
    const stream = new WebSocket(
      `${bUrl.replace(/^http/, "ws")}/api/v1/browser/sessions/${session.id}/stream`,
      { headers: { origin: b.origin } },
    );
    const closed = new Promise<number>((resolve) => stream.on("close", (code) => resolve(code)));
    await new Promise<void>((resolve) => stream.on("open", resolve));
    stream.send(
      JSON.stringify({ type: "ticket", ticket: ticket.json<{ ticket: string }>().ticket }),
    );
    stream.send(JSON.stringify({ type: "hello", viewport: { width: 800, height: 600 } }));
    await new Promise<void>((resolve) => {
      stream.on("message", (data, isBinary) => {
        if (!isBinary && Buffer.isBuffer(data) && data.toString("utf8").includes('"welcome"')) {
          resolve();
        }
      });
    });

    // Ended through instance A: B hears it over Valkey and closes the stream.
    expect((await client.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(204);
    expect(await closed).toBe(4003);
    expect(aUrl).not.toBe(bUrl);
  }, 90_000);
});

describe("orphaned objects", () => {
  it("removes objects nothing refers to once they are old enough, and keeps the rest", async () => {
    const client = a.browser();
    const email = a.uniqueEmail("orphans");
    await a.signUp(client, email);
    const upload = await client.upload("/drive/files", {
      name: "kept.txt",
      content: Buffer.from("stays"),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const kept = driveFileSchema.parse(upload.json());
    const store = a.app.get<ObjectStore>(OBJECT_STORE);
    const userId = (await client.get("/auth/session")).json<{ account: { id: string } }>().account
      .id;
    const strayKey = `drive/${userId}/stray-${Date.now().toString(36)}`;
    await store.put(strayKey, Readable.from([Buffer.from("nobody refers to this")]));

    const orphans = a.app.get(OrphanService);
    // Just written: too young to touch.
    const young = await orphans.run();
    expect(young.removed).toBe(0);
    expect(await store.get(strayKey)).not.toBeNull();
    // Two hours later: gone, while the referenced file stays.
    const later = await orphans.run(new Date(Date.now() + 2 * 60 * 60_000));
    expect(later.removed).toBeGreaterThanOrEqual(1);
    expect(await store.get(strayKey)).toBeNull();
    expect((await client.get(`/drive/files/${kept.id}/preview`)).statusCode).toBe(200);
  }, 60_000);
});
