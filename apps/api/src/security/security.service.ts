import type {
  Recommendation,
  SecurityEvent,
  SecurityEventPage,
  SecurityOverview,
} from "@brawzer/contracts";
import { and, type DatabaseHandle, desc, eq, gt, inArray, lt, schema, sql } from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { MfaService } from "../auth/mfa/mfa.service.js";
import { PasskeyService } from "../auth/passkeys/passkey.service.js";
import { type AuthContext, SessionService } from "../auth/session.service.js";
import { describeUserAgent } from "../auth/user-agent.js";
import { DATABASE } from "../database/database.module.js";

/** Only these metadata keys ever leave the API. */
function detailsOf(metadata: Record<string, string | number | boolean>): SecurityEvent["details"] {
  const details: SecurityEvent["details"] = {};
  if (typeof metadata.method === "string") details.method = metadata.method;
  if (typeof metadata.persistent === "boolean") details.persistent = metadata.persistent;
  if (typeof metadata.reason === "string") details.reason = metadata.reason;
  if (typeof metadata.count === "number") details.count = metadata.count;
  if (typeof metadata.chars === "number") details.chars = metadata.chars;
  if (typeof metadata.kind === "string") details.kind = metadata.kind;
  if (typeof metadata.plan === "string") details.plan = metadata.plan;
  if (typeof metadata.picture === "boolean") details.picture = metadata.picture;
  if (typeof metadata.team === "string") details.team = metadata.team;
  if (typeof metadata.role === "string") details.role = metadata.role;
  return details;
}

/** Reads the account's security history, newest first. */
@Injectable()
export class SecurityHistoryService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(PasskeyService) private readonly passkeys: PasskeyService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  private toEvent(row: typeof schema.securityEvents.$inferSelect): SecurityEvent {
    return {
      id: row.id,
      type: row.type,
      occurredAt: row.occurredAt.toISOString(),
      device: describeUserAgent(row.userAgent),
      ipAddress: row.ipAddress,
      details: detailsOf(row.metadata),
    };
  }

  /** The whole history, newest first (for "download your data"). */
  async all(userId: string): Promise<SecurityEvent[]> {
    const rows = await this.database.db
      .select()
      .from(schema.securityEvents)
      .where(eq(schema.securityEvents.userId, userId))
      .orderBy(desc(schema.securityEvents.id));
    return rows.map((row) => this.toEvent(row));
  }

  /** Shield's overview: how the account is protected, and what would protect it better. */
  async overview(auth: AuthContext): Promise<SecurityOverview> {
    const userId = auth.user.id;
    const [passkeys, mfa, devices] = await Promise.all([
      this.passkeys.list(userId),
      this.mfa.status(userId),
      this.sessions.listActive(auth),
    ]);
    const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const month = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [failed] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.securityEvents)
      .where(
        and(
          eq(schema.securityEvents.userId, userId),
          inArray(schema.securityEvents.type, ["sign_in.failed", "mfa.failed"]),
          gt(schema.securityEvents.occurredAt, week),
        ),
      );
    const newDevices = await this.database.db
      .select()
      .from(schema.securityEvents)
      .where(
        and(
          eq(schema.securityEvents.userId, userId),
          eq(schema.securityEvents.type, "sign_in.new_device"),
          gt(schema.securityEvents.occurredAt, month),
        ),
      )
      .orderBy(desc(schema.securityEvents.id))
      .limit(5);

    const recommendations: Recommendation[] = [];
    if (passkeys.length === 0) recommendations.push({ id: "add_passkey" });
    if (!mfa.totpEnabled && passkeys.length === 0)
      recommendations.push({ id: "enable_two_factor" });
    if (mfa.totpEnabled && mfa.recoveryCodesRemaining <= 3)
      recommendations.push({ id: "recovery_codes_low" });
    if (devices.length > 3) recommendations.push({ id: "review_devices" });

    return {
      passkeys: passkeys.length,
      twoFactorEnabled: mfa.totpEnabled,
      recoveryCodesRemaining: mfa.recoveryCodesRemaining,
      signedInDevices: devices.length,
      recentFailedAttempts: failed?.count ?? 0,
      recommendations,
      newDeviceSignIns: newDevices.map((row) => this.toEvent(row)),
    };
  }

  async page(
    userId: string,
    query: { before?: string; limit: number },
  ): Promise<SecurityEventPage> {
    // Event IDs are UUIDv7, which sort by creation time: the ID is the cursor.
    const rows = await this.database.db
      .select()
      .from(schema.securityEvents)
      .where(
        and(
          eq(schema.securityEvents.userId, userId),
          query.before ? lt(schema.securityEvents.id, query.before) : undefined,
        ),
      )
      .orderBy(desc(schema.securityEvents.id))
      .limit(query.limit + 1);

    const events = rows.slice(0, query.limit).map((row) => this.toEvent(row));
    return {
      events,
      nextCursor: rows.length > query.limit ? (events.at(-1)?.id ?? null) : null,
    };
  }
}
