import type {
  changePasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from "@brawzer/contracts";
import { and, type DatabaseHandle, eq, isNull, schema, type User } from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";
import { ApiException, rateLimited } from "../common/api-exception.js";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE } from "../database/database.module.js";
import { EmailService } from "../email/email.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { BreachedPasswordCheck } from "./breached-passwords.js";
import { EmailTokenService } from "./email-token.service.js";
import {
  assertAcceptablePassword,
  burnPasswordCheck,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password.js";
import { type AuthContext, type IssuedSession, SessionService } from "./session.service.js";
import { describeUserAgent } from "./user-agent.js";

type RegisterInput = z.output<typeof registerRequestSchema>;
type LoginInput = z.output<typeof loginRequestSchema>;
type VerifyEmailInput = z.output<typeof verifyEmailRequestSchema>;
type ResetPasswordInput = z.output<typeof resetPasswordRequestSchema>;
type ChangePasswordInput = z.output<typeof changePasswordRequestSchema>;

export interface SignedIn {
  issued: IssuedSession;
  user: User;
}

const linkInvalid = () =>
  new ApiException("token_invalid", 400, "This link has expired or has already been used.");

const invalidCredentials = () =>
  new ApiException("invalid_credentials", 401, "Email or password is incorrect.");

/** Rate-limit subject for requests whose address is unknown, so they share one bucket. */
const ipOf = (meta: RequestMeta) => meta.ip ?? "unknown";

/**
 * Account sign-up, email confirmation, sign-in, sign-out and password reset.
 *
 * Responses never reveal whether an email address has an account: sign-up
 * and password-reset requests always get the same answer, emails are sent in
 * the background, and sign-in checks a password even when there is no account.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(EmailTokenService) private readonly emailTokens: EmailTokenService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(BreachedPasswordCheck) private readonly breached: BreachedPasswordCheck,
  ) {}

  private async findUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    return user;
  }

  /** Each account receives a few emails an hour at most; beyond that they are skipped silently. */
  private async mayEmail(userId: string): Promise<boolean> {
    return (await this.limiter.hit(RATE_LIMITS.emailsPerAccount, userId)).allowed;
  }

  /**
   * Starts sign-up. The chosen password is attached to the confirmation link
   * and becomes the account's password only when the person who opens the
   * link enters it again. Someone who registers another person's address
   * therefore can never take over the account that address later uses.
   */
  async register(input: RegisterInput, meta: RequestMeta): Promise<void> {
    await this.limiter.enforce(RATE_LIMITS.registerPerIp, ipOf(meta));
    assertAcceptablePassword(input.password, input.email);
    await this.breached.assertNotBreached(input.password);
    const pendingPasswordHash = await hashPassword(input.password);

    const [created] = await this.database.db
      .insert(schema.users)
      .values({ email: input.email })
      .onConflictDoNothing({ target: schema.users.email })
      .returning();

    if (created) {
      const token = await this.emailTokens.issue(created.id, "verify_email", {
        pendingPasswordHash,
      });
      await this.events.record({ type: "account.created", userId: created.id, meta });
      if (await this.mayEmail(created.id)) this.email.sendVerification(created.email, token);
      return;
    }

    const existing = await this.findUserByEmail(input.email);
    if (!existing || !(await this.mayEmail(existing.id))) return;
    if (existing.emailVerifiedAt) {
      this.email.sendAccountExists(existing.email);
      return;
    }
    const token = await this.emailTokens.issue(existing.id, "verify_email", {
      pendingPasswordHash,
    });
    this.email.sendVerification(existing.email, token);
  }

  /** Confirms the address with the link's token and the password chosen at sign-up, then signs in. */
  async verifyEmail(input: VerifyEmailInput, meta: RequestMeta): Promise<SignedIn> {
    await this.limiter.enforce(RATE_LIMITS.linkAttemptsPerIp, ipOf(meta));
    const found = await this.emailTokens.find(input.token, "verify_email");
    const pendingPasswordHash = found?.token.pendingPasswordHash;
    if (!found || !pendingPasswordHash) throw linkInvalid();

    const lockout = await this.limiter.isBlocked(RATE_LIMITS.linkPasswordFailures, found.token.id);
    if (!lockout.allowed) throw rateLimited(lockout.retryAfterSeconds);
    if (!(await verifyPassword(pendingPasswordHash, input.password))) {
      await this.limiter.hit(RATE_LIMITS.linkPasswordFailures, found.token.id);
      throw new ApiException(
        "invalid_credentials",
        401,
        "That isn’t the password you chose when you created your account.",
      );
    }

    const result = await this.database.db.transaction(async (tx) => {
      if (!(await this.emailTokens.consume(found.token.id, tx))) return null;
      const now = new Date();
      const [user] = await tx
        .update(schema.users)
        .set({ passwordHash: pendingPasswordHash, emailVerifiedAt: now, updatedAt: now })
        .where(and(eq(schema.users.id, found.user.id), isNull(schema.users.emailVerifiedAt)))
        .returning();
      if (!user) return null;
      // Other sign-up links for this address, possibly carrying someone else's password, die now.
      await this.emailTokens.invalidateAll(user.id, ["verify_email"], tx);
      const issued = await this.sessions.create(user.id, input.keepSignedIn, meta, tx);
      return { user, issued };
    });
    if (!result) throw linkInvalid();

    await this.events.record({
      type: "email.verified",
      userId: result.user.id,
      meta,
      metadata: { method: "sign_up_link" },
    });
    await this.events.record({
      type: "sign_in.succeeded",
      userId: result.user.id,
      sessionId: result.issued.session.id,
      meta,
      metadata: { method: "sign_up_link", persistent: input.keepSignedIn },
    });
    return result;
  }

  async login(input: LoginInput, meta: RequestMeta, presentedToken?: string): Promise<SignedIn> {
    await this.limiter.enforce(RATE_LIMITS.signInPerIp, ipOf(meta));
    // Keyed by the submitted address whether or not it has an account, so lockouts reveal nothing.
    const lockout = await this.limiter.isBlocked(RATE_LIMITS.signInFailuresPerAccount, input.email);
    if (!lockout.allowed) throw rateLimited(lockout.retryAfterSeconds);

    const user = await this.findUserByEmail(input.email);
    const passwordHash = user?.passwordHash;
    const valid = passwordHash
      ? await verifyPassword(passwordHash, input.password)
      : user
        ? await this.checkPendingSignUp(user, input.password)
        : await burnPasswordCheck(input.password);

    if (!user || !passwordHash || !valid) {
      await this.limiter.hit(RATE_LIMITS.signInFailuresPerAccount, input.email);
      if (user) {
        await this.events.record({
          type: "sign_in.failed",
          userId: user.id,
          meta,
          metadata: { reason: "wrong_password" },
        });
      }
      throw invalidCredentials();
    }

    await this.limiter.reset(RATE_LIMITS.signInFailuresPerAccount, input.email);
    if (needsRehash(passwordHash)) {
      await this.database.db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(input.password), updatedAt: new Date() })
        .where(eq(schema.users.id, user.id));
    }
    // A browser that was already signed in (perhaps as someone else) leaves that session behind.
    await this.sessions.revokeByToken(presentedToken, "replaced");
    const issued = await this.sessions.create(user.id, input.keepSignedIn, meta);
    await this.events.record({
      type: "sign_in.succeeded",
      userId: user.id,
      sessionId: issued.session.id,
      meta,
      metadata: { method: "password", persistent: input.keepSignedIn },
    });
    return { user, issued };
  }

  /**
   * Sign-in for an account whose address isn't confirmed yet. With the
   * password chosen at sign-up, it sends a fresh confirmation link and says
   * so; that reveals the account only to the person who created it.
   */
  private async checkPendingSignUp(user: User, password: string): Promise<false> {
    const pending = await this.emailTokens.latestPendingSignUp(user.id);
    const pendingPasswordHash = pending?.pendingPasswordHash;
    if (!pendingPasswordHash) return burnPasswordCheck(password);
    if (!(await verifyPassword(pendingPasswordHash, password))) return false;

    if (await this.mayEmail(user.id)) {
      const token = await this.emailTokens.issue(user.id, "verify_email", { pendingPasswordHash });
      this.email.sendVerification(user.email, token);
    }
    throw new ApiException(
      "email_not_verified",
      403,
      "Confirm your email address to finish creating your account. We’ve emailed you a link.",
    );
  }

  /** Ends the session the request belongs to. Always succeeds, so the cookie can always be cleared. */
  async logout(token: string | undefined, meta: RequestMeta): Promise<void> {
    const context = await this.sessions.validate(token);
    if (!context) return;
    await this.sessions.revoke(context.session.id, "signed_out");
    await this.events.record({
      type: "sign_out",
      userId: context.user.id,
      sessionId: context.session.id,
      meta,
    });
  }

  /**
   * Rotates the session token. A request that still carries the previous
   * token (another tab racing this one) gets the session without a second
   * rotation, so the browser keeps the newest cookie.
   */
  async refresh(context: AuthContext): Promise<IssuedSession | null> {
    if (context.staleToken) return null;
    return this.sessions.rotate(context);
  }

  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    await this.limiter.enforce(RATE_LIMITS.emailsPerIp, ipOf(meta));
    const user = await this.findUserByEmail(email);
    if (!user || !(await this.mayEmail(user.id))) return;
    const token = await this.emailTokens.issue(user.id, "reset_password");
    await this.events.record({ type: "password.reset_requested", userId: user.id, meta });
    this.email.sendPasswordReset(user.email, token);
  }

  /**
   * Sets a new password from a reset link. It confirms the address too (the
   * link proves access to the inbox), signs out every device and doesn't
   * sign in: the person signs in with the new password.
   */
  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    await this.limiter.enforce(RATE_LIMITS.linkAttemptsPerIp, ipOf(meta));
    const found = await this.emailTokens.find(input.token, "reset_password");
    if (!found) throw linkInvalid();
    assertAcceptablePassword(input.password, found.user.email);
    await this.breached.assertNotBreached(input.password);
    const passwordHash = await hashPassword(input.password);

    const revoked = await this.database.db.transaction(async (tx) => {
      if (!(await this.emailTokens.consume(found.token.id, tx))) return null;
      const now = new Date();
      await tx
        .update(schema.users)
        .set({ passwordHash, emailVerifiedAt: found.user.emailVerifiedAt ?? now, updatedAt: now })
        .where(eq(schema.users.id, found.user.id));
      await this.emailTokens.invalidateAll(found.user.id, ["verify_email", "reset_password"], tx);
      return this.sessions.revokeAll(found.user.id, "password_reset", { executor: tx });
    });
    if (revoked === null) throw linkInvalid();

    const userId = found.user.id;
    await this.limiter.reset(RATE_LIMITS.signInFailuresPerAccount, found.user.email);
    if (!found.user.emailVerifiedAt) {
      await this.events.record({
        type: "email.verified",
        userId,
        meta,
        metadata: { method: "password_reset" },
      });
    }
    await this.events.record({ type: "password.reset", userId, meta });
    if (revoked > 0) {
      await this.events.record({
        type: "sessions.revoked",
        userId,
        meta,
        metadata: { reason: "password_reset", count: revoked },
      });
    }
    this.email.sendPasswordChanged(
      found.user.email,
      describeUserAgent(meta.userAgent),
      "every-device",
    );
  }

  /**
   * Changes the password of a signed-in person after checking the current
   * one. Every other device is signed out and this session gets a new token,
   * so anyone who had the old password or an old cookie loses access.
   */
  async changePassword(
    auth: AuthContext,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<{ issued: IssuedSession | null; signedOut: number }> {
    const { user, session } = auth;
    const lockout = await this.limiter.isBlocked(RATE_LIMITS.passwordChangeFailures, user.id);
    if (!lockout.allowed) throw rateLimited(lockout.retryAfterSeconds);

    const correct = user.passwordHash
      ? await verifyPassword(user.passwordHash, input.currentPassword)
      : await burnPasswordCheck(input.currentPassword);
    if (!correct) {
      await this.limiter.hit(RATE_LIMITS.passwordChangeFailures, user.id);
      // 400, not 401: the session is fine, only the form value is wrong.
      throw new ApiException("validation_failed", 400, "Check your current password.", {
        details: ["currentPassword: That isn’t your current password."],
      });
    }
    if (input.newPassword === input.currentPassword) {
      throw new ApiException("validation_failed", 400, "Choose a new password.", {
        details: ["newPassword: Choose a password you haven’t been using."],
      });
    }
    assertAcceptablePassword(input.newPassword, user.email, "newPassword");
    await this.breached.assertNotBreached(input.newPassword, "newPassword");
    const passwordHash = await hashPassword(input.newPassword);

    const signedOut = await this.database.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(schema.users.id, user.id));
      // A reset link requested earlier must not undo this change.
      await this.emailTokens.invalidateAll(user.id, ["reset_password"], tx);
      return this.sessions.revokeAll(user.id, "password_changed", {
        except: session.id,
        executor: tx,
      });
    });

    await this.limiter.reset(RATE_LIMITS.passwordChangeFailures, user.id);
    await this.limiter.reset(RATE_LIMITS.signInFailuresPerAccount, user.email);
    await this.events.record({
      type: "password.changed",
      userId: user.id,
      sessionId: session.id,
      meta,
    });
    if (signedOut > 0) {
      await this.events.record({
        type: "sessions.revoked",
        userId: user.id,
        sessionId: session.id,
        meta,
        metadata: { reason: "password_changed", count: signedOut },
      });
    }
    this.email.sendPasswordChanged(user.email, describeUserAgent(meta.userAgent), "other-devices");
    return { issued: await this.sessions.rotate(auth), signedOut };
  }

  /** Signs out one of the account's other devices. */
  async endSession(auth: AuthContext, sessionId: string, meta: RequestMeta): Promise<void> {
    if (sessionId === auth.session.id) {
      throw new ApiException("bad_request", 400, "To end the session on this device, sign out.");
    }
    if (!(await this.sessions.revokeOwned(auth.user.id, sessionId, "signed_out_remotely"))) {
      throw new ApiException("not_found", 404, "That session has already ended.");
    }
    await this.events.record({
      type: "sessions.revoked",
      userId: auth.user.id,
      sessionId: auth.session.id,
      meta,
      metadata: { reason: "signed_out_remotely", count: 1 },
    });
  }

  /** Signs out every device except the one making the request. */
  async endOtherSessions(auth: AuthContext, meta: RequestMeta): Promise<number> {
    const count = await this.sessions.revokeAll(auth.user.id, "signed_out_everywhere_else", {
      except: auth.session.id,
    });
    if (count > 0) {
      await this.events.record({
        type: "sessions.revoked",
        userId: auth.user.id,
        sessionId: auth.session.id,
        meta,
        metadata: { reason: "signed_out_everywhere_else", count },
      });
    }
    return count;
  }
}
