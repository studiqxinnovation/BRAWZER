import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { MfaStatus, TotpSetupResponse } from "@brawzer/contracts";
import {
  and,
  type DatabaseExecutor,
  type DatabaseHandle,
  eq,
  isNull,
  schema,
  sql,
  type TotpFactor,
  type User,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { ApiException, rateLimited } from "../../common/api-exception.js";
import type { RequestMeta } from "../../common/request-meta.js";
import { SECRET_BOX } from "../../crypto/crypto.module.js";
import type { SecretBox } from "../../crypto/secret-box.js";
import { DATABASE } from "../../database/database.module.js";
import { EmailService } from "../../email/email.js";
import { RATE_LIMITS, RateLimiter } from "../../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../../security-events/security-events.js";
import type { SignedIn } from "../auth.service.js";
import { ChallengeService } from "../challenges.js";
import { NewDeviceService } from "../new-device.service.js";
import { type AuthContext, SessionService } from "../session.service.js";
import { generateToken, hashToken } from "../tokens.js";

const RECOVERY_CODE_COUNT = 10;
/** No 0/o, 1/l/i: easy to copy by hand. */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const MAX_WRONG_CODES_PER_TICKET = 5;

const ipOf = (meta: RequestMeta) => meta.ip ?? "unknown";
const totpContext = (userId: string) => `totp:${userId}`;
const hashRecoveryCode = (code: string) =>
  createHash("sha256").update(normaliseRecoveryCode(code)).digest("hex");

export function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "k7mpw-3xq9a": 10 characters from a 31-letter alphabet, about 50 bits each. */
export function generateRecoveryCode(): string {
  const characters = Array.from(
    { length: 10 },
    () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
  );
  return `${characters.slice(0, 5).join("")}-${characters.slice(5).join("")}`;
}

const wrongCode = (field = "code") =>
  new ApiException("validation_failed", 400, "That code isn’t right.", {
    details: [`${field}: That code isn’t right. Use the newest code from your authenticator app.`],
  });

const ticketInvalid = (message = "This sign-in has expired. Sign in again.") =>
  new ApiException("token_invalid", 401, message);

/**
 * Two-factor authentication with an authenticator app (TOTP, RFC 6238) and
 * single-use recovery codes. Secrets are sealed with envelope encryption;
 * accepted codes can't be replayed.
 */
@Injectable()
export class MfaService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(ChallengeService) private readonly challenges: ChallengeService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(NewDeviceService) private readonly newDevices: NewDeviceService,
  ) {}

  private async factorOf(
    userId: string,
    executor: DatabaseExecutor = this.database.db,
  ): Promise<TotpFactor | undefined> {
    const [factor] = await executor
      .select()
      .from(schema.totpFactors)
      .where(eq(schema.totpFactors.userId, userId))
      .limit(1);
    return factor;
  }

  async isEnabled(userId: string): Promise<boolean> {
    return (await this.factorOf(userId))?.confirmedAt != null;
  }

  async status(userId: string): Promise<MfaStatus> {
    const factor = await this.factorOf(userId);
    const [remaining] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.recoveryCodes)
      .where(and(eq(schema.recoveryCodes.userId, userId), isNull(schema.recoveryCodes.usedAt)));
    const enabled = factor?.confirmedAt != null;
    return {
      totpEnabled: enabled,
      enabledAt: factor?.confirmedAt?.toISOString() ?? null,
      recoveryCodesRemaining: enabled ? (remaining?.count ?? 0) : 0,
    };
  }

  /** Starts setup: a new secret, shown once as a QR code and as text. */
  async startSetup(auth: AuthContext): Promise<TotpSetupResponse> {
    const { user } = auth;
    if (await this.isEnabled(user.id)) {
      throw new ApiException("conflict", 409, "Two-factor authentication is already on.");
    }
    const secret = generateSecret();
    const sealed = await this.box.seal(secret, totpContext(user.id));
    await this.database.db
      .insert(schema.totpFactors)
      .values({ userId: user.id, secret: sealed })
      .onConflictDoUpdate({
        target: schema.totpFactors.userId,
        set: { secret: sealed, confirmedAt: null, lastTimeStep: 0, createdAt: new Date() },
      });
    const uri = generateURI({ issuer: "Brawzer", label: user.email, secret });
    const qrSvg = await QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
    return { secret, uri, qrSvg };
  }

  /** Checks a 6-digit code; returns its time step when valid and not a replay. */
  private async checkTotp(factor: TotpFactor, code: string): Promise<number | null> {
    if (!/^\d{6}$/.test(code)) return null;
    const secret = await this.box.open(factor.secret, totpContext(factor.userId));
    const result = await verify({
      secret,
      token: code,
      // One 30-second step either side, for clocks that drift a little.
      epochTolerance: 30,
      ...(factor.lastTimeStep > 0 ? { afterTimeStep: factor.lastTimeStep } : {}),
    });
    // TOTP results carry the matched time step (counter-based HOTP results don't).
    return result.valid && "timeStep" in result ? result.timeStep : null;
  }

  /** Atomically records a used time step; false if another request used it first. */
  private async markStepUsed(
    userId: string,
    step: number,
    executor: DatabaseExecutor = this.database.db,
  ) {
    const updated = await executor
      .update(schema.totpFactors)
      .set({ lastTimeStep: step })
      .where(
        and(
          eq(schema.totpFactors.userId, userId),
          sql`${schema.totpFactors.lastTimeStep} < ${step}`,
        ),
      )
      .returning({ userId: schema.totpFactors.userId });
    return updated.length === 1;
  }

  private async replaceRecoveryCodes(
    userId: string,
    executor: DatabaseExecutor,
  ): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await executor.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
    await executor
      .insert(schema.recoveryCodes)
      .values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })));
    return codes;
  }

  /** Finishes setup with a first code; returns the recovery codes, shown only now. */
  async confirmSetup(auth: AuthContext, code: string, meta: RequestMeta): Promise<string[]> {
    const { user, session } = auth;
    const factor = await this.factorOf(user.id);
    if (!factor || factor.confirmedAt) {
      throw new ApiException(
        "bad_request",
        400,
        "Start setting up two-factor authentication again.",
      );
    }
    const step = await this.checkTotp(factor, code);
    if (step === null) throw wrongCode();

    const codes = await this.database.db.transaction(async (tx) => {
      await tx
        .update(schema.totpFactors)
        .set({ confirmedAt: new Date(), lastTimeStep: step })
        .where(eq(schema.totpFactors.userId, user.id));
      return this.replaceRecoveryCodes(user.id, tx);
    });
    await this.events.record({ type: "mfa.enabled", userId: user.id, sessionId: session.id, meta });
    this.email.sendMfaEnabled(user.email);
    return codes;
  }

  async disable(auth: AuthContext, meta: RequestMeta): Promise<void> {
    await this.disableFor(auth.user, auth.session.id, meta);
  }

  /** Staff turn two-factor off for a customer who lost it (Phase 11); the owner is told as usual. */
  async disableForUser(userId: string, meta: RequestMeta): Promise<void> {
    const [user] = await this.database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw new ApiException("not_found", 404, "That account doesn’t exist.");
    await this.disableFor(user, null, meta);
  }

  private async disableFor(
    user: { id: string; email: string },
    sessionId: string | null,
    meta: RequestMeta,
  ): Promise<void> {
    if (!(await this.isEnabled(user.id))) {
      throw new ApiException("bad_request", 400, "Two-factor authentication isn’t on.");
    }
    await this.database.db.transaction(async (tx) => {
      await tx.delete(schema.totpFactors).where(eq(schema.totpFactors.userId, user.id));
      await tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, user.id));
    });
    await this.events.record({
      type: "mfa.disabled",
      userId: user.id,
      ...(sessionId ? { sessionId } : {}),
      meta,
      ...(sessionId ? {} : { metadata: { by: "staff" } }),
    });
    this.email.sendMfaDisabled(user.email);
  }

  async regenerateRecoveryCodes(auth: AuthContext, meta: RequestMeta): Promise<string[]> {
    const { user, session } = auth;
    if (!(await this.isEnabled(user.id))) {
      throw new ApiException("bad_request", 400, "Turn on two-factor authentication first.");
    }
    const codes = await this.database.db.transaction((tx) =>
      this.replaceRecoveryCodes(user.id, tx),
    );
    await this.events.record({
      type: "mfa.recovery_codes_regenerated",
      userId: user.id,
      sessionId: session.id,
      meta,
    });
    return codes;
  }

  /** After a correct password on a two-factor account: a ticket for the second step. */
  async createTicket(
    user: User,
    keepSignedIn: boolean,
  ): Promise<{ ticket: string; expiresAt: Date }> {
    const secret = generateToken();
    const ttlSeconds = 300;
    const id = await this.challenges.create({
      purpose: "mfa",
      challenge: hashToken(secret),
      userId: user.id,
      data: { keepSignedIn },
      ttlSeconds,
    });
    return { ticket: `${id}.${secret}`, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  /** The second sign-in step: a ticket plus an authenticator code or a recovery code. */
  async verifyTicket(
    input: { ticket: string; code: string },
    meta: RequestMeta,
    presentedToken: string | undefined,
  ): Promise<SignedIn> {
    await this.limiter.enforce(RATE_LIMITS.mfaAttemptsPerIp, ipOf(meta));
    const [id = "", secret = ""] = input.ticket.split(".");
    if (!/^[0-9a-f-]{36}$/.test(id) || secret.length !== 43) throw ticketInvalid();
    const challenge = await this.challenges.peek(id, "mfa");
    const expected = Buffer.from(challenge?.challenge ?? "", "utf8");
    const presented = Buffer.from(hashToken(secret), "utf8");
    if (
      !challenge?.userId ||
      expected.length !== presented.length ||
      !timingSafeEqual(expected, presented)
    ) {
      throw ticketInvalid();
    }
    const userId = challenge.userId;
    const lockout = await this.limiter.isBlocked(RATE_LIMITS.mfaFailuresPerAccount, userId);
    if (!lockout.allowed) throw rateLimited(lockout.retryAfterSeconds);

    const [user] = await this.database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const factor = await this.factorOf(userId);
    if (!user || !factor?.confirmedAt) throw ticketInvalid();

    const code = input.code.trim();
    const isTotp = /^\d{6}$/.test(code);
    const step = isTotp ? await this.checkTotp(factor, code) : null;
    const recoveryCodeId = isTotp ? null : await this.findRecoveryCode(userId, code);

    if (step === null && recoveryCodeId === null) {
      const attempts = await this.challenges.recordFailure(id);
      await this.limiter.hit(RATE_LIMITS.mfaFailuresPerAccount, userId);
      await this.events.record({ type: "mfa.failed", userId, meta });
      if (attempts >= MAX_WRONG_CODES_PER_TICKET) {
        await this.challenges.consume(id, "mfa");
        throw ticketInvalid("Too many wrong codes. Sign in again.");
      }
      throw wrongCode();
    }

    // Use the ticket and the code exactly once, even under concurrent requests.
    if (!(await this.challenges.consume(id, "mfa"))) throw ticketInvalid();
    if (step !== null && !(await this.markStepUsed(userId, step))) throw wrongCode();
    if (recoveryCodeId !== null) {
      const used = await this.database.db
        .update(schema.recoveryCodes)
        .set({ usedAt: new Date() })
        .where(
          and(eq(schema.recoveryCodes.id, recoveryCodeId), isNull(schema.recoveryCodes.usedAt)),
        )
        .returning({ id: schema.recoveryCodes.id });
      if (used.length === 0) throw wrongCode();
    }

    await this.limiter.reset(RATE_LIMITS.mfaFailuresPerAccount, userId);
    await this.sessions.revokeByToken(presentedToken, "replaced");
    const keepSignedIn = challenge.data.keepSignedIn === true;
    const issued = await this.sessions.create(
      userId,
      { persistent: keepSignedIn, method: "password_totp" },
      meta,
    );
    await this.events.record({
      type: "sign_in.succeeded",
      userId,
      sessionId: issued.session.id,
      meta,
      metadata: {
        method: recoveryCodeId ? "password_recovery_code" : "password_totp",
        persistent: keepSignedIn,
      },
    });
    if (recoveryCodeId) {
      const remaining = (await this.status(userId)).recoveryCodesRemaining;
      await this.events.record({
        type: "mfa.recovery_code_used",
        userId,
        sessionId: issued.session.id,
        meta,
        metadata: { remaining },
      });
      this.email.sendRecoveryCodeUsed(user.email, remaining);
    }
    await this.newDevices.recordSignIn(user, meta, issued.session.id);
    return { user, issued };
  }

  private async findRecoveryCode(userId: string, code: string): Promise<string | null> {
    if (normaliseRecoveryCode(code).length !== 10) return null;
    const [row] = await this.database.db
      .select({ id: schema.recoveryCodes.id })
      .from(schema.recoveryCodes)
      .where(
        and(
          eq(schema.recoveryCodes.userId, userId),
          eq(schema.recoveryCodes.codeHash, hashRecoveryCode(code)),
          isNull(schema.recoveryCodes.usedAt),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /** For confirming it's you: a current authenticator code (recovery codes aren't spent on this). */
  async checkCodeForConfirmation(userId: string, code: string | undefined): Promise<void> {
    const factor = await this.factorOf(userId);
    if (!factor?.confirmedAt) return;
    if (!code) {
      throw new ApiException("validation_failed", 400, "Enter your two-factor code.", {
        details: ["code: Enter the 6-digit code from your authenticator app."],
      });
    }
    const step = await this.checkTotp(factor, code.trim());
    if (step === null || !(await this.markStepUsed(userId, step))) throw wrongCode();
  }
}
