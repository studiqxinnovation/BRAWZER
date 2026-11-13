import { accountExportSchema, profileListSchema, profileSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

// Requires the local services: `pnpm infra:up`.
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.64.0" });
});

afterAll(async () => {
  await h.close();
});

const PASSWORD = "violet-harbor-lantern";

async function account(tag: string): Promise<{ email: string; client: TestBrowser }> {
  const email = h.uniqueEmail(tag);
  const client = h.browser();
  await h.signUp(client, email, PASSWORD);
  return { email, client };
}

async function list(client: TestBrowser) {
  const response = await client.get("/profiles");
  expect(response.statusCode).toBe(200);
  return profileListSchema.parse(response.json());
}

async function create(client: TestBrowser, name: string, color = "teal") {
  return client.post("/profiles", { name, color });
}

describe("a new account's profiles", () => {
  it("start with Personal, and the limit is reported", async () => {
    const { client } = await account("profiles-first");
    const { profiles, limit } = await list(client);
    expect(limit).toBe(10);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      name: "Personal",
      color: "indigo",
      engine: "bee",
      position: 0,
    });
  });

  it("include Personal when a reset link is what confirmed the account", async () => {
    const email = h.uniqueEmail("profiles-reset");
    const client = h.browser();
    expect(
      (await client.post("/auth/register", { name: "Ana Silva", email, password: PASSWORD }))
        .statusCode,
    ).toBe(202);
    await client.post("/auth/password/forgot", { email });
    const token = h.tokenIn(await h.waitForEmail(email, "Reset your Brawzer password"));
    const reset = await client.post("/auth/password/reset", {
      token,
      password: "copper-meadow-whistle",
    });
    expect(reset.statusCode).toBe(200);
    await h.signIn(client, email, "copper-meadow-whistle");
    expect((await list(client)).profiles.map((profile) => profile.name)).toEqual(["Personal"]);
  });

  it("need a session", async () => {
    expect((await h.browser().get("/profiles")).statusCode).toBe(401);
  });
});

