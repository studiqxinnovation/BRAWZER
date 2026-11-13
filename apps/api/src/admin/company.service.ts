import {
  type AdminSettings,
  type CompanyOverview,
  type Growth,
  isStaffRole,
  type Organisation,
  type OrganisationSummary,
  type StaffList,
  type StaffMember,
  type StaffRole,
  staffRoles,
} from "@brawzer/contracts";
import {
  and,
  count,
  type DatabaseHandle,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { BillingService } from "../billing/billing.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import { maskEmail } from "../email/transports.js";
import { type StaffActor, StaffAuditService } from "./audit.service.js";
import { CustomersService } from "./customers.service.js";
import { StaffGuard } from "./staff.guard.js";

const DAY = 86_400_000;
const LIVE = ["starting", "running"] as const;
const PAYING = ["active", "trialing"] as const;

/** The first day of the month `offset` months before now, in UTC. */
function monthStart(offset: number, now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
}

const monthLabel = (date: Date) =>
  date.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

/**
 * The company's own pages (Phase 11): the overview, growth, the team,
 * settings and organisations. Every figure is counted from the database;
 * revenue comes from active subscriptions and Stripe's prices.
 */
@Injectable()
export class CompanyService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(StaffGuard) private readonly staffGuard: StaffGuard,
  ) {}

  /** Monthly revenue per paying subscription, by plan code, from Stripe's prices. */
  private async monthlyByPlan(): Promise<{
    byPlan: Map<string, { amount: number; currency: string; name: string }>;
    currency: string;
  }> {
    const plans = await this.billing.publicPlans();
    const byPlan = new Map<string, { amount: number; currency: string; name: string }>();
    let currency = "usd";
    for (const plan of plans) {
      if (plan.price) {
        currency = plan.price.currency;
        byPlan.set(plan.code, {
          amount:
            plan.price.interval === "year" ? Math.round(plan.price.amount / 12) : plan.price.amount,
          currency: plan.price.currency,
          name: plan.name,
        });
      } else {
        byPlan.set(plan.code, { amount: 0, currency: "", name: plan.name });
      }
    }
    return { byPlan, currency };
  }

  async overview(viewer: StaffActor): Promise<CompanyOverview> {
    const db = this.database.db;
    const now = new Date();
    const [
      [accounts],
      [joined],
      [active],
      subscriptions,
      [teams],
      [live],
      [reports],
      staff,
      customers,
      largest,
      prices,
    ] = await Promise.all([
      db.select({ count: count() }).from(schema.users),
      db
        .select({ count: count() })
        .from(schema.users)
        .where(gt(schema.users.createdAt, new Date(now.getTime() - 30 * DAY))),
      db
        .select({ count: sql<number>`count(distinct ${schema.authSessions.userId})::int` })
        .from(schema.authSessions)
        .where(gt(schema.authSessions.lastSeenAt, new Date(now.getTime() - 7 * DAY))),
      db.select().from(schema.subscriptions),
      db.select({ count: count() }).from(schema.teams),
      db
        .select({ count: count() })
        .from(schema.browserSessions)
        .where(inArray(schema.browserSessions.status, [...LIVE])),
      db
        .select({ count: count() })
        .from(schema.pageReports)
        .where(isNull(schema.pageReports.closedAt)),
      this.staff(),
      this.customers.list(viewer, { view: "attention", limit: 1 }),
      this.organisations(),
      this.monthlyByPlan(),
    ]);
    const paying = subscriptions.filter((row) =>
      (PAYING as readonly string[]).includes(row.status),
    );
    const sum = (rows: typeof subscriptions) => {
      const totals = new Map<string, number>();
      for (const row of rows) {
        const price = prices.byPlan.get(row.planCode);
        if (!price || price.amount === 0) continue;
        totals.set(price.currency, (totals.get(price.currency) ?? 0) + price.amount);
      }
      return Array.from(totals.entries()).map(([currency, amount]) => ({ currency, amount }));
    };
    const lastMonthEnd = monthStart(0, now);
    const payingLastMonth = subscriptions.filter(
      (row) =>
        row.createdAt < lastMonthEnd &&
        ((PAYING as readonly string[]).includes(row.status) || row.updatedAt >= lastMonthEnd),
    );
    const revenueByMonth = Array.from({ length: 12 }, (_, index) => {
      const start = monthStart(11 - index, now);
      const end = monthStart(10 - index, now);
      const inForce = subscriptions.filter(
        (row) =>
          row.createdAt < end &&
          ((PAYING as readonly string[]).includes(row.status) || row.updatedAt >= start),
      );
      return {
        month: monthLabel(start),
        amount: sum(inForce).find((entry) => entry.currency === prices.currency)?.amount ?? 0,
      };
    });
    const staleStaff = staff.staff.filter(
      (member) =>
        member.lastSignInAt === null || now.getTime() - Date.parse(member.lastSignInAt) > 60 * DAY,
    ).length;
    return {
      accounts: accounts?.count ?? 0,
      joined30d: joined?.count ?? 0,
      active7d: active?.count ?? 0,
      payingAccounts: paying.length,
      teams: teams?.count ?? 0,
      mrr: sum(paying),
      mrrLastMonth: sum(payingLastMonth),
      stripeConfigured: this.billing.available,
      liveSessions: live?.count ?? 0,
      liveSessionLimit: this.config.browser.maxLiveSessions,
      attention: customers.counts.attention,
      pastDue: customers.counts.views.past_due,
      openReports: reports?.count ?? 0,
      staffWithoutSecondFactor: staff.staff.filter((member) => member.secondFactor === "none")
        .length,
      staleStaff,
      revenueByMonth,
      currency: prices.currency,
      recentActions: await this.audit.recent(8),
      largestTeams: largest.slice(0, 6),
    };
  }

  async growth(): Promise<Growth> {
    const db = this.database.db;
    const now = new Date();
    const since = monthStart(11, now);
    const [users, firstSessions, subscriptions, prices, [verified], lastSeen] = await Promise.all([
      db
        .select({
          id: schema.users.id,
          createdAt: schema.users.createdAt,
          planCode: schema.users.planCode,
          planSource: schema.users.planSource,
          emailVerifiedAt: schema.users.emailVerifiedAt,
        })
        .from(schema.users),
      db
        .select({
          userId: schema.browserSessions.userId,
          first: sql<Date>`min(${schema.browserSessions.createdAt})`,
          days: sql<number>`count(distinct date(${schema.browserSessions.createdAt}))::int`,
        })
        .from(schema.browserSessions)
        .groupBy(schema.browserSessions.userId),
      db.select().from(schema.subscriptions),
      this.monthlyByPlan(),
      db
        .select({ count: count() })
        .from(schema.users)
        .where(isNotNull(schema.users.emailVerifiedAt)),
      db
        .select({
          userId: schema.authSessions.userId,
          lastSeenAt: sql<Date>`max(${schema.authSessions.lastSeenAt})`,
        })
        .from(schema.authSessions)
        .groupBy(schema.authSessions.userId),
    ]);
    const firstBy = new Map(firstSessions.map((row) => [row.userId, row]));
    const seenBy = new Map(lastSeen.map((row) => [row.userId, new Date(row.lastSeenAt)]));
    const subscriptionBy = new Map(subscriptions.map((row) => [row.userId, row]));
    const months = Array.from({ length: 12 }, (_, index) => {
      const start = monthStart(11 - index, now);
      const end = monthStart(10 - index, now);
      const joined = users.filter((user) => user.createdAt >= start && user.createdAt < end);
      return {
        month: monthLabel(start),
        signUps: joined.length,
        activated: joined.filter((user) => {
          const first = firstBy.get(user.id);
          return (
            first !== undefined && new Date(first.first).getTime() - user.createdAt.getTime() < DAY
          );
        }).length,
        converted: subscriptions.filter((row) => row.createdAt >= start && row.createdAt < end)
          .length,
        churned: subscriptions.filter(
          (row) => row.status === "canceled" && row.updatedAt >= start && row.updatedAt < end,
        ).length,
      };
    });
    const recent = users.filter((user) => user.createdAt >= since);
    const paying = users.filter((user) => {
      const row = subscriptionBy.get(user.id);
      return row !== undefined && (PAYING as readonly string[]).includes(row.status);
    });
    const retention = Array.from({ length: 6 }, (_, index) => {
      const start = monthStart(5 - index, now);
      const end = monthStart(4 - index, now);
      const cohort = users.filter((user) => user.createdAt >= start && user.createdAt < end);
      const kept: number[] = [];
      for (let after = 0; after <= 5 - index; after += 1) {
        const at = monthStart(5 - index - after, now);
        const until = monthStart(4 - index - after, now);
        const stillActive = cohort.filter((user) => {
          const seen = seenBy.get(user.id);
          return seen !== undefined && seen >= at && (seen < until || after === 5 - index);
        }).length;
        kept.push(cohort.length ? Math.round((stillActive / cohort.length) * 100) : 0);
      }
      return { month: monthLabel(start), kept };
    });
    const plans = await this.billing.publicPlans();
    const byPlan = plans.map((plan) => {
      const accounts = users.filter((user) => user.planCode === plan.code);
      const price = prices.byPlan.get(plan.code);
      const payingHere = accounts.filter((user) => {
        const row = subscriptionBy.get(user.id);
        return (
          user.planSource === "stripe" &&
          row !== undefined &&
          (PAYING as readonly string[]).includes(row.status)
        );
      }).length;
      return {
        planCode: plan.code,
        planName: plan.name,
        accounts: accounts.length,
        mrr: (price?.amount ?? 0) * payingHere,
      };
    });
    return {
      months,
      funnel: {
        signedUp: recent.length,
        verified: Math.min(verified?.count ?? 0, recent.filter((u) => u.emailVerifiedAt).length),
        openedBrowser: recent.filter((user) => firstBy.has(user.id)).length,
        usedThreeDays: recent.filter((user) => (firstBy.get(user.id)?.days ?? 0) >= 3).length,
        paying: paying.filter((user) => user.createdAt >= since).length,
      },
      retention,
      byPlan,
      currency: prices.currency,
    };
  }

  /* ── Organisations ── */

  async organisations(): Promise<OrganisationSummary[]> {
    const db = this.database.db;
    const [teams, members, invitations, proxies, subscriptions, lastSeen] = await Promise.all([
      db.select().from(schema.teams).orderBy(desc(schema.teams.createdAt)),
      db
        .select({ member: schema.teamMembers, user: schema.users })
        .from(schema.teamMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId)),
      db
        .select({ teamId: schema.teamInvitations.teamId, count: count() })
        .from(schema.teamInvitations)
        .groupBy(schema.teamInvitations.teamId),
      db
        .select({ teamId: schema.proxies.teamId, count: count() })
        .from(schema.proxies)
        .where(isNotNull(schema.proxies.teamId))
        .groupBy(schema.proxies.teamId),
      db.select().from(schema.subscriptions),
      db
        .select({
          userId: schema.authSessions.userId,
          lastSeenAt: sql<Date>`max(${schema.authSessions.lastSeenAt})`,
        })
        .from(schema.authSessions)
        .groupBy(schema.authSessions.userId),
    ]);
    const plans = await this.billing.publicPlans();
    const planName = (code: string) => plans.find((plan) => plan.code === code)?.name ?? code;
    const invitationBy = new Map(invitations.map((row) => [row.teamId, row.count]));
    const proxyBy = new Map(proxies.map((row) => [row.teamId, row.count]));
    const subscriptionBy = new Map(subscriptions.map((row) => [row.userId, row]));
    const seenBy = new Map(lastSeen.map((row) => [row.userId, new Date(row.lastSeenAt)]));
    return teams.map((team) => {
      const own = members.filter((row) => row.member.teamId === team.id);
      const owner = own.find((row) => row.member.role === "owner")?.user;
      const subscription = owner ? subscriptionBy.get(owner.id) : undefined;
      const seen = own
        .map((row) => seenBy.get(row.user.id))
        .filter((date): date is Date => date !== undefined)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        id: team.id,
        name: team.name,
        ownerEmail: owner ? maskEmail(owner.email) : "",
        members: own.length,
        memberLimit: owner ? this.billing.limitsOfPlan(owner.planCode).teamMembers : 0,
        invitations: invitationBy.get(team.id) ?? 0,
        planCode: owner?.planCode ?? "free",
        planName: planName(owner?.planCode ?? "free"),
        renewsAt: subscription?.currentPeriodEnd?.toISOString() ?? null,
        createdAt: team.createdAt.toISOString(),
        lastActiveAt: seen?.toISOString() ?? null,
        proxies: proxyBy.get(team.id) ?? 0,
      };
    });
  }

  async organisation(viewer: StaffActor, id: string): Promise<Organisation> {
    const summary = (await this.organisations()).find((team) => team.id === id);
    if (!summary) throw new ApiException("not_found", 404, "That organisation doesn’t exist.");
    const founder = viewer.user.role === "admin";
    const [members, invitations] = await Promise.all([
      this.database.db
        .select({ member: schema.teamMembers })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.teamId, id)),
      this.database.db
        .select()
        .from(schema.teamInvitations)
        .where(eq(schema.teamInvitations.teamId, id))
        .orderBy(desc(schema.teamInvitations.createdAt)),
    ]);
    const ids = members.map((row) => row.member.userId);
    const customers = ids.length
      ? (await this.customers.list(viewer, { view: "all", limit: 100 })).customers.filter((c) =>
          ids.includes(c.id),
        )
      : [];
    const secondFactor = new Set(
      (
        await Promise.all(
          ids.map(async (userId) =>
            (await this.staffGuard.hasSecondFactor(userId)) ? userId : null,
          ),
        )
      ).filter((entry): entry is string => entry !== null),
    );
    return {
      ...summary,
      ownerEmail: founder
        ? (customers.find((c) => c.teamRole === "owner")?.email ?? summary.ownerEmail)
        : summary.ownerEmail,
      memberList: members
        .map(({ member }) => {
          const customer = customers.find((c) => c.id === member.userId);
          return {
            id: member.userId,
            email: customer?.email ?? "",
            role: member.role,
            joinedAt: member.joinedAt.toISOString(),
            lastActiveAt: customer?.lastActiveAt ?? null,
            secondFactor: secondFactor.has(member.userId),
            status: customer?.status ?? "active",
          };
        })
        .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0)),
      invitationList: invitations.map((row) => ({
        id: row.id,
        email: founder ? row.email : maskEmail(row.email),
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
    };
  }

  /* ── The team ── */

  async staff(): Promise<StaffList> {
    const rows = await this.database.db
      .select()
      .from(schema.users)
      .where(inArray(schema.users.role, [...staffRoles]))
      .orderBy(schema.users.createdAt);
    const ids = rows.map((row) => row.id);
    const [passkeys, factors, signIns] = ids.length
      ? await Promise.all([
          this.database.db
            .select({ userId: schema.webauthnCredentials.userId })
            .from(schema.webauthnCredentials)
            .where(inArray(schema.webauthnCredentials.userId, ids)),
          this.database.db
            .select({ userId: schema.totpFactors.userId })
            .from(schema.totpFactors)
            .where(
              and(
                inArray(schema.totpFactors.userId, ids),
                isNotNull(schema.totpFactors.confirmedAt),
              ),
            ),
          this.database.db
            .select({
              userId: schema.authSessions.userId,
              last: sql<Date>`max(${schema.authSessions.createdAt})`,
            })
            .from(schema.authSessions)
            .where(inArray(schema.authSessions.userId, ids))
            .groupBy(schema.authSessions.userId),
        ])
      : [[], [], []];
    const passkeyUsers = new Set(passkeys.map((row) => row.userId));
    const factorUsers = new Set(factors.map((row) => row.userId));
    const lastBy = new Map(signIns.map((row) => [row.userId, new Date(row.last)]));
    const staff: StaffMember[] = rows.flatMap((row) =>
      isStaffRole(row.role)
        ? [
            {
              id: row.id,
              email: row.email,
              role: row.role,
              secondFactor: passkeyUsers.has(row.id)
                ? ("passkey" as const)
                : factorUsers.has(row.id)
                  ? ("authenticator" as const)
                  : ("none" as const),
              lastSignInAt: lastBy.get(row.id)?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
            },
          ]
        : [],
    );
    return { staff, secondFactorRequired: this.config.staffSecondFactorRequired };
  }

  async invite(actor: StaffActor, email: string, role: StaffRole, meta: RequestMeta) {
    const [user] = await this.database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (!user) {
      throw new ApiException(
        "not_found",
        404,
        "No account has that address. They need to sign up to Brawzer first; then invite them.",
      );
    }
    if (user.role === "admin") {
      throw new ApiException("bad_request", 400, "That account is a founder already.");
    }
    await this.database.db
      .update(schema.users)
      .set({ role, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));
    await this.audit.record(actor, {
      action: user.role === "user" ? "Invited a staff member" : "Changed a staff role",
      target: user.id,
      detail: `${maskEmail(email)} · ${role}`,
      meta,
    });
    return this.staff();
  }

  async setRole(actor: StaffActor, userId: string, role: StaffRole, meta: RequestMeta) {
    const [user] = await this.database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user || !isStaffRole(user.role)) {
      throw new ApiException("not_found", 404, "That person isn’t on the team.");
    }
    if (user.role === "admin" || this.config.adminEmails.includes(user.email)) {
      throw new ApiException("bad_request", 400, "A founder’s role is set by ADMIN_EMAILS.");
    }
    await this.database.db
      .update(schema.users)
      .set({ role, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
    await this.audit.record(actor, {
      action: "Changed a staff role",
      target: userId,
      detail: `${user.role} → ${role}`,
      meta,
    });
    return this.staff();
  }

  async remove(actor: StaffActor, userId: string, reason: string, meta: RequestMeta) {
    const [user] = await this.database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user || !isStaffRole(user.role)) {
      throw new ApiException("not_found", 404, "That person isn’t on the team.");
    }
    if (user.role === "admin" || this.config.adminEmails.includes(user.email)) {
      throw new ApiException("bad_request", 400, "A founder is removed by changing ADMIN_EMAILS.");
    }
    if (userId === actor.user.id) {
      throw new ApiException("bad_request", 400, "You can’t remove yourself.");
    }
    await this.database.db
      .update(schema.users)
      .set({ role: "user", updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
    await this.audit.record(actor, {
      action: "Removed a staff member",
      target: userId,
      detail: `${user.role} · ${reason}`,
      meta,
    });
    return this.staff();
  }

  /* ── Settings ── */

  async settings(): Promise<AdminSettings> {
    const [plans, counts] = await Promise.all([
      this.billing.publicPlans(),
      this.database.db
        .select({ planCode: schema.users.planCode, count: count() })
        .from(schema.users)
        .groupBy(schema.users.planCode),
    ]);
    const countBy = new Map(counts.map((row) => [row.planCode, row.count]));
    const config = this.config;
    const services: AdminSettings["services"] = [
      {
        name: "Stripe",
        purpose: "Plans, payments, invoices",
        state: this.billing.available ? "configured" : "off",
        detail: this.billing.available
          ? `${String(plans.length - 1)} paid plan${plans.length === 2 ? "" : "s"} configured`
          : "No STRIPE_SECRET_KEY: only the free plan exists",
      },
      {
        name: "Email",
        purpose: "Account, billing and team emails",
        state: config.email.transport === "resend" ? "configured" : "development",
        detail:
          config.email.transport === "resend"
            ? `Resend, from ${config.email.from}`
            : `${config.email.transport}: delivered locally, never to real inboxes`,
      },
      {
        name: "Object store",
        purpose: "Drive files and profile data, encrypted",
        state: config.storage.endpoint?.startsWith("https://") ? "configured" : "development",
        detail: `${config.storage.endpoint ?? "AWS S3"} · bucket ${config.storage.bucket}`,
      },
      {
        name: "Malware scanner",
        purpose: "Every upload and download",
        state: "configured",
        detail: `ClamAV at ${config.scanner.host}:${String(config.scanner.port)}`,
      },
      {
        name: "Key service",
        purpose: "Wraps every encryption key",
        state: config.encryption.provider === "vault" ? "configured" : "development",
        detail:
          config.encryption.provider === "vault"
            ? "Vault-compatible transit engine"
            : "A local key: development only",
      },
      {
        name: "Cloud browser runtime",
        purpose: "Session containers",
        state: config.browser.docker.kind === "tcp" ? "configured" : "development",
        detail: `${String(config.browser.hosts.length)} runtime host${config.browser.hosts.length === 1 ? "" : "s"} · up to ${String(config.browser.maxLiveSessions)} live sessions`,
      },
      {
        name: "Assistant",
        purpose: "The Assistant and Study Notes",
        state: config.assistant.apiKey ? "configured" : "off",
        detail: config.assistant.apiKey ? config.assistant.model : "No ANTHROPIC_API_KEY",
      },
    ];
    return {
      plans: plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        price: plan.price,
        limits: plan.limits,
        accounts: countBy.get(plan.code) ?? 0,
      })),
      services,
      adminEmails: [...config.adminEmails],
    };
  }
}
