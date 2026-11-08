import type { AccountExport } from "@brawzer/contracts";
import { and, type DatabaseHandle, eq, ne, schema } from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { BreachedPasswordCheck } from "../auth/breached-passwords.js";
import { BrowserService } from "../browser/browser.service.js";
import { EmailTokenService } from "../auth/email-token.service.js";
import { assertAcceptablePassword, hashPassword } from "../auth/password.js";
import { MfaService } from "../auth/mfa/mfa.service.js";
import { PasskeyService } from "../auth/passkeys/passkey.service.js";
import { type AuthContext, SessionService } from "../auth/session.service.js";
import { ApiException } from "../common/api-exception.js";
import { isUniqueViolation } from "../common/database-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE } from "../database/database.module.js";
import { DriveService } from "../drive/drive.service.js";
import { ProfileDataService } from "../profiles/profile-data.service.js";
import { EmailService } from "../email/email.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { ProfilesService } from "../profiles/profiles.service.js";
import { ProxiesService } from "../proxies/proxies.service.js";
import { SecurityHistoryService } from "../security/security.service.js";

const logger = new Logger("Account");
const ipOf = (meta: RequestMeta) => meta.ip ?? "unknown";

const addressTaken = () =>
  new ApiException("conflict", 409, "That address is already used by another Brawzer account.");

const linkInvalid = () =>
  new ApiException("token_invalid", 400, "This link has expired or has already been used.");

