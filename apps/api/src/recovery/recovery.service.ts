import {
  RECOVERY_WAIT_HOURS,
  type RecoveryCase,
  type RecoveryCheckKind,
  type RecoveryConfirmed,
  recoveryPoints,
} from "@brawzer/contracts";
import { and, type DatabaseHandle, desc, eq, inArray, or, schema } from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { EmailTokenService } from "../auth/email-token.service.js";
import { MfaService } from "../auth/mfa/mfa.service.js";
import { PasskeyService } from "../auth/passkeys/passkey.service.js";
import { SessionService } from "../auth/session.service.js";
import { BillingService } from "../billing/billing.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE } from "../database/database.module.js";
import { EmailService } from "../email/email.js";
import { maskEmail } from "../email/transports.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../security-events/security-events.js";

type CaseRow = typeof schema.recoveryCases.$inferSelect;

/** Who is doing something in the console. */
export interface StaffViewer {
  user: { id: string; email: string; role: string };
}

const HOUR = 3_600_000;
const OPEN = ["verifying", "waiting"] as const;

const notFound = () => new ApiException("not_found", 404, "That case doesn’t exist.");
const handleOf = (email: string) => email.split("@")[0] ?? email;

/**
 * Account recovery (Phase 11.2): for people who lost every sign-in method.
 * The owner confirms from their email and can cancel from it; a 48-hour wait
 * follows; staff record identity checks; a second person releases the
 * account, which removes the lost methods and sends a password link. Every
 * step is a security event on the account, and the founders are told.
 */
