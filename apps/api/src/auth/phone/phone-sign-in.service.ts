import { randomInt, timingSafeEqual } from "node:crypto";
import {
  PHONE_SIGN_IN_SECONDS,
  type PhoneApproval,
  type PhoneSignInStart,
  type PhoneSignInState,
} from "@brawzer/contracts";
import { type AuthChallenge, type DatabaseHandle, eq, schema, type User } from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import QRCode from "qrcode";
import { ApiException } from "../../common/api-exception.js";
import type { RequestMeta } from "../../common/request-meta.js";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/env.js";
import { DATABASE } from "../../database/database.module.js";
import { EmailService } from "../../email/email.js";
import { RATE_LIMITS, RateLimiter } from "../../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../../security-events/security-events.js";
import { ChallengeService } from "../challenges.js";
import { NewDeviceService } from "../new-device.service.js";
import { type IssuedSession, SessionService } from "../session.service.js";
import { generateToken, hashToken } from "../tokens.js";
import { describeUserAgent } from "../user-agent.js";

const PURPOSE = "phone_approval" as const;
/** Wrong numbers before the request is refused for good. */
const MAX_WRONG_CODES = 3;

const gone = () =>
  new ApiException(
    "not_found",
    404,
    "This sign-in request has expired. Start again on the computer.",
  );

const ipOf = (meta: RequestMeta) => meta.ip ?? "unknown";

