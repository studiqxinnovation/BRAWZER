import {
  type ProxyKind,
  type ProxyProtocol,
  type ProxyRotation,
  type ProxyTestReason,
  proxyTestReasonSchema,
  type ProxyList,
  type ProxyTestResult,
  type SavedProxy,
} from "@brawzer/contracts";
import {
  and,
  asc,
  type DatabaseHandle,
  eq,
  isNotNull,
  isNull,
  or,
  type ProxyRow,
  schema,
  type StoredProxyTest,
  sql,
} from "@brawzer/db";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { AuthContext } from "../auth/session.service.js";
import { lockAccount } from "../common/account-lock.js";
import { ApiException } from "../common/api-exception.js";
import { isUniqueViolation } from "../common/database-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { SECRET_BOX } from "../crypto/crypto.module.js";
import type { SecretBox } from "../crypto/secret-box.js";
import { DATABASE } from "../database/database.module.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { isObviouslyLocal, parseHost } from "@brawzer/net-policy";
import type { ProxyTarget, ProxyTester } from "@brawzer/proxy-client";
import { BillingService } from "../billing/billing.service.js";
import { EgressService } from "../egress/egress.service.js";
import { type Membership, TeamsService } from "../teams/teams.service.js";

const logger = new Logger("Proxies");

export const PROXY_TESTER = Symbol.for("brawzer.api.proxy-tester");

interface Credentials {
  username: string;
  password: string;
}

const messages: Record<ProxyTestReason | "ok", string> = {
  ok: "The proxy works.",
  invalid_host: "The host isn’t a valid host name or IP address.",
  dns_failed: "The host name couldn’t be found.",
  blocked_address: "Brawzer doesn’t connect to private, local or reserved network addresses.",
  timeout: "The proxy didn’t answer in time.",
  connection_refused: "The proxy refused the connection. Check the host and port.",
  connection_failed: "Brawzer couldn’t connect to the proxy.",
  tls_failed: "The proxy’s secure connection couldn’t be verified.",
  auth_failed: "The proxy didn’t accept the username or password.",
  proxy_error: "The proxy answered in a way Brawzer didn’t understand. Check the protocol.",
  destination_failed: "The proxy is reachable, but it couldn’t reach the internet.",
  invalid_response: "The test through the proxy returned an unexpected answer.",
};

/**
 * Ciphertexts are bound to their owner and row, so they can't be moved to
 * another: an account's own proxy to the account, a team's to the team (so
 * they stay readable when whoever added them leaves).
 */
const credentialsContext = (row: { userId: string; teamId: string | null; id: string }) =>
  row.teamId === null
    ? `proxy-credentials:${row.userId}:${row.id}`
    : `proxy-credentials:team:${row.teamId}:${row.id}`;

const cannotManage = () =>
  new ApiException("forbidden", 403, "Only the team’s owner and admins can change its proxies.");

const notFound = () => new ApiException("not_found", 404, "That proxy doesn’t exist.");

const invalid = (field: string, message: string) =>
  new ApiException("validation_failed", 400, "Some of the submitted values are invalid.", {
    details: [`${field}: ${message}`],
  });

const nameTaken = () =>
  new ApiException("conflict", 409, "You already have a proxy with that name.", {
    details: ["name: You already have a proxy with that name."],
  });

function toResult(stored: StoredProxyTest): ProxyTestResult {
  const reason = proxyTestReasonSchema.safeParse(stored.reason);
  const known = reason.success ? reason.data : null;
  return {
    ok: stored.ok,
    reachable: stored.reachable,
    authenticated: stored.authenticated,
    latencyMs: stored.latencyMs,
    exitAddress: stored.exitAddress,
    reason: known,
    message: stored.ok ? messages.ok : messages[known ?? "connection_failed"],
    testedAt: stored.testedAt,
  };
}

