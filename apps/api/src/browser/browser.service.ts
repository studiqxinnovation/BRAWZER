import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import {
  BROWSER_LIMITS,
  type BrowserOverview,
  type BrowserSession,
  type BrowserSessionEndReason,
  browserSessionEndReasonSchema,
  type StreamTicket,
} from "@brawzer/contracts";
import {
  and,
  type BrowserSessionRow,
  count,
  type DatabaseHandle,
  desc,
  eq,
  inArray,
  ne,
  schema,
  sql,
} from "@brawzer/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { Redis } from "ioredis";
import { SessionService } from "../auth/session.service.js";
import { BillingService } from "../billing/billing.service.js";
import { lockAccount } from "../common/account-lock.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { SECRET_BOX } from "../crypto/crypto.module.js";
import type { SecretBox } from "../crypto/secret-box.js";
import { DATABASE } from "../database/database.module.js";
import { REDIS } from "../redis/redis.module.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { ProfileDataService, ProfileDataTooLargeError } from "../profiles/profile-data.service.js";
import { ProfilesService } from "../profiles/profiles.service.js";
import { ProxiesService } from "../proxies/proxies.service.js";
import { OrchestratorService } from "./orchestrator.service.js";
import { StreamTickets } from "./stream-tickets.js";

const logger = new Logger("Browser");
const LIVE = ["starting", "running"] as const;
const REAP_INTERVAL_MS = 30_000;
/** Every API instance hears which sessions ended, whichever instance ended them (ADR 0016). */
export const SESSION_ENDED_CHANNEL = "brawzer:browser:ended";
/** Only one instance reaps at a time; the lock outlives a tick but not a crashed instance. */
const REAPER_LOCK_KEY = "brawzer:browser:reaper";
const REAPER_LOCK_MS = REAP_INTERVAL_MS - 5_000;
/** The installation's live sessions are counted under one advisory lock, so two starts can't both pass. */
const CAPACITY_LOCK_KEY = 0x62_72_63_70;

/** The agent secret is sealed for one session only (ADR 0008). */
const secretContext = (sessionId: string) => `browser-session:${sessionId}`;

const notFound = () =>
  new ApiException("not_found", 404, "That browser session doesn’t exist or has ended.");

/** What the relay needs to reach a running session's agent. */
export interface ViewerAccess {
  agentAddress: string;
  secret: string;
}

/**
 * Cloud browser sessions: one container per session (Phase 3), started by a
 * signed-in device, watched through single-use stream tickets, ended on
 * request, on sign-out, when idle, at its maximum age, or when the runtime
 * fails. In-process events tell the relay when viewers must be cut off.
 */