/** Changing the email address, deleting the account, and downloading its data. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(EmailTokenService) private readonly emailTokens: EmailTokenService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(PasskeyService) private readonly passkeys: PasskeyService,
    @Inject(SecurityHistoryService) private readonly history: SecurityHistoryService,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
    @Inject(ProxiesService) private readonly proxies: ProxiesService,
    @Inject(DriveService) private readonly drive: DriveService,
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(ProfileDataService) private readonly profileData: ProfileDataService,
    @Inject(BreachedPasswordCheck) private readonly breached: BreachedPasswordCheck,
  ) {}

  /**
   * Sends a confirmation link to the new address and a notice to the current
   * one. Nothing changes until the link is opened, which proves the new
   * address belongs to the person.
   */
  async requestEmailChange(auth: AuthContext, newEmail: string, meta: RequestMeta): Promise<void> {
    const { user, session } = auth;
    if (newEmail === user.email) {
      throw new ApiException("validation_failed", 400, "That’s already your email address.", {
        details: ["email: That’s already your email address."],
      });
    }
    await this.limiter.enforce(RATE_LIMITS.emailsPerAccount, user.id);
    // Only the newest request counts.
    await this.emailTokens.invalidateAll(user.id, ["change_email"]);
    const [holder] = await this.database.db
      .select({ emailVerifiedAt: schema.users.emailVerifiedAt })
      .from(schema.users)
      .where(eq(schema.users.email, newEmail))
      .limit(1);
    // The reply is the same either way, so this can't be used to find out
    // whether an address has an account; only that inbox learns why.
    if (holder?.emailVerifiedAt) {
      this.email.sendEmailInUse(newEmail);
    } else {
      const token = await this.emailTokens.issue(user.id, "change_email", { newEmail });
      this.email.sendEmailChangeLink(newEmail, token);
    }
    this.email.sendEmailChangeRequested(user.email, newEmail);
    await this.events.record({
      type: "email.change_requested",
      userId: user.id,
      sessionId: session.id,
      meta,
    });
  }

  async confirmEmailChange(token: string, meta: RequestMeta): Promise<string> {
    await this.limiter.enforce(RATE_LIMITS.linkAttemptsPerIp, ipOf(meta));
    const found = await this.emailTokens.find(token, "change_email");
    const newEmail = found?.token.newEmail;
    if (!found || !newEmail) throw linkInvalid();
    const oldEmail = found.user.email;

    let undoToken = "";
    try {
      await this.database.db.transaction(async (tx) => {
        if (!(await this.emailTokens.consume(found.token.id, tx))) throw linkInvalid();
        const [holder] = await tx
          .select({ id: schema.users.id, emailVerifiedAt: schema.users.emailVerifiedAt })
          .from(schema.users)
          .where(and(eq(schema.users.email, newEmail), ne(schema.users.id, found.user.id)))
          .limit(1);
        if (holder?.emailVerifiedAt) throw addressTaken();
        // An unconfirmed sign-up was never proven to belong to anyone, and
        // whoever opened this link just proved the address is theirs.
        if (holder) await tx.delete(schema.users).where(eq(schema.users.id, holder.id));
        const now = new Date();
        await tx
          .update(schema.users)
          .set({ email: newEmail, emailVerifiedAt: now, updatedAt: now })
          .where(eq(schema.users.id, found.user.id));
        await this.emailTokens.invalidateAll(found.user.id, ["change_email"], tx);
        // The old address can undo this for 7 days (see undoEmailChange).
        undoToken = await this.emailTokens.issue(
          found.user.id,
          "undo_email_change",
          { previousEmail: oldEmail },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw addressTaken();
      throw error;
    }
    this.email.sendEmailChanged(oldEmail, newEmail, undoToken);
    await this.events.record({ type: "email.changed", userId: found.user.id, meta });
    return newEmail;
  }

  /**
   * From the link sent to the old address when an email change completed.
   * Whoever changed the address had the password too, so undoing also sets a
   * new password, signs out every device and cancels outstanding links. The
   * link proves access to the old inbox, like a password reset does.
   */
  async undoEmailChange(token: string, password: string, meta: RequestMeta): Promise<string> {
    await this.limiter.enforce(RATE_LIMITS.linkAttemptsPerIp, ipOf(meta));
    const found = await this.emailTokens.find(token, "undo_email_change");
    const restored = found?.token.previousEmail;
    if (!found || !restored) throw linkInvalid();
    assertAcceptablePassword(password, restored);
    await this.breached.assertNotBreached(password);
    const passwordHash = await hashPassword(password);
    const removed = found.user.email;

    let revoked = 0;
    try {
      revoked = await this.database.db.transaction(async (tx) => {
        if (!(await this.emailTokens.consume(found.token.id, tx))) throw linkInvalid();
        const [holder] = await tx
          .select({ id: schema.users.id, emailVerifiedAt: schema.users.emailVerifiedAt })
          .from(schema.users)
          .where(and(eq(schema.users.email, restored), ne(schema.users.id, found.user.id)))
          .limit(1);
        if (holder?.emailVerifiedAt) throw addressTaken();
        if (holder) await tx.delete(schema.users).where(eq(schema.users.id, holder.id));
        const now = new Date();
        await tx
          .update(schema.users)
          .set({ email: restored, emailVerifiedAt: now, passwordHash, updatedAt: now })
          .where(eq(schema.users.id, found.user.id));
        await this.emailTokens.invalidateAll(
          found.user.id,
          ["reset_password", "change_email", "undo_email_change"],
          tx,
        );
        return this.sessions.revokeAll(found.user.id, "email_change_undone", { executor: tx });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw addressTaken();
      throw error;
    }

    const userId = found.user.id;
    await this.limiter.reset(RATE_LIMITS.signInFailuresPerAccount, restored);
    await this.events.record({ type: "email.change_undone", userId, meta });
    await this.events.record({
      type: "password.reset",
      userId,
      meta,
      metadata: { method: "undo_email_change" },
    });
    if (revoked > 0) {
      await this.events.record({
        type: "sessions.revoked",
        userId,
        meta,
        metadata: { reason: "email_change_undone", count: revoked },
      });
    }
    this.email.sendEmailChangeUndone(restored);
    if (removed !== restored) this.email.sendEmailChangeReverted(removed);
    return restored;
  }

  /** Deletes the account and everything stored with it, immediately and irreversibly. */
  async deleteAccount(auth: AuthContext, typedEmail: string): Promise<void> {
    const { user } = auth;
    if (typedEmail.trim().toLowerCase() !== user.email) {
      throw new ApiException("validation_failed", 400, "Type your email address to confirm.", {
        details: ["email: Type your email address exactly as it is shown."],
      });
    }
    // Containers and Drive objects aren't rows: stop and list them first.
    await this.browser.endAllForUser(user.id, "account_deleted");
    const [objectKeys, profileObjectKeys] = await Promise.all([
      this.drive.objectKeysOf(user.id),
      this.profileData.objectKeysOf(user.id),
    ]);
    await this.database.db.delete(schema.users).where(eq(schema.users.id, user.id));
    await this.drive.removeAllObjects(objectKeys);
    await this.profileData.removeObjects(profileObjectKeys);
    this.email.sendAccountDeleted(user.email);
    logger.log(`Account ${user.id} deleted by its owner`);
  }

  /** Everything Brawzer holds about the account, except secrets. */
  async export(auth: AuthContext, meta: RequestMeta): Promise<AccountExport> {
    const { user, session } = auth;
    const [passkeys, mfa, devices, history, profiles, proxies, drive, browserSessions] =
      await Promise.all([
        this.passkeys.list(user.id),
        this.mfa.status(user.id),
        this.sessions.listActive(auth),
        this.history.all(user.id),
        this.profiles.list(user.id),
        this.proxies.forExport(user.id),
        this.drive.forExport(user.id),
        this.browser.forExport(user.id),
      ]);
    await this.events.record({
      type: "data.exported",
      userId: user.id,
      sessionId: session.id,
      meta,
    });
    return {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        createdAt: user.createdAt.toISOString(),
      },
      twoFactor: { enabled: mfa.totpEnabled, recoveryCodesRemaining: mfa.recoveryCodesRemaining },
      passkeys: passkeys.map(({ name, synced, createdAt, lastUsedAt }) => ({
        name,
        synced,
        createdAt,
        lastUsedAt,
      })),
      sessions: devices.map(({ device, ipAddress, createdAt, lastActiveAt }) => ({
        device,
        ipAddress,
        createdAt,
        lastActiveAt,
      })),
      securityHistory: history,
      profiles: profiles.map(({ name, color, engine, createdAt, updatedAt }) => ({
        name,
        color,
        engine,
        createdAt,
        updatedAt,
      })),
      proxies,
      drive,
      browserSessions,
    };
  }
}
