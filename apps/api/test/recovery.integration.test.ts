import { recoveryCaseListSchema, recoveryConfirmedSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

const ADMIN_EMAIL = `admin-recovery-${Date.now().toString(36)}@brawzer.test`;
const HOUR = 3_600_000;
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.83.0", env: { ADMIN_EMAILS: ADMIN_EMAIL } });
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

const caseFor = (body: unknown, userEmail: string) =>
  recoveryCaseListSchema
    .parse(body)
    .cases.find((entry) => entry.customer.handle === userEmail.split("@")[0]);

describe("account recovery", () => {
  it("confirms by email, waits, is checked by one person and released by another", async () => {
    const owner = h.browser();
    const ownerEmail = h.uniqueEmail("owner");
    await h.signUp(owner, ownerEmail);

    // Anyone can ask; the answer never says whether the address exists.
    const stranger = h.browser();
    const unknown = await stranger.post("/auth/recovery/start", {
      email: h.uniqueEmail("nobody"),
    });
    expect(unknown.statusCode).toBe(202);
    const started = await owner.post("/auth/recovery/start", { email: ownerEmail });
    expect(started.statusCode, started.body).toBe(202);
    expect(unknown.body).toBe(started.body);

    // Confirming from the email starts the 48-hour wait and sends the cancel link.
    const confirmToken = h.tokenIn(
      await h.waitForEmail(ownerEmail, "Confirm your Brawzer account recovery"),
    );
    const confirmed = await owner.post("/auth/recovery/confirm", { token: confirmToken });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const { releaseAt } = recoveryConfirmedSchema.parse(confirmed.json());
    expect(Date.parse(releaseAt) - Date.now()).toBeGreaterThan(47 * HOUR);
    expect(Date.parse(releaseAt) - Date.now()).toBeLessThan(49 * HOUR);
    // The link is single use.
    expect((await owner.post("/auth/recovery/confirm", { token: confirmToken })).statusCode).toBe(
      400,
    );
    expect(await h.waitForEmail(ownerEmail, "48-hour wait")).toContain("cancel");
    expect(await h.waitForEmail(ADMIN_EMAIL, "account recovery needs a look")).toContain(
      "Device seen before",
    );
    expect(await h.eventTypes(ownerEmail)).toContain("recovery.requested");

    // Care sees the case: the email counts, and the device that confirmed had signed in before.
    const { client: care, email: careEmail } = await staff("care");
    const listed = caseFor((await care.get("/console/recovery")).json(), ownerEmail);
    expect(listed?.status).toBe("waiting");
    expect(listed?.deviceKnown).toBe(true);
    expect(listed?.points).toBe(3);
    expect(listed?.customer.email).toContain("***");
    const id = listed?.id ?? "";

    // Checks add points; the reviewer marks them complete.
    const checked = await care.post(`/console/recovery/${id}/checks`, {
      check: "invoice",
      ok: true,
      note: "Named the October invoice and amount",
    });
    expect(checked.statusCode, checked.body).toBe(200);
    expect(caseFor(checked.json(), ownerEmail)?.points).toBe(5);
    // Care may not release at all.
    expect(
      (await care.post(`/console/recovery/${id}/release`, { reason: "Checks passed" })).statusCode,
    ).toBe(403);
    // Security may, but not before the checks are marked complete.
    const { client: security, email: securityEmail } = await staff("security");
    const tooSoon = await security.post(`/console/recovery/${id}/release`, {
      reason: "Checks passed",
      early: true,
    });
    expect(tooSoon.statusCode, tooSoon.body).toBe(409);
    expect((await care.post(`/console/recovery/${id}/reviewed`, {})).statusCode).toBe(200);
    // The wait isn't over: releasing needs the early flag, and that is kept.
    const waitNotOver = await security.post(`/console/recovery/${id}/release`, {
      reason: "Checks passed",
    });
    expect(waitNotOver.statusCode, waitNotOver.body).toBe(409);
    const released = await security.post(`/console/recovery/${id}/release`, {
      reason: "Customer on the phone, travelling, invoice and card confirmed",
      early: true,
    });
    expect(released.statusCode, released.body).toBe(200);
    const done = caseFor(released.json(), ownerEmail);
    expect(done?.status).toBe("released");
    expect(done?.releasedEarly).toBe(true);
    expect(done?.reviewedBy).toBe(careEmail);
    expect(done?.closedBy).toBe(securityEmail);

    // The owner is signed out everywhere and gets a password link.
    expect((await owner.get("/auth/session")).statusCode).toBe(401);
    expect(await h.waitForEmail(ownerEmail, "Your Brawzer account is released")).toContain(
      "reset-password",
    );
    expect(await h.eventTypes(ownerEmail)).toContain("recovery.released");

    const audit = await h.database.pool.query<{ action: string; detail: string }>(
      "select action, detail from staff_actions where target = $1 order by created_at",
      [id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "Recorded a recovery check",
      "Completed recovery checks",
      "Approved account recovery",
    ]);
    expect(audit.rows[2]?.detail).toContain("EARLY");
  });

  it("stops when the owner says it wasn't them, and keeps one person from doing both halves", async () => {
    const owner = h.browser();
    const ownerEmail = h.uniqueEmail("owner");
    await h.signUp(owner, ownerEmail);
    await owner.post("/auth/recovery/start", { email: ownerEmail });
    const confirmToken = h.tokenIn(
      await h.waitForEmail(ownerEmail, "Confirm your Brawzer account recovery"),
    );
    expect((await owner.post("/auth/recovery/confirm", { token: confirmToken })).statusCode).toBe(
      200,
    );
    const cancelToken = h.tokenIn(await h.waitForEmail(ownerEmail, "48-hour wait"));

    // The founder completes the checks; the same founder can't release.
    const { client: founder } = await staff("admin");
    const listed = caseFor((await founder.get("/console/recovery")).json(), ownerEmail);
    const id = listed?.id ?? "";
    expect((await founder.post(`/console/recovery/${id}/reviewed`, {})).statusCode).toBe(200);
    const sameHands = await founder.post(`/console/recovery/${id}/release`, {
      reason: "All good",
      early: true,
    });
    expect(sameHands.statusCode).toBe(409);
    expect(h.errorOf(sameHands).message).toContain("different member of staff");

    // The owner cancels: denied, flagged, nothing changed, the owner still signed in.
    const cancelled = await owner.post("/auth/recovery/cancel", { token: cancelToken });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const after = caseFor((await founder.get("/console/recovery")).json(), ownerEmail);
    expect(after?.status).toBe("denied");
    expect(after?.closedByOwner).toBe(true);
    expect((await owner.get("/auth/session")).statusCode).toBe(200);
    expect(await h.eventTypes(ownerEmail)).toContain("recovery.cancelled");
    expect(await h.waitForEmail(ownerEmail, "recovery was cancelled")).toContain("nothing changes");
    // Releasing a closed case is impossible.
    expect(
      (await founder.post(`/console/recovery/${id}/release`, { reason: "Oops", early: true }))
        .statusCode,
    ).toBe(409);

    // Staff can start a case for a customer; the customer still has to confirm by email.
    const other = h.browser();
    const otherEmail = h.uniqueEmail("asked-by-phone");
    await h.signUp(other, otherEmail);
    const otherId = (
      await h.database.pool.query<{ id: string }>("select id from users where email = $1", [
        otherEmail,
      ])
    ).rows[0]?.id;
    const begun = await founder.post("/console/recovery", { customerId: otherId });
    expect(begun.statusCode, begun.body).toBe(200);
    expect(caseFor(begun.json(), otherEmail)?.status).toBe("verifying");
    expect(await h.waitForEmail(otherEmail, "Confirm your Brawzer account recovery")).toContain(
      "recover/confirm",
    );
    // Denied with a reason by staff.
    const otherCase = caseFor(begun.json(), otherEmail);
    const denied = await founder.post(`/console/recovery/${otherCase?.id ?? ""}/deny`, {
      reason: "Could not reach the customer back",
    });
    expect(denied.statusCode, denied.body).toBe(200);
    expect(caseFor(denied.json(), otherEmail)?.status).toBe("denied");
    expect(await h.eventTypes(otherEmail)).toContain("recovery.denied");
  });
});