@Injectable()
export class BrowserService implements OnApplicationBootstrap, OnApplicationShutdown {
  /** `ended` (session id): the relay closes its viewers. */
  readonly events = new EventEmitter();
  private timer: NodeJS.Timeout | undefined;
  private runtimeChecked = 0;
  private runtimeAvailable = false;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OrchestratorService) private readonly orchestrator: OrchestratorService,
    @Inject(StreamTickets) private readonly tickets: StreamTickets,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(SecurityEventsService) private readonly securityEvents: SecurityEventsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
    @Inject(ProfileDataService) private readonly profileData: ProfileDataService,
    @Inject(ProxiesService) private readonly proxies: ProxiesService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(REDIS) private readonly redis: Pick<Redis, "publish" | "set">,
  ) {}

  onApplicationBootstrap(): void {
    // A sign-in that ends takes its cloud browser with it.
    this.sessions.onRevoked((authSessionId) => {
      void this.endForAuthSession(authSessionId, "signed_out").catch(() => undefined);
    });
    void this.reconcile().catch((error: unknown) => {
      logger.warn(`Reconciling runtimes failed: ${error instanceof Error ? error.message : ""}`);
    });
    this.timer = setInterval(() => {
      void this.reapAsLeader().catch((error: unknown) => {
        logger.warn(`Reaping sessions failed: ${error instanceof Error ? error.message : ""}`);
      });
    }, REAP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  async overview(userId: string): Promise<BrowserOverview> {
    const [live, runtime] = await Promise.all([this.liveSession(userId), this.runtimeStatus()]);
    return {
      session: live ? describe(live) : null,
      limits: { idleMinutes: BROWSER_LIMITS.idleMinutes, maxHours: BROWSER_LIMITS.maxHours },
      runtime,
    };
  }

  /** Cached for 10 seconds: the Browser page asks on every load. */
  private async runtimeStatus(): Promise<"available" | "unavailable"> {
    if (Date.now() - this.runtimeChecked > 10_000) {
      this.runtimeChecked = Date.now();
      try {
        await this.orchestrator.ping();
        this.runtimeAvailable = true;
      } catch (error) {
        this.runtimeAvailable = false;
        logger.warn(`Runtime unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    return this.runtimeAvailable ? "available" : "unavailable";
  }

  private async liveSession(userId: string): Promise<BrowserSessionRow | undefined> {
    const [row] = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(
        and(
          eq(schema.browserSessions.userId, userId),
          inArray(schema.browserSessions.status, [...LIVE]),
        ),
      )
      .orderBy(desc(schema.browserSessions.createdAt))
      .limit(1);
    return row;
  }

  async forExport(
    userId: string,
  ): Promise<
    { engine: string; startedAt: string; endedAt: string | null; endReason: string | null }[]
  > {
    const rows = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(eq(schema.browserSessions.userId, userId))
      .orderBy(desc(schema.browserSessions.createdAt));
    return rows.map((row) => ({
      engine: row.engine,
      startedAt: (row.startedAt ?? row.createdAt).toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      endReason: row.endReason,
    }));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async start(
    auth: { user: { id: string }; session: { id: string } },
    profileId: string | null,
    meta: RequestMeta,
  ): Promise<BrowserSession> {
    const userId = auth.user.id;
    const profile = profileId ? await this.profiles.find(userId, profileId) : undefined;
    if (profileId && !profile) {
      throw new ApiException("validation_failed", 400, "Choose one of your profiles.", {
        details: ["profileId: Choose one of your profiles."],
      });
    }
    const secret = randomBytes(32).toString("base64url");
    const limits = await this.billing.limitsFor(userId);
    if (limits.browsingMinutesPerMonth !== null) {
      const used = await this.billing.browsingMinutesThisMonth(userId);
      if (used >= limits.browsingMinutesPerMonth) {
        throw new ApiException(
          "limit_reached",
          403,
          `Your plan's ${String(Math.round(limits.browsingMinutesPerMonth / 60))} browsing hours for this month are used up. They reset on the 1st; a plan with more hours is on the Account page.`,
        );
      }
    }

    const row = await this.database.db.transaction(async (tx) => {
      await lockAccount(tx, userId);
      // The installation's capacity, counted under one lock across every instance.
      await tx.execute(sql`select pg_advisory_xact_lock(${CAPACITY_LOCK_KEY})`);
      const [total] = await tx
        .select({ count: count() })
        .from(schema.browserSessions)
        .where(inArray(schema.browserSessions.status, [...LIVE]));
      if ((total?.count ?? 0) >= this.config.browser.maxLiveSessions) {
        throw new ApiException(
          "service_unavailable",
          503,
          "Brawzer’s cloud is at capacity right now. Try again in a few minutes.",
          { headers: { "Retry-After": "60" } },
        );
      }
      const live = await tx
        .select({ id: schema.browserSessions.id })
        .from(schema.browserSessions)
        .where(
          and(
            eq(schema.browserSessions.userId, userId),
            inArray(schema.browserSessions.status, [...LIVE]),
          ),
        );
      if (live.length >= limits.liveSessions) {
        throw new ApiException("conflict", 409, "A browser session is already running.");
      }
      const [created] = await tx
        .insert(schema.browserSessions)
        .values({
          userId,
          authSessionId: auth.session.id,
          profileId,
          proxyId: profile?.proxyId ?? null,
          engine: "chromium",
          status: "starting",
          // Sealed once the row id exists; a placeholder keeps the column non-null meanwhile.
          agentSecret: "",
        })
        .returning();
      if (!created) throw new Error("Creating a browser session returned no row");
      return created;
    });

    let started: { containerId: string; agentAddress: string };
    try {
      await this.database.db
        .update(schema.browserSessions)
        .set({ agentSecret: await this.box.seal(secret, secretContext(row.id)) })
        .where(eq(schema.browserSessions.id, row.id));
      // A profile that keeps its data starts from what was saved last time,
      // and browses through its proxy (ADR 0014).
      const restore = profile?.keepData ? await this.profileData.open(profile) : null;
      const upstream = await this.proxies.forEgress(userId, profile?.proxyId ?? null);
      started = await this.orchestrator.start(row.id, secret, restore, upstream);
    } catch (error) {
      logger.warn(
        `Runtime for session ${row.id} failed to start: ${error instanceof Error ? error.message : ""}`,
      );
      await this.markEnded(row.id, "runtime_failed");
      throw new ApiException(
        "service_unavailable",
        503,
        "The cloud browser couldn’t start. Try again in a moment.",
        { headers: { "Retry-After": "10" } },
      );
    }

    const now = new Date();
    const [running] = await this.database.db
      .update(schema.browserSessions)
      .set({
        status: "running",
        containerId: started.containerId,
        agentAddress: started.agentAddress,
        startedAt: now,
      })
      .where(
        and(eq(schema.browserSessions.id, row.id), eq(schema.browserSessions.status, "starting")),
      )
      .returning();
    if (!running) {
      // Ended (sign-out, account deleted) while the container was starting.
      await this.orchestrator.stopSession(row.id, started.containerId);
      throw notFound();
    }
    await this.securityEvents.record({
      type: "browser.session_started",
      userId,
      sessionId: auth.session.id,
      meta,
    });
    return describe(running);
  }

  /** Ends the person's own session. */
  async end(userId: string, id: string, meta: RequestMeta): Promise<void> {
    const [row] = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(and(eq(schema.browserSessions.id, id), eq(schema.browserSessions.userId, userId)))
      .limit(1);
    if (!row) throw notFound();
    if (row.status === "ended") return;
    await this.endSession(row, "user", meta);
  }

  async issueTicket(
    auth: { user: { id: string }; session: { id: string } },
    id: string,
  ): Promise<StreamTicket> {
    const [row] = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(
        and(eq(schema.browserSessions.id, id), eq(schema.browserSessions.userId, auth.user.id)),
      )
      .limit(1);
    if (row?.status !== "running") throw notFound();
    await this.limiter.enforce(RATE_LIMITS.browserTicketsPerAccount, auth.user.id);
    const issued = await this.tickets.issue({
      userId: auth.user.id,
      authSessionId: auth.session.id,
      browserSessionId: row.id,
    });
    return {
      url: `${this.config.browser.streamUrl}/api/v1/browser/sessions/${row.id}/stream`,
      ticket: issued.ticket,
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  /** For the relay, after a ticket was redeemed: where the agent is and how to prove the relay may talk to it. */
  async viewerAccess(id: string, userId: string): Promise<ViewerAccess | null> {
    const [row] = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(and(eq(schema.browserSessions.id, id), eq(schema.browserSessions.userId, userId)))
      .limit(1);
    if (row?.status !== "running" || !row.agentAddress) return null;
    const secret = await this.box.open(row.agentSecret, secretContext(row.id));
    return { agentAddress: row.agentAddress, secret };
  }

  /** The relay's periodic check: may this viewer keep watching? */
  async viewerAllowed(id: string, authSessionId: string): Promise<boolean> {
    const [row] = await this.database.db
      .select({ status: schema.browserSessions.status })
      .from(schema.browserSessions)
      .where(eq(schema.browserSessions.id, id))
      .limit(1);
    if (row?.status !== "running") return false;
    return this.sessions.isActive(authSessionId);
  }

  /** Someone is watching: postpones the idle timeout. */
  async touch(id: string): Promise<void> {
    await this.database.db
      .update(schema.browserSessions)
      .set({ lastViewedAt: new Date() })
      .where(eq(schema.browserSessions.id, id));
  }

  async endForAuthSession(authSessionId: string, reason: BrowserSessionEndReason): Promise<void> {
    const rows = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(
        and(
          eq(schema.browserSessions.authSessionId, authSessionId),
          inArray(schema.browserSessions.status, [...LIVE]),
        ),
      );
    for (const row of rows) await this.endSession(row, reason, null);
  }

  /** Before the account's rows disappear: stop its containers. */
  async endAllForUser(userId: string, reason: BrowserSessionEndReason): Promise<void> {
    const rows = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(
        and(
          eq(schema.browserSessions.userId, userId),
          inArray(schema.browserSessions.status, [...LIVE]),
        ),
      );
    for (const row of rows) await this.endSession(row, reason, null);
  }

  private async endSession(
    row: BrowserSessionRow,
    reason: BrowserSessionEndReason,
    meta: RequestMeta | null,
  ): Promise<void> {
    const ended = await this.markEnded(row.id, reason);
    if (!ended) return;
    this.events.emit("ended", row.id);
    // Other instances may hold the viewer's relay.
    this.redis.publish(SESSION_ENDED_CHANNEL, row.id).catch(() => undefined);
    if (row.containerId) {
      if (reason !== "account_deleted" && reason !== "runtime_failed") {
        await this.saveProfileData(row);
      }
      await this.orchestrator.stopSession(row.id, row.containerId);
    }
    if (reason !== "account_deleted") {
      await this.securityEvents.record({
        type: "browser.session_ended",
        userId: row.userId,
        sessionId: row.authSessionId,
        meta: meta ?? { ip: null, userAgent: null },
        metadata: { reason },
      });
    }
  }

  /**
   * Before the container goes: if the session ran under a profile that keeps
   * its data, the engine is closed cleanly and the profile archived. A
   * failure here never stops the session from ending; the previous data stays.
   */
  private async saveProfileData(row: BrowserSessionRow): Promise<void> {
    if (!row.profileId || !row.agentAddress || row.status !== "running") return;
    const profile = await this.profiles.find(row.userId, row.profileId);
    if (!profile?.keepData) return;
    try {
      const secret = await this.box.open(row.agentSecret, secretContext(row.id));
      const archive = await this.orchestrator.packProfile(row.agentAddress, secret);
      const { bytes } = await this.profileData.save(profile, archive);
      logger.log(`Saved ${String(bytes)} bytes of profile data for session ${row.id}`);
    } catch (error) {
      if (error instanceof ProfileDataTooLargeError) {
        logger.warn(
          `Profile data for session ${row.id} is over the limit; the previous data is kept`,
        );
      } else {
        logger.warn(
          `Saving profile data for session ${row.id} failed: ${error instanceof Error ? error.message : ""}`,
        );
      }
    }
  }

  /** True when this call ended it (not already ended). */
  private async markEnded(id: string, reason: BrowserSessionEndReason): Promise<boolean> {
    const updated = await this.database.db
      .update(schema.browserSessions)
      .set({ status: "ended", endedAt: new Date(), endReason: reason })
      .where(and(eq(schema.browserSessions.id, id), ne(schema.browserSessions.status, "ended")))
      .returning({ id: schema.browserSessions.id });
    return updated.length === 1;
  }

  // ── Housekeeping ──────────────────────────────────────────────────────

  /** Reaps when this instance wins the lock for this tick; otherwise another one does. */
  private async reapAsLeader(): Promise<void> {
    let leader: string | null;
    try {
      leader = await this.redis.set(REAPER_LOCK_KEY, "1", "PX", REAPER_LOCK_MS, "NX");
    } catch {
      // Redis is away: reap anyway rather than let sessions outlive their limits.
      leader = "OK";
    }
    if (leader === "OK") await this.reap();
  }

  /** Idle and over-age sessions, and runtimes that died on their own. */
  async reap(now = new Date()): Promise<void> {
    const rows = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(inArray(schema.browserSessions.status, [...LIVE]));
    for (const row of rows) {
      const age = now.getTime() - row.createdAt.getTime();
      const lastViewed = (row.lastViewedAt ?? row.startedAt ?? row.createdAt).getTime();
      if (age > BROWSER_LIMITS.maxHours * 3_600_000) {
        await this.endSession(row, "max_lifetime", null);
      } else if (
        row.status === "running" &&
        now.getTime() - lastViewed > BROWSER_LIMITS.idleMinutes * 60_000
      ) {
        await this.endSession(row, "idle", null);
      } else if (row.status === "starting" && age > BROWSER_LIMITS.startTimeoutSeconds * 2_000) {
        await this.endSession(row, "runtime_failed", null);
      } else if (row.containerId && !(await this.orchestrator.isRunning(row.containerId))) {
        await this.endSession(row, "runtime_failed", null);
      }
    }
  }

  /** After a restart: containers without a live session go, sessions without a container end. */
  async reconcile(): Promise<void> {
    const runtimes = await this.orchestrator.listRuntimes();
    const live = await this.database.db
      .select({ id: schema.browserSessions.id, containerId: schema.browserSessions.containerId })
      .from(schema.browserSessions)
      .where(inArray(schema.browserSessions.status, [...LIVE]));
    const liveIds = new Set(live.map((row) => row.id));
    for (const runtime of runtimes) {
      if (!liveIds.has(runtime.sessionId)) {
        logger.log(`Removing orphaned runtime for session ${runtime.sessionId}`);
        await this.orchestrator.stopSession(runtime.sessionId, runtime.containerId);
      }
    }
    await this.reap();
  }
}

export function describe(row: BrowserSessionRow): BrowserSession {
  const reason = browserSessionEndReasonSchema.safeParse(row.endReason);
  return {
    id: row.id,
    status: row.status,
    engine: row.engine,
    profileId: row.profileId,
    proxyId: row.proxyId,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    expiresAt: new Date(
      row.createdAt.getTime() + BROWSER_LIMITS.maxHours * 3_600_000,
    ).toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    endReason: reason.success ? reason.data : null,
  };
}
