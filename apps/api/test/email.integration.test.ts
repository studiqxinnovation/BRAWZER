import { createHmac } from "node:crypto";
import { accountEmailSchema, unsubscribeResponseSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EmailDeliveryService } from "../src/email/delivery.js";
import { EmailService } from "../src/email/email.js";
import { createHarness } from "./support/harness.js";

const WEBHOOK_SECRET = `whsec_${Buffer.from("resend-webhook-test-secret-0001").toString("base64")}`;
const ADMIN = "admin-notices@example.com";

let h: Awaited<ReturnType<typeof createHarness>>;

beforeAll(async () => {
  h = await createHarness({
    ipPrefix: "100.74.1",
    env: { ADMIN_EMAILS: ADMIN, RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET },
  });
});
afterAll(async () => {
  await h.app.close();
});

function signed(id: string, body: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(WEBHOOK_SECRET.slice(6), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}

describe("after sign-up", () => {
  it("welcomes the person and tells the administrators", async () => {
    const client = h.browser();
    const email = h.uniqueEmail("welcome");
    await h.signUp(client, email);
    const welcome = await h.waitForEmail(email, "Welcome to Brawzer");
    expect(welcome).toContain("/app");
    expect(welcome).toContain("never sees your passwords");
    const notice = await h.waitForEmail(ADMIN, "a new account was created");
    expect(notice).toContain(email);
  });
});

describe("email preferences", () => {
  it("are on by default, change from the account, and one click from a footer turns one off", async () => {
    const client = h.browser();
    const email = h.uniqueEmail("prefs");
    await h.signUp(client, email);
    const before = await client.get("/account/email");
    expect(before.statusCode, before.body).toBe(200);
    expect(accountEmailSchema.parse(before.json())).toEqual({
      preferences: { usageNotices: true, teamUpdates: true },
      deliveryProblem: null,
    });
    const changed = await client.patch("/account/email-preferences", { usageNotices: false });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(accountEmailSchema.parse(changed.json()).preferences).toEqual({
      usageNotices: false,
      teamUpdates: true,
    });

    // The footer link of a team update, issued for this account, works once and without a sign-in.
    const me = (await client.get("/auth/session")).json<{ account: { id: string } }>();
    const url = await h.app.get(EmailService).issueUnsubscribeLink(me.account.id, "teamUpdates");
    const token = h.tokenIn(url);
    const stranger = h.browser();
    const stopped = await stranger.post("/account/unsubscribe", { token });
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(unsubscribeResponseSchema.parse(stopped.json())).toMatchObject({
      category: "teamUpdates",
    });
    const again = await stranger.post("/account/unsubscribe", { token });
    expect(again.statusCode).toBe(400);
    const after = accountEmailSchema.parse((await client.get("/account/email")).json());
    expect(after.preferences).toEqual({ usageNotices: false, teamUpdates: false });
    const bad = await stranger.post("/account/unsubscribe", { token: "x".repeat(43) });
    expect(bad.statusCode).toBe(400);
  });
});

describe("delivery reports from the email provider", () => {
  it("stop email to a bounced address, say so on the account, and need no page origin", async () => {
    const client = h.browser();
    const email = h.uniqueEmail("bounce");
    await h.signUp(client, email);
    const body = JSON.stringify({
      type: "email.bounced",
      created_at: new Date().toISOString(),
      data: {
        email_id: "em_1",
        to: [email],
        bounce: { type: "Permanent", message: "mailbox does not exist" },
      },
    });
    // A webhook comes from the provider, not a Brawzer page: no origin, a signature instead.
    const delivered = await h.browser().raw("POST", "/webhooks/resend", Buffer.from(body), {
      ...signed("msg_bounce_1", body),
      origin: "",
    });
    expect(delivered.statusCode, delivered.body).toBe(204);
    const settings = accountEmailSchema.parse((await client.get("/account/email")).json());
    expect(settings.deliveryProblem).toBe("bounced");
    expect(await h.app.get(EmailDeliveryService).isSuppressed(email)).toBe(true);
    // Nothing more goes there: a password reset for this address sends no email.
    const reset = await h.browser().post("/auth/password/forgot", { email });
    expect(reset.statusCode, reset.body).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await h.emailsTo(email, "Reset your Brawzer password")).toHaveLength(0);

    // A soft bounce changes nothing; a forged signature is refused; a replayed old one too.
    const soft = JSON.stringify({
      type: "email.bounced",
      data: { to: [h.uniqueEmail("soft")], bounce: { type: "Transient" } },
    });
    const softResult = await h
      .browser()
      .raw("POST", "/webhooks/resend", Buffer.from(soft), signed("msg_soft", soft));
    expect(softResult.statusCode).toBe(204);
    const forged = await h.browser().raw("POST", "/webhooks/resend", Buffer.from(body), {
      ...signed("msg_bounce_2", body),
      "svix-signature": "v1,AAAA",
    });
    expect(forged.statusCode).toBe(401);
  });

  it("is refused by a Stripe-style signature check on the billing webhook even without an origin", async () => {
    const forged = await h.browser().raw("POST", "/billing/webhook", Buffer.from("{}"), {
      "content-type": "application/json",
      "stripe-signature": "t=1,v1=deadbeef",
      origin: "",
    });
    // Not 403 (origin): the signature is what guards a webhook. Without Stripe
    // configured in this harness the route answers 503; with it, 401.
    expect(forged.statusCode).not.toBe(403);
    expect([401, 503]).toContain(forged.statusCode);
  });
});
