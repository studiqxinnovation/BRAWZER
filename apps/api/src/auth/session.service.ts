import { type SessionInfo, sessionCookieName } from "@brawzer/contracts";
import {
  and,
  type AuthSession,
  type DatabaseExecutor,
  type DatabaseHandle,
  eq,
  gt,
  isNull,
  or,
  schema,
  type User,
} from "@brawzer/db";
// Brings in the request.cookies / reply.setCookie type augmentation.
import type {} from "@fastify/cookie";
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
  "signed_out" | "idle_timeout" | "replaced" | "password_reset" | "signed_out_everywhere";

@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** `__Host-brawzer_session` over HTTPS; `brawzer_session` on plain-HTTP localhost. */
  get cookieName(): string {
    return sessionCookieName(this.config.secureCookies);
  }

  async create(
    userId: string,
    persistent: boolean,
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
  async validate(token: string | undefined): Promise<AuthContext | null> {
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
    if (idleMs > ACTIVITY_WRITE_INTERVAL_SECONDS * 1000) {
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

  async revoke(sessionId: string, reason: RevocationReason): Promise<void> {
    await this.database.db
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(schema.authSessions.id, sessionId), isNull(schema.authSessions.revokedAt)));
  }

  /** Ends the session a token belongs to, if any. */
  async revokeByToken(token: string | undefined, reason: RevocationReason): Promise<void> {
    if (!isWellFormedToken(token)) return;
    await this.database.db
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(schema.authSessions.tokenHash, hashToken(token)),
          isNull(schema.authSessions.revokedAt),
        ),
      );
  }

  /** Ends every session of an account; returns how many were active. */
  async revokeAll(
    userId: string,
    reason: RevocationReason,
    executor: DatabaseExecutor = this.database.db,
  ): Promise<number> {
    const revoked = await executor
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(schema.authSessions.userId, userId), isNull(schema.authSessions.revokedAt)))
      .returning({ id: schema.authSessions.id });
    return revoked.length;
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
    };
  }
}
