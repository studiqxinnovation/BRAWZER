import { browserSessionSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({
    ipPrefix: "100.73.0",
    env: { BROWSER_TEST_SITE: "true", BROWSER_WARM_POOL: "1" },
  });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

async function pooledContainers(): Promise<string[]> {
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    const filters = encodeURIComponent(JSON.stringify({ label: ["brawzer.pool"] }));
    const request = http.request(
      {
        socketPath: h.config.browser.dockerSocket,
        path: `/v1.44/containers/json?filters=${filters}`,
        method: "GET",
      },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk.toString()));
        response.on("end", () => {
          resolve((JSON.parse(body) as { Id: string }[]).map((container) => container.Id));
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string) {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

describe("the warm pool", () => {
  it("hands a waiting pair to a session that needs nothing special, and refills", async () => {
    // The pool fills shortly after boot: a runtime and its sidecar, labelled.
    const before = await until(pooledContainers, (ids) => ids.length >= 2, "a warm pair");

    const client = h.browser();
    await h.signUp(client, h.uniqueEmail("warm-pool"));
    const startedAt = Date.now();
    const response = await client.post("/browser/sessions", {});
    expect(response.statusCode, response.body).toBe(201);
    const session = browserSessionSchema.parse(response.json());
    // Launching a waiting pair skips container creation and the readiness wait.
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    const row = await h.database.pool.query<{ container_id: string }>(
      "select container_id from browser_sessions where id = $1",
      [session.id],
    );
    // Its runtime is a pooled one. Other suites' pools run on the same engine at the same time,
    // so the label, not the list seen earlier, says so.
    expect(await pooledContainers()).toContain(row.rows[0]?.container_id);

    // The session is a real one: a stream ticket is issued for it.
    expect((await client.post(`/browser/sessions/${session.id}/ticket`, {})).statusCode).toBe(200);

    // Meanwhile the pool made a fresh pair for the next session.
    const after = await until(
      pooledContainers,
      (ids) => ids.filter((id) => !before.includes(id)).length >= 2,
      "the pool to refill",
    );
    expect(after.length).toBeGreaterThanOrEqual(4);
    expect((await client.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(204);
  }, 150_000);
});
