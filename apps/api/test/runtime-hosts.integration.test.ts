import { browserSessionSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dockerSocketPath } from "../src/config/env.js";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  // Two "hosts" that are this machine's engine twice, and one nobody answers on.
  const socket = dockerSocketPath(process.env.DOCKER_HOST);
  h = await createHarness({
    ipPrefix: "100.74.0",
    env: {
      BROWSER_TEST_SITE: "true",
      RUNTIME_HOSTS: JSON.stringify([
        { name: "host-a", docker: socket, capacity: 1 },
        { name: "host-b", docker: socket, capacity: 1 },
        { name: "host-dead", docker: "tcp://127.0.0.1:1", capacity: 5 },
      ]),
    },
  });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

async function account(tag: string): Promise<TestBrowser> {
  const client = h.browser();
  await h.signUp(client, h.uniqueEmail(tag));
  return client;
}

async function hostOf(sessionId: string): Promise<string | null> {
  const rows = await h.database.pool.query<{ runtime_host: string | null }>(
    "select runtime_host from browser_sessions where id = $1",
    [sessionId],
  );
  return rows.rows[0]?.runtime_host ?? null;
}

describe("placing sessions across runtime hosts", () => {
  it("fills the healthy hosts in turn, skips the unreachable one, and says when all are full", async () => {
    const first = await account("hosts-1");
    const second = await account("hosts-2");
    const third = await account("hosts-3");

    const one = await first.post("/browser/sessions", {});
    expect(one.statusCode, one.body).toBe(201);
    const two = await second.post("/browser/sessions", {});
    expect(two.statusCode, two.body).toBe(201);
    const hosts = [
      await hostOf(browserSessionSchema.parse(one.json()).id),
      await hostOf(browserSessionSchema.parse(two.json()).id),
    ];
    expect(hosts.toSorted()).toEqual(["host-a", "host-b"]);

    // Every reachable host is at its capacity.
    const full = await third.post("/browser/sessions", {});
    expect(full.statusCode, full.body).toBe(503);
    expect(full.headers["retry-after"]).toBe("60");

    // Ending one makes room, on that host; stopping goes to the session's own host.
    const endedId = browserSessionSchema.parse(one.json()).id;
    expect((await first.delete(`/browser/sessions/${endedId}`)).statusCode).toBe(204);
    const again = await third.post("/browser/sessions", {});
    expect(again.statusCode, again.body).toBe(201);
    expect(await hostOf(browserSessionSchema.parse(again.json()).id)).toBe(hosts[0]);

    for (const [client, response] of [
      [second, two],
      [third, again],
    ] as const) {
      const id = browserSessionSchema.parse(response.json()).id;
      expect((await client.delete(`/browser/sessions/${id}`)).statusCode).toBe(204);
    }
  }, 180_000);
});