@Injectable()
export class RecoveryService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(EmailTokenService) private readonly tokens: EmailTokenService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(PasskeyService) private readonly passkeys: PasskeyService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /* ── The person ── */

  /** Starts (or restarts) a case; says nothing about whether the address has an account. */
  async start(email: string, meta: RequestMeta, openedById: string | null = null): Promise<void> {
    await this.limiter.enforce(RATE_LIMITS.emailsPerIp, meta.ip ?? "unknown");
    const [user] = await this.database.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.email, email.trim().toLowerCase()))
      .limit(1);
    if (!user) return;
    await this.limiter.enforce(RATE_LIMITS.emailsPerAccount, user.id);
    await this.openFor(user, meta, openedById);
  }

  private async openFor(
    user: { id: string; email: string },
    meta: RequestMeta,
    openedById: string | null,
  ): Promise<string> {
    const db = this.database.db;
    const [open] = await db
      .select({ id: schema.recoveryCases.id, status: schema.recoveryCases.status })
      .from(schema.recoveryCases)
      .where(
        and(eq(schema.recoveryCases.userId, user.id), inArray(schema.recoveryCases.status, OPEN)),
      )
      .limit(1);
    let caseId = open?.id;
    if (!open) {
      const [created] = await db
        .insert(schema.recoveryCases)
        .values({
          userId: user.id,
          openedById,
          requestIp: meta.ip,
          requestUserAgent: meta.userAgent,
        })
        .returning({ id: schema.recoveryCases.id });
      caseId = created?.id;
    }
    if (!caseId) throw new Error("The case was not created");
    if (open?.status === "waiting") return caseId; // Confirmed already: nothing more to send.
    await this.tokens.invalidateAll(user.id, ["recovery_confirm"]);
    const token = await this.tokens.issue(user.id, "recovery_confirm");
    this.email.sendRecoveryConfirm(user.email, token);
    return caseId;
  }

  /** The owner confirmed from their email: the wait begins; they can cancel from the next email. */
  async confirm(token: string, meta: RequestMeta): Promise<RecoveryConfirmed> {
    await this.limiter.enforce(RATE_LIMITS.linkAttemptsPerIp, meta.ip ?? "unknown");
    const found = await this.tokens.find(token, "recovery_confirm");
    if (!found) throw new ApiException("token_invalid", 400, "That link isn’t valid any more.");
    const db = this.database.db;
    const [open] = await db
      .select()
      .from(schema.recoveryCases)
      .where(
        and(
          eq(schema.recoveryCases.userId, found.user.id),
          inArray(schema.recoveryCases.status, OPEN),
        ),
      )
      .limit(1);
    if (!open) throw new ApiException("token_invalid", 400, "That link isn’t valid any more.");
    if (!(await this.tokens.consume(found.token.id))) {
      throw new ApiException("token_invalid", 400, "That link isn’t valid any more.");
    }
    if (open.status === "waiting" && open.releaseAt) {
      return { releaseAt: open.releaseAt.toISOString() };
    }
    const now = new Date();
    const releaseAt = new Date(now.getTime() + RECOVERY_WAIT_HOURS * HOUR);
    const deviceKnown = await this.deviceKnown(found.user.id, meta);
    await db
      .update(schema.recoveryCases)
      .set({ status: "waiting", emailConfirmedAt: now, releaseAt, deviceKnown, updatedAt: now })
      .where(eq(schema.recoveryCases.id, open.id));
    await this.events.record({
      type: "recovery.requested",
      userId: found.user.id,
      meta,
      metadata: { deviceKnown, releaseAt: releaseAt.toISOString() },
    });
    const cancel = await this.tokens.issue(found.user.id, "recovery_cancel");
    this.email.sendRecoveryWaiting(found.user.email, releaseAt, cancel);
    this.email.notifyAdmins(
      "recovery",
      [
        ["Account", maskEmail(found.user.email)],
        ["Device seen before", deviceKnown ? "yes" : "no"],
        ["Earliest release", releaseAt.toISOString()],
      ],
      `recovery:${open.id}:confirmed`,
    );
    return { releaseAt: releaseAt.toISOString() };
  }

  /** "This wasn't me": the owner stops it. Security hears about it. */
  async cancel(token: string, meta: RequestMeta): Promise<void> {
    await this.limiter.enforce(RATE_LIMITS.linkAttemptsPerIp, meta.ip ?? "unknown");
    const found = await this.tokens.find(token, "recovery_cancel");
    if (!found) throw new ApiException("token_invalid", 400, "That link isn’t valid any more.");
    if (!(await this.tokens.consume(found.token.id))) {
      throw new ApiException("token_invalid", 400, "That link isn’t valid any more.");
    }
    await this.tokens.invalidateAll(found.user.id, ["recovery_confirm", "recovery_cancel"]);
    const now = new Date();
    const closed = await this.database.db
      .update(schema.recoveryCases)
      .set({
        status: "denied",
        closedByOwner: true,
        closedAt: now,
        closedReason: "Cancelled by the account owner: possible takeover attempt",
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.recoveryCases.userId, found.user.id),
          inArray(schema.recoveryCases.status, OPEN),
        ),
      )
      .returning({ id: schema.recoveryCases.id });
    await this.events.record({
      type: "recovery.cancelled",
      userId: found.user.id,
      meta,
      metadata: { byOwner: true },
    });
    this.email.sendRecoveryCancelled(found.user.email);
    this.email.notifyAdmins(
      "recovery",
      [
        ["Account", maskEmail(found.user.email)],
        ["What happened", "The owner cancelled: someone else may have asked"],
      ],
      `recovery:${closed[0]?.id ?? found.user.id}:cancelled`,
    );
  }

  /* ── The console ── */

  async list(
    viewer: StaffViewer,
  ): Promise<{ cases: RecoveryCase[]; averageHoursToRelease: number | null }> {
    const rows = await this.database.db
      .select()
      .from(schema.recoveryCases)
      .orderBy(desc(schema.recoveryCases.openedAt))
      .limit(200);
    const cases = await this.cases(viewer, rows);
    const released = rows.filter(
      (row) => row.status === "released" && row.closedAt && row.emailConfirmedAt,
    );
    const average = released.length
      ? released.reduce(
          (sum, row) =>
            sum + ((row.closedAt?.getTime() ?? 0) - (row.emailConfirmedAt?.getTime() ?? 0)) / HOUR,
          0,
        ) / released.length
      : null;
    return {
      cases,
      averageHoursToRelease: average === null ? null : Math.round(average * 10) / 10,
    };
  }

  /** Staff start a case for a customer who asked by other means; the customer still confirms by email. */
  async startForCustomer(
    actor: StaffViewer,
    customerId: string,
    meta: RequestMeta,
  ): Promise<string> {
    const [user] = await this.database.db
      .select({ id: schema.users.id, email: schema.users.email, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, customerId))
      .limit(1);
    if (!user) throw new ApiException("not_found", 404, "That account doesn’t exist.");
    return this.openFor(user, meta, actor.user.id);
  }

  async recordCheck(
    actor: StaffViewer,
    id: string,
    check: RecoveryCheckKind,
    ok: boolean,
    note: string,
  ): Promise<void> {
    const row = await this.openCase(id);
    const checks = {
      ...row.checks,
      [check]: { ok, by: actor.user.email, at: new Date().toISOString(), note },
    };
    await this.database.db
      .update(schema.recoveryCases)
      .set({ checks, updatedAt: new Date() })
      .where(eq(schema.recoveryCases.id, id));
  }

  /** A first member of staff says the checks are done; a different one releases. */
  async markReviewed(actor: StaffViewer, id: string): Promise<void> {
    const row = await this.openCase(id);
    if (row.status !== "waiting") {
      throw new ApiException("conflict", 409, "The owner hasn’t confirmed from their email yet.");
    }
    await this.database.db
      .update(schema.recoveryCases)
      .set({ reviewedById: actor.user.id, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.recoveryCases.id, id));
  }

  async release(
    actor: StaffViewer,
    id: string,
    reason: string,
    early: boolean,
    meta: RequestMeta,
  ): Promise<{ userEmail: string; early: boolean }> {
    const row = await this.openCase(id);
    if (row.status !== "waiting" || !row.releaseAt) {
      throw new ApiException("conflict", 409, "The owner hasn’t confirmed from their email yet.");
    }
    if (!row.reviewedById) {
      throw new ApiException(
        "conflict",
        409,
        "Someone must record the checks and mark them complete first.",
      );
    }
    if (row.reviewedById === actor.user.id) {
      throw new ApiException(
        "conflict",
        409,
        "You completed the checks, so a different member of staff must release the account.",
      );
    }
    const now = new Date();
    const isEarly = row.releaseAt.getTime() > now.getTime();
    if (isEarly && !early) {
      throw new ApiException(
        "conflict",
        409,
        "The 48-hour wait isn’t over. Releasing early is for confirmed emergencies only.",
      );
    }
    const [user] = await this.database.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, row.userId))
      .limit(1);
    if (!user) throw notFound();

    // The lost methods go; every device is signed out; a password link goes to the owner.
    for (const passkey of await this.passkeys.list(user.id)) {
      await this.passkeys.removeForUser(user.id, passkey.id, meta);
    }
    if ((await this.mfa.status(user.id)).totpEnabled) await this.mfa.disableForUser(user.id, meta);
    await this.sessions.revokeAll(user.id, "signed_out_by_staff");
    await this.tokens.invalidateAll(user.id, [
      "recovery_confirm",
      "recovery_cancel",
      "reset_password",
    ]);
    const reset = await this.tokens.issue(user.id, "reset_password");
    await this.database.db
      .update(schema.recoveryCases)
      .set({
        status: "released",
        closedById: actor.user.id,
        closedAt: now,
        closedReason: reason,
        releasedEarly: isEarly,
        updatedAt: now,
      })
      .where(eq(schema.recoveryCases.id, id));
    await this.events.record({
      type: "recovery.released",
      userId: user.id,
      meta,
      metadata: { early: isEarly },
    });
    this.email.sendRecoveryReleased(user.email, reset);
    return { userEmail: user.email, early: isEarly };
  }

  async deny(actor: StaffViewer, id: string, reason: string, meta: RequestMeta): Promise<string> {
    const row = await this.openCase(id);
    const now = new Date();
    await this.database.db
      .update(schema.recoveryCases)
      .set({
        status: "denied",
        closedById: actor.user.id,
        closedAt: now,
        closedReason: reason,
        updatedAt: now,
      })
      .where(eq(schema.recoveryCases.id, id));
    await this.tokens.invalidateAll(row.userId, ["recovery_confirm", "recovery_cancel"]);
    await this.events.record({ type: "recovery.denied", userId: row.userId, meta });
    return row.userId;
  }

  /* ── Shared ── */

  private async openCase(id: string): Promise<CaseRow> {
    const [row] = await this.database.db
      .select()
      .from(schema.recoveryCases)
      .where(eq(schema.recoveryCases.id, id))
      .limit(1);
    if (!row) throw notFound();
    if (row.status === "released" || row.status === "denied") {
      throw new ApiException("conflict", 409, "That case is closed.");
    }
    return row;
  }

  /** Has this address or browser signed in to the account before? */
  private async deviceKnown(userId: string, meta: RequestMeta): Promise<boolean> {
    const conditions = [];
    if (meta.ip) conditions.push(eq(schema.authSessions.ipAddress, meta.ip));
    if (meta.userAgent) conditions.push(eq(schema.authSessions.userAgent, meta.userAgent));
    if (conditions.length === 0) return false;
    const [row] = await this.database.db
      .select({ id: schema.authSessions.id })
      .from(schema.authSessions)
      .where(and(eq(schema.authSessions.userId, userId), or(...conditions)))
      .limit(1);
    return row !== undefined;
  }

  private async cases(viewer: StaffViewer, rows: readonly CaseRow[]): Promise<RecoveryCase[]> {
    if (rows.length === 0) return [];
    const db = this.database.db;
    const userIds = [...new Set(rows.map((row) => row.userId))];
    const staffIds = [
      ...new Set(
        rows.flatMap((row) =>
          [row.openedById, row.reviewedById, row.closedById].filter(
            (value): value is string => !!value,
          ),
        ),
      ),
    ];
    const [users, staff, plans, planCodes, passkeyRows, mfaRows] = await Promise.all([
      db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds)),
      staffIds.length
        ? db
            .select({ id: schema.users.id, email: schema.users.email })
            .from(schema.users)
            .where(inArray(schema.users.id, staffIds))
        : Promise.resolve([]),
      this.billing.publicPlans(),
      this.billing.plansOf(userIds),
      db
        .select({ userId: schema.webauthnCredentials.userId })
        .from(schema.webauthnCredentials)
        .where(inArray(schema.webauthnCredentials.userId, userIds)),
      db
        .select({ userId: schema.totpFactors.userId, confirmedAt: schema.totpFactors.confirmedAt })
        .from(schema.totpFactors)
        .where(inArray(schema.totpFactors.userId, userIds)),
    ]);
    const founder = viewer.user.role === "admin";
    const emailBy = new Map(users.map((user) => [user.id, user.email]));
    const staffBy = new Map(staff.map((user) => [user.id, user.email]));
    const planBy = new Map(plans.map((plan) => [plan.code, plan.name]));
    const passkeyCount = new Map<string, number>();
    for (const row of passkeyRows)
      passkeyCount.set(row.userId, (passkeyCount.get(row.userId) ?? 0) + 1);
    const authenticator = new Set(
      mfaRows.filter((row) => row.confirmedAt !== null).map((row) => row.userId),
    );
    return rows.map((row) => {
      const email = emailBy.get(row.userId) ?? "";
      const planCode = planCodes.get(row.userId) ?? "free";
      const checks = row.checks as RecoveryCase["checks"];
      let points = 0;
      if (row.emailConfirmedAt) points += recoveryPoints.email;
      if (row.deviceKnown) points += recoveryPoints.device;
      for (const key of ["invoice", "card", "idDocument"] as const) {
        if (checks[key]?.ok) points += recoveryPoints[key];
      }
      return {
        id: row.id,
        status: row.status,
        customer: {
          id: row.userId,
          handle: handleOf(email),
          email: founder ? email : maskEmail(email),
          planName: planBy.get(planCode) ?? planCode,
        },
        openedAt: row.openedAt.toISOString(),
        openedBy: row.openedById ? (staffBy.get(row.openedById) ?? "(account gone)") : null,
        emailConfirmedAt: row.emailConfirmedAt?.toISOString() ?? null,
        deviceKnown: row.deviceKnown,
        releaseAt: row.releaseAt?.toISOString() ?? null,
        checks,
        points,
        reviewedBy: row.reviewedById ? (staffBy.get(row.reviewedById) ?? "(account gone)") : null,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        closedBy: row.closedById ? (staffBy.get(row.closedById) ?? "(account gone)") : null,
        closedByOwner: row.closedByOwner,
        closedAt: row.closedAt?.toISOString() ?? null,
        closedReason: row.closedReason,
        releasedEarly: row.releasedEarly,
        signIn: {
          passkeys: passkeyCount.get(row.userId) ?? 0,
          authenticator: authenticator.has(row.userId),
        },
      };
    });
  }
}
