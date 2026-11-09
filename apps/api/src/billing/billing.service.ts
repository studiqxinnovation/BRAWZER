import {
  type BillingOverview,
  FREE_PLAN_CODE,
  type Plan,
  type PlanLimits,
  type PlanPrice,
  type PlanSource,
  planSourceSchema,
  type Subscription,
  subscriptionStatusSchema,
  type Usage,
} from "@brawzer/contracts";
import {
  and,
  count,
  type DatabaseHandle,
  eq,
  gte,
  inArray,
  schema,
  sql,
  type SubscriptionRow,
} from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { PlanCatalogue } from "./plans.js";
import { STRIPE, type Stripe } from "./stripe.js";
import { MetricsService } from "../metrics/metrics.service.js";

const logger = new Logger("Billing");
const PRICE_CACHE_MS = 10 * 60_000;
/** Subscription statuses that grant the paid plan. */
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

const notAvailable = () =>
  new ApiException(
    "service_unavailable",
    503,
    "Paid plans aren’t set up on this installation yet.",
  );

function toSubscription(row: SubscriptionRow): Subscription {
  const status = subscriptionStatusSchema.safeParse(row.status);
  return {
    status: status.success ? status.data : "canceled",
    planCode: row.planCode,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

/**
 * Plans and billing (Phase 6, ADR 0015). The plan in force is on the user
 * row (`planCode`, `planSource`), where every limit check reads it; Stripe's
 * webhooks and administrators write it. Prices are never stored or written
 * here: they are read from Stripe when shown.
 */
@Injectable()
export class BillingService {
  private readonly catalogue: PlanCatalogue;
  private priceCache: { at: number; prices: Map<string, PlanPrice> } | null = null;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(STRIPE) private readonly stripe: Stripe | null,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {
    this.catalogue = new PlanCatalogue(config.billing.plans);
  }

  get available(): boolean {
    return this.stripe !== null;
  }

  // ── Limits, for every other module ──────────────────────────────────

  /**
   * The plan in force for an account: its own, or its team owner's when it
   * is in a team (Phase 8, idea 19), and that owner, when it isn't the account.
   */
  private async planCodeFor(
    userId: string,
  ): Promise<{ code: string; team: { name: string; owner: string } | null }> {
    const result = await this.database.pool.query<{
      own: string;
      owner_plan: string | null;
      owner_id: string | null;
      owner_email: string | null;
      team_name: string | null;
    }>(
      `select u.plan_code as own, o.plan_code as owner_plan, o.id as owner_id,
              o.email as owner_email, t.name as team_name
       from users u
       left join team_members m on m.user_id = u.id
       left join teams t on t.id = m.team_id
       left join team_members om on om.team_id = m.team_id and om.role = 'owner'
       left join users o on o.id = om.user_id
       where u.id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return { code: FREE_PLAN_CODE, team: null };
    if (row.owner_id && row.owner_id !== userId && row.owner_plan !== null) {
      return {
        code: row.owner_plan,
        team: { name: row.team_name ?? "", owner: row.owner_email ?? "" },
      };
    }
    return { code: row.own, team: null };
  }

  /** The limits the account's plan allows (its team owner's plan, in a team). */
  async limitsFor(userId: string): Promise<PlanLimits> {
    return this.catalogue.limits((await this.planCodeFor(userId)).code);
  }

  /** The plan in force, described, without asking Stripe for prices. */
  async planOf(userId: string): Promise<Plan> {
    return this.catalogue.describe((await this.planCodeFor(userId)).code);
  }

  /** Whether the account pays for a subscription of its own (a team member must not). */
  async hasOwnSubscription(userId: string): Promise<boolean> {
    const [row] = await this.database.db
      .select({ status: schema.subscriptions.status })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, userId))
      .limit(1);
    return row !== undefined && PAID_STATUSES.has(row.status);
  }

  /** Cloud browser minutes in the current calendar month (UTC), live sessions counted to now. */
  async browsingMinutesThisMonth(userId: string, now = new Date()): Promise<number> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [row] = await this.database.db
      .select({
        // Sums come back as strings from PostgreSQL.
        seconds: sql<
          string | number
        >`coalesce(sum(extract(epoch from (coalesce(${schema.browserSessions.endedAt}, now()) - greatest(${schema.browserSessions.startedAt}, ${monthStart})))), 0)`,
      })
      .from(schema.browserSessions)
      .where(
        and(
          eq(schema.browserSessions.userId, userId),
          gte(sql`coalesce(${schema.browserSessions.endedAt}, now())`, monthStart),
          sql`${schema.browserSessions.startedAt} is not null`,
        ),
      );
    return Math.max(0, Math.round(Number(row?.seconds ?? 0) / 60));
  }

  async usage(userId: string): Promise<Usage> {
    const [profiles, proxies, drive, minutes] = await Promise.all([
      this.database.db
        .select({ count: count() })
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, userId)),
      this.database.db
        .select({ count: count() })
        .from(schema.proxies)
        .where(eq(schema.proxies.userId, userId)),
      this.database.db
        .select({
          bytes: sql<string | number>`coalesce(sum(${schema.driveFiles.size}), 0)`,
          files: count(),
        })
        .from(schema.driveFiles)
        .where(eq(schema.driveFiles.userId, userId)),
      this.browsingMinutesThisMonth(userId),
    ]);
    return {
      profiles: profiles[0]?.count ?? 0,
      proxies: proxies[0]?.count ?? 0,
      driveBytes: Number(drive[0]?.bytes ?? 0),
      driveFiles: drive[0]?.files ?? 0,
      browsingMinutesThisMonth: minutes,
    };
  }

  // ── Reads ───────────────────────────────────────────────────────────

  async overview(userId: string): Promise<BillingOverview> {
    const [user] = await this.database.db
      .select({ planCode: schema.users.planCode, planSource: schema.users.planSource })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const source = planSourceSchema.safeParse(user?.planSource);
    const [subscription] = await this.database.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, userId))
      .limit(1);
    const prices = await this.prices();
    const plans = await this.publicPlans(prices);
    const inForce = await this.planCodeFor(userId);
    const code = inForce.team ? inForce.code : (user?.planCode ?? FREE_PLAN_CODE);
    return {
      plan: this.describe(code, prices),
      team: inForce.team,
      source: source.success ? source.data : "free",
      usage: await this.usage(userId),
      subscription: subscription ? toSubscription(subscription) : null,
      plans,
      billing: this.available ? "available" : "unavailable",
      trialEligible: !subscription?.stripeSubscriptionId,
    };
  }

  /** Every plan, free first, with prices when Stripe answers. */
  async publicPlans(prices?: Map<string, PlanPrice>): Promise<Plan[]> {
    const known = prices ?? (await this.prices());
    return [
      this.catalogue.describe(FREE_PLAN_CODE),
      ...this.catalogue.paid.map((plan) => this.describe(plan.code, known)),
    ];
  }

  private describe(code: string, prices: Map<string, PlanPrice>): Plan {
    const definition = this.catalogue.definition(code);
    return this.catalogue.describe(
      code,
      definition ? (prices.get(definition.stripePriceId) ?? null) : null,
    );
  }

  /** Stripe's prices for the configured plans, cached briefly; empty without Stripe. */
  private async prices(): Promise<Map<string, PlanPrice>> {
    if (!this.stripe || this.catalogue.paid.length === 0) return new Map();
    if (this.priceCache && Date.now() - this.priceCache.at < PRICE_CACHE_MS) {
      return this.priceCache.prices;
    }
    const prices = new Map<string, PlanPrice>();
    for (const plan of this.catalogue.paid) {
      try {
        const price = await this.stripe.prices.retrieve(plan.stripePriceId);
        const interval = String(price.recurring?.interval ?? "");
        if (price.unit_amount !== null && (interval === "month" || interval === "year")) {
          prices.set(plan.stripePriceId, {
            amount: price.unit_amount,
            currency: price.currency,
            interval,
          });
        }
      } catch (error) {
        logger.warn(
          `Could not read the price of plan ${plan.code}: ${error instanceof Error ? error.message : ""}`,
        );
      }
    }
    this.priceCache = { at: Date.now(), prices };
    return prices;
  }

  // ── Checkout and the portal ─────────────────────────────────────────

  async checkout(
    auth: { user: { id: string; email: string }; session: { id: string } },
    planCode: string,
  ): Promise<string> {
    if ((await this.planCodeFor(auth.user.id)).team) {
      throw new ApiException(
        "conflict",
        409,
        "Your plan comes from your team. Leave the team to choose a plan of your own.",
      );
    }
    if (!this.stripe) throw notAvailable();
    const plan = this.catalogue.definition(planCode);
    if (!plan) throw new ApiException("not_found", 404, "That plan doesn’t exist.");
    const customerId = await this.customerFor(auth.user);
    // A trial is for a first subscription only: an account that has had one pays from day one.
    const [previous] = await this.database.db
      .select({ subscriptionId: schema.subscriptions.stripeSubscriptionId })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, auth.user.id))
      .limit(1);
    const trialDays = plan.trialDays && !previous?.subscriptionId ? plan.trialDays : null;
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${this.config.webOrigin}/app/account?billing=success`,
      cancel_url: `${this.config.webOrigin}/app/account?billing=cancelled`,
      client_reference_id: auth.user.id,
      metadata: { userId: auth.user.id, planCode: plan.code },
      subscription_data: {
        metadata: { userId: auth.user.id, planCode: plan.code },
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
      allow_promotion_codes: true,
    });
    if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
    return session.url;
  }

  async portal(auth: { user: { id: string; email: string } }): Promise<string> {
    if (!this.stripe) throw notAvailable();
    const customerId = await this.customerFor(auth.user);
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.config.webOrigin}/app/account`,
    });
    return session.url;
  }

  /** The account's Stripe customer, created on first use and remembered. */
  private async customerFor(user: { id: string; email: string }): Promise<string> {
    if (!this.stripe) throw notAvailable();
    const [existing] = await this.database.db
      .select({ customer: schema.subscriptions.stripeCustomerId })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, user.id))
      .limit(1);
    if (existing) return existing.customer;
    const customer = await this.stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    await this.database.db
      .insert(schema.subscriptions)
      .values({
        userId: user.id,
        stripeCustomerId: customer.id,
        status: "incomplete",
        planCode: FREE_PLAN_CODE,
      })
      .onConflictDoNothing({ target: schema.subscriptions.userId });
    return customer.id;
  }

  // ── Webhooks ────────────────────────────────────────────────────────

  /** Verifies and applies one Stripe event; redeliveries are applied once. */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<void> {
    if (!this.stripe || !this.config.billing.webhookSecret) throw notAvailable();
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature ?? "",
        this.config.billing.webhookSecret,
      );
    } catch {
      this.metrics.count("brawzer_stripe_webhooks_total", "Stripe webhooks, by result.", {
        result: "bad_signature",
      });
      throw new ApiException("unauthorized", 401, "The webhook signature is invalid.");
    }
    this.metrics.count("brawzer_stripe_webhooks_total", "Stripe webhooks, by result.", {
      result: "received",
    });
    const seen = await this.database.db
      .insert(schema.billingEvents)
      .values({ stripeEventId: event.id, type: event.type })
      .onConflictDoNothing({ target: schema.billingEvents.stripeEventId })
      .returning({ id: schema.billingEvents.stripeEventId });
    if (seen.length === 0) return;

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await this.applySubscription(event.data.object);
        return;
      case "checkout.session.completed": {
        const session = event.data.object;
        if (typeof session.subscription === "string") {
          const subscription = await this.stripe.subscriptions.retrieve(session.subscription);
          await this.applySubscription(subscription);
        }
        return;
      }
      default:
        return;
    }
  }

  /** Mirrors a Stripe subscription onto the account and sets its plan. */
  private async applySubscription(subscription: Stripe.Subscription): Promise<void> {
    const customerId =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const [row] = await this.database.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.stripeCustomerId, customerId))
      .limit(1);
    if (!row) {
      logger.warn(`Stripe subscription for unknown customer ${customerId}`);
      return;
    }
    const priceId = subscription.items.data[0]?.price.id ?? "";
    const plan = this.catalogue.byPrice(priceId);
    const paid = PAID_STATUSES.has(subscription.status) && plan !== null;
    const planCode = paid ? plan.code : FREE_PLAN_CODE;
    const periodEnd = subscription.items.data[0]?.current_period_end;
    await this.database.db
      .update(schema.subscriptions)
      .set({
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        planCode,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptions.id, row.id));

    const [user] = await this.database.db
      .select({ planCode: schema.users.planCode, planSource: schema.users.planSource })
      .from(schema.users)
      .where(eq(schema.users.id, row.userId))
      .limit(1);
    if (!user) return;
    // An administrator's grant outranks Stripe until the administrator ends it.
    if (user.planSource === "admin") return;
    const nextSource: PlanSource = paid ? "stripe" : "free";
    if (user.planCode === planCode && user.planSource === nextSource) return;
    await this.setPlan(row.userId, planCode, nextSource, null);
    const type =
      user.planCode === FREE_PLAN_CODE && paid
        ? "billing.subscription_started"
        : paid
          ? "billing.subscription_changed"
          : "billing.subscription_ended";
    await this.events.record({
      type,
      userId: row.userId,
      meta: { ip: null, userAgent: null },
      metadata: { plan: planCode },
    });
  }

  // ── Administration ──────────────────────────────────────────────────

  /** Sets the plan by hand; `free` with source `free` hands control back to Stripe. */
  async setPlanByAdmin(
    /** Null for an operator at the command line, who has no sign-in. */
    actor: { user: { id: string }; session: { id: string } } | null,
    userId: string,
    planCode: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (!this.catalogue.has(planCode)) {
      throw new ApiException("not_found", 404, "That plan doesn’t exist.");
    }
    const [subscription] = await this.database.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, userId))
      .limit(1);
    // Handing control back: whatever Stripe says applies, or the free plan.
    const stripeGrants =
      subscription && PAID_STATUSES.has(subscription.status) ? subscription.planCode : null;
    const source: PlanSource =
      planCode === FREE_PLAN_CODE ? (stripeGrants ? "stripe" : "free") : "admin";
    const effective = planCode === FREE_PLAN_CODE && stripeGrants ? stripeGrants : planCode;
    await this.setPlan(userId, effective, source, source === "admin" ? reason : null);
    await this.events.record({
      type: "admin.plan_changed",
      userId,
      sessionId: actor?.session.id ?? null,
      meta,
      metadata: { plan: effective, reason },
    });
  }

  private async setPlan(
    userId: string,
    planCode: string,
    source: PlanSource,
    note: string | null,
  ): Promise<void> {
    await this.database.db
      .update(schema.users)
      .set({ planCode, planSource: source, planNote: note, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  /** For tests and the admin page: the plans the installation knows. */
  get plans(): PlanCatalogue {
    return this.catalogue;
  }

  /** Accounts whose plan a removed configuration no longer defines fall back to free at read time; nothing to do here. */
  static readonly PAID_STATUSES = PAID_STATUSES;

  /** Tests: the statuses in use. */
  static isPaid(status: string): boolean {
    return PAID_STATUSES.has(status);
  }

  /** Tests and the admin page: which of several accounts are on which plan. */
  async plansOf(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.database.db
      .select({ id: schema.users.id, planCode: schema.users.planCode })
      .from(schema.users)
      .where(inArray(schema.users.id, [...userIds]));
    return new Map(rows.map((row) => [row.id, row.planCode]));
  }
}