function toProxy(row: ProxyRow, usedBy: SavedProxy["usedBy"]): SavedProxy {
  return {
    team: row.teamId !== null,
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    kind: row.kind,
    rotation: row.rotation,
    hasCredentials: row.credentials !== null,
    lastTest: row.lastTest ? toResult(row.lastTest) : null,
    usedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What each protocol can carry. */
function checkCredentials(protocol: ProxyProtocol, credentials: Credentials): void {
  const { username, password } = credentials;
  if ((protocol === "socks4" || protocol === "socks4a") && password !== "") {
    throw invalid("credentials.password", "SOCKS4 proxies take a user ID only, not a password.");
  }
  if ((protocol === "http" || protocol === "https") && username.includes(":")) {
    throw invalid("credentials.username", "An HTTP proxy username can’t contain a colon.");
  }
  if (protocol === "socks5") {
    if (Buffer.byteLength(username, "utf8") > 255) {
      throw invalid("credentials.username", "SOCKS5 usernames are limited to 255 bytes.");
    }
    if (Buffer.byteLength(password, "utf8") > 255) {
      throw invalid("credentials.password", "SOCKS5 passwords are limited to 255 bytes.");
    }
  }
}

/**
 * Proxy settings. Credentials are encrypted with their own data key (ADR
 * 0008), never returned, and decrypted only for the moment a test needs
 * them. Tests follow ADR 0010.
 */
@Injectable()
export class ProxiesService implements OnModuleInit {
  private readonly runningByAccount = new Map<string, number>();
  private runningTotal = 0;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROXY_TESTER) private readonly tester: ProxyTester,
    @Inject(EgressService) private readonly egress: EgressService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(TeamsService) private readonly teams: TeamsService,
  ) {}

  /** Someone leaving a team: their profiles stop using its proxies, which stay with the team. */
  onModuleInit(): void {
    this.teams.register({
      memberLeft: async (tx, teamId, userId, ownerId) => {
        await tx
          .update(schema.profiles)
          .set({ proxyId: null })
          .where(
            and(
              eq(schema.profiles.userId, userId),
              sql`${schema.profiles.proxyId} in (select id from proxies where team_id = ${teamId})`,
            ),
          );
        await tx
          .update(schema.proxies)
          .set({ userId: ownerId })
          .where(and(eq(schema.proxies.teamId, teamId), eq(schema.proxies.userId, userId)));
        return undefined;
      },
    });
  }

  /** The person's own proxies, or one of their team's. */
  private ownedBy(userId: string, membership: Membership | null) {
    const own = and(eq(schema.proxies.userId, userId), isNull(schema.proxies.teamId));
    return membership ? or(own, eq(schema.proxies.teamId, membership.teamId)) : own;
  }

  /** A profile's proxy as the egress needs it, credentials included; null without one. */
  async forEgress(userId: string, proxyId: string | null): Promise<ProxyTarget | null> {
    if (!proxyId) return null;
    const membership = await this.teams.membership(userId);
    const [row] = await this.database.db
      .select()
      .from(schema.proxies)
      .where(and(eq(schema.proxies.id, proxyId), this.ownedBy(userId, membership)))
      .limit(1);
    if (!row) return null;
    return {
      protocol: row.protocol,
      host: row.host,
      port: row.port,
      credentials: await this.openCredentials(row),
    };
  }

  /** The stored form of a host, or a validation error. */
  private normalizeHost(input: string): string {
    const parsed = parseHost(input);
    if (!parsed) {
      throw invalid("host", "Enter a host name or IP address, such as proxy.example.com.");
    }
    if (!this.config.proxyTests.allowPrivate && isObviouslyLocal(parsed)) {
      throw invalid(
        "host",
        "Brawzer doesn’t connect to private, local or reserved network addresses.",
      );
    }
    return parsed.kind === "ip" ? parsed.address : parsed.name;
  }

  private async openCredentials(row: ProxyRow): Promise<Credentials | null> {
    if (!row.credentials) return null;
    const plain = await this.box.open(row.credentials, credentialsContext(row));
    return JSON.parse(plain) as Credentials;
  }

  /**
   * A proxy the person may change: their own, or their team's when they are
   * its owner or an admin. Anyone else's is "not found".
   */
  private async find(userId: string, id: string): Promise<ProxyRow> {
    const membership = await this.teams.membership(userId);
    const [row] = await this.database.db
      .select()
      .from(schema.proxies)
      .where(and(eq(schema.proxies.id, id), this.ownedBy(userId, membership)))
      .limit(1);
    if (!row) throw notFound();
    if (row.teamId !== null && membership?.role === "member") throw cannotManage();
    return row;
  }

  /** The Proxy page: the person's own, then their team's, and what they may do with them. */
  async listFor(userId: string, limit: number): Promise<ProxyList> {
    const membership = await this.teams.membership(userId);
    const team = membership
      ? await this.database.db
          .select({ name: schema.teams.name })
          .from(schema.teams)
          .where(eq(schema.teams.id, membership.teamId))
      : [];
    return {
      proxies: await this.list(userId, membership),
      limit,
      team:
        membership && team[0] ? { name: team[0].name, manage: membership.role !== "member" } : null,
    };
  }

  async list(
    userId: string,
    /** Already read; undefined: read it here. */
    membership?: Membership | null,
  ): Promise<SavedProxy[]> {
    const team = membership === undefined ? await this.teams.membership(userId) : membership;
    const [rows, uses] = await Promise.all([
      this.database.db
        .select()
        .from(schema.proxies)
        .where(this.ownedBy(userId, team))
        .orderBy(sql`${schema.proxies.teamId} is not null`, asc(schema.proxies.createdAt)),
      this.database.db
        .select({
          proxyId: schema.profiles.proxyId,
          id: schema.profiles.id,
          name: schema.profiles.name,
        })
        .from(schema.profiles)
        .where(and(eq(schema.profiles.userId, userId), isNotNull(schema.profiles.proxyId)))
        .orderBy(asc(schema.profiles.position)),
    ]);
    return rows.map((row) =>
      toProxy(
        row,
        uses.filter((use) => use.proxyId === row.id).map(({ id, name }) => ({ id, name })),
      ),
    );
  }

  async create(
    auth: AuthContext,
    input: {
      name: string;
      protocol: ProxyProtocol;
      host: string;
      port: number;
      kind: ProxyKind;
      rotation: ProxyRotation;
      credentials?: Credentials | undefined;
      team?: boolean | undefined;
    },
    meta: RequestMeta,
  ): Promise<SavedProxy> {
    const userId = auth.user.id;
    const host = this.normalizeHost(input.host);
    if (input.credentials) checkCredentials(input.protocol, input.credentials);
    let teamId: string | null = null;
    if (input.team) {
      const membership = await this.teams.membership(userId);
      if (!membership) throw new ApiException("not_found", 404, "You aren’t in a team.");
      if (membership.role === "member") throw cannotManage();
      teamId = membership.teamId;
    }

    let row: ProxyRow;
    try {
      row = await this.database.db.transaction(async (tx) => {
        if (teamId) {
          // A team's list is counted under the team's lock, against the owner's plan.
          await tx
            .select({ id: schema.teams.id })
            .from(schema.teams)
            .where(eq(schema.teams.id, teamId))
            .for("update");
        } else {
          await lockAccount(tx, userId);
        }
        const [stats] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.proxies)
          .where(
            teamId
              ? eq(schema.proxies.teamId, teamId)
              : and(eq(schema.proxies.userId, userId), isNull(schema.proxies.teamId)),
          );
        const limit = (await this.billing.limitsFor(userId)).proxies;
        if ((stats?.count ?? 0) >= limit) {
          throw new ApiException(
            "limit_reached",
            409,
            teamId
              ? `The team’s plan allows ${String(limit)} team proxies. Delete one first.`
              : `Your plan allows ${String(limit)} proxies. Delete one, or move to a plan with more.`,
          );
        }
        const [inserted] = await tx
          .insert(schema.proxies)
          .values({
            userId,
            teamId,
            name: input.name,
            protocol: input.protocol,
            host,
            port: input.port,
            kind: input.kind,
            rotation: input.rotation,
          })
          .returning();
        if (!inserted) throw new Error("Proxy insert returned nothing");
        if (!input.credentials) return inserted;
        // Sealed with the row's own ID, so it can only ever be opened for this row.
        const sealed = await this.box.seal(
          JSON.stringify(input.credentials),
          credentialsContext(inserted),
        );
        const [withCredentials] = await tx
          .update(schema.proxies)
          .set({ credentials: sealed })
          .where(eq(schema.proxies.id, inserted.id))
          .returning();
        return withCredentials ?? inserted;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
    await this.events.record({ type: "proxy.created", userId, sessionId: auth.session.id, meta });
    return toProxy(row, []);
  }

  async update(
    auth: AuthContext,
    id: string,
    input: {
      name?: string | undefined;
      protocol?: ProxyProtocol | undefined;
      host?: string | undefined;
      port?: number | undefined;
      kind?: ProxyKind | undefined;
      rotation?: ProxyRotation | undefined;
      credentials?: Credentials | null | undefined;
    },
    meta: RequestMeta,
  ): Promise<SavedProxy> {
    const userId = auth.user.id;
    const current = await this.find(userId, id);
    const protocol = input.protocol ?? current.protocol;
    const host = input.host === undefined ? current.host : this.normalizeHost(input.host);
    const port = input.port ?? current.port;

    let credentials: string | null | undefined;
    if (input.credentials === null) {
      credentials = null;
    } else if (input.credentials) {
      checkCredentials(protocol, input.credentials);
      credentials = await this.box.seal(
        JSON.stringify(input.credentials),
        credentialsContext(current),
      );
    } else if (protocol !== current.protocol) {
      // The saved credentials must still suit the new protocol.
      const saved = await this.openCredentials(current);
      if (saved) checkCredentials(protocol, saved);
    }

    // A test result describes the old address or credentials; it no longer applies.
    const changesConnection =
      protocol !== current.protocol ||
      host !== current.host ||
      port !== current.port ||
      credentials !== undefined;

    let row: ProxyRow | undefined;
    try {
      [row] = await this.database.db
        .update(schema.proxies)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          protocol,
          host,
          port,
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.rotation === undefined ? {} : { rotation: input.rotation }),
          ...(credentials === undefined ? {} : { credentials }),
          ...(changesConnection ? { lastTest: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.proxies.id, current.id))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
    if (!row) throw notFound();
    await this.events.record({ type: "proxy.updated", userId, sessionId: auth.session.id, meta });
    const [updated] = (await this.list(userId)).filter((proxy) => proxy.id === id);
    return updated ?? toProxy(row, []);
  }

  /** Deletes a proxy; profiles that used it go back to no proxy. */
  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const userId = auth.user.id;
    const current = await this.find(userId, id);
    const deleted = await this.database.db
      .delete(schema.proxies)
      .where(eq(schema.proxies.id, current.id))
      .returning({ id: schema.proxies.id });
    if (deleted.length === 0) throw notFound();
    await this.events.record({ type: "proxy.deleted", userId, sessionId: auth.session.id, meta });
  }

  /** Runs a test now and keeps its result. */
  async test(auth: AuthContext, id: string): Promise<ProxyTestResult> {
    const userId = auth.user.id;
    const row = await this.find(userId, id);
    await this.limiter.enforce(RATE_LIMITS.proxyTestsPerAccount, userId);

    const mine = this.runningByAccount.get(userId) ?? 0;
    if (mine >= 2 || this.runningTotal >= 16) {
      throw new ApiException(
        "rate_limited",
        429,
        "Another proxy test is still running. Try again in a moment.",
        { headers: { "Retry-After": "5" } },
      );
    }
    this.runningByAccount.set(userId, mine + 1);
    this.runningTotal += 1;
    try {
      const target: ProxyTarget = {
        protocol: row.protocol,
        host: row.host,
        port: row.port,
        credentials: await this.openCredentials(row),
      };
      let outcome;
      if (this.config.proxyTests.runner === "egress") {
        try {
          outcome = await this.egress.test(target);
        } catch (error) {
          logger.warn(`Egress tester unavailable: ${error instanceof Error ? error.message : ""}`);
          throw new ApiException(
            "service_unavailable",
            503,
            "Proxy tests aren’t available right now. Try again in a moment.",
            { headers: { "Retry-After": "10" } },
          );
        }
      } else {
        outcome = await this.tester.test(target);
      }
      const stored: StoredProxyTest = { ...outcome, testedAt: new Date().toISOString() };
      await this.database.db
        .update(schema.proxies)
        .set({ lastTest: stored })
        .where(eq(schema.proxies.id, row.id));
      return toResult(stored);
    } finally {
      const left = (this.runningByAccount.get(userId) ?? 1) - 1;
      if (left <= 0) this.runningByAccount.delete(userId);
      else this.runningByAccount.set(userId, left);
      this.runningTotal -= 1;
    }
  }

  /** For "download your data": the person's own, settings only, never credentials. */
  async forExport(userId: string) {
    return (await this.list(userId, null)).map(
      ({ name, protocol, host, port, kind, rotation, hasCredentials, createdAt, updatedAt }) => ({
        name,
        protocol,
        host,
        port,
        kind,
        rotation,
        hasCredentials,
        createdAt,
        updatedAt,
      }),
    );
  }
}
