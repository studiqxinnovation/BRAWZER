import { randomBytes } from "node:crypto";
import type { Passkey } from "@brawzer/contracts";
import {
  and,
  type DatabaseHandle,
  desc,
  eq,
  schema,
  type User,
  type WebauthnCredential,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { ApiException } from "../../common/api-exception.js";
import type { RequestMeta } from "../../common/request-meta.js";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/env.js";
import { DATABASE } from "../../database/database.module.js";
import { EmailService } from "../../email/email.js";
import { RATE_LIMITS, RateLimiter } from "../../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../../security-events/security-events.js";
import type { SignedIn } from "../auth.service.js";
import { ChallengeService } from "../challenges.js";
import { type AuthContext, SessionService } from "../session.service.js";
import { describeUserAgent } from "../user-agent.js";

export interface PasskeyOptions {
  challengeId: string;
  options: Record<string, unknown>;
}

/** Sign-in failures are 401s; failures while signed in are 400s, so pages don't think the session ended. */
const signInFailed = () =>
  new ApiException("invalid_credentials", 401, "That passkey couldn’t be verified. Try again.");
const checkFailed = () =>
  new ApiException("bad_request", 400, "That passkey couldn’t be verified. Try again.");

const ipOf = (meta: RequestMeta) => meta.ip ?? "unknown";

function toPasskey(row: WebauthnCredential): Passkey {
  return {
    id: row.id,
    name: row.name,
    synced: row.deviceType === "multiDevice",
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** A label for a new passkey when the owner doesn't give one: "Passkey on Chrome on macOS". */
function defaultName(meta: RequestMeta): string {
  const device = describeUserAgent(meta.userAgent);
  return device ? `Passkey on ${device}` : "Passkey";
}

/**
 * Passkeys (WebAuthn): adding them, signing in with them, and using them to
 * confirm it's you. Only public keys are stored. User verification (Face ID,
 * fingerprint, PIN) is always required.
 */
@Injectable()
export class PasskeyService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ChallengeService) private readonly challenges: ChallengeService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  private get expected() {
    const { rpId, origins } = this.config.webauthn;
    return { expectedRPID: rpId, expectedOrigin: [...origins] };
  }

  private async credentialsOf(userId: string): Promise<WebauthnCredential[]> {
    return this.database.db
      .select()
      .from(schema.webauthnCredentials)
      .where(eq(schema.webauthnCredentials.userId, userId))
      .orderBy(desc(schema.webauthnCredentials.createdAt));
  }

  async list(userId: string): Promise<Passkey[]> {
    return (await this.credentialsOf(userId)).map(toPasskey);
  }

  /** The user's random WebAuthn handle, created on first use. */
  private async userHandle(user: User): Promise<string> {
    if (user.webauthnUserId) return user.webauthnUserId;
    const handle = randomBytes(32).toString("base64url");
    await this.database.db
      .update(schema.users)
      .set({ webauthnUserId: handle })
      .where(eq(schema.users.id, user.id));
    return handle;
  }

  async registrationOptions(auth: AuthContext): Promise<PasskeyOptions> {
    const { user, session } = auth;
    const existing = await this.credentialsOf(user.id);
    const options = await generateRegistrationOptions({
      rpName: this.config.webauthn.rpName,
      rpID: this.config.webauthn.rpId,
      userName: user.email,
      userDisplayName: user.email,
      userID: Buffer.from(await this.userHandle(user), "base64url"),
      attestationType: "none",
      excludeCredentials: existing.map((row) => ({
        id: row.credentialId,
        transports: row.transports,
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
        // On a shared computer, never store a passkey on the computer itself.
        ...(session.persistent ? {} : { authenticatorAttachment: "cross-platform" as const }),
      },
    });
    const challengeId = await this.challenges.create({
      purpose: "passkey_registration",
      challenge: options.challenge,
      userId: user.id,
      sessionId: session.id,
    });
    return { challengeId, options: { ...options } };
  }

  async register(
    auth: AuthContext,
    input: { challengeId: string; name?: string | undefined; response: Record<string, unknown> },
    meta: RequestMeta,
  ): Promise<Passkey> {
    const { user, session } = auth;
    const challenge = await this.challenges.consume(input.challengeId, "passkey_registration");
    if (challenge?.userId !== user.id || challenge.sessionId !== session.id) throw checkFailed();

    const response = input.response as unknown as RegistrationResponseJSON;
    if (!session.persistent && response.authenticatorAttachment === "platform") {
      throw new ApiException(
        "bad_request",
        400,
        "On a shared computer, add a passkey on your phone or a security key, not on the computer itself.",
      );
    }

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        ...this.expected,
        requireUserVerification: true,
      });
    } catch {
      throw checkFailed();
    }
    if (!verification.verified) throw checkFailed();

    const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
      verification.registrationInfo;
    const name = input.name ?? defaultName(meta);
    const [row] = await this.database.db
      .insert(schema.webauthnCredentials)
      .values({
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        aaguid,
        name,
      })
      .onConflictDoNothing({ target: schema.webauthnCredentials.credentialId })
      .returning();
    if (!row) throw new ApiException("conflict", 409, "This passkey is already saved.");

    await this.events.record({
      type: "passkey.added",
      userId: user.id,
      sessionId: session.id,
      meta,
      metadata: { synced: credentialDeviceType === "multiDevice" },
    });
    this.email.sendPasskeyAdded(user.email, name, describeUserAgent(meta.userAgent));
    return toPasskey(row);
  }

  /** Options for signing in with any passkey for this site (the browser shows which ones exist). */
  async signInOptions(meta: RequestMeta): Promise<PasskeyOptions> {
    await this.limiter.enforce(RATE_LIMITS.passkeyAttemptsPerIp, ipOf(meta));
    const options = await generateAuthenticationOptions({
      rpID: this.config.webauthn.rpId,
      userVerification: "required",
    });
    const challengeId = await this.challenges.create({
      purpose: "passkey_authentication",
      challenge: options.challenge,
    });
    return { challengeId, options: { ...options } };
  }

  async signIn(
    input: { challengeId: string; keepSignedIn: boolean; response: Record<string, unknown> },
    meta: RequestMeta,
    presentedToken: string | undefined,
  ): Promise<SignedIn> {
    await this.limiter.enforce(RATE_LIMITS.passkeyAttemptsPerIp, ipOf(meta));
    const challenge = await this.challenges.consume(input.challengeId, "passkey_authentication");
    // A challenge issued for confirming identity can't be used to sign in.
    if (challenge?.userId !== null) throw signInFailed();
    const user = await this.verifyAssertion(challenge.challenge, input.response, null).catch(() => {
      throw signInFailed();
    });
    if (!user.emailVerifiedAt) throw signInFailed();

    await this.sessions.revokeByToken(presentedToken, "replaced");
    const issued = await this.sessions.create(
      user.id,
      { persistent: input.keepSignedIn, method: "passkey" },
      meta,
    );
    await this.events.record({
      type: "sign_in.succeeded",
      userId: user.id,
      sessionId: issued.session.id,
      meta,
      metadata: { method: "passkey", persistent: input.keepSignedIn },
    });
    return { user, issued };
  }

  /** Options for confirming it's you with one of this account's passkeys. */
  async confirmationOptions(auth: AuthContext): Promise<PasskeyOptions> {
    const existing = await this.credentialsOf(auth.user.id);
    if (existing.length === 0) {
      throw new ApiException(
        "bad_request",
        400,
        "You don’t have a passkey yet. Use your password.",
      );
    }
    const options = await generateAuthenticationOptions({
      rpID: this.config.webauthn.rpId,
      userVerification: "required",
      allowCredentials: existing.map((row) => ({
        id: row.credentialId,
        transports: row.transports as never,
      })),
    });
    const challengeId = await this.challenges.create({
      purpose: "passkey_authentication",
      challenge: options.challenge,
      userId: auth.user.id,
      sessionId: auth.session.id,
    });
    return { challengeId, options: { ...options } };
  }

  async confirm(
    auth: AuthContext,
    input: { challengeId: string; response: Record<string, unknown> },
    meta: RequestMeta,
  ): Promise<Date> {
    const challenge = await this.challenges.consume(input.challengeId, "passkey_authentication");
    if (challenge?.userId !== auth.user.id || challenge.sessionId !== auth.session.id) {
      throw checkFailed();
    }
    await this.verifyAssertion(challenge.challenge, input.response, auth.user.id).catch(() => {
      throw checkFailed();
    });
    const at = await this.sessions.confirmIdentity(auth.session.id);
    await this.events.record({
      type: "reauthenticated",
      userId: auth.user.id,
      sessionId: auth.session.id,
      meta,
      metadata: { method: "passkey" },
    });
    return at;
  }

  /**
   * Verifies a passkey assertion against the stored public key and updates
   * the signature counter. Throws if the passkey is unknown, belongs to
   * someone else (when `expectedUserId` is given) or fails verification.
   */
  private async verifyAssertion(
    expectedChallenge: string,
    responseJson: Record<string, unknown>,
    expectedUserId: string | null,
  ): Promise<User> {
    const response = responseJson as unknown as AuthenticationResponseJSON;
    if (typeof response.id !== "string") throw new Error("No credential ID");
    const [row] = await this.database.db
      .select({ credential: schema.webauthnCredentials, user: schema.users })
      .from(schema.webauthnCredentials)
      .innerJoin(schema.users, eq(schema.users.id, schema.webauthnCredentials.userId))
      .where(eq(schema.webauthnCredentials.credentialId, response.id))
      .limit(1);
    if (!row || (expectedUserId !== null && row.user.id !== expectedUserId)) {
      throw new Error("Unknown passkey");
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      ...this.expected,
      credential: {
        id: row.credential.credentialId,
        publicKey: Buffer.from(row.credential.publicKey, "base64url"),
        counter: row.credential.counter,
        transports: row.credential.transports,
      },
      requireUserVerification: true,
    });
    if (!verification.verified) throw new Error("Not verified");

    const info = verification.authenticationInfo;
    await this.database.db
      .update(schema.webauthnCredentials)
      .set({
        counter: info.newCounter,
        backedUp: info.credentialBackedUp,
        deviceType: info.credentialDeviceType,
        lastUsedAt: new Date(),
      })
      .where(eq(schema.webauthnCredentials.id, row.credential.id));
    return row.user;
  }

  async rename(userId: string, id: string, name: string): Promise<Passkey> {
    const [row] = await this.database.db
      .update(schema.webauthnCredentials)
      .set({ name })
      .where(
        and(eq(schema.webauthnCredentials.id, id), eq(schema.webauthnCredentials.userId, userId)),
      )
      .returning();
    if (!row) throw new ApiException("not_found", 404, "That passkey doesn’t exist.");
    return toPasskey(row);
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const [row] = await this.database.db
      .delete(schema.webauthnCredentials)
      .where(
        and(
          eq(schema.webauthnCredentials.id, id),
          eq(schema.webauthnCredentials.userId, auth.user.id),
        ),
      )
      .returning();
    if (!row) throw new ApiException("not_found", 404, "That passkey doesn’t exist.");
    await this.events.record({
      type: "passkey.removed",
      userId: auth.user.id,
      sessionId: auth.session.id,
      meta,
    });
    this.email.sendPasskeyRemoved(auth.user.email, row.name);
  }
}
