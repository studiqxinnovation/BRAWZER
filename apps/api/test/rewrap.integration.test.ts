import { randomBytes } from "node:crypto";
import { rewrapResultSchema } from "@brawzer/contracts";
import { describe, expect, it } from "vitest";
import { ProxiesService } from "../src/proxies/proxies.service.js";
import { createHarness, type Harness } from "./support/harness.js";

const PASSWORD = "violet-harbor-lantern";
const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("base64");

/** Each step runs the API with a different key ring, as a rotation would. */
async function withKeys(keys: string, env: NodeJS.ProcessEnv, run: (h: Harness) => Promise<void>) {
  const h = await createHarness({ ipPrefix: "100.72.0", env: { ENCRYPTION_KEYS: keys, ...env } });
  await h.listen();
  try {
    await run(h);
  } finally {
    await h.close();
  }
}

describe("re-wrapping secrets after a key rotation", () => {
  it("re-wraps every sealed value under the new key, so the old key can be retired", async () => {
    let email = "";
    let userId = "";
    let proxyId = "";

    // Before the rotation: secrets sealed under the first key.
    await withKeys(`old-1:${keyA}`, {}, async (h) => {
      const client = h.browser();
      email = h.uniqueEmail("rewrap");
      await h.signUp(client, email);
      const proxy = await client.post("/proxies", {
        name: "Rotating proxy",
        protocol: "socks5",
        host: "proxy.example.com",
        port: 1080,
        credentials: { username: "rotate", password: "p4ss-before" },
      });
      expect(proxy.statusCode, proxy.body).toBe(201);
      proxyId = proxy.json<{ id: string }>().id;
      const upload = await client.upload("/drive/files", {
        name: "notes.txt",
        content: Buffer.from("kept across rotations"),
      });
      expect(upload.statusCode, upload.body).toBe(201);
      const rows = await h.database.pool.query<{ user_id: string; credentials: string }>(
        "select user_id, credentials from proxies where id = $1",
        [proxyId],
      );
      userId = rows.rows[0]?.user_id ?? "";
      expect(rows.rows[0]?.credentials.startsWith("v1.old-1.")).toBe(true);
    });

    // The rotation: a new first key, the old one still readable; the job re-wraps.
    await withKeys(`new-2:${keyB},old-1:${keyA}`, { ADMIN_EMAILS: email }, async (h) => {
      const client = h.browser();
      await h.signIn(client, email, PASSWORD, true);
      const run = await client.post("/admin/maintenance/rewrap", {});
      expect(run.statusCode, run.body).toBe(200);
      const result = rewrapResultSchema.parse(run.json());
      expect(result.ran).toBe(true);
      // Rows other tests sealed under the development key are reported, never touched.
      expect(result.rewrapped.proxies).toBeGreaterThanOrEqual(1);
      expect(result.rewrapped.drive_files).toBeGreaterThanOrEqual(1);
      const rows = await h.database.pool.query<{ credentials: string }>(
        "select credentials from proxies where id = $1",
        [proxyId],
      );
      expect(rows.rows[0]?.credentials.startsWith("v1.new-2.")).toBe(true);
      const files = await h.database.pool.query<{ wrapped_key: string }>(
        "select wrapped_key from drive_files where user_id = $1",
        [userId],
      );
      expect(files.rows.every((row) => row.wrapped_key.startsWith("v1.new-2."))).toBe(true);
      // Nothing left on a second run.
      const again = rewrapResultSchema.parse(
        (await client.post("/admin/maintenance/rewrap", {})).json(),
      );
      expect(again).toMatchObject({ rewrapped: {}, ran: true });
    });

    // After retiring the old key: the secrets still open.
    await withKeys(`new-2:${keyB}`, {}, async (h) => {
      const proxies = h.app.get(ProxiesService);
      const target = await proxies.forEgress(userId, proxyId);
      expect(target?.credentials).toEqual({ username: "rotate", password: "p4ss-before" });
      const client = h.browser();
      await h.signIn(client, email, PASSWORD, true);
      const files = await client.get("/drive/files");
      expect(files.statusCode, files.body).toBe(200);
    });
  }, 90_000);
});
