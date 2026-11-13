import {
  announcementListSchema,
  incidentSchema,
  publicStatusSchema,
  staffAnnouncementListSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.82.0" });
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

describe("announcements", () => {
  it("reach their audience, count views and clicks, and stay dismissed", async () => {
    const { client: care } = await staff("care");
    const customer = h.browser();
    await h.signUp(customer, h.uniqueEmail("reader"));

    // Nothing yet.
    const quiet = announcementListSchema.parse((await customer.get("/announcements")).json());
    const before = quiet.announcements.length;

    // Published to everyone; a plan-only one doesn't reach a free account.
    const published = await care.post("/console/announcements", {
      title: "New: extensions for each browser",
      body: "Add uBlock and more to each of your cloud browsers.",
      kind: "news",
      audience: "everyone",
      link: "/app/extensions",
    });
    expect(published.statusCode, published.body).toBe(200);
    const proOnly = await care.post("/console/announcements", {
      title: "Pro: more sessions",
      body: "Pro accounts can run more browsers at once.",
      kind: "tip",
      audience: "plan:pro",
    });
    expect(proOnly.statusCode, proOnly.body).toBe(200);
    const list = staffAnnouncementListSchema.parse(proOnly.json());
    const news = list.announcements.find((entry) => entry.title.startsWith("New: extensions"));
    expect(news?.on).toBe(true);
    expect(news?.views).toBe(0);

    // A bad link or audience is refused.
    expect(
      (
        await care.post("/console/announcements", {
          title: "Bad",
          body: "Nope nope",
          kind: "news",
          audience: "everyone",
          link: "https://elsewhere.example",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await care.post("/console/announcements", {
          title: "Bad",
          body: "Nope nope",
          kind: "news",
          audience: "country:ng",
        })
      ).statusCode,
    ).toBe(400);

    // The customer sees the news, not the Pro tip; seeing counts as a view.
    const seen = announcementListSchema.parse((await customer.get("/announcements")).json());
    expect(seen.announcements.length).toBe(before + 1);
    expect(seen.announcements.some((entry) => entry.title.startsWith("Pro:"))).toBe(false);
    const shown = seen.announcements.find((entry) => entry.title.startsWith("New: extensions"));
    expect(shown?.link).toBe("/app/extensions");

    expect((await customer.post(`/announcements/${news?.id ?? ""}/click`, {})).statusCode).toBe(
      204,
    );
    expect((await customer.post(`/announcements/${news?.id ?? ""}/dismiss`, {})).statusCode).toBe(
      204,
    );
    const after = announcementListSchema.parse((await customer.get("/announcements")).json());
    expect(after.announcements.some((entry) => entry.id === news?.id)).toBe(false);

    const counted = staffAnnouncementListSchema.parse(
      (await care.get("/console/announcements")).json(),
    );
    const newsNow = counted.announcements.find((entry) => entry.id === news?.id);
    expect(newsNow?.views).toBe(1);
    expect(newsNow?.clicks).toBe(1);

    // Hidden banners reach nobody; billing staff can't publish.
    const hidden = await care.patch(`/console/announcements/${news?.id ?? ""}`, { on: false });
    expect(hidden.statusCode, hidden.body).toBe(200);
    const { client: billing } = await staff("billing");
    expect(
      (
        await billing.post("/console/announcements", {
          title: "Hello",
          body: "From billing",
          kind: "news",
          audience: "everyone",
        })
      ).statusCode,
    ).toBe(403);

    const audit = await h.database.pool.query<{ action: string }>(
      "select action from staff_actions where target = $1 order by created_at",
      [news?.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "Published an announcement",
      "Hid an announcement",
    ]);
  });
});

describe("incidents and the status page", () => {
  it("shows a public incident on /status and as a banner until it is resolved", async () => {
    const { client: tech, email: techEmail } = await staff("technical");
    const anyone = h.browser();
    const customer = h.browser();
    await h.signUp(customer, h.uniqueEmail("watcher"));

    const clear = publicStatusSchema.parse((await anyone.get("/status")).json());
    expect(clear.components.map((component) => component.key)).toEqual([
      "cloud_browsers",
      "sign_in",
      "drive",
      "email",
      "billing",
    ]);

    const declared = await tech.post("/console/incidents", {
      title: "Slow starts for cloud browsers",
      severity: "sev2",
      components: ["cloud_browsers"],
      isPublic: true,
      body: "New sessions take up to a minute to start. We’re adding capacity.",
    });
    expect(declared.statusCode, declared.body).toBe(201);
    const incident = incidentSchema.parse(declared.json());
    expect(incident.status).toBe("investigating");
    expect(incident.owner).toBe(techEmail);
    expect(incident.updates).toHaveLength(1);

    // Public: on the status page, and a banner for everyone.
    const during = publicStatusSchema.parse((await anyone.get("/status")).json());
    expect(during.overall).not.toBe("operational");
    expect(during.components.find((c) => c.key === "cloud_browsers")?.state).toBe("incident");
    expect(during.incidents.some((entry) => entry.id === incident.id)).toBe(true);
    const banners = announcementListSchema.parse((await customer.get("/announcements")).json());
    const banner = banners.announcements.find((entry) => entry.title === incident.title);
    expect(banner?.kind).toBe("incident");
    expect(banner?.link).toBe("/status");

    // Care can read incidents but not declare or update them.
    const { client: care } = await staff("care");
    expect((await care.get("/console/incidents")).statusCode).toBe(200);
    expect(
      (
        await care.post(`/console/incidents/${incident.id}/updates`, {
          status: "monitoring",
          body: "Looks better.",
        })
      ).statusCode,
    ).toBe(403);

    // Resolving turns the banner off and clears the page.
    const resolved = await tech.post(`/console/incidents/${incident.id}/updates`, {
      status: "resolved",
      body: "Capacity added; starts are back to normal.",
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(incidentSchema.parse(resolved.json()).resolvedAt).not.toBeNull();
    const afterBanners = announcementListSchema.parse(
      (await customer.get("/announcements")).json(),
    );
    expect(afterBanners.announcements.some((entry) => entry.id === banner?.id)).toBe(false);
    const after = publicStatusSchema.parse((await anyone.get("/status")).json());
    expect(after.components.find((c) => c.key === "cloud_browsers")?.state).not.toBe("incident");
    const listed = after.incidents.find((entry) => entry.id === incident.id);
    expect(listed?.status).toBe("resolved");
    expect(listed?.updates).toHaveLength(2);
    expect(JSON.stringify(after)).not.toContain(techEmail);

    // An internal incident never leaves the console.
    const internal = incidentSchema.parse(
      (
        await tech.post("/console/incidents", {
          title: "Disk filling on a runtime host",
          severity: "sev3",
          isPublic: false,
          body: "Cleaning up old images.",
        })
      ).json(),
    );
    const publicNow = publicStatusSchema.parse((await anyone.get("/status")).json());
    expect(publicNow.incidents.some((entry) => entry.id === internal.id)).toBe(false);
  });
});
