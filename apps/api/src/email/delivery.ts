import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { type DatabaseHandle, eq, schema } from "@brawzer/db";
import { z } from "zod";
import { ApiException } from "../common/api-exception.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import { maskEmail } from "./transports.js";

const logger = new Logger("EmailDelivery");

/** A webhook older than this is refused: a captured one can't be replayed later. */
const MAX_AGE_SECONDS = 5 * 60;

/** What Resend's webhooks say, in the part Brawzer reads. */
const resendEventSchema = z.object({
  type: z.string().max(64),
  created_at: z.string().optional(),
  data: z.object({
    email_id: z.string().max(128).optional(),
    to: z.union([z.array(z.string()), z.string()]).optional(),
    bounce: z.object({ type: z.string().optional(), message: z.string().optional() }).optional(),
  }),
});

export type DeliveryProblem = "bounced" | "complained";

/**
 * What the email provider reports back (Resend's webhooks, signed in the
 * Svix way): a hard bounce or a spam complaint stops every further email to
 * that address, and the account's page says so. Signatures are checked
 * against RESEND_WEBHOOK_SECRET; without one, the route refuses.
 */
@Injectable()
export class EmailDeliveryService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.config.email.resendWebhookSecret !== undefined;
  }

  /** Checks the Svix signature headers over the raw body, as Resend sends them. */
  verify(
    rawBody: string,
    headers: {
      id: string | undefined;
      timestamp: string | undefined;
      signature: string | undefined;
    },
  ): void {
    const secret = this.config.email.resendWebhookSecret;
    if (!secret) throw new ApiException("not_found", 404, "Not found.");
    if (!headers.id || !headers.timestamp || !headers.signature) {
      throw new ApiException("unauthorized", 401, "The webhook signature is missing.");
    }
    const timestamp = Number(headers.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > MAX_AGE_SECONDS) {
      throw new ApiException("unauthorized", 401, "The webhook is too old.");
    }
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = createHmac("sha256", key)
      .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
      .digest();
    const offered = headers.signature
      .split(" ")
      .map((part) => part.split(",")[1] ?? "")
      .filter((part) => part !== "")
      .map((part) => Buffer.from(part, "base64"));
    const ok = offered.some(
      (candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected),
    );
    if (!ok) throw new ApiException("unauthorized", 401, "The webhook signature is invalid.");
  }

  /** Applies one event; anything but a bounce or a complaint is noted and ignored. */
  async handle(rawBody: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new ApiException("validation_failed", 400, "The webhook body isn’t JSON.");
    }
    const event = resendEventSchema.safeParse(parsed);
    if (!event.success) return;
    const { type, data } = event.data;
    const addresses = (Array.isArray(data.to) ? data.to : data.to ? [data.to] : [])
      .map((address) => address.trim().toLowerCase())
      .filter((address) => address.includes("@"));
    if (type === "email.bounced") {
      // A soft bounce (a full mailbox) passes on its own; only a hard one stops email.
      if (data.bounce?.type && /soft|transient/i.test(data.bounce.type)) return;
      for (const address of addresses) {
        await this.suppress(address, "bounced", data.bounce?.message ?? data.bounce?.type ?? null);
      }
    } else if (type === "email.complained") {
      for (const address of addresses) await this.suppress(address, "complained", null);
    }
  }

  private async suppress(
    email: string,
    reason: DeliveryProblem,
    detail: string | null,
  ): Promise<void> {
    await this.database.db
      .insert(schema.emailSuppressions)
      .values({ email, reason, detail })
      .onConflictDoUpdate({
        target: schema.emailSuppressions.email,
        set: { reason, detail, createdAt: new Date() },
      });
    logger.warn(`Email to ${maskEmail(email)} stopped: ${reason}`);
  }

  async isSuppressed(email: string): Promise<boolean> {
    return (await this.problemFor(email)) !== null;
  }

  async problemFor(email: string): Promise<DeliveryProblem | null> {
    const [row] = await this.database.db
      .select({ reason: schema.emailSuppressions.reason })
      .from(schema.emailSuppressions)
      .where(eq(schema.emailSuppressions.email, email.trim().toLowerCase()))
      .limit(1);
    return row ? (row.reason === "complained" ? "complained" : "bounced") : null;
  }

  /** The person changed their address: the old one's block no longer applies to the new. */
  async clear(email: string): Promise<void> {
    await this.database.db
      .delete(schema.emailSuppressions)
      .where(eq(schema.emailSuppressions.email, email.trim().toLowerCase()));
  }
}
