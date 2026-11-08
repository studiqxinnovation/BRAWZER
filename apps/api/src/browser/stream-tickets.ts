import { createHash, randomBytes } from "node:crypto";
import { STREAM_TICKET_SECONDS } from "@brawzer/contracts";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { ApiException } from "../common/api-exception.js";
import { REDIS } from "../redis/redis.module.js";

const unavailable = () =>
  new ApiException(
    "service_unavailable",
    503,
    "The cloud browser can’t be reached right now. Try again in a moment.",
    { headers: { "Retry-After": "10" } },
  );

const keyOf = (ticket: string) =>
  `stream-ticket:${createHash("sha256").update(ticket).digest("hex")}`;

export interface StreamTicketClaims {
  userId: string;
  authSessionId: string;
  browserSessionId: string;
}

/**
 * Single-use stream tickets: the Browser page gets one with its session
 * cookie, then presents it on the WebSocket, which never sees the cookie. A
 * ticket dies within a minute or on first use, and is bound to the sign-in
 * that asked for it.
 */
@Injectable()
export class StreamTickets {
  constructor(@Inject(REDIS) private readonly redis: Pick<Redis, "set" | "getdel">) {}

  async issue(claims: StreamTicketClaims): Promise<{ ticket: string; expiresAt: Date }> {
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + STREAM_TICKET_SECONDS * 1000);
    try {
      await this.redis.set(keyOf(ticket), JSON.stringify(claims), "EX", STREAM_TICKET_SECONDS);
    } catch {
      throw unavailable();
    }
    return { ticket, expiresAt };
  }

  /** The claims the ticket carries, if it is valid for this browser session. Consumes it. */
  async redeem(ticket: string, browserSessionId: string): Promise<StreamTicketClaims | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
    let value: string | null;
    try {
      value = await this.redis.getdel(keyOf(ticket));
    } catch {
      return null;
    }
    if (!value) return null;
    try {
      const claims = JSON.parse(value) as StreamTicketClaims;
      return claims.browserSessionId === browserSessionId ? claims : null;
    } catch {
      return null;
    }
  }
}
