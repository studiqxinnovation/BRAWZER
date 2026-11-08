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
