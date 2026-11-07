import { createHash, randomBytes } from "node:crypto";
import { DOWNLOAD_TICKET_SECONDS } from "@brawzer/contracts";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { ApiException } from "../common/api-exception.js";
import { REDIS } from "../redis/redis.module.js";

const unavailable = () =>
  new ApiException(
    "service_unavailable",
    503,
    "Saving files isn’t available right now. Try again in a moment.",
    { headers: { "Retry-After": "10" } },
  );

/** Tickets are stored by hash, so Redis never holds something that can be redeemed. */
const keyOf = (ticket: string) =>
  `drive-ticket:${createHash("sha256").update(ticket).digest("hex")}`;

/**
 * Single-use download tickets (ADR 0011): a copied content link dies within
 * a minute, and download managers never see the session cookie.
 */
@Injectable()
export class DownloadTickets {
  constructor(@Inject(REDIS) private readonly redis: Pick<Redis, "set" | "getdel">) {}

  async issue(userId: string, fileId: string): Promise<{ ticket: string; expiresAt: Date }> {
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + DOWNLOAD_TICKET_SECONDS * 1000);
    try {
      await this.redis.set(keyOf(ticket), `${userId}:${fileId}`, "EX", DOWNLOAD_TICKET_SECONDS);
    } catch {
      throw unavailable();
    }
    return { ticket, expiresAt };
  }

  /** The account the ticket was issued to, if it is valid for this file. Consumes it. */
  async redeem(ticket: string, fileId: string): Promise<string | null> {
    let value: string | null;
    try {
      value = await this.redis.getdel(keyOf(ticket));
    } catch {
      throw unavailable();
    }
    if (!value) return null;
    const separator = value.indexOf(":");
    const userId = value.slice(0, separator);
    return separator > 0 && value.slice(separator + 1) === fileId ? userId : null;
  }
}
