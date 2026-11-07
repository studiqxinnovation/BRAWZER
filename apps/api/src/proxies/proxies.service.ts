import {
  MAX_PROXIES,
  type ProxyKind,
  type ProxyProtocol,
  type ProxyRotation,
  type ProxyTestReason,
  proxyTestReasonSchema,
  type ProxyTestResult,
  type SavedProxy,
} from "@brawzer/contracts";
import {
  and,
  asc,
  type DatabaseHandle,
  eq,
  isNotNull,
  type ProxyRow,
  schema,
  type StoredProxyTest,
  sql,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
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
import type { ProxyTester } from "./proxy-tester.js";

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

/** Ciphertexts are bound to their account and row, so they can't be moved to another. */
const credentialsContext = (userId: string, proxyId: string) =>
  `proxy-credentials:${userId}:${proxyId}`;

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
export class ProxiesService {
  private readonly runningByAccount = new Map<string, number>();
  private runningTotal = 0;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROXY_TESTER) private readonly tester: ProxyTester,
  ) {}

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
    const plain = await this.box.open(row.credentials, credentialsContext(row.userId, row.id));
    return JSON.parse(plain) as Credentials;
  }

  private async find(userId: string, id: string): Promise<ProxyRow> {
    const [row] = await this.database.db
      .select()
      .from(schema.proxies)
      .where(and(eq(schema.proxies.id, id), eq(schema.proxies.userId, userId)))
      .limit(1);
    if (!row) throw notFound();
    return row;
  }

  async list(userId: string): Promise<SavedProxy[]> {
    const [rows, uses] = await Promise.all([
      this.database.db
        .select()
        .from(schema.proxies)
        .where(eq(schema.proxies.userId, userId))
        .orderBy(asc(schema.proxies.createdAt)),
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
    },
    meta: RequestMeta,
  ): Promise<SavedProxy> {
    const userId = auth.user.id;
    const host = this.normalizeHost(input.host);
    if (input.credentials) checkCredentials(input.protocol, input.credentials);

    let row: ProxyRow;
    try {
      row = await this.database.db.transaction(async (tx) => {
        await lockAccount(tx, userId);
        const [stats] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.proxies)
          .where(eq(schema.proxies.userId, userId));
        if ((stats?.count ?? 0) >= MAX_PROXIES) {
          throw new ApiException(
            "limit_reached",
            409,
            `You can have up to ${String(MAX_PROXIES)} proxies while Brawzer is in development.`,
          );
        }
        const [inserted] = await tx
          .insert(schema.proxies)
          .values({
            userId,
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
          credentialsContext(userId, inserted.id),
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
        credentialsContext(userId, id),
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
        .where(and(eq(schema.proxies.id, id), eq(schema.proxies.userId, userId)))
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
    const deleted = await this.database.db
      .delete(schema.proxies)
      .where(and(eq(schema.proxies.id, id), eq(schema.proxies.userId, userId)))
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
      const outcome = await this.tester.test({
        protocol: row.protocol,
        host: row.host,
        port: row.port,
        credentials: await this.openCredentials(row),
      });
      const stored: StoredProxyTest = { ...outcome, testedAt: new Date().toISOString() };
      await this.database.db
        .update(schema.proxies)
        .set({ lastTest: stored })
        .where(and(eq(schema.proxies.id, id), eq(schema.proxies.userId, userId)));
      return toResult(stored);
    } finally {
      const left = (this.runningByAccount.get(userId) ?? 1) - 1;
      if (left <= 0) this.runningByAccount.delete(userId);
      else this.runningByAccount.set(userId, left);
      this.runningTotal -= 1;
    }
  }

  /** For "download your data": settings only, never credentials. */
  async forExport(userId: string) {
    return (await this.list(userId)).map(
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
