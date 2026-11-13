import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Enough of Stripe's API for the billing tests: customers, checkout and
 * portal sessions, prices and subscriptions. Records what was asked, so a
 * test can check what the API sent (and that it sent no card data, which
 * Brawzer never sees).
 */
export interface FakeStripe {
  url: string;
  customers: { id: string; email: string; metadata: Record<string, string> }[];
  checkouts: Record<string, string>[];
  portals: Record<string, string>[];
  /** Subscriptions a test wants `GET /v1/subscriptions/:id` to answer with. */
  subscriptions: Map<string, object>;
  /** Invoices a test wants `GET /v1/invoices` to list (newest first). */
  invoices: Record<string, unknown>[];
  /** Refunds the API asked for. */
  refunds: Record<string, string>[];
  /** Coupons and promotion codes the API created, as Stripe would hold them. */
  coupons: Record<string, unknown>[];
  promotionCodes: Record<string, unknown>[];
  close(): Promise<void>;
}

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) out[key] = value;
  return out;
}

export function fakeStripe(
  prices: Record<string, { unit_amount: number; currency: string; interval: string }>,
): Promise<FakeStripe> {
  const state: Omit<FakeStripe, "url" | "close"> = {
    customers: [],
    checkouts: [],
    portals: [],
    subscriptions: new Map(),
    invoices: [],
    refunds: [],
    coupons: [],
    promotionCodes: [],
  };
  // Ids are unique per run: the local database outlives a test run.
  const run = Date.now().toString(36);
  let counter = 0;
  const next = (prefix: string) => `${prefix}_${run}_${String(++counter)}`;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      const json = (status: number, payload: object) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (!req.headers.authorization?.startsWith("Bearer sk_")) {
        json(401, { error: { message: "no key" } });
        return;
      }
      const url = new URL(req.url ?? "/", "http://stripe");
      const form = parseForm(body);
      if (req.method === "POST" && url.pathname === "/v1/customers") {
        const customer = {
          id: next("cus"),
          email: form.email ?? "",
          metadata: { userId: form["metadata[userId]"] ?? "" },
        };
        state.customers.push(customer);
        json(200, { id: customer.id, object: "customer", email: customer.email });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
        state.checkouts.push(form);
        json(200, {
          id: next("cs"),
          object: "checkout.session",
          url: `https://checkout.stripe.test/c/${String(counter)}`,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") {
        state.portals.push(form);
        json(200, {
          id: next("bps"),
          object: "billing_portal.session",
          url: `https://billing.stripe.test/p/${String(counter)}`,
        });
        return;
      }
      const price = /^\/v1\/prices\/(.+)$/.exec(url.pathname);
      if (req.method === "GET" && price) {
        const known = prices[price[1] ?? ""];
        if (!known) {
          json(404, { error: { message: "No such price" } });
          return;
        }
        json(200, {
          id: price[1],
          object: "price",
          unit_amount: known.unit_amount,
          currency: known.currency,
          recurring: { interval: known.interval },
        });
        return;
      }
      const subscription = /^\/v1\/subscriptions\/(.+)$/.exec(url.pathname);
      if (req.method === "GET" && subscription) {
        const known = state.subscriptions.get(subscription[1] ?? "");
        if (!known) {
          json(404, { error: { message: "No such subscription" } });
          return;
        }
        json(200, known);
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/invoices") {
        const customer = url.searchParams.get("customer");
        const limit = Number(url.searchParams.get("limit") ?? "10");
        const after = url.searchParams.get("starting_after");
        let data = state.invoices.filter((invoice) => !customer || invoice.customer === customer);
        if (after) {
          const index = data.findIndex((invoice) => invoice.id === after);
          data = index >= 0 ? data.slice(index + 1) : [];
        }
        json(200, { object: "list", data: data.slice(0, limit), has_more: data.length > limit });
        return;
      }
      const invoiceById = /^\/v1\/invoices\/(.+)$/.exec(url.pathname);
      if (req.method === "GET" && invoiceById) {
        const known = state.invoices.find((entry) => entry.id === invoiceById[1]);
        if (!known) {
          json(404, { error: { message: "No such invoice" } });
          return;
        }
        json(200, known);
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/refunds") {
        state.refunds.push(form);
        const invoice = state.invoices.find(
          (entry) => entry.payment_intent === form.payment_intent,
        );
        if (invoice) {
          invoice.amount_refunded = Number(invoice.amount_refunded ?? 0) + Number(form.amount ?? 0);
        }
        json(200, {
          id: next("re"),
          object: "refund",
          amount: Number(form.amount ?? 0),
          status: "succeeded",
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/coupons") {
        const coupon = {
          id: next("coup"),
          object: "coupon",
          name: form.name ?? null,
          percent_off: form.percent_off ? Number(form.percent_off) : null,
          amount_off: form.amount_off ? Number(form.amount_off) : null,
          currency: form.currency ?? null,
          duration: form.duration ?? "once",
          duration_in_months: form.duration_in_months ? Number(form.duration_in_months) : null,
        };
        state.coupons.push(coupon);
        json(200, coupon);
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/promotion_codes") {
        const coupon =
          state.coupons.find((entry) => entry.id === form["promotion[coupon]"]) ?? null;
        const code = {
          id: next("promo"),
          object: "promotion_code",
          code: form.code ?? "",
          active: true,
          promotion: { type: "coupon", coupon },
          times_redeemed: 0,
          max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
          expires_at: form.expires_at ? Number(form.expires_at) : null,
        };
        state.promotionCodes.push(code);
        json(200, code);
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/promotion_codes") {
        json(200, { object: "list", data: [...state.promotionCodes].reverse(), has_more: false });
        return;
      }
      const promo = /^\/v1\/promotion_codes\/(.+)$/.exec(url.pathname);
      if (req.method === "POST" && promo) {
        const code = state.promotionCodes.find((entry) => entry.id === promo[1]);
        if (!code) {
          json(404, { error: { message: "No such promotion code" } });
          return;
        }
        if (form.active !== undefined) code.active = form.active === "true";
        json(200, code);
        return;
      }
      json(404, { error: { message: `Unexpected ${req.method ?? ""} ${url.pathname}` } });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        ...state,
        url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

/** A subscription object as Stripe would send it in an event or answer. */
export function subscriptionObject(input: {
  id: string;
  customer: string;
  status: string;
  priceId: string;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}): object {
  return {
    id: input.id,
    object: "subscription",
    customer: input.customer,
    status: input.status,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    items: {
      object: "list",
      data: [
        {
          id: `si_${input.id}`,
          object: "subscription_item",
          price: { id: input.priceId, object: "price" },
          current_period_end: input.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * 86_400,
        },
      ],
    },
  };
}
