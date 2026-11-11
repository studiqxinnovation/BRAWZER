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
