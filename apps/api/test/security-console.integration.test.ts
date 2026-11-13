import { abuseReportListSchema, legalSchema, threatsSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.86.0" });
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

describe("threats and blocked addresses", () => {
  it("shows failed sign-ins and refuses a blocked network at sign-in and sign-up", async () => {
    // A failed sign-in from a known address.
    const victim = h.browser(undefined, "100.86.0.77");
    const victimEmail = h.uniqueEmail("victim");
    await h.signUp(victim, victimEmail);
    const wrong = await victim.post("/auth/login", {
      email: victimEmail,
      password: "wrong-password-1",
    });
    expect(wrong.statusCode).toBe(401);

    const { client: security, email: securityEmail } = await staff("security");
    const before = threatsSchema.parse((await security.get("/console/security/threats")).json());
    expect(before.failed24h).toBeGreaterThan(0);
    expect(before.failedPerHour).toHaveLength(24);
    const failure = before.events.find(
      (event) =>
        event.type === "sign_in.failed" && event.customer?.handle === victimEmail.split("@")[0],
    );
    expect(failure?.ipAddress).toBe("100.86.0.77");
    expect(failure?.blocked).toBe(false);
    expect(before.staffSignIns.some((entry) => entry.email === securityEmail && entry.ok)).toBe(
      true,
    );

    // Block the network it came from; too-wide networks are refused.
    const tooWide = await security.post("/console/security/blocked", {
      cidr: "100.0.0.0/8",
      reason: "Everything",
    });
    expect(tooWide.statusCode).toBe(422);
    const blocked = await security.post("/console/security/blocked", {
      cidr: "100.86.0.64/26",
      reason: "Credential stuffing against several accounts",
      hours: 24,
    });
    expect(blocked.statusCode, blocked.body).toBe(200);
    const after = threatsSchema.parse(blocked.json());
    const entry = after.blocked.find((row) => row.cidr === "100.86.0.64/26");
    expect(entry?.expiresAt).not.toBeNull();
    expect(after.events.find((event) => event.ipAddress === "100.86.0.77")?.blocked).toBe(true);

    // From inside the block nothing works; from outside everything does.
    const inside = h.browser(undefined, "100.86.0.100");
    const refused = await inside.post("/auth/login", {
      email: victimEmail,
      password: "violet-harbor-lantern",
    });
    expect(refused.statusCode).toBe(403);
    expect(h.errorOf(refused).message).toContain("network");
    const refusedSignUp = await inside.post("/auth/register", {
      name: "Ana Silva",
      email: h.uniqueEmail("blocked"),
      password: "violet-harbor-lantern",
    });
    expect(refusedSignUp.statusCode).toBe(403);
    const outside = h.browser(undefined, "100.86.0.200");
    expect(
      (await outside.post("/auth/login", { email: victimEmail, password: "violet-harbor-lantern" }))
        .statusCode,
    ).toBe(200);

    // Lifting it works at once.
    const lifted = await security.delete(`/console/security/blocked/${entry?.id ?? ""}`);
    expect(lifted.statusCode, lifted.body).toBe(200);
    expect(
      (await inside.post("/auth/login", { email: victimEmail, password: "violet-harbor-lantern" }))
        .statusCode,
    ).toBe(200);

    // Care can't see this page at all.
    const { client: care } = await staff("care");
    expect((await care.get("/console/security/threats")).statusCode).toBe(403);
  });
});

describe("abuse reports and legal holds", () => {
  it("warns by email, suspends with a hold that stops deletion, and releases", async () => {
    const customer = h.browser();
    const customerEmail = h.uniqueEmail("suspect");
    await h.signUp(customer, customerEmail);
    const id = await userId(customerEmail);

    const { client: security, email: securityEmail } = await staff("security");
    const logged = await security.post("/console/security/abuse", {
      customerId: id,
      kind: "spam",
      source: "Hosting provider",
      detail: "Outbound connections to a mail relay from three sessions",
    });
    expect(logged.statusCode, logged.body).toBe(200);
    const report = abuseReportListSchema
      .parse(logged.json())
      .reports.find((entry) => entry.customer.id === id);
    expect(report?.status).toBe("open");
    expect(report?.createdBy).toBe(securityEmail);

    // A warning goes out by email.
    const warned = await security.post(`/console/security/abuse/${report?.id ?? ""}/decision`, {
      action: "warn",
      note: "Mail relays are not allowed; stop or the account is suspended",
    });
    expect(warned.statusCode, warned.body).toBe(200);
    expect(
      abuseReportListSchema.parse(warned.json()).reports.find((entry) => entry.id === report?.id)
        ?.status,
    ).toBe("warned");
    expect(await h.waitForEmail(customerEmail, "warning about how your Brawzer account")).toContain(
      "Mail relays",
    );

    // A second report: suspended, evidence held, so neither staff nor the customer can delete.
    const second = abuseReportListSchema
      .parse(
        (
          await security.post("/console/security/abuse", {
            customerId: id,
            kind: "phishing",
            source: "A bank's fraud team",
            detail: "Hosted a copied sign-in page",
          })
        ).json(),
      )
      .reports.find((entry) => entry.kind === "phishing" && entry.customer.id === id);
    const suspended = await security.post(`/console/security/abuse/${second?.id ?? ""}/decision`, {
      action: "suspend",
      note: "Phishing page confirmed by the bank",
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    const decided = abuseReportListSchema
      .parse(suspended.json())
      .reports.find((entry) => entry.id === second?.id);
    expect(decided?.status).toBe("suspended");
    expect(decided?.held).toBe(true);
    expect((await customer.get("/auth/session")).statusCode).toBe(401);

    const legal = legalSchema.parse((await security.get("/console/security/legal")).json());
    expect(legal.holds.some((hold) => hold.customer.id === id)).toBe(true);
    const staffDelete = await security.post(`/console/customers/${id}/delete`, {
      reason: "Clean up",
    });
    expect(staffDelete.statusCode).toBe(409);
    expect(h.errorOf(staffDelete).message).toContain("legal hold");

    // A legal request logged with a due date; answered.
    const request = await security.post("/console/security/legal/requests", {
      fromWhom: "Kent Police",
      kind: "Request for subscriber information",
      customerId: id,
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      note: "Verified by calling the force’s switchboard",
    });
    expect(request.statusCode, request.body).toBe(200);
    const logged2 = legalSchema
      .parse(request.json())
      .requests.find((entry) => entry.fromWhom === "Kent Police");
    expect(logged2?.status).toBe("verifying");
    const answered = await security.post(
      `/console/security/legal/requests/${logged2?.id ?? ""}/decision`,
      {
        status: "answered",
        note: "Sent the subscriber details the order named",
      },
    );
    expect(
      legalSchema.parse(answered.json()).requests.find((entry) => entry.id === logged2?.id)?.status,
    ).toBe("answered");

    // Releasing the hold lets deletion happen again.
    const released = await security.delete(`/console/security/legal/holds/${id}`);
    expect(released.statusCode, released.body).toBe(200);
    expect(legalSchema.parse(released.json()).holds.some((hold) => hold.customer.id === id)).toBe(
      false,
    );
    const deleted = await security.post(`/console/customers/${id}/delete`, {
      reason: "Phishing, evidence passed on",
    });
    expect(deleted.statusCode, deleted.body).toBe(204);

    const audit = await h.database.pool.query<{ action: string }>(
      "select action from staff_actions where target = $1 order by created_at",
      [id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "Logged an abuse report",
        "Warned an account about abuse",
        "Suspended an account for abuse, evidence held",
        "Logged a legal request",
        "Released a legal hold",
        "Deleted the account",
      ]),
    );
  });
});
