import {
  type AbuseDecision,
  type AbuseReportList,
  abuseKindNames,
  type BlockAddressRequest,
  isStaffRole,
  type Legal,
  type LogAbuseRequest,
  type LogLegalRequest,
  type ThreatEvent,
  type Threats,
} from "@brawzer/contracts";
import {
  and,
  count,
  type DatabaseHandle,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { describeUserAgent } from "../auth/user-agent.js";
import { BillingService } from "../billing/billing.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE } from "../database/database.module.js";
import { EmailService } from "../email/email.js";
import { maskEmail } from "../email/transports.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { BlockedAddressesService, parseCidr } from "../security-events/blocked-addresses.js";
import { CustomersService } from "./customers.service.js";

/** Who is doing something in the console. */
export interface StaffViewer {
  user: { id: string; email: string; role: string };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const handleOf = (email: string) => email.split("@")[0] ?? email;

/** The event types the threats page lists: sign-in trouble and anything about account control. */
const THREAT_TYPES = [
  "sign_in.failed",
  "sign_in.new_device",
  "mfa.failed",
  "mfa.disabled",
  "mfa.recovery_code_used",
  "passkey.removed",
  "password.reset_requested",
  "password.reset",
  "email.change_requested",
  "sessions.revoked",
  "recovery.requested",
  "recovery.cancelled",
  "recovery.released",
  "recovery.denied",
  "session.locked",
] as const;

/**
 * The console's security pages (Phase 11.5): what the security events say
 * about sign-in trouble, the addresses Brawzer refuses, abuse reports and
 * what was done about them, and legal requests with the holds that keep an
 * account's data.
 */
@Injectable()
export class SecurityConsoleService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(BlockedAddressesService) private readonly blocked: BlockedAddressesService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(CustomersService) private readonly customers: CustomersService,
  ) {}

  private async customerRefs(viewer: StaffViewer, userIds: readonly string[]) {
    if (userIds.length === 0)
      return new Map<
        string,
        { id: string; handle: string; email: string; planName: string; role: string }
      >();
    const [users, plans] = await Promise.all([
      this.database.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          planCode: schema.users.planCode,
          role: schema.users.role,
        })
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
          role: user.role,
        },
      ]),
    );
  }

  /* ── Threats & sign-ins ── */

  async threats(viewer: StaffViewer): Promise<Threats> {
    const db = this.database.db;
    const now = Date.now();
    const dayAgo = new Date(now - DAY);
    const monthAgo = new Date(now - 30 * DAY);
    const [failed, events, blocked, [accounts], [withPasskey], [withTotp], staff, staffEvents] =
      await Promise.all([
        db
          .select({ at: schema.securityEvents.occurredAt })
          .from(schema.securityEvents)
          .where(
            and(
              eq(schema.securityEvents.type, "sign_in.failed"),
              gte(schema.securityEvents.occurredAt, dayAgo),
            ),
          ),
        db
          .select()
          .from(schema.securityEvents)
          .where(inArray(schema.securityEvents.type, [...THREAT_TYPES]))
          .orderBy(desc(schema.securityEvents.id))
          .limit(200),
        this.blocked.all(),
        db.select({ value: count() }).from(schema.users),
        db
          .select({
            value: sql<string | number>`count(distinct ${schema.webauthnCredentials.userId})`,
          })
          .from(schema.webauthnCredentials),
        db
          .select({ value: sql<string | number>`count(distinct ${schema.totpFactors.userId})` })
          .from(schema.totpFactors)
          .where(isNotNull(schema.totpFactors.confirmedAt)),
        db
          .select({ id: schema.users.id, email: schema.users.email, role: schema.users.role })
          .from(schema.users)
          .where(
            inArray(schema.users.role, [
              "admin",
              "care",
              "billing",
              "sales",
              "technical",
              "security",
            ]),
          ),
        db
          .select()
          .from(schema.securityEvents)
          .where(
            and(
              inArray(schema.securityEvents.type, ["sign_in.succeeded", "sign_in.failed"]),
              gte(schema.securityEvents.occurredAt, monthAgo),
              inArray(
                schema.securityEvents.userId,
                db
                  .select({ id: schema.users.id })
                  .from(schema.users)
                  .where(
                    inArray(schema.users.role, [
                      "admin",
                      "care",
                      "billing",
                      "sales",
                      "technical",
                      "security",
                    ]),
                  ),
              ),
            ),
          )
          .orderBy(desc(schema.securityEvents.id))
          .limit(200),
      ]);

    const failedPerHour = Array.from({ length: 24 }, (_, index) => {
      const start = new Date(Math.floor(now / HOUR) * HOUR - (23 - index) * HOUR);
      const end = new Date(start.getTime() + HOUR);
      return {
        hour: start.toISOString(),
        count: failed.filter((row) => row.at >= start && row.at < end).length,
      };
    });

    // Accounts refused right now: eight failures in fifteen minutes, as the limiter counts them.
    const recentFailures = await db
      .select({ metadata: schema.securityEvents.metadata, userId: schema.securityEvents.userId })
      .from(schema.securityEvents)
      .where(
        and(
          eq(schema.securityEvents.type, "sign_in.failed"),
          gte(schema.securityEvents.occurredAt, new Date(now - 15 * 60_000)),
        ),
      );
    const failuresBy = new Map<string, number>();
    for (const row of recentFailures) {
      if (row.userId) failuresBy.set(row.userId, (failuresBy.get(row.userId) ?? 0) + 1);
    }
    const lockedNow = [...failuresBy.values()].filter(
      (value) => value >= RATE_LIMITS.signInFailuresPerAccount.limit,
    ).length;

    const refs = await this.customerRefs(
      viewer,
      events.flatMap((row) => (row.userId ? [row.userId] : [])),
    );
    const blockedNow = blocked.filter((row) => !row.expiresAt || row.expiresAt.getTime() > now);
    const isBlockedIp = async (ip: string | null) => (ip ? this.blocked.isBlocked(ip) : false);
    const threatEvents: ThreatEvent[] = await Promise.all(
      events.map(async (row) => {
        const ref = row.userId ? refs.get(row.userId) : undefined;
        const reason = typeof row.metadata.reason === "string" ? row.metadata.reason : null;
        return {
          id: row.id,
          type: row.type,
          at: row.occurredAt.toISOString(),
          customer: ref
            ? { id: ref.id, handle: ref.handle, email: ref.email, planName: ref.planName }
            : null,
          staff: ref ? isStaffRole(ref.role) : false,
          ipAddress: row.ipAddress,
          blocked: await isBlockedIp(row.ipAddress),
          device: describeUserAgent(row.userAgent),
          detail: reason,
        };
      }),
    );
    const staffBy = new Map(staff.map((member) => [member.id, member]));
    const staffIds = [
      ...new Set([...blocked.flatMap((row) => (row.createdById ? [row.createdById] : []))]),
    ];
    const staffEmails = staffIds.length
      ? await db
          .select({ id: schema.users.id, email: schema.users.email })
          .from(schema.users)
          .where(inArray(schema.users.id, staffIds))
      : [];
    const emailBy = new Map(staffEmails.map((row) => [row.id, row.email]));
    const withSecondFactor = Number(withPasskey?.value ?? 0) + Number(withTotp?.value ?? 0);
    const total = accounts?.value ?? 0;
    return {
      failedPerHour,
      failed24h: failed.length,
      lockedNow,
      blocked: blockedNow.map((row) => ({
        id: row.id,
        cidr: row.cidr,
        reason: row.reason,
        createdBy: row.createdById ? (emailBy.get(row.createdById) ?? "(account gone)") : null,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
      })),
      secondFactorPercent: total
        ? Math.min(100, Math.round((withSecondFactor / total) * 1000) / 10)
        : 0,
      staffWithSecondFactor: await this.staffWithSecondFactor(staff.map((member) => member.id)),
      staffTotal: staff.length,
      events: threatEvents,
      staffSignIns: staffEvents.flatMap((row) => {
        const member = row.userId ? staffBy.get(row.userId) : undefined;
        if (!member) return [];
        return [
          {
            at: row.occurredAt.toISOString(),
            email: member.email,
            role: member.role,
            ipAddress: row.ipAddress,
            device: describeUserAgent(row.userAgent),
            ok: row.type === "sign_in.succeeded",
          },
        ];
      }),
    };
  }

  private async staffWithSecondFactor(staffIds: readonly string[]): Promise<number> {
    if (staffIds.length === 0) return 0;
    const [passkeys, totps] = await Promise.all([
      this.database.db
        .select({ userId: schema.webauthnCredentials.userId })
        .from(schema.webauthnCredentials)
        .where(inArray(schema.webauthnCredentials.userId, [...staffIds])),
      this.database.db
        .select({ userId: schema.totpFactors.userId })
        .from(schema.totpFactors)
        .where(
          and(
            inArray(schema.totpFactors.userId, [...staffIds]),
            isNotNull(schema.totpFactors.confirmedAt),
          ),
        ),
    ]);
    return new Set([...passkeys.map((row) => row.userId), ...totps.map((row) => row.userId)]).size;
  }

  async block(actor: StaffViewer, body: BlockAddressRequest): Promise<string> {
    const parsed = parseCidr(body.cidr);
    if (!parsed)
      throw new ApiException(
        "validation_failed",
        422,
        "Give an address, or a network like 203.0.113.0/24.",
      );
    if (parsed.family === 4 && parsed.prefix < 16) {
      throw new ApiException(
        "validation_failed",
        422,
        "That network is too wide: /16 is the most Brawzer will block at once.",
      );
    }
    if (parsed.family === 6 && parsed.prefix < 32) {
      throw new ApiException(
        "validation_failed",
        422,
        "That network is too wide: /32 is the most Brawzer will block at once.",
      );
    }
    const row = await this.blocked.add({
      cidr: body.cidr,
      reason: body.reason,
      createdById: actor.user.id,
      expiresAt: body.hours ? new Date(Date.now() + body.hours * HOUR) : null,
    });
    return row.cidr;
  }

  async unblock(id: string): Promise<string> {
    const row = await this.blocked.remove(id);
    if (!row) throw new ApiException("not_found", 404, "That block is gone already.");
    return row.cidr;
  }

  /* ── Abuse reports ── */

  async abuse(viewer: StaffViewer): Promise<AbuseReportList> {
    const db = this.database.db;
    const rows = await db
      .select()
      .from(schema.abuseReports)
      .orderBy(desc(schema.abuseReports.createdAt))
      .limit(200);
    const holds = await db.select({ userId: schema.legalHolds.userId }).from(schema.legalHolds);
    const held = new Set(holds.map((row) => row.userId));
    const staffIds = [
      ...new Set(
        rows.flatMap((row) => [row.createdById, row.decidedById].filter((v): v is string => !!v)),
      ),
    ];
    const [refs, staff] = await Promise.all([
      this.customerRefs(
        viewer,
        rows.map((row) => row.userId),
      ),
      staffIds.length
        ? db
            .select({ id: schema.users.id, email: schema.users.email })
            .from(schema.users)
            .where(inArray(schema.users.id, staffIds))
        : Promise.resolve([]),
    ]);
    const emailBy = new Map(staff.map((row) => [row.id, row.email]));
    return {
      reports: rows.flatMap((row) => {
        const ref = refs.get(row.userId);
        if (!ref) return [];
        return [
          {
            id: row.id,
            customer: { id: ref.id, handle: ref.handle, email: ref.email, planName: ref.planName },
            kind: row.kind,
            source: row.source,
            detail: row.detail,
            status: row.status,
            note: row.note,
            createdBy: row.createdById ? (emailBy.get(row.createdById) ?? "(account gone)") : null,
            createdAt: row.createdAt.toISOString(),
            decidedBy: row.decidedById ? (emailBy.get(row.decidedById) ?? "(account gone)") : null,
            decidedAt: row.decidedAt?.toISOString() ?? null,
            held: held.has(row.userId),
          },
        ];
      }),
    };
  }

  async logAbuse(actor: StaffViewer, body: LogAbuseRequest): Promise<string> {
    const [user] = await this.database.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, body.customerId))
      .limit(1);
    if (!user) throw new ApiException("not_found", 404, "That account doesn’t exist.");
    const [row] = await this.database.db
      .insert(schema.abuseReports)
      .values({
        userId: body.customerId,
        kind: body.kind,
        source: body.source,
        detail: body.detail,
        createdById: actor.user.id,
      })
      .returning({ id: schema.abuseReports.id });
    if (!row) throw new Error("The report was not created");
    return row.id;
  }

  /** Warn (emailed), suspend with the evidence held, or close as not abuse. */
  async decideAbuse(
    actor: StaffViewer,
    id: string,
    body: AbuseDecision,
    meta: RequestMeta,
  ): Promise<{ userId: string; kind: string }> {
    const [row] = await this.database.db
      .select()
      .from(schema.abuseReports)
      .where(eq(schema.abuseReports.id, id))
      .limit(1);
    if (!row) throw new ApiException("not_found", 404, "That report doesn’t exist.");
    if (row.status !== "open")
      throw new ApiException("conflict", 409, "That report was already decided.");
    const [user] = await this.database.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, row.userId))
      .limit(1);
    if (!user) throw new ApiException("not_found", 404, "That account doesn’t exist.");
    const kind = abuseKindNames[row.kind].toLowerCase();
    if (body.action === "warn") {
      this.email.sendAbuseWarning(user.email, kind, body.note);
    } else if (body.action === "suspend") {
      await this.database.db
        .insert(schema.legalHolds)
        .values({
          userId: row.userId,
          why: `Abuse report (${kind}): evidence kept · ${body.note}`,
          createdById: actor.user.id,
        })
        .onConflictDoNothing();
      await this.customers.suspend(actor, row.userId, `Abuse: ${kind}. ${body.note}`, meta);
    }
    await this.database.db
      .update(schema.abuseReports)
      .set({
        status:
          body.action === "warn" ? "warned" : body.action === "suspend" ? "suspended" : "dismissed",
        note: body.note,
        decidedById: actor.user.id,
        decidedAt: new Date(),
      })
      .where(eq(schema.abuseReports.id, id));
    return { userId: row.userId, kind };
  }

  /* ── Legal requests and holds ── */

  async legal(viewer: StaffViewer): Promise<Legal> {
    const db = this.database.db;
    const [requests, holds] = await Promise.all([
      db
        .select()
        .from(schema.legalRequests)
        .orderBy(desc(schema.legalRequests.createdAt))
        .limit(200),
      db.select().from(schema.legalHolds).orderBy(desc(schema.legalHolds.createdAt)),
    ]);
    const userIds = [
      ...new Set([
        ...requests.flatMap((row) => (row.userId ? [row.userId] : [])),
        ...holds.map((row) => row.userId),
      ]),
    ];
    const staffIds = [
      ...new Set(
        [...requests, ...holds].flatMap((row) => (row.createdById ? [row.createdById] : [])),
      ),
    ];
    const [refs, staff] = await Promise.all([
      this.customerRefs(viewer, userIds),
      staffIds.length
        ? db
            .select({ id: schema.users.id, email: schema.users.email })
            .from(schema.users)
            .where(inArray(schema.users.id, staffIds))
        : Promise.resolve([]),
    ]);
    const emailBy = new Map(staff.map((row) => [row.id, row.email]));
    const ref = (userId: string | null) => {
      const found = userId ? refs.get(userId) : undefined;
      return found
        ? { id: found.id, handle: found.handle, email: found.email, planName: found.planName }
        : null;
    };
    return {
      requests: requests.map((row) => ({
        id: row.id,
        fromWhom: row.fromWhom,
        kind: row.kind,
        customer: ref(row.userId),
        status: row.status,
        dueAt: row.dueAt?.toISOString() ?? null,
        note: row.note,
        createdBy: row.createdById ? (emailBy.get(row.createdById) ?? "(account gone)") : null,
        createdAt: row.createdAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
      })),
      holds: holds.flatMap((row) => {
        const customer = ref(row.userId);
        if (!customer) return [];
        return [
          {
            customer,
            why: row.why,
            createdBy: row.createdById ? (emailBy.get(row.createdById) ?? "(account gone)") : null,
            createdAt: row.createdAt.toISOString(),
          },
        ];
      }),
    };
  }

  async logLegal(actor: StaffViewer, body: LogLegalRequest): Promise<string> {
    if (body.customerId) {
      const [user] = await this.database.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, body.customerId))
        .limit(1);
      if (!user) throw new ApiException("not_found", 404, "That account doesn’t exist.");
    }
    const [row] = await this.database.db
      .insert(schema.legalRequests)
      .values({
        fromWhom: body.fromWhom,
        kind: body.kind,
        userId: body.customerId ?? null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        note: body.note ?? null,
        createdById: actor.user.id,
      })
      .returning({ id: schema.legalRequests.id });
    if (!row) throw new Error("The request was not logged");
    if (body.hold && body.customerId) {
      await this.hold(actor, body.customerId, `${body.kind} from ${body.fromWhom}`);
    }
    return row.id;
  }

  async decideLegal(id: string, status: "answered" | "refused", note: string): Promise<void> {
    const updated = await this.database.db
      .update(schema.legalRequests)
      .set({ status, note: note || null, decidedAt: new Date() })
      .where(eq(schema.legalRequests.id, id))
      .returning({ id: schema.legalRequests.id });
    if (updated.length === 0)
      throw new ApiException("not_found", 404, "That request doesn’t exist.");
  }

  async hold(actor: StaffViewer, customerId: string, why: string): Promise<void> {
    const [user] = await this.database.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, customerId))
      .limit(1);
    if (!user) throw new ApiException("not_found", 404, "That account doesn’t exist.");
    await this.database.db
      .insert(schema.legalHolds)
      .values({ userId: customerId, why, createdById: actor.user.id })
      .onConflictDoUpdate({
        target: schema.legalHolds.userId,
        set: { why, createdById: actor.user.id, createdAt: new Date() },
      });
  }

  async release(customerId: string): Promise<string> {
    const [row] = await this.database.db
      .delete(schema.legalHolds)
      .where(eq(schema.legalHolds.userId, customerId))
      .returning({ why: schema.legalHolds.why });
    if (!row) throw new ApiException("not_found", 404, "There is no hold on that account.");
    return row.why;
  }

  /** Whether an account is under a hold, for other services. */
  async isHeld(userId: string): Promise<boolean> {
    const [row] = await this.database.db
      .select({ userId: schema.legalHolds.userId })
      .from(schema.legalHolds)
      .where(eq(schema.legalHolds.userId, userId))
      .limit(1);
    return row !== undefined;
  }
}
