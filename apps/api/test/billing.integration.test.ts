import { billingOverviewSchema, profileSchema } from "@brawzer/contracts";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FakeStripe, fakeStripe, subscriptionObject } from "./support/fake-stripe.js";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

// Requires the local services (`pnpm infra:up`). Stripe is a fake server
// here (STRIPE_API_BASE); webhooks are signed with the test secret.
let h: Harness;
let plain: Harness;
let stripe: FakeStripe;
const WEBHOOK_SECRET = "whsec_test_secret_for_the_billing_suite";
// Unique per run: accounts outlive a test run in the local database.
const ADMIN_EMAIL = `admin-billing-${Date.now().toString(36)}@brawzer.test`;
const PLUS = {
  code: "plus",
  name: "Plus",
  stripePriceId: "price_plus_month",
  limits: {
    profiles: 2,
    proxies: 3,
    driveBytes: 50 * 1024 * 1024,
    driveFiles: 50,
    driveFolders: 10,
    browsingMinutesPerMonth: 1,
    liveSessions: 1,
  },
  trialDays: 14,
};

beforeAll(async () => {
  stripe = await fakeStripe({
    price_plus_month: { unit_amount: 900, currency: "eur", interval: "month" },
  });
  h = await createHarness({
    ipPrefix: "100.70.0",
    env: {
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_API_BASE: stripe.url,
      BILLING_PLANS: JSON.stringify([PLUS]),
      ADMIN_EMAILS: ADMIN_EMAIL,
    },
  });
  plain = await createHarness({
    ipPrefix: "100.71.0",
    env: { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined, BILLING_PLANS: "" },
  });
});

afterAll(async () => {
  await h.close();
  await plain.close();
  await stripe.close();
});

async function account(harness: Harness, tag: string, email = harness.uniqueEmail(tag)) {
  const client = harness.browser();
  await harness.signUp(client, email);
  return { client, email };
}

async function overview(client: TestBrowser) {
  const response = await client.get("/billing");
  expect(response.statusCode, response.body).toBe(200);
  return billingOverviewSchema.parse(response.json());
}

