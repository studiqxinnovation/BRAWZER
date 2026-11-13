import {
  type BrowserEngine,
  type BrowserImages,
  browserEngines,
  engineDetails,
  EXTENSION_CATALOGUE,
  type ExtensionStatus,
  type Fleet,
  type LiveSession,
  type LiveSessionList,
  type ModeratedExtensionList,
  type Network,
  type TechHealth,
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
  isNull,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { BrowserService } from "../browser/browser.service.js";
import { OrchestratorService } from "../browser/orchestrator.service.js";
import { StreamGateway } from "../browser/stream-gateway.js";
import { WarmPoolService } from "../browser/warm-pool.service.js";
import { ApiException } from "../common/api-exception.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import { RuntimeHostsService } from "../egress/runtime-hosts.service.js";
import { EmailService } from "../email/email.js";
import { maskEmail } from "../email/transports.js";
import { HealthService } from "../health/health.service.js";
import { RetentionService } from "../maintenance/retention.js";

/** Who is doing something in the console. */
export interface StaffViewer {
  user: { id: string; email: string; role: string };
}

const DAY = 86_400_000;
const LIVE = ["starting", "running"] as const;
const logger = new Logger("TechConsole");
const handleOf = (email: string) => email.split("@")[0] ?? email;

const CHECK_NAMES: Record<string, string> = {
  database: "Database (PostgreSQL)",
  redis: "Cache and queues (Valkey)",
  storage: "Object store (Drive files)",
  scanner: "Malware scanner",
  runtime: "Cloud browser runtime",
};

/**
 * The console's technical pages (Phase 11.4): what the API knows about its
 * runtime hosts, live sessions, images, the extension catalogue, proxies and
 * its own health. Nothing here is estimated; what Brawzer doesn't measure, the
 * pages say they don't measure.
 */
@Injectable()
export class TechConsoleService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RuntimeHostsService) private readonly hosts: RuntimeHostsService,
    @Inject(OrchestratorService) private readonly orchestrator: OrchestratorService,
    @Inject(WarmPoolService) private readonly pool: WarmPoolService,
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(StreamGateway) private readonly stream: StreamGateway,
    @Inject(HealthService) private readonly health: HealthService,
    @Inject(RetentionService) private readonly retention: RetentionService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  /* ── Shared counts ── */

  private async sessionCounts() {
    const db = this.database.db;
    const dayAgo = new Date(Date.now() - DAY);
    const [[live], [started], [ended], [failed], starts] = await Promise.all([
      db
        .select({ value: count() })
        .from(schema.browserSessions)
        .where(inArray(schema.browserSessions.status, [...LIVE])),
      db
        .select({ value: count() })
        .from(schema.browserSessions)
        .where(gte(schema.browserSessions.createdAt, dayAgo)),
      db
        .select({ value: count() })
        .from(schema.browserSessions)
        .where(
          and(
            eq(schema.browserSessions.status, "ended"),
            gte(schema.browserSessions.endedAt, dayAgo),
          ),
        ),
      db
        .select({ value: count() })
        .from(schema.browserSessions)
        .where(
          and(
            gte(schema.browserSessions.createdAt, dayAgo),
            eq(schema.browserSessions.status, "ended"),
            isNull(schema.browserSessions.startedAt),
          ),
        ),
      db
        .select({
          seconds: sql<
            string | number
          >`extract(epoch from (${schema.browserSessions.startedAt} - ${schema.browserSessions.createdAt}))`,
        })
        .from(schema.browserSessions)
        .where(
          and(
            gte(schema.browserSessions.createdAt, dayAgo),
            isNotNull(schema.browserSessions.startedAt),
          ),
        ),
    ]);
    const waits = starts
      .map((row) => Number(row.seconds))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    const median = waits.length
      ? waits.length % 2
        ? (waits[(waits.length - 1) / 2] ?? 0)
        : ((waits[waits.length / 2 - 1] ?? 0) + (waits[waits.length / 2] ?? 0)) / 2
      : null;
    return {
      live: live?.value ?? 0,
      startedLast24h: started?.value ?? 0,
      endedLast24h: ended?.value ?? 0,
      failedStarts24h: failed?.value ?? 0,
      medianStartSeconds: median === null ? null : Math.round(median * 10) / 10,
    };
  }

  /* ── Fleet ── */

  async fleet(): Promise<Fleet> {
    const [counts, runtime] = await Promise.all([
      this.sessionCounts(),
      this.browser.adminRuntime(),
    ]);
    let containers: Map<string, number> | null = null;
    try {
      containers = new Map();
      for (const entry of await this.orchestrator.listRuntimes()) {
        containers.set(entry.host, (containers.get(entry.host) ?? 0) + 1);
      }
    } catch (error) {
      logger.warn(
        `Could not list containers: ${error instanceof Error ? error.message : "unknown"}`,
      );
      containers = null;
    }
    return {
      hosts: runtime.hosts.map((host) => ({
        ...host,
        containers: containers ? (containers.get(host.name) ?? 0) : null,
      })),
      warmPool: runtime.warmPool,
      maxLiveSessions: this.config.browser.maxLiveSessions,
      ...counts,
      runtimeImage: this.config.browser.image,
      egressImage: this.config.egress.image,
    };
  }

  /* ── Live sessions ── */

  async sessions(viewer: StaffViewer): Promise<LiveSessionList> {
    const runtime = await this.browser.adminRuntime();
    const ids = runtime.sessions.map((session) => session.id);
    const rows = ids.length
      ? await this.database.db
          .select({
            id: schema.browserSessions.id,
            userId: schema.browserSessions.userId,
            startedAt: schema.browserSessions.startedAt,
            profileName: schema.profiles.name,
          })
          .from(schema.browserSessions)
          .leftJoin(schema.profiles, eq(schema.profiles.id, schema.browserSessions.profileId))
          .where(inArray(schema.browserSessions.id, ids))
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const founder = viewer.user.role === "admin";
    const sessions: LiveSession[] = runtime.sessions.map((session) => {
      const row = byId.get(session.id);
      return {
        id: session.id,
        customer: {
          id: row?.userId ?? "00000000-0000-7000-8000-000000000000",
          handle: handleOf(session.email),
          email: founder ? session.email : maskEmail(session.email),
        },
        engine: session.engine,
        engineName: engineDetails[session.engine].name,
        status: session.status,
        host: session.host,
        profileName: row?.profileName ?? null,
        createdAt: session.createdAt,
        startedAt: row?.startedAt?.toISOString() ?? null,
        lastViewedAt: session.lastViewedAt,
        expiresAt: session.expiresAt,
        throughProxy: session.throughProxy,
        extensions: session.extensions,
        viewers: this.stream.viewersOf(session.id),
      };
    });
    return { sessions, hosts: runtime.hosts.map((host) => host.name) };
  }

  async endSession(id: string): Promise<void> {
    await this.browser.endByAdmin(id);
  }

  /* ── Browser images ── */

  async images(): Promise<BrowserImages> {
    const db = this.database.db;
    const [live, profiles] = await Promise.all([
      db
        .select({ engine: schema.browserSessions.engine, value: count() })
        .from(schema.browserSessions)
        .where(inArray(schema.browserSessions.status, [...LIVE]))
        .groupBy(schema.browserSessions.engine),
      db
        .select({ engine: schema.profiles.engine, value: count() })
        .from(schema.profiles)
        .groupBy(schema.profiles.engine),
    ]);
    const liveBy = new Map(live.map((row) => [row.engine, row.value]));
    const profilesBy = new Map(profiles.map((row) => [row.engine, row.value]));
    const offered = new Set<string>(this.config.browser.engines);
    return {
      runtimeImage: this.config.browser.image,
      egressImage: this.config.egress.image,
      apiVersion: this.config.version,
      engines: browserEngines.map((engine: BrowserEngine) => ({
        engine,
        name: engineDetails[engine].name,
        offered: offered.has(engine),
        live: liveBy.get(engine) ?? 0,
        profiles: profilesBy.get(engine) ?? 0,
      })),
    };
  }

  /* ── Extension catalogue ── */

  async extensions(): Promise<ModeratedExtensionList> {
    const db = this.database.db;
    const [policies, installs] = await Promise.all([
      db
        .select({ policy: schema.extensionPolicies, by: schema.users.email })
        .from(schema.extensionPolicies)
        .leftJoin(schema.users, eq(schema.users.id, schema.extensionPolicies.changedById)),
      db
        .select({
          slug: sql<string>`ext.slug`,
          value: count(),
        })
        .from(
          sql`${schema.profiles}, jsonb_array_elements_text(${schema.profiles.extensions}) as ext(slug)`,
        )
        .groupBy(sql`ext.slug`),
    ]);
    const policyBy = new Map(policies.map(({ policy, by }) => [policy.slug, { policy, by }]));
    const installsBy = new Map(installs.map((row) => [row.slug, row.value]));
    return {
      extensions: EXTENSION_CATALOGUE.map((entry) => {
        const found = policyBy.get(entry.slug);
        return {
          slug: entry.slug,
          name: entry.name,
          summary: entry.summary,
          licence: entry.licence,
          homepage: entry.homepage,
          versions: { bee: entry.bee?.version ?? null, firefox: entry.firefox?.version ?? null },
          installs: installsBy.get(entry.slug) ?? 0,
          status: found?.policy.status ?? "allowed",
          reason: found?.policy.reason ?? null,
          changedBy: found?.by ?? null,
          changedAt: found?.policy.changedAt.toISOString() ?? null,
        };
      }),
    };
  }

  /** Sets the status; blocking removes the extension from every profile and emails the people who had it. */
  async setExtensionStatus(
    actor: StaffViewer,
    slug: string,
    status: ExtensionStatus,
    reason: string,
  ): Promise<{ name: string; removedFrom: number }> {
    const entry = EXTENSION_CATALOGUE.find((candidate) => candidate.slug === slug);
    if (!entry) throw new ApiException("not_found", 404, "That extension isn’t in the catalogue.");
    if (status === "blocked" && reason.trim().length < 4) {
      throw new ApiException(
        "validation_failed",
        422,
        "Say why it is blocked: the reason goes to the people who had it.",
      );
    }
    const db = this.database.db;
    await db
      .insert(schema.extensionPolicies)
      .values({
        slug,
        status,
        reason: reason || null,
        changedById: actor.user.id,
        changedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.extensionPolicies.slug,
        set: { status, reason: reason || null, changedById: actor.user.id, changedAt: new Date() },
      });
    if (status !== "blocked") return { name: entry.name, removedFrom: 0 };
    const affected = await db
      .update(schema.profiles)
      .set({ extensions: sql`${schema.profiles.extensions} - ${slug}` })
      .where(sql`${schema.profiles.extensions} ? ${slug}`)
      .returning({ userId: schema.profiles.userId });
    const userIds = [...new Set(affected.map((row) => row.userId))];
    if (userIds.length > 0) {
      const users = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds));
      for (const user of users) this.email.sendExtensionBlocked(user.email, entry.name, reason);
    }
    return { name: entry.name, removedFrom: userIds.length };
  }

  /* ── Proxy & Shield ── */

  async network(): Promise<Network> {
    const db = this.database.db;
    const [proxies, [allow], [block], [accounts], [throughProxy]] = await Promise.all([
      db
        .select({ protocol: schema.proxies.protocol, lastTest: schema.proxies.lastTest })
        .from(schema.proxies),
      db
        .select({ value: count() })
        .from(schema.siteRules)
        .where(eq(schema.siteRules.kind, "allow")),
      db
        .select({ value: count() })
        .from(schema.siteRules)
        .where(eq(schema.siteRules.kind, "block")),
      db
        .select({ value: sql<string | number>`count(distinct ${schema.siteRules.userId})` })
        .from(schema.siteRules),
      db
        .select({ value: count() })
        .from(schema.browserSessions)
        .where(
          and(
            inArray(schema.browserSessions.status, [...LIVE]),
            isNotNull(schema.browserSessions.proxyId),
          ),
        ),
    ]);
    const byProtocol = new Map<string, number>();
    for (const proxy of proxies)
      byProtocol.set(proxy.protocol, (byProtocol.get(proxy.protocol) ?? 0) + 1);
    const failures = proxies
      .filter((proxy) => proxy.lastTest && !proxy.lastTest.ok)
      .sort(
        (a, b) => Date.parse(b.lastTest?.testedAt ?? "") - Date.parse(a.lastTest?.testedAt ?? ""),
      )
      .slice(0, 20);
    return {
      proxies: {
        total: proxies.length,
        working: proxies.filter((proxy) => proxy.lastTest?.ok).length,
        failing: proxies.filter((proxy) => proxy.lastTest && !proxy.lastTest.ok).length,
        untested: proxies.filter((proxy) => !proxy.lastTest).length,
        byProtocol: [...byProtocol.entries()].map(([protocol, value]) => ({
          protocol,
          count: value,
        })),
        recentFailures: failures.map((proxy) => ({
          protocol: proxy.protocol,
          testedAt: new Date(proxy.lastTest?.testedAt ?? 0).toISOString(),
          reason: proxy.lastTest?.reason ?? null,
          reachable: proxy.lastTest?.reachable ?? false,
          authenticated: proxy.lastTest?.authenticated ?? null,
        })),
        liveThroughProxy: throughProxy?.value ?? 0,
      },
      siteRules: {
        allow: allow?.value ?? 0,
        block: block?.value ?? 0,
        accounts: Number(accounts?.value ?? 0),
      },
      egressImage: this.config.egress.image,
    };
  }

  /* ── Queues & health ── */

  async techHealth(): Promise<TechHealth> {
    const db = this.database.db;
    const [checks, counts, health, [reports], [tickets], [quarantined]] = await Promise.all([
      this.health.probeAll(),
      this.sessionCounts(),
      this.health.check(),
      db
        .select({ value: count() })
        .from(schema.pageReports)
        .where(isNull(schema.pageReports.closedAt)),
      db
        .select({ value: count() })
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.status, "open")),
      db
        .select({ value: count() })
        .from(schema.driveFiles)
        .where(eq(schema.driveFiles.status, "infected")),
    ]);
    return {
      checks: Object.entries(checks).map(([key, check]) => ({
        key,
        name: CHECK_NAMES[key] ?? key,
        check,
      })),
      retentionLastRunAt: this.retention.lastRunAt?.toISOString() ?? null,
      warmPool: { size: this.pool.size, waiting: this.pool.waiting },
      live: counts.live,
      startedLast24h: counts.startedLast24h,
      failedStarts24h: counts.failedStarts24h,
      openReports: reports?.value ?? 0,
      openTickets: tickets?.value ?? 0,
      quarantinedFiles: quarantined?.value ?? 0,
      uptimeSeconds: health.uptimeSeconds,
      version: health.version,
    };
  }
}

/** Newest first, for lists that read a timestamp. */
export const newestFirst = desc;
