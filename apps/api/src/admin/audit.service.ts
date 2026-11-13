import type { StaffAction, StaffActionList, StaffRole } from "@brawzer/contracts";
import { and, type DatabaseHandle, desc, eq, ilike, lt, or, schema } from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DATABASE } from "../database/database.module.js";
import type { RequestMeta } from "../common/request-meta.js";

const logger = new Logger("StaffAudit");

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

export interface StaffActor {
  user: { id: string; role: string };
}

export interface StaffActionInput {
  action: string;
  target?: string;
  detail?: string;
  meta: RequestMeta;
}

/**
 * The audit log (Phase 11): every staff action, including pages refused by
 * permissions, with who, their role at the time, what, on what, why, from
 * where and when. Rows are only ever added.
 */
@Injectable()
export class StaffAuditService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async record(actor: StaffActor, input: StaffActionInput): Promise<void> {
    try {
      await this.database.db.insert(schema.staffActions).values({
        actorId: actor.user.id,
        actorRole: actor.user.role,
        action: input.action,
        target: input.target ?? "",
        detail: input.detail ?? "",
        ipAddress: input.meta.ip,
      });
    } catch (error) {
      logger.error(
        `Could not record staff action "${input.action}": ${error instanceof Error ? error.message : ""}`,
      );
    }
  }

  async list(query: {
    q?: string;
    role?: StaffRole;
    before?: string;
    limit: number;
  }): Promise<StaffActionList> {
    const conditions: ReturnType<typeof eq>[] = [];
    if (query.role) conditions.push(eq(schema.staffActions.actorRole, query.role));
    if (query.before) conditions.push(lt(schema.staffActions.id, query.before));
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      const match = or(
        ilike(schema.staffActions.action, like),
        ilike(schema.staffActions.target, like),
        ilike(schema.staffActions.detail, like),
        ilike(schema.users.email, like),
      );
      if (match) conditions.push(match);
    }
    const rows = await this.database.db
      .select({ action: schema.staffActions, email: schema.users.email })
      .from(schema.staffActions)
      .leftJoin(schema.users, eq(schema.users.id, schema.staffActions.actorId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.staffActions.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      actions: page.map((row) => toAction(row.action, row.email)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.action.id ?? null) : null,
    };
  }

  /** The latest actions, for the overview. */
  async recent(limit: number): Promise<StaffAction[]> {
    return (await this.list({ limit })).actions;
  }

  /** Staff actions whose target is this account. */
  async forTarget(target: string, limit = 100): Promise<StaffAction[]> {
    const rows = await this.database.db
      .select({ action: schema.staffActions, email: schema.users.email })
      .from(schema.staffActions)
      .leftJoin(schema.users, eq(schema.users.id, schema.staffActions.actorId))
      .where(eq(schema.staffActions.target, target))
      .orderBy(desc(schema.staffActions.id))
      .limit(limit);
    return rows.map((row) => toAction(row.action, row.email));
  }
}

function toAction(
  row: typeof schema.staffActions.$inferSelect,
  actorEmail: string | null,
): StaffAction {
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    actorId: row.actorId,
    actorEmail,
    actorRole: row.actorRole,
    action: row.action,
    target: row.target,
    detail: row.detail,
    ipAddress: row.ipAddress,
  };
}
