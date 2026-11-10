import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import {
  type BrowserEngine,
  engineDetails,
  type AdminRuntime,
  extensionsFor,
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
  type DatabaseExecutor,
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
  type OnModuleInit,
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
import { SiteRulesService } from "../site-rules/site-rules.service.js";
import { POOL_MAX_AGE_MS, WarmPoolService } from "./warm-pool.service.js";
import { RuntimeHostsService } from "../egress/runtime-hosts.service.js";
import { EnginesService } from "../egress/engines.service.js";
import { OrchestratorService } from "./orchestrator.service.js";
import { StreamTickets } from "./stream-tickets.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { type AfterCommit, TeamsService } from "../teams/teams.service.js";
import { HistoryService } from "../history/history.service.js";

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
export class BrowserService implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  /** `ended` (session id): the relay closes its viewers. */
  readonly events = new EventEmitter();
  private timer: NodeJS.Timeout | undefined;
  private runtimeChecked = 0;
  private runtimeAvailable = false;
  /** The check in progress (or the last one): requests meanwhile wait for it, not a stale answer. */
  private runtimeCheck: Promise<void> | null = null;

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
    @Inject(SiteRulesService) private readonly siteRules: SiteRulesService,
    @Inject(WarmPoolService) private readonly pool: WarmPoolService,
    @Inject(RuntimeHostsService) private readonly hosts: RuntimeHostsService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(EnginesService) private readonly engines: EnginesService,
    @Inject(REDIS) private readonly redis: Pick<Redis, "publish" | "set">,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {}

  /**
   * A session browsing through a team's proxy ends when its person leaves the
   * team or the team goes: the proxy is no longer theirs to use (ADR 0019).
   */
  onModuleInit(): void {
    const throughTeamProxy = async (
      tx: DatabaseExecutor,
      teamId: string,
      userId: string | null,
    ): Promise<AfterCommit | undefined> => {
      const rows = await tx
        .select()
        .from(schema.browserSessions)
        .where(
          and(
            inArray(schema.browserSessions.status, [...LIVE]),
            sql`${schema.browserSessions.proxyId} in (select id from proxies where team_id = ${teamId})`,
            ...(userId ? [eq(schema.browserSessions.userId, userId)] : []),
          ),
        );
      if (rows.length === 0) return undefined;
      return async () => {
        for (const row of rows) await this.endSession(row, "team_left", null);
      };
    };
    this.teams.register({
      memberLeft: (tx, teamId, userId) => throughTeamProxy(tx, teamId, userId),
      teamDeleting: (tx, teamId) => throughTeamProxy(tx, teamId, null),
    });
  }

  onApplicationBootstrap(): void {
    // A sign-in that ends takes its cloud browser with it.
    this.sessions.onRevoked((authSessionId) => {
      void this.endForAuthSession(authSessionId, "signed_out").catch(() => undefined);
    });
    // An operator's CLI process leaves the containers to the servers.
    if (this.config.role === "server") {
      void this.reconcile().catch((error: unknown) => {
        logger.warn(`Reconciling runtimes failed: ${error instanceof Error ? error.message : ""}`);
      });
    }
    this.metrics.gauge(
      "brawzer_sessions_live",
      "Live sessions (starting or running), by runtime host.",
      async () => {
        const rows = await this.database.db
          .select({ host: schema.browserSessions.runtimeHost, count: count() })
          .from(schema.browserSessions)
          .where(inArray(schema.browserSessions.status, [...LIVE]))
          .groupBy(schema.browserSessions.runtimeHost);
        return rows.map((row) => ({ labels: { host: row.host ?? "local" }, value: row.count }));
      },
    );
    this.metrics.gauge(
      "brawzer_runtime_available",
      "1 when a runtime host answered the last check.",
      () => Promise.resolve([{ value: this.runtimeAvailable ? 1 : 0 }]),
    );
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
    const [live, runtime, savedTabs, limits, engines] = await Promise.all([
      this.liveSessions(userId),
      this.runtimeStatus(),
      this.history.savedTabsFor(userId),
      this.billing.limitsFor(userId),
      this.engines.offered(),
    ]);
    const sessions = live.map(describe);
    return {
      session: sessions[0] ?? null,
      sessions,
      engines: [...engines],
      limits: {
        idleMinutes: BROWSER_LIMITS.idleMinutes,
        maxHours: BROWSER_LIMITS.maxHours,
        liveSessions: limits.liveSessions,
      },
      runtime,
      region: this.config.browser.region,
      savedTabs,
    };
  }

  /** Cached for 10 seconds: the Browser page asks on every load. */
  private async runtimeStatus(): Promise<"available" | "unavailable"> {
    if (this.runtimeCheck === null || Date.now() - this.runtimeChecked > 10_000) {
      this.runtimeChecked = Date.now();
      this.runtimeCheck = this.orchestrator.ping().then(
        () => {
          this.runtimeAvailable = true;
        },
        (error: unknown) => {
          this.runtimeAvailable = false;
          logger.warn(`Runtime unavailable: ${error instanceof Error ? error.message : "unknown"}`);
        },
      );
    }
    await this.runtimeCheck;
    return this.runtimeAvailable ? "available" : "unavailable";
  }

  /** Every live session of the account, newest first. */
  private async liveSessions(userId: string): Promise<BrowserSessionRow[]> {
    return this.database.db
      .select()
      .from(schema.browserSessions)
      .where(
        and(
          eq(schema.browserSessions.userId, userId),
          inArray(schema.browserSessions.status, [...LIVE]),
        ),
      )
      .orderBy(desc(schema.browserSessions.createdAt));
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
    resume = false,
    requestedEngine?: BrowserEngine,
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

    // What the session needs decides whether a waiting pair can serve it.
    const upstream = await this.proxies.forEgress(userId, profile?.proxyId ?? null);
    const siteRules = await this.siteRules.forEgress(userId);
    // A profile brings its own browser; a temporary session names one (Bee by default).
    const offered = await this.engines.offered();
    const engine = profile?.engine ?? requestedEngine ?? offered[0] ?? "bee";
    if (!offered.includes(engine)) {
      throw new ApiException(
        "conflict",
        409,
        `${engineDetails[engine].name} isn’t offered on this installation.`,
      );
    }
    const privateViaUpstream = upstream !== null && profile?.privateThroughProxy === true;
    // Only the catalogue entries this engine runs (ADR 0018); a waiting pair has none,
    // so it serves plain sessions only.
    const extensions = (profile?.extensions ?? []).filter((slug) =>
      extensionsFor(engine).some((entry) => entry.slug === slug),
    );
    // The browser's own account and passwords (ADR 0021): only where the profile keeps its data.
    const browserAccount = profile?.browserAccount === true && profile.keepData;
    const pair =
      upstream === null && siteRules === null && extensions.length === 0 && !browserAccount
        ? await this.pool.claim(engine)
        : null;
    const secretForAgent = pair?.secret ?? secret;

    let row: BrowserSessionRow;
    try {
      row = await this.database.db.transaction(async (tx) => {
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
          .select({ id: schema.browserSessions.id, profileId: schema.browserSessions.profileId })
          .from(schema.browserSessions)
          .where(
            and(
              eq(schema.browserSessions.userId, userId),
              inArray(schema.browserSessions.status, [...LIVE]),
            ),
          );
        // A profile's saved data can be in one session at a time.
        if (profileId && live.some((entry) => entry.profileId === profileId)) {
          throw new ApiException(
            "conflict",
            409,
            `“${profile?.name ?? "That profile"}” is already open in another browser. Switch to it, or end it first.`,
          );
        }
        if (live.length >= limits.liveSessions) {
          throw new ApiException(
            "conflict",
            409,
            limits.liveSessions === 1
              ? "A browser is already running. End it to open another."
              : `Your plan runs ${String(limits.liveSessions)} browsers at once. End one to open another.`,
          );
        }
        // Where it runs: a waiting pair's own host, else the host with the most room.
        const perHost = await tx
          .select({ host: schema.browserSessions.runtimeHost, count: count() })
          .from(schema.browserSessions)
          .where(inArray(schema.browserSessions.status, [...LIVE]))
          .groupBy(schema.browserSessions.runtimeHost);
        const liveByHost = new Map(perHost.map((entry) => [entry.host ?? "local", entry.count]));
        const host = pair ? this.hosts.byName(pair.host) : await this.hosts.pick(liveByHost);
        if (!host) {
          throw new ApiException(
            "service_unavailable",
            503,
            "Brawzer’s cloud is at capacity right now. Try again in a few minutes.",
            { headers: { "Retry-After": "60" } },
          );
        }
        const [created] = await tx
          .insert(schema.browserSessions)
          .values({
            // A pooled pair's containers already carry the id reserved for it.
            ...(pair ? { id: pair.sessionId } : {}),
            runtimeHost: host.name,
            userId,
            authSessionId: auth.session.id,
            profileId,
            proxyId: profile?.proxyId ?? null,
            engine,
            status: "starting",
            // Sealed once the row id exists; a placeholder keeps the column non-null meanwhile.
            agentSecret: "",
          })
          .returning();
        if (!created) throw new Error("Creating a browser session returned no row");
        // The profile's saved tabs, when asked to continue from them (ADR 0020).
        if (profileId) await this.history.prepareSession(created.id, profileId, resume, tx);
        return created;
      });
    } catch (error) {
      if (pair) this.pool.release(pair);
      throw error;
    }

    this.metrics.count(
      "brawzer_sessions_started_total",
      "Sessions asked for, by engine and start.",
      {
        engine,
        start: pair ? "warm" : "cold",
      },
    );
    let started: { host: string; containerId: string; agentAddress: string };
    try {
      await this.database.db
        .update(schema.browserSessions)
        .set({ agentSecret: await this.box.seal(secretForAgent, secretContext(row.id)) })
        .where(eq(schema.browserSessions.id, row.id));
      // A profile that keeps its data starts from what was saved last time,
      // and browses through its proxy (ADR 0014).
      const restore = profile?.keepData ? await this.profileData.open(profile) : null;
      started = pair
        ? await this.orchestrator.launch(pair, pair.secret, restore)
        : await this.orchestrator.start(
            this.hosts.byName(row.runtimeHost),
            row.id,
            secret,
            restore,
            upstream,
            row.engine,
            {
              // Only with a proxy: the proxy reaches the private addresses, never Brawzer.
              privateViaUpstream,
              siteRules,
              extensions,
              browserAccount,
            },
          );
    } catch (error) {
      logger.warn(
        `Runtime for session ${row.id} failed to start: ${error instanceof Error ? error.message : ""}`,
      );
      this.metrics.count(
        "brawzer_session_starts_failed_total",
        "Sessions whose runtime failed to start.",
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
      await this.orchestrator.stopSession(started.host, row.id, started.containerId);
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

  /** Ends the session so its open tabs wait for the profile's next one, on any device. */
  async handOff(userId: string, id: string, meta: RequestMeta): Promise<void> {
    const [row] = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(and(eq(schema.browserSessions.id, id), eq(schema.browserSessions.userId, userId)))
      .limit(1);
    if (!row || row.status === "ended") throw notFound();
    const profile = row.profileId ? await this.profiles.find(userId, row.profileId) : undefined;
    if (!profile?.keepData) {
      throw new ApiException(
        "conflict",
        409,
        "This session keeps nothing to continue from. Use a profile that keeps its data.",
      );
    }
    await this.history.markHandedOff(profile.id);
    await this.endSession(row, "handed_off", meta);
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

  /** The Admin page's view: hosts, the warm pool and every live session (Phase 8, idea 22). */
  async adminRuntime(): Promise<AdminRuntime> {
    const rows = await this.database.db
      .select({
        id: schema.browserSessions.id,
        email: schema.users.email,
        engine: schema.browserSessions.engine,
        status: schema.browserSessions.status,
        host: schema.browserSessions.runtimeHost,
        createdAt: schema.browserSessions.createdAt,
        lastViewedAt: schema.browserSessions.lastViewedAt,
        proxyId: schema.browserSessions.proxyId,
        extensions: schema.profiles.extensions,
      })
      .from(schema.browserSessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.browserSessions.userId))
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.browserSessions.profileId))
      .where(inArray(schema.browserSessions.status, [...LIVE]))
      .orderBy(desc(schema.browserSessions.createdAt));
    const sessions = rows.map((row) => ({
      id: row.id,
      email: row.email,
      engine: row.engine,
      status: row.status,
      host: this.hosts.byName(row.host).name,
      createdAt: row.createdAt.toISOString(),
      lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
      expiresAt: new Date(
        row.createdAt.getTime() + BROWSER_LIMITS.maxHours * 3_600_000,
      ).toISOString(),
      throughProxy: row.proxyId !== null,
      extensions: row.extensions?.length ?? 0,
    }));
    const hosts = await Promise.all(
      this.hosts.all().map(async (host) => ({
        name: host.name,
        healthy: await this.hosts.healthy(host),
        live: sessions.filter((session) => session.host === host.name).length,
        capacity: host.capacity,
      })),
    );
    return {
      hosts,
      warmPool: { size: this.pool.size, waiting: this.pool.waiting },
      sessions,
    };
  }

  /** Ends any live session, for an administrator; recorded in that account's history. */
  async endByAdmin(id: string): Promise<void> {
    const [row] = await this.database.db
      .select()
      .from(schema.browserSessions)
      .where(eq(schema.browserSessions.id, id))
      .limit(1);
    if (!row) throw notFound();
    if (row.status === "ended") return;
    logger.log(`Session ${row.id} ended by an administrator`);
    await this.endSession(row, "admin", null);
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
    this.metrics.count("brawzer_sessions_ended_total", "Sessions ended, by reason.", { reason });
    this.events.emit("ended", row.id);
    // Other instances may hold the viewer's relay.
    this.redis.publish(SESSION_ENDED_CHANNEL, row.id).catch(() => undefined);
    if (row.containerId) {
      if (reason !== "account_deleted" && reason !== "runtime_failed") {
        await this.saveProfileData(row);
      }
      await this.orchestrator.stopSession(row.runtimeHost, row.id, row.containerId);
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
      } else if (
        row.containerId &&
        !(await this.orchestrator.isRunning(row.runtimeHost, row.containerId))
      ) {
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
      if (liveIds.has(runtime.sessionId)) continue;
      // A warm pool's pair waits for a session that doesn't exist yet; only a stale one goes.
      if (runtime.pooledAt && Date.now() - runtime.pooledAt.getTime() < POOL_MAX_AGE_MS) continue;
      logger.log(`Removing orphaned runtime for session ${runtime.sessionId} on ${runtime.host}`);
      await this.orchestrator.stopSession(runtime.host, runtime.sessionId, runtime.containerId);
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
