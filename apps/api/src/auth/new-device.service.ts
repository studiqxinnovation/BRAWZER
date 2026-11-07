import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { type DatabaseHandle, eq, schema, sql, type User } from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE } from "../database/database.module.js";
import { EmailService } from "../email/email.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { describeUserAgent } from "./user-agent.js";

/** IPv4 /24 or IPv6 /48: people move around within a network, so match the network, not the address. */
export function networkPrefix(ip: string | null): string {
  if (!ip) return "unknown";
  if (isIPv4(ip)) return ip.split(".").slice(0, 3).join(".");
  if (isIPv6(ip)) {
    const [head = "", tail = ""] = ip.split("::");
    const groups = [...head.split(":").filter(Boolean)];
    const tailGroups = tail.split(":").filter(Boolean);
    while (groups.length + tailGroups.length < 8) groups.push("0");
    return [...groups, ...tailGroups].slice(0, 3).join(":");
  }
  return "unknown";
}

export function deviceKey(meta: RequestMeta): string {
  const device = describeUserAgent(meta.userAgent) ?? "unknown";
  return createHash("sha256")
    .update(`${device}|${networkPrefix(meta.ip)}`)
    .digest("hex");
}

/**
 * Notices sign-ins from a browser and network the account hasn't used in
 * the last 90 days, and tells the owner by email and in Shield. An account's
 * very first sign-in is never "new".
 */
@Injectable()
export class NewDeviceService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  async recordSignIn(user: User, meta: RequestMeta, sessionId: string): Promise<boolean> {
    const key = deviceKey(meta);
    const [known] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.knownDevices)
      .where(eq(schema.knownDevices.userId, user.id));
    const inserted = await this.database.db
      .insert(schema.knownDevices)
      .values({ userId: user.id, deviceKey: key })
      .onConflictDoUpdate({
        target: [schema.knownDevices.userId, schema.knownDevices.deviceKey],
        set: { lastSeenAt: new Date() },
      })
      .returning({
        firstSeenAt: schema.knownDevices.firstSeenAt,
        lastSeenAt: schema.knownDevices.lastSeenAt,
      });
    const row = inserted[0];
    const isNew = row !== undefined && row.firstSeenAt.getTime() === row.lastSeenAt.getTime();
    if (!isNew || (known?.count ?? 0) === 0) return false;

    const device = describeUserAgent(meta.userAgent) ?? "an unknown browser";
    await this.events.record({ type: "sign_in.new_device", userId: user.id, sessionId, meta });
    this.email.sendNewDeviceSignIn(user.email, device, meta.ip);
    return true;
  }
}
