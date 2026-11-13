import {
  type ComplianceList,
  type DataMap,
  DRIVE_TRASH_DAYS,
  type Goal,
  type GoalList,
  type GoalRequest,
  HISTORY_LIMITS,
  type LogPrivacyRequest,
  PRIVACY_DEADLINE_DAYS,
  type PrivacyKind,
  type PrivacyRequestList,
  type WeeklyPreview,
  type WeeklySettings,
  weeklySettingsSchema,
} from "@brawzer/contracts";
import { type DatabaseHandle, desc, eq, inArray, schema } from "@brawzer/db";
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { BillingService } from "../billing/billing.service.js";
import { IncidentsService } from "../care/incidents.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import { EmailService } from "../email/email.js";
import { maskEmail } from "../email/transports.js";
import { RETENTION } from "../maintenance/retention.js";
import { RecoveryService } from "../recovery/recovery.service.js";
import { SupportService } from "../support/support.service.js";
import { CompanyService } from "./company.service.js";
import { CustomersService } from "./customers.service.js";

/** Who is doing something in the console. */
export interface StaffViewer {
  user: { id: string; email: string; role: string };
}

const DAY = 86_400_000;
const WEEKLY_KEY = "weekly-email";
const logger = new Logger("ComplianceConsole");
const handleOf = (email: string) => email.split("@")[0] ?? email;

const DEFAULT_WEEKLY: WeeklySettings = { on: false, hourUtc: 8, recipients: [] };

/** Controls seeded the first time the checklist is opened; the team edits them from there. */
const DEFAULT_CONTROLS: readonly (readonly [string, string])[] = [
  ["Access", "Every member of staff signs in with a passkey or an authenticator"],
  ["Access", "Founders’ recovery codes are kept offline, not in email or chat"],
  ["Access", "Staff who left have had their role removed within a day"],
  ["Access", "Production server access goes through the runbook, with a record"],
  ["Data protection", "The privacy notice matches what Brawzer actually does with data"],
  ["Data protection", "Every privacy request this quarter was answered within a month"],
  ["Data protection", "Supplier agreements (data processing terms) are signed and filed"],
  ["Data protection", "The data map in the console is reviewed this quarter"],
  ["Operations", "Database backups were restored in a test this quarter"],
  ["Operations", "A penetration test was done in the last twelve months"],
  ["Operations", "The incident response plan was reviewed this year"],
  ["Operations", "Secrets (Stripe, Resend, encryption keys) were rotated on schedule"],
];

/**
 * Privacy requests, the compliance checklist, the data map, goals and the
 * weekly founder email (Phase 11.5). The data map and the weekly email read
 * what the installation configures and measures; the rest are records the
 * team keeps here, each change audited by the controller.
 */
