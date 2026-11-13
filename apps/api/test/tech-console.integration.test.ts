import {
  browserImagesSchema,
  fleetSchema,
  liveSessionListSchema,
  moderatedExtensionListSchema,
  networkSchema,
  profileListSchema,
  profileSchema,
  techHealthSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.85.0" });
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

describe("the technical pages", () => {
  it("report the fleet, images, network and health from what the API knows", async () => {
    const { client: tech } = await staff("technical");
    const fleet = fleetSchema.parse((await tech.get("/console/tech/fleet")).json());
    expect(fleet.hosts.length).toBeGreaterThan(0);
    expect(fleet.maxLiveSessions).toBeGreaterThan(0);
    expect(fleet.runtimeImage).toContain("brawzer-runtime");

    const images = browserImagesSchema.parse((await tech.get("/console/tech/images")).json());
    expect(images.engines.map((engine) => engine.engine)).toContain("bee");
    expect(images.engines.find((engine) => engine.engine === "bee")?.offered).toBe(true);

    const network = networkSchema.parse((await tech.get("/console/tech/network")).json());
    expect(network.proxies.total).toBeGreaterThanOrEqual(0);
    expect(network.siteRules.accounts).toBeGreaterThanOrEqual(0);

    const health = techHealthSchema.parse((await tech.get("/console/tech/health")).json());
    expect(health.checks.map((entry) => entry.key).sort()).toEqual([
      "database",
      "redis",
      "runtime",
      "scanner",
      "storage",
    ]);
    expect(health.checks.find((entry) => entry.key === "database")?.check.status).toBe("up");

    const sessions = liveSessionListSchema.parse((await tech.get("/console/tech/sessions")).json());
    expect(Array.isArray(sessions.sessions)).toBe(true);

    // Billing has no business here.
    const { client: billing } = await staff("billing");
    expect((await billing.get("/console/tech/fleet")).statusCode).toBe(403);
    expect((await billing.get("/console/tech/sessions")).statusCode).toBe(403);
  });

  it("blocks an extension for everyone: removed from profiles, refused on install, emailed", async () => {
    // A customer with Dark Reader in a profile.
    const customer = h.browser();
    const customerEmail = h.uniqueEmail("reader");
    await h.signUp(customer, customerEmail);
    const created = await customer.post("/profiles", {
      name: "Study",
      color: "indigo",
      engine: "bee",
    });
    expect(created.statusCode, created.body).toBe(201);
    const profile = profileSchema.parse(created.json());
    const withExtension = await customer.patch(`/profiles/${profile.id}`, {
      extensions: ["dark-reader"],
    });
    expect(withExtension.statusCode, withExtension.body).toBe(200);
    expect(profileSchema.parse(withExtension.json()).extensions).toEqual(["dark-reader"]);

    const { client: tech, email: techEmail } = await staff("technical");
    const before = moderatedExtensionListSchema.parse(
      (await tech.get("/console/tech/extensions")).json(),
    );
    const dark = before.extensions.find((entry) => entry.slug === "dark-reader");
    expect(dark?.installs).toBeGreaterThanOrEqual(1);

    // Blocking needs a reason; care may not moderate at all.
    expect(
      (await tech.put("/console/tech/extensions/dark-reader", { status: "blocked", reason: "" }))
        .statusCode,
    ).toBe(422);
    const { client: care } = await staff("care");
    expect(
      (await care.put("/console/tech/extensions/dark-reader", { status: "review", reason: "" }))
        .statusCode,
    ).toBe(403);

    const blocked = await tech.put("/console/tech/extensions/dark-reader", {
      status: "blocked",
      reason: "A release sent page contents to a third party",
    });
    expect(blocked.statusCode, blocked.body).toBe(200);
    const after = moderatedExtensionListSchema.parse(blocked.json());
    const darkAfter = after.extensions.find((entry) => entry.slug === "dark-reader");
    expect(darkAfter?.status).toBe("blocked");
    expect(darkAfter?.changedBy).toBe(techEmail);
    expect(darkAfter?.installs).toBe(0);

    // Gone from the profile, emailed, and refused if they try again.
    const seen = profileListSchema
      .parse((await customer.get("/profiles")).json())
      .profiles.find((entry) => entry.id === profile.id);
    expect(seen?.extensions).toEqual([]);
    expect(await h.waitForEmail(customerEmail, "removed from your Brawzer browsers")).toContain(
      "third party",
    );
    const again = await customer.patch(`/profiles/${profile.id}`, { extensions: ["dark-reader"] });
    expect(again.statusCode).toBe(422);
    expect(h.errorOf(again).message).toContain("blocked by Brawzer’s team");

    // Allowed again: installs work.
    expect(
      (await tech.put("/console/tech/extensions/dark-reader", { status: "allowed", reason: "" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await customer.patch(`/profiles/${profile.id}`, { extensions: ["dark-reader"] })).statusCode,
    ).toBe(200);

    const audit = await h.database.pool.query<{ action: string }>(
      "select action from staff_actions where target = 'dark-reader' order by created_at desc limit 2",
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "Changed an extension’s status",
      "Blocked an extension",
    ]);
  });
});
