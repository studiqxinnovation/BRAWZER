import { accountExportSchema, appRecordListSchema, appRecordSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.72.0" });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

describe("app records", () => {
  it("keeps each app's records for its account only, sealed, and in the data export", async () => {
    const owner = h.browser();
    const ownerEmail = h.uniqueEmail("app-records");
    await h.signUp(owner, ownerEmail);
    expect(appRecordListSchema.parse((await owner.get("/apps/money/records")).json())).toEqual({
      records: [],
    });

    const entry = { entries: [{ id: "a1", kind: "income", amount: 1250.5, note: "Café rent £" }] };
    const kept = await owner.put("/apps/money/records/state", { data: entry });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(appRecordSchema.parse(kept.json())).toMatchObject({ key: "state", data: entry });
    // Replacing it keeps one record.
    const replaced = { entries: [...entry.entries, { id: "a2", kind: "expense", amount: 40 }] };
    expect((await owner.put("/apps/money/records/state", { data: replaced })).statusCode).toBe(200);
    const listed = appRecordListSchema.parse((await owner.get("/apps/money/records")).json());
    expect(listed.records).toHaveLength(1);
    expect(listed.records[0]?.data).toEqual(replaced);

    // Sealed in the database: the text isn't there.
    const rows = await h.database.pool.query<{ sealed: string }>(
      "select sealed from app_records r join users u on u.id = r.user_id where u.email = $1",
      [ownerEmail],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.sealed).not.toContain("Café");

    // Another account sees none of it, and can't delete it.
    const other = h.browser();
    await h.signUp(other, h.uniqueEmail("app-records-other"));
    expect(
      appRecordListSchema.parse((await other.get("/apps/money/records")).json()).records,
    ).toEqual([]);
    expect((await other.delete("/apps/money/records/state")).statusCode).toBe(404);

    // Unknown apps and bad keys are refused, and so is a record over 256 KB.
    expect((await owner.get("/apps/terminal/records")).statusCode).toBe(400);
    expect((await owner.put("/apps/money/records/Bad Key", { data: 1 })).statusCode).toBe(400);
    const huge = await owner.put("/apps/money/records/huge", { data: "x".repeat(300 * 1024) });
    expect(huge.statusCode).toBe(413);

    const exported = accountExportSchema.parse((await owner.get("/account/export")).json());
    expect(exported.appRecords).toEqual([
      expect.objectContaining({ app: "money", key: "state", data: replaced }),
    ]);

    expect((await owner.delete("/apps/money/records/state")).statusCode).toBe(204);
    expect(
      appRecordListSchema.parse((await owner.get("/apps/money/records")).json()).records,
    ).toEqual([]);
  });
});

describe("Exam Mode, enforced by the API", () => {
  it("refuses browsers the exam doesn't allow, and ending it early without confirming it's you", async () => {
    const client = h.browser();
    const email = h.uniqueEmail("exam");
    await h.signUp(client, email);
    const running = { endsAt: Date.now() + 60 * 60_000, allowed: ["app:notepad"] };
    expect(
      (await client.put("/apps/exam-mode/records/current", { data: running })).statusCode,
    ).toBe(200);

    // No browser was allowed: a session can't start, whichever page asks.
    const start = await client.post("/browser/sessions", {});
    expect(start.statusCode, start.body).toBe(403);
    expect(start.json<{ error: { message: string } }>().error.message).toContain("Exam Mode");

    // Ending it early is a sensitive step: confirming it's you, within ten minutes.
    await h.database.pool.query(
      `update auth_sessions set reauthenticated_at = now() - interval '11 minutes'
       where user_id = (select id from users where email = $1)`,
      [email],
    );
    const early = await client.delete("/apps/exam-mode/records/current");
    expect(early.statusCode).toBe(403);
    expect(early.json<{ error: { code: string } }>().error.code).toBe("reauthentication_required");
    expect(
      (await client.post("/auth/reauthenticate", { password: "violet-harbor-lantern" })).statusCode,
    ).toBe(200);
    expect((await client.delete("/apps/exam-mode/records/current")).statusCode).toBe(204);

    // With the exam over, browsers open and its record goes without confirming.
    const over = { endsAt: Date.now() - 1_000, allowed: [] };
    expect((await client.put("/apps/exam-mode/records/current", { data: over })).statusCode).toBe(
      200,
    );
    await h.database.pool.query(
      `update auth_sessions set reauthenticated_at = now() - interval '11 minutes'
       where user_id = (select id from users where email = $1)`,
      [email],
    );
    expect((await client.delete("/apps/exam-mode/records/current")).statusCode).toBe(204);
  });
});

describe("app-record writes are rate limited", () => {
  let limited: Harness;

  beforeAll(async () => {
    limited = await createHarness({ ipPrefix: "100.72.1", env: { RATE_LIMIT_SCALE: "1" } });
  });

  afterAll(async () => {
    await limited.close();
  });

  it("answers 429 after 600 writes in a quarter of an hour", async () => {
    const client = limited.browser();
    await limited.signUp(client, limited.uniqueEmail("record-limit"));
    for (let n = 0; n < 600; n += 1) {
      const response = await client.put("/apps/focus-timer/records/state", { data: { n } });
      expect(response.statusCode, `write ${String(n)}: ${response.body}`).toBe(200);
    }
    const over = await client.put("/apps/focus-timer/records/state", { data: { n: 600 } });
    expect(over.statusCode).toBe(429);
    // Reading is not limited.
    expect((await client.get("/apps/focus-timer/records")).statusCode).toBe(200);
  }, 120_000);
});
