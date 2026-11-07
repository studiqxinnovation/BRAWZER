import type { SecurityEvent, SecurityEventPage } from "@brawzer/contracts";
import { and, type DatabaseHandle, desc, eq, lt, schema } from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { describeUserAgent } from "../auth/user-agent.js";
import { DATABASE } from "../database/database.module.js";

/** Only these metadata keys ever leave the API. */
function detailsOf(metadata: Record<string, string | number | boolean>): SecurityEvent["details"] {
  const details: SecurityEvent["details"] = {};
  if (typeof metadata.method === "string") details.method = metadata.method;
  if (typeof metadata.persistent === "boolean") details.persistent = metadata.persistent;
  if (typeof metadata.reason === "string") details.reason = metadata.reason;
  if (typeof metadata.count === "number") details.count = metadata.count;
  return details;
}

/** Reads the account's security history, newest first. */
@Injectable()
export class SecurityHistoryService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

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

    const events = rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      type: row.type,
      occurredAt: row.occurredAt.toISOString(),
      device: describeUserAgent(row.userAgent),
      ipAddress: row.ipAddress,
      details: detailsOf(row.metadata),
    }));
    return {
      events,
      nextCursor: rows.length > query.limit ? (events.at(-1)?.id ?? null) : null,
    };
  }
}
