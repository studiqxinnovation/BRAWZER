import {
  type Approval,
  type ApprovalList,
  COUPON_APPROVAL_PERCENT,
  type CouponList,
  type CouponResult,
  type CreateCouponRequest,
  FREE_PLAN_CODE,
  type Finance,
  type InvoiceList,
  type Money,
  refundLimitsMinor,
  type StaffCoupon,
  type StaffInvoice,
  type StaffRole,
  type SubscriptionList,
  type UpgradeSignalList,
} from "@brawzer/contracts";
import {
  and,
  count,
  type DatabaseHandle,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { BillingService } from "../billing/billing.service.js";
import { STRIPE, type Stripe } from "../billing/stripe.js";
import { ApiException } from "../common/api-exception.js";
import { DATABASE } from "../database/database.module.js";
import { maskEmail } from "../email/transports.js";

/** Who is doing something in the console. */
export interface StaffViewer {
  user: { id: string; email: string; role: string };
}

type ApprovalRow = typeof schema.approvals.$inferSelect;

const DAY = 86_400_000;
const PAYING = ["active", "trialing", "past_due"] as const;
const PAGE = 50;

const handleOf = (email: string) => email.split("@")[0] ?? email;
const noStripe = () =>
  new ApiException("service_unavailable", 503, "Stripe isn’t configured on this installation.");

/** Fields the installed Stripe types may not name on an invoice, read defensively. */
interface InvoiceLike {
  id: string;
  number?: string | null;
  customer?: string | { id: string } | null;
  created: number;
  status?: string | null;
  total?: number | null;
  currency: string;
  amount_paid?: number | null;
  amount_refunded?: number | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  payment_intent?: string | { id: string } | null;
  charge?: string | { id: string; amount_refunded?: number } | null;
}

/**
 * The console's money pages (Phase 11.3). Subscriptions and finance come from
 * Brawzer's own records of what Stripe told it; invoices, refunds and coupons
 * are Stripe's, read and written live. Without Stripe, each page says so.
 */
@Injectable()
export class BillingConsoleService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(STRIPE) private readonly stripe: Stripe | null,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /* ── Prices ── */

  /** Monthly revenue per plan code, in minor units, and the catalogue's currency. */
  private async monthlyPrices(): Promise<{ byPlan: Map<string, number>; currency: string }> {
    const plans = await this.billing.publicPlans();
    const byPlan = new Map<string, number>();
    let currency = "gbp";
    for (const plan of plans) {
      if (!plan.price) continue;
      currency = plan.price.currency;
      byPlan.set(
        plan.code,
        plan.price.interval === "year" ? Math.round(plan.price.amount / 12) : plan.price.amount,
      );
    }
    return { byPlan, currency };
  }

  private async customerRefs(
    viewer: StaffViewer,
    userIds: readonly string[],
  ): Promise<Map<string, { id: string; handle: string; email: string; planName: string }>> {
    if (userIds.length === 0) return new Map();
    const [users, plans] = await Promise.all([
      this.database.db
        .select({ id: schema.users.id, email: schema.users.email, planCode: schema.users.planCode })
        .from(schema.users)
        .where(inArray(schema.users.id, [...userIds])),
      this.billing.publicPlans(),
    ]);
    const planName = new Map(plans.map((plan) => [plan.code, plan.name]));
    const founder = viewer.user.role === "admin";
    return new Map(
      users.map((user) => [
        user.id,
        {
          id: user.id,
          handle: handleOf(user.email),
          email: founder ? user.email : maskEmail(user.email),
          planName: planName.get(user.planCode) ?? user.planCode,
        },
      ]),
    );
  }

  /* ── Subscriptions ── */

  async subscriptions(viewer: StaffViewer): Promise<SubscriptionList> {
    const rows = await this.database.db
      .select()
      .from(schema.subscriptions)
      .orderBy(desc(schema.subscriptions.updatedAt))
      .limit(500);
    const [{ byPlan, currency }, refs, [byHand]] = await Promise.all([
      this.monthlyPrices(),
      this.customerRefs(
        viewer,
        rows.map((row) => row.userId),
      ),
      this.database.db
        .select({ value: count() })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.planSource, "admin"),
            sql`${schema.users.planCode} <> ${FREE_PLAN_CODE}`,
          ),
        ),
    ]);
    const plans = await this.billing.publicPlans();
    const planName = new Map(plans.map((plan) => [plan.code, plan.name]));
    const subscriptions = rows.flatMap((row) => {
      const customer = refs.get(row.userId);
      if (!customer) return [];
      const monthly = byPlan.get(row.planCode);
      return [
        {
          id: row.id,
          customer,
          planCode: row.planCode,
          planName: planName.get(row.planCode) ?? row.planCode,
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          createdAt: row.createdAt.toISOString(),
          mrr: monthly === undefined ? null : { amount: monthly, currency },
        },
      ];
    });
    const paying = subscriptions.filter((entry) =>
      (PAYING as readonly string[]).includes(entry.status),
    );
    const pastDue = paying.filter((entry) => entry.status === "past_due");
    return {
      stripeConfigured: this.stripe !== null,
      subscriptions,
      counts: {
        all: paying.length,
        past_due: pastDue.length,
        trialing: paying.filter((entry) => entry.status === "trialing").length,
        cancelling: paying.filter((entry) => entry.cancelAtPeriodEnd).length,
      },
      atRisk: {
        amount: pastDue.reduce((sum, entry) => sum + (entry.mrr?.amount ?? 0), 0),
        currency,
      },
      setByHand: byHand?.value ?? 0,
    };
  }

  /* ── Invoices and refunds ── */

  async invoices(
    viewer: StaffViewer,
    query: { customer?: string; after?: string },
  ): Promise<InvoiceList> {
    if (!this.stripe) return { stripeConfigured: false, invoices: [], hasMore: false };
    let stripeCustomer: string | undefined;
    if (query.customer) {
      const [row] = await this.database.db
        .select({ stripeCustomerId: schema.subscriptions.stripeCustomerId })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, query.customer))
        .limit(1);
      if (!row) return { stripeConfigured: true, invoices: [], hasMore: false };
      stripeCustomer = row.stripeCustomerId;
    }
    const page = await this.stripe.invoices.list({
      limit: PAGE,
      ...(stripeCustomer ? { customer: stripeCustomer } : {}),
      ...(query.after ? { starting_after: query.after } : {}),
    });
    const raw = page.data as unknown as InvoiceLike[];
    const stripeIds = [
      ...new Set(
        raw.flatMap((invoice) => {
          const id = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
          return id ? [id] : [];
        }),
      ),
    ];
    const links = stripeIds.length
      ? await this.database.db
          .select({
            stripeCustomerId: schema.subscriptions.stripeCustomerId,
            userId: schema.subscriptions.userId,
          })
          .from(schema.subscriptions)
          .where(inArray(schema.subscriptions.stripeCustomerId, stripeIds))
      : [];
    const userBy = new Map(links.map((link) => [link.stripeCustomerId, link.userId]));
    const refs = await this.customerRefs(viewer, [...new Set(userBy.values())]);
    const invoices: StaffInvoice[] = raw.map((invoice) => {
      const stripeCustomerId =
        typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);
      const userId = stripeCustomerId ? userBy.get(stripeCustomerId) : undefined;
      const charge = typeof invoice.charge === "object" ? invoice.charge : null;
      return {
        id: invoice.id,
        number: invoice.number ?? null,
        customer: userId ? (refs.get(userId) ?? null) : null,
        stripeCustomerId,
        createdAt: new Date(invoice.created * 1000).toISOString(),
        status: invoice.status ?? "unknown",
        total: { amount: invoice.total ?? 0, currency: invoice.currency },
        amountPaid: invoice.amount_paid ?? 0,
        amountRefunded: charge?.amount_refunded ?? invoice.amount_refunded ?? 0,
        hostedUrl: invoice.hosted_invoice_url ?? null,
        pdfUrl: invoice.invoice_pdf ?? null,
        paymentIntentId:
          typeof invoice.payment_intent === "string"
            ? invoice.payment_intent
            : (invoice.payment_intent?.id ?? null),
      };
    });
    return { stripeConfigured: true, invoices, hasMore: page.has_more };
  }

  async refund(
    actor: StaffViewer,
    invoiceId: string,
    amount: number,
    reason: string,
  ): Promise<{
    outcome: "refunded" | "awaiting_approval";
    approvalId: string | null;
    currency: string;
  }> {
    if (!this.stripe) throw noStripe();
    const invoice = (await this.stripe.invoices.retrieve(invoiceId)) as unknown as InvoiceLike;
    const paymentIntent =
      typeof invoice.payment_intent === "string"
        ? invoice.payment_intent
        : (invoice.payment_intent?.id ?? null);
    if (!paymentIntent || !invoice.amount_paid) {
      throw new ApiException(
        "conflict",
        409,
        "That invoice hasn’t been paid, so there is nothing to refund.",
      );
    }
    const charge = typeof invoice.charge === "object" ? invoice.charge : null;
    const refundable =
      invoice.amount_paid - (charge?.amount_refunded ?? invoice.amount_refunded ?? 0);
    if (amount > refundable) {
      throw new ApiException(
        "validation_failed",
        422,
        `At most ${(refundable / 100).toFixed(2)} ${invoice.currency.toUpperCase()} can still be refunded.`,
      );
    }
    const role = actor.user.role as StaffRole;
    const limit: number | null = role in refundLimitsMinor ? refundLimitsMinor[role] : 0;
    if (limit !== null && amount > limit) {
      const [created] = await this.database.db
        .insert(schema.approvals)
        .values({
          kind: "refund",
          requestedById: actor.user.id,
          what: `Refund ${(amount / 100).toFixed(2)} ${invoice.currency.toUpperCase()} of invoice ${invoice.number ?? invoice.id}`,
          target: invoice.id,
          amountMinor: amount,
          currency: invoice.currency,
          payload: { invoiceId: invoice.id, paymentIntent, amount, reason },
        })
        .returning({ id: schema.approvals.id });
      return {
        outcome: "awaiting_approval",
        approvalId: created?.id ?? null,
        currency: invoice.currency,
      };
    }
    await this.stripe.refunds.create({
      payment_intent: paymentIntent,
      amount,
      reason: "requested_by_customer",
      metadata: { invoice: invoice.id, by: actor.user.id, why: reason.slice(0, 200) },
    });
    return { outcome: "refunded", approvalId: null, currency: invoice.currency };
  }

  /* ── Coupons ── */

  async coupons(): Promise<CouponList> {
    if (!this.stripe) return { stripeConfigured: false, coupons: [] };
    const page = await this.stripe.promotionCodes.list({
      limit: 100,
      expand: ["data.promotion.coupon"],
    });
    return {
      stripeConfigured: true,
      coupons: page.data.map((code) => this.coupon(code)),
    };
  }

  private coupon(code: Stripe.PromotionCode): StaffCoupon {
    const raw = code.promotion.coupon;
    const coupon: Partial<Stripe.Coupon> = typeof raw === "object" && raw !== null ? raw : {};
    const gives = coupon.percent_off
      ? `${String(coupon.percent_off)}% off`
      : coupon.amount_off
        ? `${(coupon.amount_off / 100).toFixed(2)} ${(coupon.currency ?? "").toUpperCase()} off`
        : "A discount";
    const span =
      coupon.duration === "forever"
        ? "for as long as they subscribe"
        : coupon.duration === "repeating"
          ? `for ${String(coupon.duration_in_months ?? 0)} months`
          : "once";
    return {
      id: code.id,
      code: code.code,
      active: code.active,
      gives: `${gives}, ${span}`,
      percentOff: coupon.percent_off ?? null,
      amountOff:
        coupon.amount_off !== null && coupon.amount_off !== undefined
          ? { amount: coupon.amount_off, currency: coupon.currency ?? "" }
          : null,
      duration: coupon.duration ?? "once",
      durationInMonths: coupon.duration_in_months ?? null,
      timesRedeemed: code.times_redeemed,
      maxRedemptions: code.max_redemptions ?? null,
      expiresAt: code.expires_at ? new Date(code.expires_at * 1000).toISOString() : null,
    };
  }

  async createCoupon(actor: StaffViewer, body: CreateCouponRequest): Promise<CouponResult> {
    if (!this.stripe) throw noStripe();
    const bigDiscount = (body.percentOff ?? 0) > COUPON_APPROVAL_PERCENT;
    if (bigDiscount && actor.user.role !== "admin") {
      const [created] = await this.database.db
        .insert(schema.approvals)
        .values({
          kind: "coupon",
          requestedById: actor.user.id,
          what: `Coupon ${body.code}: ${String(body.percentOff ?? 0)}% off, ${body.duration}${body.durationInMonths ? ` for ${String(body.durationInMonths)} months` : ""}`,
          target: body.code,
          payload: {
            code: body.code,
            percentOff: body.percentOff ?? null,
            amountOff: body.amountOff ?? null,
            currency: body.currency ?? null,
            duration: body.duration,
            durationInMonths: body.durationInMonths ?? null,
            maxRedemptions: body.maxRedemptions ?? null,
            expiresAt: body.expiresAt ?? null,
          },
        })
        .returning({ id: schema.approvals.id });
      return {
        outcome: "awaiting_approval",
        approvalId: created?.id ?? null,
        list: await this.coupons(),
      };
    }
    await this.makeCoupon(body);
    return { outcome: "created", approvalId: null, list: await this.coupons() };
  }

  private async makeCoupon(body: CreateCouponRequest): Promise<void> {
    if (!this.stripe) throw noStripe();
    const coupon = await this.stripe.coupons.create({
      name: body.code,
      duration: body.duration,
      ...(body.duration === "repeating" && body.durationInMonths
        ? { duration_in_months: body.durationInMonths }
        : {}),
      ...(body.percentOff !== undefined
        ? { percent_off: body.percentOff }
        : { amount_off: body.amountOff ?? 0, currency: body.currency ?? "gbp" }),
    });
    await this.stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code: body.code,
      ...(body.maxRedemptions ? { max_redemptions: body.maxRedemptions } : {}),
      ...(body.expiresAt ? { expires_at: Math.floor(Date.parse(body.expiresAt) / 1000) } : {}),
    });
  }

  async toggleCoupon(id: string, active: boolean): Promise<string> {
    if (!this.stripe) throw noStripe();
    const code = await this.stripe.promotionCodes.update(id, { active });
    return code.code;
  }

  /* ── Finance ── */

  async finance(): Promise<Finance> {
    const db = this.database.db;
    const now = new Date();
    const monthStart = (back: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const since = monthStart(11);
    const [{ byPlan, currency }, events, subscriptions, [byHand]] = await Promise.all([
      this.monthlyPrices(),
      db
        .select({
          type: schema.securityEvents.type,
          metadata: schema.securityEvents.metadata,
          at: schema.securityEvents.occurredAt,
        })
        .from(schema.securityEvents)
        .where(
          and(
            inArray(schema.securityEvents.type, [
              "billing.subscription_started",
              "billing.subscription_changed",
              "billing.subscription_ended",
            ]),
            gte(schema.securityEvents.occurredAt, since),
          ),
        ),
      db.select().from(schema.subscriptions),
      db
        .select({ value: count() })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.planSource, "admin"),
            sql`${schema.users.planCode} <> ${FREE_PLAN_CODE}`,
          ),
        ),
    ]);
    const inForceAt = (moment: Date) =>
      subscriptions
        .filter(
          (row) =>
            row.createdAt < moment &&
            ((PAYING as readonly string[]).includes(row.status) || row.updatedAt >= moment),
        )
        .reduce((sum, row) => sum + (byPlan.get(row.planCode) ?? 0), 0);
    const label = new Intl.DateTimeFormat("en-GB", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    const months = Array.from({ length: 12 }, (_, index) => {
      const start = monthStart(11 - index);
      const end = monthStart(10 - index);
      const inMonth = events.filter((event) => event.at >= start && event.at < end);
      let newAmount = 0;
      let newCount = 0;
      let upgrades = 0;
      let downgrades = 0;
      let lostAmount = 0;
      let lostCount = 0;
      let unvaluedChanges = 0;
      for (const event of inMonth) {
        const plan = typeof event.metadata.plan === "string" ? event.metadata.plan : "";
        const from = typeof event.metadata.from === "string" ? event.metadata.from : null;
        if (event.type === "billing.subscription_started") {
          newAmount += byPlan.get(plan) ?? 0;
          newCount += 1;
        } else if (event.type === "billing.subscription_ended") {
          lostAmount += byPlan.get(from ?? "") ?? 0;
          lostCount += 1;
        } else if (from === null) {
          unvaluedChanges += 1;
        } else {
          const delta = (byPlan.get(plan) ?? 0) - (byPlan.get(from) ?? 0);
          if (delta >= 0) upgrades += delta;
          else downgrades += -delta;
        }
      }
      return {
        month: label.format(start),
        start: inForceAt(start),
        end: inForceAt(end > now ? now : end),
        newAmount,
        newCount,
        upgrades,
        downgrades,
        lostAmount,
        lostCount,
        unvaluedChanges,
      };
    });
    return {
      currency,
      months,
      stripeConfigured: this.stripe !== null,
      setByHand: byHand?.value ?? 0,
    };
  }

  /* ── Approvals ── */

  async approvals(): Promise<ApprovalList> {
    const rows = await this.database.db
      .select({ approval: schema.approvals })
      .from(schema.approvals)
      .orderBy(desc(schema.approvals.createdAt))
      .limit(200);
    const staffIds = [
      ...new Set(
        rows.flatMap(({ approval }) =>
          [approval.requestedById, approval.decidedById].filter(
            (value): value is string => !!value,
          ),
        ),
      ),
    ];
    const staff = staffIds.length
      ? await this.database.db
          .select({ id: schema.users.id, email: schema.users.email })
          .from(schema.users)
          .where(inArray(schema.users.id, staffIds))
      : [];
    const emailBy = new Map(staff.map((user) => [user.id, user.email]));
    return {
      approvals: rows.map(({ approval }) => this.approval(approval, emailBy)),
    };
  }

  private approval(row: ApprovalRow, emailBy: Map<string, string>): Approval {
    return {
      id: row.id,
      kind: row.kind,
      requestedBy: row.requestedById ? (emailBy.get(row.requestedById) ?? "(account gone)") : null,
      what: row.what,
      target: row.target,
      amount:
        row.amountMinor !== null && row.currency
          ? ({ amount: row.amountMinor, currency: row.currency } satisfies Money)
          : null,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      decidedBy: row.decidedById ? (emailBy.get(row.decidedById) ?? "(account gone)") : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      reason: row.reason,
    };
  }

  /** Approving carries the request out; nobody decides their own. */
  async decide(
    actor: StaffViewer,
    id: string,
    approve: boolean,
    reason: string,
  ): Promise<ApprovalRow> {
    const [row] = await this.database.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, id))
      .limit(1);
    if (!row) throw new ApiException("not_found", 404, "That request doesn’t exist.");
    if (row.status !== "waiting")
      throw new ApiException("conflict", 409, "That request was already decided.");
    if (row.requestedById === actor.user.id) {
      throw new ApiException("conflict", 409, "You can’t approve your own request.");
    }
    if (approve) {
      if (!this.stripe) throw noStripe();
      const payload = row.payload;
      if (row.kind === "refund") {
        await this.stripe.refunds.create({
          payment_intent: String(payload.paymentIntent ?? ""),
          amount: Number(payload.amount ?? row.amountMinor ?? 0),
          reason: "requested_by_customer",
          metadata: {
            invoice: String(payload.invoiceId ?? row.target),
            by: actor.user.id,
            requestedBy: row.requestedById ?? "",
          },
        });
      } else {
        await this.makeCoupon({
          code: String(payload.code ?? row.target),
          percentOff: typeof payload.percentOff === "number" ? payload.percentOff : undefined,
          amountOff: typeof payload.amountOff === "number" ? payload.amountOff : undefined,
          currency: typeof payload.currency === "string" ? payload.currency : undefined,
          duration: (payload.duration as CreateCouponRequest["duration"] | undefined) ?? "once",
          durationInMonths:
            typeof payload.durationInMonths === "number" ? payload.durationInMonths : undefined,
          maxRedemptions:
            typeof payload.maxRedemptions === "number" ? payload.maxRedemptions : undefined,
          expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : undefined,
        });
      }
    }
    const [updated] = await this.database.db
      .update(schema.approvals)
      .set({
        status: approve ? "approved" : "declined",
        decidedById: actor.user.id,
        decidedAt: new Date(),
        reason: reason || null,
      })
      .where(eq(schema.approvals.id, id))
      .returning();
    if (!updated) throw new ApiException("not_found", 404, "That request doesn’t exist.");
    return updated;
  }

  /* ── Accounts likely to upgrade ── */

  async upgradeSignals(viewer: StaffViewer): Promise<UpgradeSignalList> {
    const db = this.database.db;
    const since = new Date(Date.now() - 30 * DAY);
    const minutes = await db
      .select({
        userId: schema.browserSessions.userId,
        seconds: sql<
          string | number
        >`coalesce(sum(extract(epoch from (coalesce(${schema.browserSessions.endedAt}, now()) - greatest(${schema.browserSessions.startedAt}, ${since})))), 0)`,
        live: sql<
          string | number
        >`count(*) filter (where ${schema.browserSessions.status} = 'running')`,
      })
      .from(schema.browserSessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.browserSessions.userId))
      .where(
        and(
          eq(schema.users.planCode, FREE_PLAN_CODE),
          sql`${schema.browserSessions.startedAt} is not null`,
          gte(sql`coalesce(${schema.browserSessions.endedAt}, now())`, since),
        ),
      )
      .groupBy(schema.browserSessions.userId)
      .orderBy(
        desc(
          sql`sum(extract(epoch from (coalesce(${schema.browserSessions.endedAt}, now()) - greatest(${schema.browserSessions.startedAt}, ${since}))))`,
        ),
      )
      .limit(50);
    const userIds = minutes.map((row) => row.userId);
    if (userIds.length === 0) return { accounts: [] };
    const [refs, users, drive, lastSeen] = await Promise.all([
      this.customerRefs(viewer, userIds),
      db
        .select({ id: schema.users.id, createdAt: schema.users.createdAt })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds)),
      db
        .select({
          userId: schema.driveFiles.userId,
          bytes: sql<string | number>`coalesce(sum(${schema.driveFiles.size}), 0)`,
        })
        .from(schema.driveFiles)
        .where(and(inArray(schema.driveFiles.userId, userIds), isNull(schema.driveFiles.teamId)))
        .groupBy(schema.driveFiles.userId),
      db
        .select({
          userId: schema.authSessions.userId,
          at: sql<Date | string>`max(${schema.authSessions.lastSeenAt})`,
        })
        .from(schema.authSessions)
        .where(inArray(schema.authSessions.userId, userIds))
        .groupBy(schema.authSessions.userId),
    ]);
    const createdBy = new Map(users.map((user) => [user.id, user.createdAt]));
    const driveBy = new Map(drive.map((row) => [row.userId, Number(row.bytes)]));
    const seenBy = new Map(lastSeen.map((row) => [row.userId, new Date(row.at)]));
    const freeLimit = this.billing.limitsOfPlan(FREE_PLAN_CODE).driveBytes;
    return {
      accounts: minutes.flatMap((row) => {
        const customer = refs.get(row.userId);
        if (!customer) return [];
        return [
          {
            customer,
            browsingMinutes30d: Math.round(Number(row.seconds) / 60),
            driveBytes: driveBy.get(row.userId) ?? 0,
            driveLimitBytes: freeLimit,
            liveSessionsNow: Number(row.live),
            lastActiveAt: seenBy.get(row.userId)?.toISOString() ?? null,
            createdAt: (createdBy.get(row.userId) ?? new Date()).toISOString(),
          },
        ];
      }),
    };
  }
}
