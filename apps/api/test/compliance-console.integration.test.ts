import {
  complianceListSchema,
  dataMapSchema,
  goalListSchema,
  privacyRequestListSchema,
  weeklyPreviewSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.87.0" });
});

afterAll(async () => {
  await h.close();
});

async function staff(role: string) {
  const client = h.browser();
  const email = h.uniqueEmail(role);
  await h.signUp(client, email);
  await h.database.pool.query("update users set role = $2 where email = $1", [email, role]);
  await h.signIn(client, email);
  return { client, email };
}

async function userId(email: string): Promise<string> {
  const row = await h.database.pool.query<{ id: string }>("select id from users where email = $1", [
    email,
  ]);
  return row.rows[0]?.id ?? "";
}

describe("privacy requests", () => {
  it("tracks the deadline and completes a deletion unless a hold stops it", async () => {
    const customer = h.browser();
    const customerEmail = h.uniqueEmail("subject");
    await h.signUp(customer, customerEmail);
    const id = await userId(customerEmail);

    const { client: security, email: securityEmail } = await staff("security");
    const received = new Date(Date.now() - 25 * 86_400_000).toISOString();
    const logged = await security.post("/console/compliance/privacy", {
      customerId: id,
      kind: "delete",
      receivedAt: received,
      note: "Asked by email",
    });
    expect(logged.statusCode, logged.body).toBe(200);
    const request = privacyRequestListSchema
      .parse(logged.json())
      .requests.find((entry) => entry.customer?.id === id);
    expect(request?.status).toBe("open");
    expect(request?.createdBy).toBe(securityEmail);
    // Thirty days from receipt: five days left.
    expect(Date.parse(request?.deadlineAt ?? "") - Date.parse(received)).toBe(30 * 86_400_000);

    // Under a hold the deletion is refused and the request stays open.
    expect(
      (
        await security.post("/console/security/legal/holds", {
          customerId: id,
          why: "Preservation request",
        })
      ).statusCode,
    ).toBe(200);
    const refused = await security.post(
      `/console/compliance/privacy/${request?.id ?? ""}/complete`,
      {
        note: "Deleting as asked",
      },
    );
    expect(refused.statusCode).toBe(409);
    const stillOpen = privacyRequestListSchema.parse(
      (await security.get("/console/compliance/privacy")).json(),
    );
    expect(stillOpen.requests.find((entry) => entry.id === request?.id)?.status).toBe("open");
    expect(stillOpen.requests.find((entry) => entry.id === request?.id)?.held).toBe(true);

    // Released: the deletion goes through and the request is complete.
    expect((await security.delete(`/console/security/legal/holds/${id}`)).statusCode).toBe(200);
    const done = await security.post(`/console/compliance/privacy/${request?.id ?? ""}/complete`, {
      note: "Deleted as asked, confirmation emailed",
    });
    expect(done.statusCode, done.body).toBe(200);
    const completed = privacyRequestListSchema
      .parse(done.json())
      .requests.find((entry) => entry.id === request?.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.customer).toBeNull();
    expect((await customer.get("/auth/session")).statusCode).toBe(401);

    // Care doesn't handle privacy requests.
    const { client: care } = await staff("care");
    expect((await care.get("/console/compliance/privacy")).statusCode).toBe(403);
  });
});

describe("compliance, the data map, goals and the weekly email", () => {
  it("seeds the checklist, keeps goals and sends a weekly test", async () => {
    const { client: founder, email: founderEmail } = await staff("admin");

    const list = complianceListSchema.parse(
      (await founder.get("/console/compliance/checklist")).json(),
    );
    expect(list.items.length).toBeGreaterThan(5);
    const first = list.items[0];
    const ticked = await founder.patch(`/console/compliance/checklist/${first?.id ?? ""}`, {
      done: true,
    });
    expect(ticked.statusCode, ticked.body).toBe(200);
    const after = complianceListSchema
      .parse(ticked.json())
      .items.find((item) => item.id === first?.id);
    expect(after?.done).toBe(true);
    expect(after?.doneBy).toBe(founderEmail);
    const added = await founder.post("/console/compliance/checklist", {
      framework: "Operations",
      item: "The weekly email reached the founders this Monday",
    });
    expect(
      complianceListSchema
        .parse(added.json())
        .items.some((item) => item.item.startsWith("The weekly email")),
    ).toBe(true);

    const map = dataMapSchema.parse((await founder.get("/console/compliance/datamap")).json());
    expect(map.suppliers.map((supplier) => supplier.name)).toContain("Object store");
    expect(
      map.retention.some((row) => row.data === "Drive Trash" && row.keptFor === "30 days"),
    ).toBe(true);
    expect(JSON.stringify(map)).not.toContain("sk_");

    const quarterEnd = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const goalAdded = await founder.post("/console/compliance/goals", {
      name: "Paying accounts",
      current: 12,
      target: 50,
      unit: "",
      quarterEnd,
    });
    expect(goalAdded.statusCode, goalAdded.body).toBe(200);
    const goal = goalListSchema
      .parse(goalAdded.json())
      .goals.find((entry) => entry.name === "Paying accounts");
    expect(goal?.current).toBe(12);
    const { client: sales } = await staff("sales");
    const updated = await sales.put(`/console/compliance/goals/${goal?.id ?? ""}`, { current: 20 });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(
      goalListSchema.parse(updated.json()).goals.find((entry) => entry.id === goal?.id)?.current,
    ).toBe(20);
    // Only founders add or remove goals.
    expect(
      (await sales.post("/console/compliance/goals", { name: "X", target: 1, quarterEnd }))
        .statusCode,
    ).toBe(403);
    expect((await founder.delete(`/console/compliance/goals/${goal?.id ?? ""}`)).statusCode).toBe(
      200,
    );

    // The weekly email: settings, preview, a test to oneself.
    const preview = weeklyPreviewSchema.parse(
      (await founder.get("/console/compliance/weekly")).json(),
    );
    expect(preview.settings.on).toBe(false);
    expect(preview.facts.map(([label]) => label)).toContain("Accounts");
    const set = await founder.put("/console/compliance/weekly", {
      on: true,
      hourUtc: 8,
      recipients: [{ email: founderEmail, version: "full" }],
    });
    expect(set.statusCode, set.body).toBe(200);
    const saved = weeklyPreviewSchema.parse(set.json());
    expect(saved.settings.on).toBe(true);
    expect(new Date(saved.nextAt ?? "").getUTCDay()).toBe(1);
    expect((await founder.post("/console/compliance/weekly/test", {})).statusCode).toBe(204);
    expect(await h.waitForEmail(founderEmail, "Brawzer this week")).toContain("Paying accounts");
    expect((await sales.get("/console/compliance/weekly")).statusCode).toBe(403);
    // Leave it off for the next test run.
    await founder.put("/console/compliance/weekly", { on: false, hourUtc: 8, recipients: [] });
  });
});