@Injectable()
export class ComplianceConsoleService implements OnApplicationBootstrap {
  private weeklyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(CompanyService) private readonly company: CompanyService,
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(IncidentsService) private readonly incidents: IncidentsService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.env === "test") return;
    this.weeklyTimer = setInterval(() => void this.maybeSendWeekly(), 15 * 60_000);
    this.weeklyTimer.unref();
  }

  private async customerRefs(viewer: StaffViewer, userIds: readonly string[]) {
    if (userIds.length === 0)
      return new Map<string, { id: string; handle: string; email: string; planName: string }>();
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

  private async staffEmails(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((value): value is string => !!value))];
    if (unique.length === 0) return new Map();
    const rows = await this.database.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, unique));
    return new Map(rows.map((row) => [row.id, row.email]));
  }

  /* ── Privacy requests ── */

  async privacy(viewer: StaffViewer): Promise<PrivacyRequestList> {
    const db = this.database.db;
    const [rows, holds] = await Promise.all([
      db
        .select()
        .from(schema.privacyRequests)
        .orderBy(desc(schema.privacyRequests.receivedAt))
        .limit(200),
      db.select({ userId: schema.legalHolds.userId }).from(schema.legalHolds),
    ]);
    const held = new Set(holds.map((row) => row.userId));
    const [refs, staff] = await Promise.all([
      this.customerRefs(
        viewer,
        rows.flatMap((row) => (row.userId ? [row.userId] : [])),
      ),
      this.staffEmails(rows.flatMap((row) => [row.createdById, row.completedById])),
    ]);
    return {
      requests: rows.map((row) => ({
        id: row.id,
        customer: (row.userId ? refs.get(row.userId) : undefined) ?? null,
        kind: row.kind,
        receivedAt: row.receivedAt.toISOString(),
        deadlineAt: row.deadlineAt.toISOString(),
        status: row.status,
        note: row.note,
        createdBy: row.createdById ? (staff.get(row.createdById) ?? "(account gone)") : null,
        completedBy: row.completedById ? (staff.get(row.completedById) ?? "(account gone)") : null,
        completedAt: row.completedAt?.toISOString() ?? null,
        held: row.userId ? held.has(row.userId) : false,
      })),
    };
  }

  async logPrivacy(actor: StaffViewer, body: LogPrivacyRequest): Promise<string> {
    const [user] = await this.database.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, body.customerId))
      .limit(1);
    if (!user) throw new ApiException("not_found", 404, "That account doesn’t exist.");
    const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
    const [row] = await this.database.db
      .insert(schema.privacyRequests)
      .values({
        userId: body.customerId,
        kind: body.kind,
        receivedAt,
        deadlineAt: new Date(receivedAt.getTime() + PRIVACY_DEADLINE_DAYS * DAY),
        note: body.note ?? null,
        createdById: actor.user.id,
      })
      .returning({ id: schema.privacyRequests.id });
    if (!row) throw new Error("The request was not logged");
    return row.id;
  }

  /** Completing a deletion request deletes the account (a legal hold stops it); the rest is a record. */
  async completePrivacy(
    actor: StaffViewer,
    id: string,
    note: string,
    meta: RequestMeta,
  ): Promise<{ userId: string; kind: PrivacyKind }> {
    const [row] = await this.database.db
      .select()
      .from(schema.privacyRequests)
      .where(eq(schema.privacyRequests.id, id))
      .limit(1);
    if (!row) throw new ApiException("not_found", 404, "That request doesn’t exist.");
    if (row.status === "completed")
      throw new ApiException("conflict", 409, "That request is complete already.");
    if (!row.userId) throw new ApiException("conflict", 409, "That account is gone already.");
    const userId = row.userId;
    if (row.kind === "delete") {
      // Throws under a legal hold; the request stays open so the deadline keeps showing.
      await this.customers.deleteAccount(actor, userId, `Privacy request: ${note}`, meta);
    }
    await this.database.db
      .update(schema.privacyRequests)
      .set({ status: "completed", note, completedById: actor.user.id, completedAt: new Date() })
      .where(eq(schema.privacyRequests.id, id));
    return { userId, kind: row.kind };
  }

  /* ── Compliance checklist ── */

  async checklist(): Promise<ComplianceList> {
    const db = this.database.db;
    let rows = await db
      .select()
      .from(schema.complianceItems)
      .orderBy(schema.complianceItems.framework, schema.complianceItems.sortOrder);
    if (rows.length === 0) {
      await db
        .insert(schema.complianceItems)
        .values(
          DEFAULT_CONTROLS.map(([framework, item], index) => ({
            framework,
            item,
            sortOrder: index,
          })),
        )
        .onConflictDoNothing();
      rows = await db
        .select()
        .from(schema.complianceItems)
        .orderBy(schema.complianceItems.framework, schema.complianceItems.sortOrder);
    }
    const staff = await this.staffEmails(rows.map((row) => row.doneById));
    return {
      items: rows.map((row) => ({
        id: row.id,
        framework: row.framework,
        item: row.item,
        done: row.done,
        doneBy: row.doneById ? (staff.get(row.doneById) ?? "(account gone)") : null,
        doneAt: row.doneAt?.toISOString() ?? null,
      })),
    };
  }

  async addItem(framework: string, item: string): Promise<void> {
    const [last] = await this.database.db
      .select({ sortOrder: schema.complianceItems.sortOrder })
      .from(schema.complianceItems)
      .where(eq(schema.complianceItems.framework, framework))
      .orderBy(desc(schema.complianceItems.sortOrder))
      .limit(1);
    await this.database.db
      .insert(schema.complianceItems)
      .values({ framework, item, sortOrder: (last?.sortOrder ?? -1) + 1 });
  }

  async toggleItem(
    actor: StaffViewer,
    id: string,
    done: boolean,
  ): Promise<{ framework: string; item: string }> {
    const [row] = await this.database.db
      .update(schema.complianceItems)
      .set({ done, doneById: done ? actor.user.id : null, doneAt: done ? new Date() : null })
      .where(eq(schema.complianceItems.id, id))
      .returning({
        framework: schema.complianceItems.framework,
        item: schema.complianceItems.item,
      });
    if (!row) throw new ApiException("not_found", 404, "That control is gone.");
    return row;
  }

  async removeItem(id: string): Promise<{ framework: string; item: string }> {
    const [row] = await this.database.db
      .delete(schema.complianceItems)
      .where(eq(schema.complianceItems.id, id))
      .returning({
        framework: schema.complianceItems.framework,
        item: schema.complianceItems.item,
      });
    if (!row) throw new ApiException("not_found", 404, "That control is gone.");
    return row;
  }

  /* ── Data map ── */

  dataMap(): DataMap {
    const { config } = this;
    const storeWhere = config.storage.endpoint
      ? `${new URL(config.storage.endpoint).host} · bucket ${config.storage.bucket}`
      : `AWS S3 ${config.storage.region} · bucket ${config.storage.bucket}`;
    return {
      suppliers: [
        {
          name: "Stripe",
          purpose: "Payments and invoices",
          data: "Email address, plan, payment details (card numbers never reach Brawzer)",
          where: null,
          configured: this.billing.available,
        },
        {
          name:
            config.email.transport === "resend"
              ? "Resend"
              : config.email.transport === "mailpit"
                ? "Mailpit (local development)"
                : "Log only",
          purpose: "Sending email",
          data: "Email address and the text of each message",
          where: null,
          configured: config.email.transport !== "log",
        },
        {
          name: "Object store",
          purpose: "Drive files and browser profile data, encrypted before they are stored",
          data: "Encrypted file and profile contents",
          where: storeWhere,
          configured: true,
        },
        {
          name: "Anthropic",
          purpose: "The Assistant",
          data: "What the person types into the Assistant; not used for training",
          where: config.assistant.baseUrl ? new URL(config.assistant.baseUrl).host : null,
          configured: config.assistant.apiKey !== null,
        },
        {
          name: "Cloud browser hosts",
          purpose: "Running sessions",
          data: "Everything a session does, in memory, wiped when it ends",
          where: `${String(config.browser.hosts.length)} host${config.browser.hosts.length === 1 ? "" : "s"} the installation names`,
          configured: true,
        },
      ],
      retention: [
        { data: "Cloud browser session (tabs, memory)", keptFor: "Wiped when the session ends" },
        { data: "Ended session records", keptFor: `${String(RETENTION.endedSessionDays)} days` },
        { data: "Browser profiles", keptFor: "Until the customer deletes them" },
        {
          data: "Browsing history",
          keptFor: `${String(HISTORY_LIMITS.retentionDays)} days or ${String(HISTORY_LIMITS.maxEntries)} entries`,
        },
        { data: "Drive Trash", keptFor: `${String(DRIVE_TRASH_DAYS)} days` },
        {
          data: "Security history",
          keptFor: `${String(config.securityHistoryRetentionDays)} days`,
        },
        { data: "Remembered devices", keptFor: `${String(RETENTION.knownDeviceDays)} days` },
        { data: "Used sign-in links", keptFor: `${String(RETENTION.usedLinkDays)} days` },
        {
          data: "Unconfirmed accounts",
          keptFor: `${String(RETENTION.unconfirmedAccountDays)} days`,
        },
        {
          data: "Reported pages’ pictures",
          keptFor: `${String(RETENTION.reportPictureDays)} days, or until closed`,
        },
        { data: "Closed reports", keptFor: `${String(RETENTION.closedReportDays)} days` },
        { data: "Invoices", keptFor: "In Stripe, for as long as tax law asks" },
        { data: "Deleted accounts", keptFor: "Gone at once; nothing waits in a bin" },
        { data: "Audit log", keptFor: "Kept; rows are never edited or deleted" },
      ],
      locations: [
        {
          data: "Accounts, settings, support requests",
          where: "The installation’s PostgreSQL database",
        },
        { data: "Drive files and profile data", where: storeWhere },
        { data: "Sessions", where: "The installation’s cloud browser hosts, in memory" },
        { data: "Payments", where: this.billing.available ? "Stripe" : "Not configured" },
        { data: "Email", where: config.email.transport === "resend" ? "Resend" : "Local only" },
      ],
    };
  }

  /* ── Goals ── */

  async goals(): Promise<GoalList> {
    const rows = await this.database.db.select().from(schema.goals).orderBy(schema.goals.createdAt);
    const staff = await this.staffEmails(rows.map((row) => row.ownerId));
    return {
      goals: rows.map((row) => this.goal(row, staff)),
    };
  }

  private goal(row: typeof schema.goals.$inferSelect, staff: Map<string, string>): Goal {
    return {
      id: row.id,
      name: row.name,
      unit: row.unit as Goal["unit"],
      current: row.current,
      target: row.target,
      lowerIsBetter: row.lowerIsBetter,
      owner: row.ownerId ? (staff.get(row.ownerId) ?? "(account gone)") : null,
      quarterEnd: row.quarterEnd.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async addGoal(body: GoalRequest): Promise<void> {
    await this.database.db.insert(schema.goals).values({
      name: body.name,
      unit: body.unit,
      current: body.current,
      target: body.target,
      lowerIsBetter: body.lowerIsBetter,
      ownerId: body.ownerId ?? null,
      quarterEnd: new Date(body.quarterEnd),
    });
  }

  async updateGoal(id: string, current: number, target?: number): Promise<Goal> {
    const [row] = await this.database.db
      .update(schema.goals)
      .set({ current, ...(target === undefined ? {} : { target }), updatedAt: new Date() })
      .where(eq(schema.goals.id, id))
      .returning();
    if (!row) throw new ApiException("not_found", 404, "That goal is gone.");
    return this.goal(row, await this.staffEmails([row.ownerId]));
  }

  async removeGoal(id: string): Promise<{ name: string }> {
    const [row] = await this.database.db
      .delete(schema.goals)
      .where(eq(schema.goals.id, id))
      .returning({ name: schema.goals.name });
    if (!row) throw new ApiException("not_found", 404, "That goal is gone.");
    return row;
  }

  /* ── The weekly email ── */

  private async weeklySettings(): Promise<{ settings: WeeklySettings; lastSentAt: Date | null }> {
    const [row] = await this.database.db
      .select({ value: schema.consoleSettings.value })
      .from(schema.consoleSettings)
      .where(eq(schema.consoleSettings.key, WEEKLY_KEY))
      .limit(1);
    const value = row?.value ?? {};
    const parsed = weeklySettingsSchema.safeParse(value.settings);
    const lastSentAt = typeof value.lastSentAt === "string" ? new Date(value.lastSentAt) : null;
    return { settings: parsed.success ? parsed.data : DEFAULT_WEEKLY, lastSentAt };
  }

  private async saveWeekly(settings: WeeklySettings, lastSentAt: Date | null): Promise<void> {
    await this.database.db
      .insert(schema.consoleSettings)
      .values({
        key: WEEKLY_KEY,
        value: { settings, lastSentAt: lastSentAt?.toISOString() ?? null },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.consoleSettings.key,
        set: {
          value: { settings, lastSentAt: lastSentAt?.toISOString() ?? null },
          updatedAt: new Date(),
        },
      });
  }

  async setWeekly(settings: WeeklySettings): Promise<void> {
    const { lastSentAt } = await this.weeklySettings();
    await this.saveWeekly(settings, lastSentAt);
  }

  /** Next Monday at the chosen hour, UTC. */
  private nextMonday(hourUtc: number, from = new Date()): Date {
    const next = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc),
    );
    const daysAhead = (8 - next.getUTCDay()) % 7; // 0 on a Monday
    next.setUTCDate(
      next.getUTCDate() + (daysAhead === 0 && next > from ? 0 : daysAhead === 0 ? 7 : daysAhead),
    );
    return next;
  }

  private async weeklyFacts(
    viewer: StaffViewer,
  ): Promise<{ facts: [string, string][]; needsYou: string[] }> {
    const [overview, stats, recovery, incidents] = await Promise.all([
      this.company.overview(viewer),
      this.support.stats(viewer),
      this.recovery.list(viewer),
      this.incidents.list(),
    ]);
    const mrr =
      overview.mrr
        .map((entry) => `${(entry.amount / 100).toFixed(0)} ${entry.currency.toUpperCase()}`)
        .join(", ") || "0";
    const facts: [string, string][] = [
      ["Accounts", String(overview.accounts)],
      ["Joined in the last 30 days", String(overview.joined30d)],
      ["Active in the last 7 days", String(overview.active7d)],
      ["Paying accounts", String(overview.payingAccounts)],
      ["Monthly recurring revenue", mrr],
      ["Live sessions right now", String(overview.liveSessions)],
      ["Open support requests", String(stats.open)],
      ["Support requests past their response target", String(stats.pastTarget)],
    ];
    const needsYou: string[] = [];
    if (overview.pastDue) needsYou.push(`${String(overview.pastDue)} payments failing`);
    if (stats.pastTarget) needsYou.push(`${String(stats.pastTarget)} requests past target`);
    const openCases = recovery.cases.filter(
      (entry) => entry.status === "verifying" || entry.status === "waiting",
    ).length;
    if (openCases) needsYou.push(`${String(openCases)} account recovery cases open`);
    const openIncidents = incidents.filter((incident) => incident.status !== "resolved").length;
    if (openIncidents) needsYou.push(`${String(openIncidents)} incidents open`);
    if (overview.openReports) needsYou.push(`${String(overview.openReports)} reported pages`);
    if (overview.staffWithoutSecondFactor)
      needsYou.push(`${String(overview.staffWithoutSecondFactor)} staff without a second factor`);
    return { facts, needsYou };
  }

  async weeklyPreview(viewer: StaffViewer): Promise<WeeklyPreview> {
    const [{ settings, lastSentAt }, { facts, needsYou }] = await Promise.all([
      this.weeklySettings(),
      this.weeklyFacts(viewer),
    ]);
    return {
      settings,
      lastSentAt: lastSentAt?.toISOString() ?? null,
      nextAt:
        settings.on && settings.recipients.length
          ? this.nextMonday(settings.hourUtc).toISOString()
          : null,
      facts,
      needsYou,
    };
  }

  async sendWeeklyTo(
    viewer: StaffViewer,
    recipients: WeeklySettings["recipients"],
    record: boolean,
  ): Promise<void> {
    const { facts, needsYou } = await this.weeklyFacts(viewer);
    const weekOf = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date());
    for (const recipient of recipients) {
      this.email.sendWeeklySummary(
        recipient.email,
        weekOf,
        facts,
        recipient.version === "short" ? [] : needsYou,
      );
    }
    if (record) {
      const { settings } = await this.weeklySettings();
      await this.saveWeekly(settings, new Date());
    }
  }

  /** Every 15 minutes: on Monday, from the chosen hour, once a week. */
  private async maybeSendWeekly(): Promise<void> {
    try {
      const { settings, lastSentAt } = await this.weeklySettings();
      if (!settings.on || settings.recipients.length === 0) return;
      const now = new Date();
      if (now.getUTCDay() !== 1 || now.getUTCHours() < settings.hourUtc) return;
      if (lastSentAt && now.getTime() - lastSentAt.getTime() < 6 * DAY) return;
      const system: StaffViewer = {
        user: {
          id: "00000000-0000-7000-8000-000000000000",
          email: "weekly@brawzer",
          role: "admin",
        },
      };
      await this.sendWeeklyTo(system, settings.recipients, true);
      logger.log(`Weekly email sent to ${String(settings.recipients.length)} recipients`);
    } catch (error) {
      logger.warn(`Weekly email not sent: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
}
