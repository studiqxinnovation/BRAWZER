import { randomUUID } from "node:crypto";
import {
  approvalListSchema,
  couponListSchema,
  couponResultSchema,
  financeSchema,
  invoiceListSchema,
  refundResultSchema,
  subscriptionListSchema,
  upgradeSignalListSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FakeStripe, fakeStripe } from "./support/fake-stripe.js";
import { createHarness, type Harness } from "./support/harness.js";

const PLANS = [
  {
    code: "plus",
    name: "Plus",
    stripePriceId: "price_console_plus",
    limits: {
      profiles: 10,
      proxies: 10,
      driveBytes: 20 * 1024 ** 3,
      driveFiles: 10_000,
      driveFolders: 500,
      browsingMinutesPerMonth: 6000,
      liveSessions: 3,
    },
  },
];

let stripe: FakeStripe;
let h: Harness;

beforeAll(async () => {
  stripe = await fakeStripe({
    price_console_plus: { unit_amount: 900, currency: "gbp", interval: "month" },
  });
  h = await createHarness({
    ipPrefix: "100.84.0",
    env: {
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_console_test",
      STRIPE_API_BASE: stripe.url,
      BILLING_PLANS: JSON.stringify(PLANS),
    },
  });
});

afterAll(async () => {
  await h.close();
  await stripe.close();
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

// The local database persists between runs; a per-run id keeps the audit query to this run.
const BIG = `in_console_big_${Date.now().toString(36)}`;

describe("the money pages", () => {
  it("lists subscriptions, invoices and finance from Brawzer's and Stripe's records", async () => {
    // A paying customer, as a webhook would have left them.
    const customer = h.browser();
    const customerEmail = h.uniqueEmail("payer");
    await h.signUp(customer, customerEmail);
    const id = await userId(customerEmail);
    const stripeCustomer = `cus_console_${randomUUID().slice(0, 8)}`;
    await h.database.pool.query(
      `insert into subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan_code, current_period_end)
       values ($1, $2, $3, 'past_due', 'plus', now() + interval '20 days')`,
      [id, stripeCustomer, `sub_${randomUUID().slice(0, 8)}`],
    );
    await h.database.pool.query(
      "update users set plan_code = 'plus', plan_source = 'stripe' where id = $1",
      [id],
    );
    stripe.invoices.push({
      id: "in_console_1",
      object: "invoice",
      number: "BRZ-0001",
      customer: stripeCustomer,
      created: Math.floor(Date.now() / 1000) - 3600,
      status: "paid",
      total: 900,
      currency: "gbp",
      amount_paid: 900,
      amount_refunded: 0,
      hosted_invoice_url: "https://invoice.stripe.test/in_console_1",
      invoice_pdf: null,
      payment_intent: "pi_console_1",
    });

    const { client: billing } = await staff("billing");
    const subs = subscriptionListSchema.parse(
      (await billing.get("/console/billing/subscriptions")).json(),
    );
    expect(subs.stripeConfigured).toBe(true);
    const mine = subs.subscriptions.find((entry) => entry.customer.id === id);
    expect(mine?.status).toBe("past_due");
    expect(mine?.planName).toBe("Plus");
    expect(mine?.mrr).toEqual({ amount: 900, currency: "gbp" });
    expect(subs.counts.past_due).toBeGreaterThan(0);
    expect(subs.atRisk.amount).toBeGreaterThanOrEqual(900);
    expect(mine?.customer.email).toContain("***");

    const invoices = invoiceListSchema.parse(
      (await billing.get(`/console/billing/invoices?customer=${id}`)).json(),
    );
    expect(invoices.invoices.map((entry) => entry.id)).toEqual(["in_console_1"]);
    expect(invoices.invoices[0]?.customer?.id).toBe(id);
    expect(invoices.invoices[0]?.number).toBe("BRZ-0001");

    const finance = financeSchema.parse((await billing.get("/console/billing/finance")).json());
    expect(finance.currency).toBe("gbp");
    expect(finance.months).toHaveLength(12);
    expect(finance.months.at(-1)?.end).toBeGreaterThanOrEqual(900);

    // Sales reads the upgrade signals; billing may not.
    expect((await billing.get("/console/billing/upgrade-signals")).statusCode).toBe(403);
    const { client: sales } = await staff("sales");
    const signals = upgradeSignalListSchema.parse(
      (await sales.get("/console/billing/upgrade-signals")).json(),
    );
    expect(Array.isArray(signals.accounts)).toBe(true);
    expect((await sales.get("/console/billing/subscriptions")).statusCode).toBe(403);
  });

  it("refunds within the limit, and sends bigger refunds to a founder who isn't the asker", async () => {
    const stripeCustomer = `cus_console_${randomUUID().slice(0, 8)}`;
    stripe.invoices.unshift({
      id: BIG,
      object: "invoice",
      number: "BRZ-0002",
      customer: stripeCustomer,
      created: Math.floor(Date.now() / 1000),
      status: "paid",
      total: 90_000,
      currency: "gbp",
      amount_paid: 90_000,
      amount_refunded: 0,
      hosted_invoice_url: null,
      invoice_pdf: null,
      payment_intent: "pi_console_big",
    });

    // Care may refund up to £50; £20 goes straight through.
    const { client: care, email: careEmail } = await staff("care");
    const small = await care.post(`/console/billing/invoices/${BIG}/refund`, {
      amount: 2000,
      reason: "Charged twice in one day",
    });
    expect(small.statusCode, small.body).toBe(200);
    expect(refundResultSchema.parse(small.json()).outcome).toBe("refunded");
    expect(stripe.refunds.at(-1)?.payment_intent).toBe("pi_console_big");
    expect(stripe.refunds.at(-1)?.amount).toBe("2000");

    // £600 is over care's limit: it waits.
    const big = await care.post(`/console/billing/invoices/${BIG}/refund`, {
      amount: 60_000,
      reason: "Cancelled within the first week",
    });
    expect(big.statusCode, big.body).toBe(200);
    const waiting = refundResultSchema.parse(big.json());
    expect(waiting.outcome).toBe("awaiting_approval");
    expect(stripe.refunds.filter((entry) => entry.amount === "60000")).toHaveLength(0);
    // More than is left can't even be asked for.
    const tooMuch = await care.post(`/console/billing/invoices/${BIG}/refund`, {
      amount: 100_000,
      reason: "All of it",
    });
    expect(tooMuch.statusCode).toBe(422);

    // Only founders see approvals; the asker couldn't approve anyway.
    expect((await care.get("/console/billing/approvals")).statusCode).toBe(403);
    const { client: founder } = await staff("admin");
    const list = approvalListSchema.parse((await founder.get("/console/billing/approvals")).json());
    const request = list.approvals.find((entry) => entry.id === waiting.approvalId);
    expect(request?.status).toBe("waiting");
    expect(request?.requestedBy).toBe(careEmail);
    expect(request?.amount).toEqual({ amount: 60_000, currency: "gbp" });

    const approved = await founder.post(
      `/console/billing/approvals/${waiting.approvalId ?? ""}/approve`,
      {},
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(
      approvalListSchema
        .parse(approved.json())
        .approvals.find((entry) => entry.id === waiting.approvalId)?.status,
    ).toBe("approved");
    expect(stripe.refunds.at(-1)?.amount).toBe("60000");
    // Deciding twice is impossible.
    expect(
      (
        await founder.post(`/console/billing/approvals/${waiting.approvalId ?? ""}/decline`, {
          reason: "No",
        })
      ).statusCode,
    ).toBe(409);

    const audit = await h.database.pool.query<{ action: string }>(
      "select action from staff_actions where target = $1 order by created_at",
      [BIG],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "Refunded an invoice",
      "Requested approval: refund",
      "Approved refund",
    ]);
  });

  it("makes promotion codes, and sends deep discounts to a founder", async () => {
    const { client: billing } = await staff("billing");
    const made = await billing.post("/console/billing/coupons", {
      code: "spring10",
      percentOff: 10,
      duration: "repeating",
      durationInMonths: 3,
      maxRedemptions: 100,
    });
    expect(made.statusCode, made.body).toBe(200);
    const result = couponResultSchema.parse(made.json());
    expect(result.outcome).toBe("created");
    const coupon = result.list.coupons.find((entry) => entry.code === "SPRING10");
    expect(coupon?.gives).toBe("10% off, for 3 months");
    expect(coupon?.maxRedemptions).toBe(100);
    expect(coupon?.active).toBe(true);

    const off = await billing.patch(`/console/billing/coupons/${coupon?.id ?? ""}`, {
      active: false,
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(
      couponListSchema.parse(off.json()).coupons.find((entry) => entry.id === coupon?.id)?.active,
    ).toBe(false);

    // 40% off from billing waits for a founder, who then makes it.
    const deep = await billing.post("/console/billing/coupons", {
      code: "BLACKFRIDAY",
      percentOff: 40,
      duration: "once",
    });
    expect(deep.statusCode, deep.body).toBe(200);
    const pending = couponResultSchema.parse(deep.json());
    expect(pending.outcome).toBe("awaiting_approval");
    expect(pending.list.coupons.some((entry) => entry.code === "BLACKFRIDAY")).toBe(false);
    const { client: founder } = await staff("admin");
    const approved = await founder.post(
      `/console/billing/approvals/${pending.approvalId ?? ""}/approve`,
      {
        reason: "Agreed for the campaign",
      },
    );
    expect(approved.statusCode, approved.body).toBe(200);
    const after = couponListSchema.parse((await billing.get("/console/billing/coupons")).json());
    expect(
      after.coupons.some((entry) => entry.code === "BLACKFRIDAY" && entry.percentOff === 40),
    ).toBe(true);

    // Not a valid code, and both a percentage and an amount: refused before Stripe hears of it.
    expect(
      (
        await billing.post("/console/billing/coupons", {
          code: "no spaces",
          percentOff: 5,
          duration: "once",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await billing.post("/console/billing/coupons", {
          code: "BOTH",
          percentOff: 5,
          amountOff: 500,
          currency: "gbp",
          duration: "once",
        })
      ).statusCode,
    ).toBe(400);
  });
});
