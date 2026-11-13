import {
  BROWSER_LIMITS,
  type Customer,
  type CustomerActivity,
  type CustomerBilling,
  type CustomerBrowsers,
  type CustomerDrive,
  type CustomerIssue,
  type CustomerList,
  type CustomerPrivacy,
  type CustomerSignIn,
  type CustomerStatus,
  type CustomerSummary,
  type CustomerView,
  customerViews,
  engineDetails,
  isStaffRole,
  type StaffNote,
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
import { Inject, Injectable, Logger } from "@nestjs/common";
import { AccountService } from "../account/account.service.js";
import { AuthService } from "../auth/auth.service.js";
import { MfaService } from "../auth/mfa/mfa.service.js";
import { PasskeyService } from "../auth/passkeys/passkey.service.js";
import { SessionService } from "../auth/session.service.js";
import { describeUserAgent } from "../auth/user-agent.js";
import { BillingService } from "../billing/billing.service.js";
import { BrowserService } from "../browser/browser.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE } from "../database/database.module.js";
import { DriveService } from "../drive/drive.service.js";
import { maskEmail } from "../email/transports.js";
import { RATE_LIMITS } from "../rate-limit/rate-limiter.js";
import { type StaffActor, StaffAuditService } from "./audit.service.js";

const logger = new Logger("Console");

const DAY = 86_400_000;
const LIVE = ["starting", "running"] as const;
const SIGN_IN_TYPES = ["sign_in.succeeded", "sign_in.failed", "sign_in.new_device"] as const;

type UserRow = typeof schema.users.$inferSelect;

const notFound = () => new ApiException("not_found", 404, "That account doesn’t exist.");

/** A monthly price in minor units from a plan's price, whatever its interval. */
function monthly(price: { amount: number; interval: string } | null): number {
  if (!price) return 0;
  return price.interval === "year" ? Math.round(price.amount / 12) : price.amount;
}

/** What one account's records say, gathered for the list and the 360 view. */
interface Signals {
  user: UserRow;
  lastActiveAt: Date | null;
  failed15m: number;
  driveBytes: number;
  driveFiles: number;
  secondFactor: boolean;
  subscription: typeof schema.subscriptions.$inferSelect | null;
  team: { id: string; name: string; role: "owner" | "admin" | "member" } | null;
}

/**
 * Customers (Phase 11): every account as the console shows it, with the
 * account check, and the 360 view's tabs read from the account's own
 * records. Personal details are masked until revealed with a reason; a
 * founder sees them. Every change is written to the audit log and, where
 * it touches the account, to its security history too.
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(DriveService) private readonly drive: DriveService,
    @Inject(PasskeyService) private readonly passkeys: PasskeyService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  /* ── Reading ── */

  /** Every account's signals in a handful of grouped queries. */
  private async scan(ids?: readonly string[]): Promise<Signals[]> {
    const db = this.database.db;
    const where = ids ? inArray(schema.users.id, ids) : undefined;
    const users = await db.select().from(schema.users).where(where).orderBy(desc(schema.users.id));
    if (users.length === 0) return [];
    const userIds = users.map((user) => user.id);
    const since = new Date(Date.now() - RATE_LIMITS.signInFailuresPerAccount.windowSeconds * 1000);
    const [active, failed, drive, passkeys, factors, subscriptions, members] = await Promise.all([
      db
        .select({
          userId: schema.authSessions.userId,
          lastSeenAt: sql<Date>`max(${schema.authSessions.lastSeenAt})`,
        })
        .from(schema.authSessions)
        .where(inArray(schema.authSessions.userId, userIds))
        .groupBy(schema.authSessions.userId),
      db
        .select({ userId: schema.securityEvents.userId, count: count() })
        .from(schema.securityEvents)
        .where(
          and(
            inArray(schema.securityEvents.userId, userIds),
            eq(schema.securityEvents.type, "sign_in.failed"),
            gt(schema.securityEvents.occurredAt, since),
          ),
        )
        .groupBy(schema.securityEvents.userId),
      db
        .select({
          userId: schema.driveFiles.userId,
          bytes: sql<string | number>`coalesce(sum(${schema.driveFiles.size}), 0)`,
          files: count(),
        })
        .from(schema.driveFiles)
        .where(and(inArray(schema.driveFiles.userId, userIds), isNull(schema.driveFiles.teamId)))
        .groupBy(schema.driveFiles.userId),
      db
        .select({ userId: schema.webauthnCredentials.userId })
        .from(schema.webauthnCredentials)
        .where(inArray(schema.webauthnCredentials.userId, userIds))
        .groupBy(schema.webauthnCredentials.userId),
      db
        .select({ userId: schema.totpFactors.userId })
        .from(schema.totpFactors)
        .where(
          and(
            inArray(schema.totpFactors.userId, userIds),
            isNotNull(schema.totpFactors.confirmedAt),
          ),
        ),
      db.select().from(schema.subscriptions).where(inArray(schema.subscriptions.userId, userIds)),
      db
        .select({
          userId: schema.teamMembers.userId,
          role: schema.teamMembers.role,
          teamId: schema.teams.id,
          name: schema.teams.name,
        })
        .from(schema.teamMembers)
        .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
        .where(inArray(schema.teamMembers.userId, userIds)),
    ]);
    const activeBy = new Map(active.map((row) => [row.userId, row.lastSeenAt]));
    const failedBy = new Map(failed.map((row) => [row.userId, row.count]));
    const driveBy = new Map(drive.map((row) => [row.userId, row]));
    const secondFactor = new Set([
      ...passkeys.map((row) => row.userId),
      ...factors.map((row) => row.userId),
    ]);
    const subscriptionBy = new Map(subscriptions.map((row) => [row.userId, row]));
    const teamBy = new Map(members.map((row) => [row.userId, row]));
    return users.map((user) => {
      const team = teamBy.get(user.id);
      const seen = activeBy.get(user.id);
      return {
        user,
        lastActiveAt: seen ? new Date(seen) : null,
        failed15m: failedBy.get(user.id) ?? 0,
        driveBytes: Number(driveBy.get(user.id)?.bytes ?? 0),
        driveFiles: driveBy.get(user.id)?.files ?? 0,
        secondFactor: secondFactor.has(user.id),
        subscription: subscriptionBy.get(user.id) ?? null,
        team: team ? { id: team.teamId, name: team.name, role: team.role } : null,
      };
    });
  }

  private statusOf(signals: Signals): CustomerStatus {
    if (signals.user.suspendedAt) return "suspended";
    if (signals.failed15m >= RATE_LIMITS.signInFailuresPerAccount.limit) return "locked";
    if (signals.subscription?.status === "past_due") return "past_due";
    if (!signals.user.emailVerifiedAt) return "unverified";
    return "active";
  }

  private issuesOf(signals: Signals, driveLimit: number, planName: string): CustomerIssue[] {
    const issues: CustomerIssue[] = [];
    const status = this.statusOf(signals);
    if (status === "suspended") {
      issues.push({
        severity: "high",
        title: "Account suspended",
        detail: `${signals.user.suspendedReason ?? "No reason recorded"}. Only Security or the founder can lift it.`,
        fix: "lift_suspension",
      });
    }
    if (status === "locked") {
      issues.push({
        severity: "high",
        title: `Sign-in locked after ${String(signals.failed15m)} failed attempts`,
        detail: `Password sign-in refuses for ${String(RATE_LIMITS.signInFailuresPerAccount.windowSeconds / 60)} minutes after ${String(RATE_LIMITS.signInFailuresPerAccount.limit)} failures. Check the sign-in history first: if the attempts weren’t the customer, leave it. A reset link signs them in with a new password.`,
        fix: "reset_link",
      });
    }
    if (signals.subscription?.status === "past_due") {
      issues.push({
        severity: "medium",
        title: "Last payment failed",
        detail: `Stripe retries the card and emails them each time. They keep ${planName} meanwhile; after the last retry Stripe cancels and the account moves to Free.`,
        fix: null,
      });
    }
    if (!signals.user.emailVerifiedAt) {
      issues.push({
        severity: "medium",
        title: "Email address not confirmed",
        detail:
          "They signed up but never confirmed. Password resets and sign-in codes reach that address; the account can’t sign in until it’s confirmed.",
        fix: null,
      });
    }
    if (driveLimit > 0 && signals.driveBytes / driveLimit >= 0.95) {
      issues.push({
        severity: "medium",
        title: `Drive is ${String(Math.round((signals.driveBytes / driveLimit) * 100))}% full`,
        detail:
          "Uploads and saving from browsers fail when it’s full. Trash still counts until it’s emptied.",
        fix: null,
      });
    }
    if (!signals.secondFactor && signals.user.emailVerifiedAt) {
      issues.push({
        severity: "low",
        title: "No passkey or two-factor",
        detail: "The account is protected by a password only. Suggest a passkey from Shield.",
        fix: null,
      });
    }
    return issues;
  }

  private async summaries(signals: Signals[], viewer: StaffActor): Promise<CustomerSummary[]> {
    const plans = await this.billing.publicPlans();
    const planBy = new Map(plans.map((plan) => [plan.code, plan]));
    const founder = viewer.user.role === "admin";
    return signals.map((entry) => {
      const plan = planBy.get(entry.user.planCode);
      const limits = plan?.limits ?? this.billing.limitsOfPlan(entry.user.planCode);
      const paid =
        entry.user.planSource === "stripe" &&
        entry.subscription !== null &&
        (entry.subscription.status === "active" || entry.subscription.status === "trialing");
      const source =
        entry.user.planSource === "stripe" || entry.user.planSource === "admin"
          ? entry.user.planSource
          : "free";
      return {
        id: entry.user.id,
        email: founder ? entry.user.email : maskEmail(entry.user.email),
        handle: entry.user.email.split("@")[0] ?? entry.user.email,
        planCode: entry.user.planCode,
        planName: plan?.name ?? entry.user.planCode,
        source,
        status: this.statusOf(entry),
        role: entry.user.role,
        teamId: entry.team?.id ?? null,
        teamName: entry.team?.name ?? null,
        teamRole: entry.team?.role ?? null,
        createdAt: entry.user.createdAt.toISOString(),
        lastActiveAt: entry.lastActiveAt?.toISOString() ?? null,
        issues: this.issuesOf(entry, limits.driveBytes, plan?.name ?? entry.user.planCode),
        mrr: paid ? monthly(plan?.price ?? null) : 0,
        currency: plan?.price?.currency ?? plans.find((p) => p.price)?.price?.currency ?? "usd",
      };
    });
  }

  private matches(summary: CustomerSummary, view: CustomerView, signals: Signals): boolean {
    switch (view) {
      case "all":
        return true;
      case "attention":
        return summary.issues.some((issue) => issue.severity !== "low");
      case "past_due":
        return summary.status === "past_due";
      case "locked":
        return summary.status === "locked" || summary.status === "suspended";
      case "drive_full":
        return summary.issues.some((issue) => issue.title.startsWith("Drive is"));
      case "no_2fa":
        return !signals.secondFactor;
      case "staff":
        return isStaffRole(summary.role);
    }
  }

  async list(
    viewer: StaffActor,
    query: { q?: string; view: CustomerView; before?: string; limit: number },
  ): Promise<CustomerList> {
    const signals = await this.scan();
    const summaries = await this.summaries(signals, viewer);
    const byId = new Map(signals.map((entry) => [entry.user.id, entry]));
    const q = query.q?.toLowerCase() ?? "";
    const now = Date.now();
    const views = Object.fromEntries(
      customerViews.map((view) => [
        view,
        summaries.filter((summary) => {
          const entry = byId.get(summary.id);
          return entry ? this.matches(summary, view, entry) : false;
        }).length,
      ]),
    ) as Record<CustomerView, number>;
    const filtered = summaries.filter((summary) => {
      const entry = byId.get(summary.id);
      if (!entry || !this.matches(summary, query.view, entry)) return false;
      if (!q) return true;
      const haystack =
        `${entry.user.email} ${summary.id} ${summary.teamName ?? ""} ${summary.planName}`.toLowerCase();
      return haystack.includes(q);
    });
    const before = query.before;
    const start = before ? filtered.findIndex((s) => s.id < before) : 0;
    const page = filtered.slice(Math.max(0, start), Math.max(0, start) + query.limit);
    return {
      customers: page,
      nextCursor:
        Math.max(0, start) + query.limit < filtered.length ? (page.at(-1)?.id ?? null) : null,
      counts: {
        accounts: summaries.length,
        joined30d: signals.filter((entry) => now - entry.user.createdAt.getTime() < 30 * DAY)
          .length,
        active7d: signals.filter(
          (entry) => entry.lastActiveAt !== null && now - entry.lastActiveAt.getTime() < 7 * DAY,
        ).length,
        attention: views.attention,
        views,
      },
    };
  }

  /** The account, or a plain 404. */
  private async signalsOf(id: string): Promise<Signals> {
    const [entry] = await this.scan([id]);
    if (!entry) throw notFound();
    return entry;
  }

  async one(viewer: StaffActor, id: string): Promise<Customer> {
    const entry = await this.signalsOf(id);
    const [summary] = await this.summaries([entry], viewer);
    if (!summary) throw notFound();
    const [[live], usage, limits, notes] = await Promise.all([
      this.database.db
        .select({ count: count() })
        .from(schema.browserSessions)
        .where(
          and(
            eq(schema.browserSessions.userId, id),
            inArray(schema.browserSessions.status, [...LIVE]),
          ),
        ),
      this.billing.usage(id),
      this.billing.limitsFor(id),
      this.notesOf(id),
    ]);
    return {
      ...summary,
      liveSessions: live?.count ?? 0,
      sessionLimit: limits.liveSessions,
      browsingMinutesThisMonth: usage.browsingMinutesThisMonth,
      driveBytes: usage.driveBytes,
      driveLimitBytes: limits.driveBytes,
      driveFiles: usage.driveFiles,
      notes,
      suspendedAt: entry.user.suspendedAt?.toISOString() ?? null,
      suspendedReason: entry.user.suspendedReason,
      revealed: viewer.user.role === "admin",
    };
  }

  async reveal(actor: StaffActor, id: string, reason: string, meta: RequestMeta) {
    const entry = await this.signalsOf(id);
    await this.audit.record(actor, {
      action: "Revealed personal details",
      target: id,
      detail: `Reason: ${reason}`,
      meta,
    });
    return { email: entry.user.email };
  }

  async signIn(id: string): Promise<CustomerSignIn> {
    const entry = await this.signalsOf(id);
    const now = new Date();
    const dayAgo = new Date(now.getTime() - DAY);
    const [passkeys, mfa, [failed], devices, events] = await Promise.all([
      this.passkeys.list(id),
      this.mfa.status(id),
      this.database.db
        .select({ count: count() })
        .from(schema.securityEvents)
        .where(
          and(
            eq(schema.securityEvents.userId, id),
            eq(schema.securityEvents.type, "sign_in.failed"),
            gt(schema.securityEvents.occurredAt, dayAgo),
          ),
        ),
      this.database.db
        .select()
        .from(schema.authSessions)
        .where(
          and(
            eq(schema.authSessions.userId, id),
            isNull(schema.authSessions.revokedAt),
            gt(schema.authSessions.expiresAt, now),
          ),
        )
        .orderBy(desc(schema.authSessions.lastSeenAt)),
      this.database.db
        .select()
        .from(schema.securityEvents)
        .where(
          and(
            eq(schema.securityEvents.userId, id),
            inArray(schema.securityEvents.type, [...SIGN_IN_TYPES]),
          ),
        )
        .orderBy(desc(schema.securityEvents.occurredAt))
        .limit(30),
    ]);
    return {
      passwordSet: entry.user.passwordHash !== null,
      emailVerified: entry.user.emailVerifiedAt !== null,
      passkeys: passkeys.map((passkey) => ({
        id: passkey.id,
        name: passkey.name,
        createdAt: passkey.createdAt,
        lastUsedAt: passkey.lastUsedAt,
      })),
      authenticatorOn: mfa.totpEnabled,
      recoveryCodesLeft: mfa.recoveryCodesRemaining,
      failedSignIns24h: failed?.count ?? 0,
      devices: devices.map((session) => ({
        id: session.id,
        device: describeUserAgent(session.userAgent) ?? "Unknown device",
        ipAddress: session.ipAddress,
        authMethod: session.authMethod,
        persistent: session.persistent,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        locked: session.lockedAt !== null,
      })),
      signIns: events.map((event) => ({
        at: event.occurredAt.toISOString(),
        type: event.type,
        ok: event.type !== "sign_in.failed",
        ipAddress: event.ipAddress,
        device: describeUserAgent(event.userAgent) ?? "Unknown device",
        newDevice: event.type === "sign_in.new_device",
      })),
    };
  }

  async billingOf(id: string): Promise<CustomerBilling> {
    const entry = await this.signalsOf(id);
    const [plan, usage, limits, plans] = await Promise.all([
      this.billing.planOf(id),
      this.billing.usage(id),
      this.billing.limitsFor(id),
      this.billing.publicPlans(),
    ]);
    const source =
      entry.user.planSource === "stripe" || entry.user.planSource === "admin"
        ? entry.user.planSource
        : "free";
    const coveredBy =
      entry.team && entry.team.role !== "owner" && entry.user.planSource === "free"
        ? { teamId: entry.team.id, teamName: entry.team.name }
        : null;
    return {
      planCode: plan.code,
      planName: plan.name,
      source,
      planNote: entry.user.planNote,
      price: plan.price,
      subscription: entry.subscription
        ? {
            status: entry.subscription.status,
            planCode: entry.subscription.planCode,
            currentPeriodEnd: entry.subscription.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: entry.subscription.cancelAtPeriodEnd,
            createdAt: entry.subscription.createdAt.toISOString(),
          }
        : null,
      coveredBy,
      limits,
      usage,
      stripeConfigured: this.billing.available,
      plans: plans.map((entry) => ({ code: entry.code, name: entry.name })),
    };
  }

  async browsersOf(id: string): Promise<CustomerBrowsers> {
    await this.signalsOf(id);
    const [sessions, profiles, limits] = await Promise.all([
      this.database.db
        .select({ session: schema.browserSessions, profileName: schema.profiles.name })
        .from(schema.browserSessions)
        .leftJoin(schema.profiles, eq(schema.profiles.id, schema.browserSessions.profileId))
        .where(
          and(
            eq(schema.browserSessions.userId, id),
            inArray(schema.browserSessions.status, [...LIVE]),
          ),
        )
        .orderBy(desc(schema.browserSessions.createdAt)),
      this.database.db
        .select({ profile: schema.profiles, proxyName: schema.proxies.name })
        .from(schema.profiles)
        .leftJoin(schema.proxies, eq(schema.proxies.id, schema.profiles.proxyId))
        .where(eq(schema.profiles.userId, id))
        .orderBy(schema.profiles.position),
      this.billing.limitsFor(id),
    ]);
    const nameOf = (engine: string) =>
      (engineDetails as Record<string, { name: string } | undefined>)[engine]?.name ?? engine;
    return {
      sessions: sessions.map(({ session, profileName }) => ({
        id: session.id,
        engine: session.engine,
        engineName: nameOf(session.engine),
        profileName,
        runtimeHost: session.runtimeHost,
        startedAt: session.startedAt?.toISOString() ?? null,
        lastViewedAt: session.lastViewedAt?.toISOString() ?? null,
        status: session.status,
      })),
      profiles: profiles.map(({ profile, proxyName }) => ({
        id: profile.id,
        name: profile.name,
        engine: profile.engine,
        engineName: nameOf(profile.engine),
        keepData: profile.keepData,
        dataBytes: profile.dataBytes ?? 0,
        dataSavedAt: profile.dataSavedAt?.toISOString() ?? null,
        extensions: profile.extensions,
        proxyName,
        updatedAt: profile.updatedAt.toISOString(),
      })),
      sessionLimit: limits.liveSessions,
    };
  }

  async driveOf(id: string): Promise<CustomerDrive> {
    await this.signalsOf(id);
    const own = and(eq(schema.driveFiles.userId, id), isNull(schema.driveFiles.teamId));
    const [[live], [quarantined], [folders], trash, limits] = await Promise.all([
      this.database.db
        .select({
          bytes: sql<string | number>`coalesce(sum(${schema.driveFiles.size}), 0)`,
          files: count(),
        })
        .from(schema.driveFiles)
        .where(and(own, isNull(schema.driveFiles.trashedAt))),
      this.database.db
        .select({ count: count() })
        .from(schema.driveFiles)
        .where(and(own, eq(schema.driveFiles.status, "infected"))),
      this.database.db
        .select({ count: count() })
        .from(schema.driveFolders)
        .where(and(eq(schema.driveFolders.userId, id), isNull(schema.driveFolders.teamId))),
      this.database.db
        .select()
        .from(schema.driveFiles)
        .where(and(own, isNotNull(schema.driveFiles.trashedAt)))
        .orderBy(desc(schema.driveFiles.trashedAt)),
      this.billing.limitsFor(id),
    ]);
    return {
      usedBytes: Number(live?.bytes ?? 0),
      limitBytes: limits.driveBytes,
      files: live?.files ?? 0,
      folders: folders?.count ?? 0,
      quarantined: quarantined?.count ?? 0,
      trash: trash.map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        trashedAt: (file.trashedAt ?? file.updatedAt).toISOString(),
      })),
      trashBytes: trash.reduce((total, file) => total + file.size, 0),
    };
  }

  async activityOf(id: string): Promise<CustomerActivity> {
    await this.signalsOf(id);
    const [events, actions] = await Promise.all([
      this.database.db
        .select()
        .from(schema.securityEvents)
        .where(eq(schema.securityEvents.userId, id))
        .orderBy(desc(schema.securityEvents.occurredAt))
        .limit(100),
      this.audit.forTarget(id),
    ]);
    const merged = [
      ...events.map((event) => ({
        at: event.occurredAt.toISOString(),
        type: event.type,
        ipAddress: event.ipAddress,
        device: describeUserAgent(event.userAgent) ?? "",
        staff: null,
        detail: describeMetadata(event.metadata),
      })),
      ...actions.map((action) => ({
        at: action.at,
        type: action.action,
        ipAddress: action.ipAddress,
        device: "",
        staff: action.actorEmail ?? action.actorRole,
        detail: action.detail,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    return { events: merged.slice(0, 120) };
  }

  async privacyOf(id: string): Promise<CustomerPrivacy> {
    const entry = await this.signalsOf(id);
    const [usage, [profiles], exports] = await Promise.all([
      this.billing.usage(id),
      this.database.db
        .select({
          count: count(),
          bytes: sql<string | number>`coalesce(sum(${schema.profiles.dataBytes}), 0)`,
        })
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, id)),
      this.database.db
        .select({ at: schema.securityEvents.occurredAt })
        .from(schema.securityEvents)
        .where(
          and(
            eq(schema.securityEvents.userId, id),
            eq(schema.securityEvents.type, "data.exported"),
          ),
        )
        .orderBy(desc(schema.securityEvents.occurredAt))
        .limit(10),
    ]);
    const prefs = entry.user.emailPrefs as Record<string, unknown>;
    return {
      held: [
        { what: "Account details", detail: "Email address, plan, when it was made" },
        {
          what: "Drive files",
          detail: `${formatBytes(usage.driveBytes)} in ${String(usage.driveFiles)} files, encrypted with their own keys`,
        },
        {
          what: "Browser profiles",
          detail: `${String(profiles?.count ?? 0)} profiles, ${formatBytes(Number(profiles?.bytes ?? 0))} of kept browsing data, encrypted`,
        },
        {
          what: "Saved passwords",
          detail: "Encrypted with the account’s key; Brawzer can’t read them",
        },
        { what: "Security history", detail: "Sign-ins and changes, kept by the retention policy" },
        { what: "Support notes", detail: "What staff wrote here" },
      ],
      marketingEmails: prefs.marketing !== false,
      exports: exports.map((row) => ({ at: row.at.toISOString() })),
    };
  }

  private async notesOf(id: string): Promise<StaffNote[]> {
    const rows = await this.database.db
      .select({ note: schema.staffNotes, email: schema.users.email })
      .from(schema.staffNotes)
      .leftJoin(schema.users, eq(schema.users.id, schema.staffNotes.authorId))
      .where(eq(schema.staffNotes.userId, id))
      .orderBy(desc(schema.staffNotes.pinned), desc(schema.staffNotes.id));
    return rows.map(({ note, email }) => ({
      id: note.id,
      authorEmail: email,
      body: note.body,
      pinned: note.pinned,
      createdAt: note.createdAt.toISOString(),
    }));
  }

  /* ── Acting ── */

  async addNote(
    actor: StaffActor,
    id: string,
    body: string,
    pinned: boolean,
    meta: RequestMeta,
  ): Promise<StaffNote[]> {
    await this.signalsOf(id);
    await this.database.db
      .insert(schema.staffNotes)
      .values({ userId: id, authorId: actor.user.id, body, pinned });
    await this.audit.record(actor, { action: "Added a note", target: id, meta });
    return this.notesOf(id);
  }

  async deleteNote(actor: StaffActor, id: string, noteId: string, meta: RequestMeta) {
    const deleted = await this.database.db
      .delete(schema.staffNotes)
      .where(and(eq(schema.staffNotes.id, noteId), eq(schema.staffNotes.userId, id)))
      .returning({ id: schema.staffNotes.id });
    if (deleted.length === 0) throw new ApiException("not_found", 404, "That note is gone.");
    await this.audit.record(actor, { action: "Deleted a note", target: id, meta });
    return this.notesOf(id);
  }

  async sendResetLink(actor: StaffActor, id: string, meta: RequestMeta): Promise<void> {
    const entry = await this.signalsOf(id);
    await this.auth.forgotPassword(entry.user.email, meta);
    await this.audit.record(actor, { action: "Sent a password reset link", target: id, meta });
  }

  async signOutEverywhere(actor: StaffActor, id: string, reason: string, meta: RequestMeta) {
    await this.signalsOf(id);
    await this.sessions.revokeAll(id, "signed_out_by_staff");
    await this.browser.endAllForUser(id, "admin");
    await this.audit.record(actor, {
      action: "Signed out everywhere",
      target: id,
      detail: `Reason: ${reason}`,
      meta,
    });
  }

  async signOutDevice(actor: StaffActor, id: string, sessionId: string, meta: RequestMeta) {
    await this.signalsOf(id);
    const [row] = await this.database.db
      .select({ id: schema.authSessions.id })
      .from(schema.authSessions)
      .where(and(eq(schema.authSessions.id, sessionId), eq(schema.authSessions.userId, id)))
      .limit(1);
    if (!row) throw new ApiException("not_found", 404, "That device isn’t signed in.");
    await this.browser.endForAuthSession(sessionId, "admin");
    await this.sessions.revoke(sessionId, "signed_out_by_staff");
    await this.audit.record(actor, { action: "Signed out a device", target: id, meta });
  }

  async removePasskey(
    actor: StaffActor,
    id: string,
    passkeyId: string,
    reason: string,
    meta: RequestMeta,
  ) {
    await this.signalsOf(id);
    const name = await this.passkeys.removeForUser(id, passkeyId, meta);
    await this.audit.record(actor, {
      action: "Removed a passkey",
      target: id,
      detail: `${name} · ${reason}`,
      meta,
    });
  }

  async disableTwoFactor(actor: StaffActor, id: string, reason: string, meta: RequestMeta) {
    await this.signalsOf(id);
    await this.mfa.disableForUser(id, meta);
    await this.audit.record(actor, {
      action: "Turned off two-factor",
      target: id,
      detail: `Reason: ${reason}`,
      meta,
    });
  }

  async suspend(actor: StaffActor, id: string, reason: string, meta: RequestMeta) {
    const entry = await this.signalsOf(id);
    if (isStaffRole(entry.user.role)) {
      throw new ApiException(
        "bad_request",
        400,
        "Staff accounts are removed from the team, not suspended.",
      );
    }
    await this.database.db
      .update(schema.users)
      .set({ suspendedAt: new Date(), suspendedReason: reason, updatedAt: new Date() })
      .where(eq(schema.users.id, id));
    await this.sessions.revokeAll(id, "suspended");
    await this.browser.endAllForUser(id, "admin");
    await this.audit.record(actor, {
      action: "Suspended the account",
      target: id,
      detail: `Reason: ${reason}`,
      meta,
    });
    logger.log(`Account ${id} suspended by staff`);
  }

  async liftSuspension(actor: StaffActor, id: string, reason: string, meta: RequestMeta) {
    await this.signalsOf(id);
    await this.database.db
      .update(schema.users)
      .set({ suspendedAt: null, suspendedReason: null, updatedAt: new Date() })
      .where(eq(schema.users.id, id));
    await this.audit.record(actor, {
      action: "Lifted the suspension",
      target: id,
      detail: `Reason: ${reason}`,
      meta,
    });
  }

  async setPlan(
    actor: StaffActor & { session: { id: string } },
    id: string,
    planCode: string,
    reason: string,
    meta: RequestMeta,
  ) {
    await this.signalsOf(id);
    await this.billing.setPlanByAdmin(actor, id, planCode, reason, meta);
    await this.audit.record(actor, {
      action: "Changed the plan",
      target: id,
      detail: `${planCode} · ${reason}`,
      meta,
    });
  }

  async restoreFromTrash(actor: StaffActor, id: string, fileId: string, meta: RequestMeta) {
    await this.signalsOf(id);
    const file = await this.drive.restoreFileFor(id, fileId);
    await this.audit.record(actor, {
      action: "Restored a file from Trash",
      target: id,
      detail: file.name,
      meta,
    });
    return file;
  }

  async endBrowserSession(
    actor: StaffActor,
    id: string,
    sessionId: string,
    reason: string,
    meta: RequestMeta,
  ) {
    await this.signalsOf(id);
    const [row] = await this.database.db
      .select({ id: schema.browserSessions.id })
      .from(schema.browserSessions)
      .where(and(eq(schema.browserSessions.id, sessionId), eq(schema.browserSessions.userId, id)))
      .limit(1);
    if (!row) throw new ApiException("not_found", 404, "No such session.");
    await this.browser.endByAdmin(sessionId);
    await this.audit.record(actor, {
      action: "Ended a cloud browser session",
      target: id,
      detail: `${sessionId} · ${reason}`,
      meta,
    });
  }

  async deleteAccount(actor: StaffActor, id: string, reason: string, meta: RequestMeta) {
    const entry = await this.signalsOf(id);
    if (isStaffRole(entry.user.role)) {
      throw new ApiException("bad_request", 400, "Remove a staff member from the team first.");
    }
    await this.audit.record(actor, {
      action: "Deleted the account",
      target: id,
      detail: `${maskEmail(entry.user.email)} · ${reason}`,
      meta,
    });
    await this.account.deleteByStaff(entry.user);
  }
}

function describeMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  return Object.entries(metadata as Record<string, unknown>)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export { BROWSER_LIMITS as CONSOLE_BROWSER_LIMITS };
