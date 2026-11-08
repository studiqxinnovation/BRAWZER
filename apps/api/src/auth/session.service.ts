import {
  type AuthMethod,
  authMethodSchema,
  type DeviceSession,
  type SessionInfo,
  sessionCookieName,
} from "@brawzer/contracts";
import {
  and,
  type AuthSession,
  type DatabaseExecutor,
  type DatabaseHandle,
  desc,
  eq,
  gt,
  isNull,
  ne,
  or,
  schema,
  type User,
} from "@brawzer/db";
// Brings in the request.cookies / reply.setCookie type augmentation.
import type {} from "@fastify/cookie";
import { EventEmitter } from "node:events";
import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RequestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import {
  ACTIVITY_WRITE_INTERVAL_SECONDS,
  ROTATION_GRACE_SECONDS,
  sessionLifetime,
} from "./session-policy.js";
import { generateToken, hashToken, isWellFormedToken } from "./tokens.js";
import { describeUserAgent } from "./user-agent.js";

/** Stored as text; anything unexpected reads as a password sign-in. */
export function toAuthMethod(value: string): AuthMethod {
  const parsed = authMethodSchema.safeParse(value);
  return parsed.success ? parsed.data : "password";
}

/** The signed-in person and session behind a request. */
export interface AuthContext {
  user: User;
  session: AuthSession;
  /** The request used a token that has since been rotated (still inside its grace period). */
  staleToken: boolean;
}

export interface IssuedSession {
  /** The raw token: goes into the cookie, never into storage or logs. */
  token: string;
  session: AuthSession;
}

export type RevocationReason =
  | "signed_out"
  | "idle_timeout"
  | "replaced"
  | "password_reset"
  | "password_changed"
  | "email_change_undone"
  | "signed_out_remotely"
  | "signed_out_everywhere_else";