function sameSecret(presented: string, hash: string): boolean {
  const a = Buffer.from(hashToken(presented));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A two-digit number, 10 to 99. */
const twoDigits = () => String(randomInt(10, 100));

interface ApprovalData {
  pollHash: string;
  code: string;
  codes: string;
  device: string | null;
  ip: string | null;
  state: PhoneSignInState;
  approvedBy: string | null;
}

function dataOf(row: AuthChallenge): ApprovalData {
  const data = row.data as Partial<Record<keyof ApprovalData, string | null>>;
  return {
    pollHash: data.pollHash ?? "",
    code: data.code ?? "",
    codes: data.codes ?? "",
    device: data.device ?? null,
    ip: data.ip ?? null,
    state: (data.state as PhoneSignInState | undefined) ?? "pending",
    approvedBy: data.approvedBy ?? null,
  };
}

/**
 * Sign in with your phone (milestone 2.7, ADR 0009): a computer without
 * Bluetooth shows a QR code and a two-digit number; the signed-in phone
 * scans it, sees where the request came from, picks the matching number
 * and confirms it's its owner; the computer gets a shared-computer session.
 * The computer holds a poll token, the phone the key from the QR code;
 * neither alone gets anyone in. Everything expires in two minutes and works
 * once.
 */
@Injectable()
export class PhoneSignInService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ChallengeService) private readonly challenges: ChallengeService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(NewDeviceService) private readonly newDevices: NewDeviceService,
  ) {}

  /** The computer's side: a fresh request. */
  async start(meta: RequestMeta): Promise<PhoneSignInStart> {
    await this.limiter.enforce(RATE_LIMITS.phoneStartsPerIp, ipOf(meta));
    const pollToken = generateToken();
    const key = generateToken();
    const code = twoDigits();
    const decoys = new Set<string>();
    while (decoys.size < 2) {
      const decoy = twoDigits();
      if (decoy !== code) decoys.add(decoy);
    }
    // A fixed, shuffled order so the phone can't tell which one is real.
    const codes = [code, ...decoys].sort(() => randomInt(0, 2) - 0.5);
    const data: ApprovalData = {
      pollHash: hashToken(pollToken),
      code,
      codes: codes.join(","),
      device: describeUserAgent(meta.userAgent),
      ip: meta.ip,
      state: "pending",
      approvedBy: null,
    };
    const requestId = await this.challenges.create({
      purpose: PURPOSE,
      challenge: hashToken(key),
      data: { ...data },
      ttlSeconds: PHONE_SIGN_IN_SECONDS,
    });
    const approvalUrl = `${this.config.webOrigin}/app/approve-sign-in?r=${requestId}&k=${key}`;
    const qrSvg = await QRCode.toString(approvalUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
    });
    return {
      requestId,
      pollToken,
      code,
      expiresAt: new Date(Date.now() + PHONE_SIGN_IN_SECONDS * 1000).toISOString(),
      qrSvg,
      approvalUrl,
    };
  }

  /** The computer asks whether the phone has answered; approval signs it in, once. */
  async poll(
    requestId: string,
    pollToken: string,
    meta: RequestMeta,
    presentedToken: string | undefined,
  ): Promise<
    | { state: "pending" | "denied" | "expired" }
    | { state: "approved"; user: User; issued: IssuedSession }
  > {
    await this.limiter.enforce(RATE_LIMITS.phonePollsPerIp, ipOf(meta));
    const row = await this.challenges.peek(requestId, PURPOSE);
    if (!row) return { state: "expired" };
    const data = dataOf(row);
    if (!sameSecret(pollToken, data.pollHash)) return { state: "expired" };
    if (data.state === "pending") return { state: "pending" };
    if (data.state !== "approved" || !data.approvedBy) return { state: "denied" };

    // Single use: whoever consumes the challenge gets the one session.
    const consumed = await this.challenges.consume(requestId, PURPOSE);
    if (!consumed) return { state: "expired" };
    const [user] = await this.database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, data.approvedBy))
      .limit(1);
    if (!user) return { state: "expired" };
    await this.sessions.revokeByToken(presentedToken, "replaced");
    const issued = await this.sessions.create(
      user.id,
      { persistent: false, method: "phone" },
      meta,
    );
    await this.events.record({
      type: "sign_in.succeeded",
      userId: user.id,
      sessionId: issued.session.id,
      meta,
      metadata: { method: "phone", persistent: false },
    });
    await this.newDevices.recordSignIn(user, meta, issued.session.id);
    return { state: "approved", user, issued };
  }

  /** The phone's side: what it is about to approve. */
  async describe(requestId: string, key: string): Promise<PhoneApproval> {
    const row = await this.challenges.peek(requestId, PURPOSE);
    if (!row || !sameSecret(key, row.challenge)) throw gone();
    const data = dataOf(row);
    return {
      requestId,
      state: data.state,
      device: data.device,
      ipAddress: data.ip,
      expiresAt: row.expiresAt.toISOString(),
      codes: data.codes.split(","),
    };
  }

  /** The phone approves with the number the computer shows. Three wrong numbers refuse the request. */
  async approve(
    auth: { user: User; session: { id: string } },
    requestId: string,
    key: string,
    code: string,
    meta: RequestMeta,
  ): Promise<PhoneApproval> {
    await this.limiter.enforce(RATE_LIMITS.phoneApprovalsPerAccount, auth.user.id);
    const row = await this.challenges.peek(requestId, PURPOSE);
    if (!row || !sameSecret(key, row.challenge)) throw gone();
    const data = dataOf(row);
    if (data.state !== "pending") {
      throw new ApiException("conflict", 409, "This sign-in request was already answered.");
    }
    if (code !== data.code) {
      const attempts = await this.challenges.recordFailure(requestId);
      if (attempts >= MAX_WRONG_CODES) {
        await this.challenges.updateData(requestId, PURPOSE, { state: "denied" });
        throw new ApiException(
          "forbidden",
          403,
          "That isn’t the number on the computer. The request has been refused; start again there.",
        );
      }
      throw new ApiException("validation_failed", 400, "That isn’t the number on the computer.", {
        details: ["code: Pick the number the computer shows."],
      });
    }
    const updated = await this.challenges.updateData(
      requestId,
      PURPOSE,
      { state: "approved", approvedBy: auth.user.id },
      auth.user.id,
    );
    if (!updated) throw gone();
    await this.events.record({
      type: "phone_sign_in.approved",
      userId: auth.user.id,
      sessionId: auth.session.id,
      meta,
      metadata: data.device ? { method: data.device } : {},
    });
    this.email.sendPhoneSignIn(auth.user.email, data.device, data.ip);
    return this.describe(requestId, key);
  }

  /** "This wasn't me." */
  async deny(requestId: string, key: string): Promise<PhoneApproval> {
    const row = await this.challenges.peek(requestId, PURPOSE);
    if (!row || !sameSecret(key, row.challenge)) throw gone();
    await this.challenges.updateData(requestId, PURPOSE, { state: "denied" });
    return this.describe(requestId, key);
  }
}