describe("creating profiles", () => {
  it("adds them at the end, trimmed, and records it", async () => {
    const { email, client } = await account("profiles-create");
    const response = await create(client, "  Work  ", "teal");
    expect(response.statusCode).toBe(201);
    const work = profileSchema.parse(response.json());
    expect(work).toMatchObject({ name: "Work", color: "teal", engine: "bee", position: 1 });
    expect((await list(client)).profiles.map((profile) => profile.name)).toEqual([
      "Personal",
      "Work",
    ]);
    expect(await h.eventTypes(email)).toContain("profile.created");
  });

  it("refuses duplicate names, ignoring case", async () => {
    const { client } = await account("profiles-duplicate");
    const response = await create(client, "PERSONAL");
    expect(response.statusCode).toBe(409);
    expect(h.errorOf(response)).toMatchObject({
      code: "conflict",
      details: ["name: You already have a profile with that name."],
    });
  });

  it("installs catalogue extensions into a profile, each once, from the catalogue only", async () => {
    const client = h.browser();
    await h.signUp(client, h.uniqueEmail("profiles-extensions"));
    const profile = profileListSchema.parse((await client.get("/profiles")).json()).profiles[0]!;
    expect(profile.extensions).toEqual([]);
    const set = await client.patch(`/profiles/${profile.id}`, {
      extensions: ["dark-reader", "ubo-lite"],
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(profileSchema.parse(set.json()).extensions).toEqual(["dark-reader", "ubo-lite"]);
    expect(
      (await client.patch(`/profiles/${profile.id}`, { extensions: ["nope"] })).statusCode,
    ).toBe(400);
    expect(
      (
        await client.patch(`/profiles/${profile.id}`, {
          extensions: ["dark-reader", "dark-reader"],
        })
      ).statusCode,
    ).toBe(400);
    const cleared = await client.patch(`/profiles/${profile.id}`, { extensions: [] });
    expect(profileSchema.parse(cleared.json()).extensions).toEqual([]);
  });

  it("validates the name, colour and engine", async () => {
    const { client } = await account("profiles-validate");
    const cases: [object, string][] = [
      [{ name: "   ", color: "teal" }, "name: Give the profile a name."],
      [{ name: "x".repeat(41), color: "teal" }, "name: Use at most 40 characters."],
      [
        { name: "Work‮gnp.exe", color: "teal" },
        "name: Use letters, numbers, spaces and punctuation.",
      ],
      [{ name: "Work", color: "chartreuse" }, "color: Choose a colour."],
      [
        { name: "Work", color: "teal", engine: "safari" },
        "engine: Choose Bee Browser, Chrome, Firefox, Edge or Chromium.",
      ],
    ];
    for (const [body, detail] of cases) {
      const response = await client.post("/profiles", body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(h.errorOf(response).details).toContain(detail);
    }
    // Emoji, accents and other scripts are fine.
    expect((await create(client, "Café ☕ 研究")).statusCode).toBe(201);
  });

  it("stops at the limit, even when requests arrive together", async () => {
    const { email, client } = await account("profiles-limit");
    for (let i = 2; i <= 8; i++)
      expect((await create(client, `Profile ${String(i)}`)).statusCode).toBe(201);
    // Five at once for the last two places.
    const results = await Promise.all(
      ["A", "B", "C", "D", "E"].map((name) => create(client, `Late ${name}`)),
    );
    const statuses = results.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([201, 201, 409, 409, 409]);
    const refused = results.find((response) => response.statusCode === 409);
    expect(refused && h.errorOf(refused).code).toBe("limit_reached");
    const { rows } = await h.database.pool.query<{ count: number }>(
      `select count(*)::int as count from profiles
       where user_id = (select id from users where email = $1)`,
      [email],
    );
    expect(rows[0]?.count).toBe(10);
  });
});

describe("changing profiles", () => {
  it("renames and recolours, and refuses a name in use", async () => {
    const { client } = await account("profiles-update");
    const work = profileSchema.parse((await create(client, "Work")).json());

    const renamed = await client.patch(`/profiles/${work.id}`, { name: "Office", color: "rose" });
    expect(renamed.statusCode).toBe(200);
    expect(profileSchema.parse(renamed.json())).toMatchObject({ name: "Office", color: "rose" });

    const taken = await client.patch(`/profiles/${work.id}`, { name: "personal" });
    expect(taken.statusCode).toBe(409);
    const nothing = await client.patch(`/profiles/${work.id}`, {});
    expect(nothing.statusCode).toBe(400);
  });

  it("can't touch another account's profiles", async () => {
    const { client: owner } = await account("profiles-owner");
    const { client: other } = await account("profiles-other");
    const work = profileSchema.parse((await create(owner, "Work")).json());

    expect((await other.patch(`/profiles/${work.id}`, { name: "Mine" })).statusCode).toBe(404);
    expect((await other.delete(`/profiles/${work.id}`)).statusCode).toBe(404);
    const reorder = await other.put("/profiles/order", { ids: [work.id] });
    expect(reorder.statusCode).toBe(409);
    expect((await list(other)).profiles.map((profile) => profile.name)).toEqual(["Personal"]);
    expect((await list(owner)).profiles.map((profile) => profile.name)).toEqual([
      "Personal",
      "Work",
    ]);
    expect((await owner.patch("/profiles/not-an-id", { name: "x" })).statusCode).toBe(400);
  });

  it("reorders when every profile is listed once", async () => {
    const { client } = await account("profiles-order");
    const personal = (await list(client)).profiles[0];
    const work = profileSchema.parse((await create(client, "Work")).json());
    const research = profileSchema.parse((await create(client, "Research")).json());
    if (!personal) throw new Error("no Personal profile");

    const reordered = await client.put("/profiles/order", {
      ids: [research.id, personal.id, work.id],
    });
    expect(reordered.statusCode).toBe(200);
    expect(
      profileListSchema.parse(reordered.json()).profiles.map((profile) => profile.name),
    ).toEqual(["Research", "Personal", "Work"]);
    expect((await list(client)).profiles.map((profile) => profile.name)).toEqual([
      "Research",
      "Personal",
      "Work",
    ]);

    const missing = await client.put("/profiles/order", { ids: [research.id, personal.id] });
    expect(missing.statusCode).toBe(409);
    const repeated = await client.put("/profiles/order", {
      ids: [research.id, research.id, work.id],
    });
    expect(repeated.statusCode).toBe(400);
  });
});

describe("deleting profiles", () => {
  it("deletes and records it, but never the last one", async () => {
    const { email, client } = await account("profiles-delete");
    const work = profileSchema.parse((await create(client, "Work")).json());
    expect((await client.delete(`/profiles/${work.id}`)).statusCode).toBe(204);
    expect(await h.eventTypes(email)).toContain("profile.deleted");

    const [personal] = (await list(client)).profiles;
    const last = await client.delete(`/profiles/${personal?.id ?? ""}`);
    expect(last.statusCode).toBe(409);
    expect(h.errorOf(last).message).toBe("You need at least one profile.");
  });

  it("keeps one when the last two are deleted at the same time", async () => {
    const { client } = await account("profiles-delete-race");
    await create(client, "Work");
    const ids = (await list(client)).profiles.map((profile) => profile.id);
    const results = await Promise.all(ids.map((id) => client.delete(`/profiles/${id}`)));
    expect(results.map((response) => response.statusCode).sort()).toEqual([204, 409]);
    expect((await list(client)).profiles).toHaveLength(1);
  });
});

describe("downloading your data", () => {
  it("includes the profiles", async () => {
    const { client } = await account("profiles-export");
    await create(client, "Work", "green");
    const data = accountExportSchema.parse((await client.get("/account/export")).json());
    expect(data.profiles.map(({ name, color }) => ({ name, color }))).toEqual([
      { name: "Personal", color: "indigo" },
      { name: "Work", color: "green" },
    ]);
  });
});