@Injectable()
export class SessionService {
  private readonly revocations = new EventEmitter();

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.revocations.setMaxListeners(0);
  }

  /** Called with each session id this instance revokes (any reason). */
  onRevoked(listener: (sessionId: string) => void): void {
    this.revocations.on("revoked", listener);
  }

  private announceRevoked(ids: readonly { id: string }[]): void {
    for (const { id } of ids) this.revocations.emit("revoked", id);
  }

  /** Still signed in: not revoked, not expired, not idle for too long. Doesn't count as activity. */
  async isActive(sessionId: string): Promise<boolean> {
    const now = new Date();
    const [row] = await this.database.db
      .select({
        persistent: schema.authSessions.persistent,
        lastSeenAt: schema.authSessions.lastSeenAt,
      })
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.id, sessionId),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, now),
        ),
      )
      .limit(1);
    if (!row) return false;
    return (
      now.getTime() - row.lastSeenAt.getTime() <= sessionLifetime(row.persistent).idleSeconds * 1000
    );
  }

  /** `__Host-brawzer_session` over HTTPS; `brawzer_session` on plain-HTTP localhost. */
  get cookieName(): string {
    return sessionCookieName(this.config.secureCookies);
  }

  async create(
    userId: string,
    { persistent, method }: { persistent: boolean; method: AuthMethod },
    meta: RequestMeta,
    executor: DatabaseExecutor = this.database.db,
  ): Promise<IssuedSession> {
    const token = generateToken();
    const now = new Date();
    const [session] = await executor
      .insert(schema.authSessions)
      .values({
        userId,
        tokenHash: hashToken(token),
        persistent,
        authMethod: method,
        reauthenticatedAt: now,
        reauthMethod: method,
        userAgent: meta.userAgent,
        ipAddress: meta.ip,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + sessionLifetime(persistent).absoluteSeconds * 1000),
      })
      .returning();
    if (!session) throw new Error("Creating a session returned no row");
    return { token, session };
  }

  /**
   * Resolves a token to an active session. Returns null when the token is
   * unknown, revoked, expired or idle for too long; an idle session is
   * revoked so it can never come back.
   */
  async validate(
    token: string | undefined,
    options: { recordActivity?: boolean } = {},
  ): Promise<AuthContext | null> {
    if (!isWellFormedToken(token)) return null;
    const tokenHash = hashToken(token);
    const now = new Date();
    const graceStart = new Date(now.getTime() - ROTATION_GRACE_SECONDS * 1000);

    const [row] = await this.database.db
      .select({ session: schema.authSessions, user: schema.users })
      .from(schema.authSessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
      .where(
        and(
          or(
            eq(schema.authSessions.tokenHash, tokenHash),
            and(
              eq(schema.authSessions.previousTokenHash, tokenHash),
              gt(schema.authSessions.rotatedAt, graceStart),
            ),
          ),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, now),
        ),
      )
      .limit(1);
    if (!row) return null;

    const idleMs = now.getTime() - row.session.lastSeenAt.getTime();
    if (idleMs > sessionLifetime(row.session.persistent).idleSeconds * 1000) {
      await this.revoke(row.session.id, "idle_timeout");
      return null;
    }

    let session = row.session;
    // Passive checks (is this session still valid?) must not keep it alive.
    if (options.recordActivity !== false && idleMs > ACTIVITY_WRITE_INTERVAL_SECONDS * 1000) {
      await this.database.db
        .update(schema.authSessions)
        .set({ lastSeenAt: now })
        .where(eq(schema.authSessions.id, session.id));
      session = { ...session, lastSeenAt: now };
    }
    return { user: row.user, session, staleToken: session.tokenHash !== tokenHash };
  }

  /** Issues a new token for the same session; returns null if the session ended meanwhile. */
  async rotate(context: AuthContext): Promise<IssuedSession | null> {
    const token = generateToken();
    const now = new Date();
    const [session] = await this.database.db
      .update(schema.authSessions)
      .set({
        tokenHash: hashToken(token),
        previousTokenHash: context.session.tokenHash,
        rotatedAt: now,
        lastSeenAt: now,
      })
      .where(
        and(
          eq(schema.authSessions.id, context.session.id),
          eq(schema.authSessions.tokenHash, context.session.tokenHash),
          isNull(schema.authSessions.revokedAt),
        ),
      )
      .returning();
    return session ? { token, session } : null;
  }

  /** Records that the owner just proved who they are, and how (see RecentAuthGuard). */
  async confirmIdentity(sessionId: string, method: "password" | "passkey"): Promise<Date> {
    const now = new Date();
    await this.database.db
      .update(schema.authSessions)
      .set({ reauthenticatedAt: now, reauthMethod: method })
      .where(eq(schema.authSessions.id, sessionId));
    return now;
  }

  async revoke(sessionId: string, reason: RevocationReason): Promise<void> {
    const revoked = await this.database.db
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(schema.authSessions.id, sessionId), isNull(schema.authSessions.revokedAt)))
      .returning({ id: schema.authSessions.id });
    this.announceRevoked(revoked);
  }

  /** Ends the session a token belongs to, if any. */
  async revokeByToken(token: string | undefined, reason: RevocationReason): Promise<void> {
    if (!isWellFormedToken(token)) return;
    const revoked = await this.database.db
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(schema.authSessions.tokenHash, hashToken(token)),
          isNull(schema.authSessions.revokedAt),
        ),
      )
      .returning({ id: schema.authSessions.id });
    this.announceRevoked(revoked);
  }

  /**
   * Ends every session of an account, optionally keeping one (the device
   * making the request). Returns how many were active.
   */
  async revokeAll(
    userId: string,
    reason: RevocationReason,
    options: { except?: string; executor?: DatabaseExecutor } = {},
  ): Promise<number> {
    const executor = options.executor ?? this.database.db;
    const revoked = await executor
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(schema.authSessions.userId, userId),
          isNull(schema.authSessions.revokedAt),
          options.except ? ne(schema.authSessions.id, options.except) : undefined,
        ),
      )
      .returning({ id: schema.authSessions.id });
    this.announceRevoked(revoked);
    return revoked.length;
  }

  /** Ends one session, only if it belongs to the account. False when there was nothing to end. */
  async revokeOwned(userId: string, sessionId: string, reason: RevocationReason): Promise<boolean> {
    const revoked = await this.database.db
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(schema.authSessions.id, sessionId),
          eq(schema.authSessions.userId, userId),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, new Date()),
        ),
      )
      .returning({ id: schema.authSessions.id });
    this.announceRevoked(revoked);
    return revoked.length === 1;
  }

  /** The account's signed-in devices, this one first, then most recently active. */
  async listActive(context: AuthContext): Promise<DeviceSession[]> {
    const now = Date.now();
    const rows = await this.database.db
      .select()
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.userId, context.user.id),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, new Date(now)),
        ),
      )
      .orderBy(desc(schema.authSessions.lastSeenAt));

    return rows
      .filter(
        (session) =>
          // Idle sessions are dead even before a request revokes them.
          now - session.lastSeenAt.getTime() <=
          sessionLifetime(session.persistent).idleSeconds * 1000,
      )
      .map((session) => ({
        id: session.id,
        current: session.id === context.session.id,
        persistent: session.persistent,
        device: describeUserAgent(session.userAgent),
        authMethod: toAuthMethod(session.authMethod),
        ipAddress: session.ipAddress,
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      }))
      .sort((a, b) => Number(b.current) - Number(a.current));
  }

  readToken(request: FastifyRequest): string | undefined {
    return request.cookies[this.cookieName];
  }

  setCookie(reply: FastifyReply, issued: IssuedSession): void {
    const { session, token } = issued;
    void reply.setCookie(this.cookieName, token, {
      ...this.cookieAttributes(),
      // Shared-computer sessions get no Max-Age, so the cookie ends with the browser.
      ...(session.persistent
        ? { maxAge: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)) }
        : {}),
    });
  }

  clearCookie(reply: FastifyReply): void {
    void reply.clearCookie(this.cookieName, this.cookieAttributes());
  }

  private cookieAttributes() {
    // __Host- cookies must be Secure, Path=/ and have no Domain attribute.
    return {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: "lax",
      path: "/",
    } as const;
  }

  describe(session: AuthSession): SessionInfo {
    return {
      id: session.id,
      persistent: session.persistent,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      idleTimeoutMinutes: sessionLifetime(session.persistent).idleSeconds / 60,
      authMethod: toAuthMethod(session.authMethod),
    };
  }
}