/** A signed Stripe event, as Stripe would deliver it. */
async function deliver(client: TestBrowser, event: { id: string; type: string; object: object }) {
  const payload = JSON.stringify({
    id: event.id,
    object: "event",
    type: event.type,
    data: { object: event.object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return client.raw("POST", "/billing/webhook", Buffer.from(payload), {
    "content-type": "application/json",
    "stripe-signature": signature,
  });
}

describe("plans", () => {
  it("puts new accounts on the free plan with today's limits, and lists paid plans with Stripe's prices", async () => {
    const { client } = await account(h, "billing-overview");
    const result = await overview(client);
    expect(result.plan).toMatchObject({ code: "free", name: "Free", price: null });
    expect(result.plan.limits.profiles).toBe(10);
    expect(result.source).toBe("free");
    expect(result.usage).toMatchObject({ profiles: 1, proxies: 0, driveFiles: 0 });
    expect(result.billing).toBe("available");
    expect(result.plans.map((plan) => plan.code)).toEqual(["free", "plus"]);
    expect(result.plans[1]?.price).toEqual({ amount: 900, currency: "eur", interval: "month" });
    // Public, for the pricing page.
    const plans = await h.browser().get("/billing/plans");
    expect(plans.statusCode).toBe(200);
  });

  it("says so when billing isn't set up, and offers nothing to pay for", async () => {
    const { client } = await account(plain, "billing-plain");
    const result = await overview(client);
    expect(result.billing).toBe("unavailable");
    expect(result.plans.map((plan) => plan.code)).toEqual(["free"]);
    const checkout = await client.post("/billing/checkout", { planCode: "plus" });
    expect(checkout.statusCode).toBe(503);
    expect(h.errorOf(checkout).code).toBe("service_unavailable");
  });
});

describe("checkout and webhooks", () => {
  it("starts checkout behind confirm-it's-you, applies the subscription once, and ends it", async () => {
    const { client, email } = await account(h, "billing-checkout");
    const checkout = await client.post("/billing/checkout", { planCode: "plus" });
    expect(checkout.statusCode, checkout.body).toBe(200);
    expect(checkout.json<{ url: string }>().url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const customer = stripe.customers.find((candidate) => candidate.email === email);
    expect(customer).toBeDefined();
    expect(stripe.checkouts.at(-1)).toMatchObject({
      mode: "subscription",
      customer: customer?.id,
      "line_items[0][price]": "price_plus_month",
      // A first subscription starts with the plan's trial; promotion codes are accepted.
      "subscription_data[trial_period_days]": "14",
      allow_promotion_codes: "true",
    });
    expect((await overview(client)).trialEligible).toBe(true);

    // Stripe reports the subscription; the plan and its limits follow.
    const subscriptionId = `sub_${Date.now().toString(36)}`;
    const subscription = subscriptionObject({
      id: subscriptionId,
      customer: customer?.id ?? "",
      status: "active",
      priceId: "price_plus_month",
    });
    const eventId = `evt_${Date.now().toString(36)}`;
    const first = await deliver(client, {
      id: eventId,
      type: "customer.subscription.created",
      object: subscription,
    });
    expect(first.statusCode, first.body).toBe(204);
    const after = await overview(client);
    expect(after.plan.code).toBe("plus");
    expect(after.source).toBe("stripe");
    expect(after.subscription).toMatchObject({
      status: "active",
      planCode: "plus",
      cancelAtPeriodEnd: false,
    });
    expect(await h.eventTypes(email)).toEqual(
      expect.arrayContaining(["billing.subscription_started"]),
    );

    // The plan's limits apply: two profiles, not three.
    const second = await client.post("/profiles", { name: "Second", color: "teal" });
    expect(second.statusCode, second.body).toBe(201);
    profileSchema.parse(second.json());
    const third = await client.post("/profiles", { name: "Third", color: "rose" });
    expect(third.statusCode).toBe(409);
    expect(h.errorOf(third).message).toContain("Your plan allows 2 profiles");

    // Redelivered events are applied once; a bad signature is refused.
    const again = await deliver(client, {
      id: eventId,
      type: "customer.subscription.created",
      object: subscription,
    });
    expect(again.statusCode).toBe(204);
    const forged = await client.raw("POST", "/billing/webhook", Buffer.from("{}"), {
      "content-type": "application/json",
      "stripe-signature": "t=1,v1=deadbeef",
    });
    expect(forged.statusCode).toBe(401);

    // The portal needs a recent sign-in, like checkout.
    await h.expireConfirmation(email);
    const stale = await client.post("/billing/portal");
    expect(stale.statusCode).toBe(403);
    expect(h.errorOf(stale).code).toBe("reauthentication_required");

    // Cancelled: back to free, said so in the history.
    const ended = await deliver(client, {
      id: `${eventId}_end`,
      type: "customer.subscription.deleted",
      object: subscriptionObject({
        id: subscriptionId,
        customer: customer?.id ?? "",
        status: "canceled",
        priceId: "price_plus_month",
      }),
    });
    expect(ended.statusCode).toBe(204);
    const final = await overview(client);
    expect(final.plan.code).toBe("free");
    expect(final.subscription?.status).toBe("canceled");
    expect(await h.eventTypes(email)).toEqual(
      expect.arrayContaining(["billing.subscription_ended"]),
    );

    // The trial was the first subscription's: coming back pays from day one.
    expect(final.trialEligible).toBe(false);
    expect(
      (await client.post("/auth/reauthenticate", { password: "violet-harbor-lantern" })).statusCode,
    ).toBe(200);
    const comeback = await client.post("/billing/checkout", { planCode: "plus" });
    expect(comeback.statusCode, comeback.body).toBe(200);
    expect(stripe.checkouts.at(-1)).not.toHaveProperty("subscription_data[trial_period_days]");
  });

  it("caps browsing minutes per month where the plan has a cap", async () => {
    const { client, email } = await account(h, "billing-cap");
    const admin = await account(h, "billing-cap-admin", ADMIN_EMAIL);
    const me = await client.get("/auth/session");
    const userId = me.json<{ account: { id: string } }>().account.id;
    const granted = await admin.client.put(`/admin/accounts/${userId}/plan`, {
      planCode: "plus",
      reason: "Testing the monthly cap",
    });
    expect(granted.statusCode, granted.body).toBe(200);
    // An hour of browsing earlier this month, straight into the records.
    await h.database.pool.query(
      `insert into browser_sessions (user_id, auth_session_id, engine, status, agent_secret, started_at, ended_at, end_reason)
       select $1, s.id, 'bee', 'ended', '', now() - interval '2 hours', now() - interval '1 hour', 'user'
         from auth_sessions s where s.user_id = $1 limit 1`,
      [userId],
    );
    expect((await overview(client)).usage.browsingMinutesThisMonth).toBe(60);
    const start = await client.post("/browser/sessions", {});
    expect(start.statusCode).toBe(403);
    expect(h.errorOf(start).code).toBe("limit_reached");
    expect(await h.eventTypes(email)).toEqual(expect.arrayContaining(["admin.plan_changed"]));
  });
});

describe("administration", () => {
  it("is for administrators only, lists and searches accounts, and sets plans by hand with a reason", async () => {
    const { client: user, email } = await account(h, "admin-target");
    const forbidden = await user.get("/admin/accounts");
    expect(forbidden.statusCode).toBe(403);
    expect(h.errorOf(forbidden).code).toBe("forbidden");

    const admin = h.browser();
    await h.signUp(admin, ADMIN_EMAIL).catch(() => undefined);
    // The address may already have an account from another test: sign in instead.
    if (!admin.session) {
      const signIn = await admin.post("/auth/login", {
        email: ADMIN_EMAIL,
        password: "violet-harbor-lantern",
      });
      expect(signIn.statusCode, signIn.body).toBe(200);
    }
    const me = await admin.get("/auth/session");
    expect(me.json<{ account: { role: string } }>().account.role).toBe("admin");

    const list = await admin.get(
      `/admin/accounts?q=${encodeURIComponent(email.split("@")[0] ?? "")}`,
    );
    expect(list.statusCode, list.body).toBe(200);
    const found = list.json<{ accounts: { id: string; email: string; planCode: string }[] }>()
      .accounts;
    expect(found.map((row) => row.email)).toEqual([email]);
    const id = found[0]?.id ?? "";

    const detail = await admin.get(`/admin/accounts/${id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      email,
      planCode: "free",
      source: "free",
      activeSessions: 1,
    });

    const tooShort = await admin.put(`/admin/accounts/${id}/plan`, {
      planCode: "plus",
      reason: "no",
    });
    expect(tooShort.statusCode).toBe(400);
    const set = await admin.put(`/admin/accounts/${id}/plan`, {
      planCode: "plus",
      reason: "Partner account for the pilot",
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toMatchObject({
      planCode: "plus",
      source: "admin",
      planNote: "Partner account for the pilot",
    });
    expect((await overview(user)).plan.code).toBe("plus");
    expect(await h.eventTypes(email)).toEqual(expect.arrayContaining(["admin.plan_changed"]));

    // Back to free hands control to Stripe (nothing there): free, no note.
    const back = await admin.put(`/admin/accounts/${id}/plan`, {
      planCode: "free",
      reason: "Pilot over",
    });
    expect(back.json()).toMatchObject({ planCode: "free", source: "free", planNote: null });

    // A stale confirmation blocks changes, like every sensitive action.
    await h.expireConfirmation(ADMIN_EMAIL);
    const stale = await admin.put(`/admin/accounts/${id}/plan`, {
      planCode: "plus",
      reason: "Once more",
    });
    expect(stale.statusCode).toBe(403);
    expect(h.errorOf(stale).code).toBe("reauthentication_required");
  });
});
