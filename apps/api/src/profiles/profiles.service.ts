import { type Profile, type ProfileColor } from "@brawzer/contracts";
import {
  and,
  asc,
  type DatabaseExecutor,
  type DatabaseHandle,
  eq,
  type ProfileRow,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import type { AuthContext } from "../auth/session.service.js";
import { lockAccount } from "../common/account-lock.js";
import { ApiException } from "../common/api-exception.js";
import { isForeignKeyViolation, isUniqueViolation } from "../common/database-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE } from "../database/database.module.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { BillingService } from "../billing/billing.service.js";
import { ProfileDataService } from "./profile-data.service.js";

const notFound = () => new ApiException("not_found", 404, "That profile doesn’t exist.");

const proxyMissing = () =>
  new ApiException("validation_failed", 400, "Choose one of your proxies.", {
    details: ["proxyId: That proxy doesn’t exist any more. Choose another."],
  });

const nameTaken = () =>
  new ApiException("conflict", 409, "You already have a profile with that name.", {
    details: ["name: You already have a profile with that name."],
  });

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    engine: row.engine,
    position: row.position,
    proxyId: row.proxyId,
    keepData: row.keepData,
    data:
      row.dataObjectKey && row.dataSavedAt
        ? { bytes: row.dataBytes ?? 0, savedAt: row.dataSavedAt.toISOString() }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The account's browser profiles. Changes that depend on how many profiles
 * there are lock the account row first, so two requests at once can't both
 * pass the limit or both delete "the last but one".
 */
@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(ProfileDataService) private readonly data: ProfileDataService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /** The row, for the cloud browser: which data to restore and whether to save it. */
  async find(userId: string, id: string): Promise<ProfileRow | undefined> {
    const [row] = await this.database.db
      .select()
      .from(schema.profiles)
      .where(and(eq(schema.profiles.id, id), eq(schema.profiles.userId, userId)))
      .limit(1);
    return row;
  }

  private rows(executor: DatabaseExecutor, userId: string): Promise<ProfileRow[]> {
    return executor
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, userId))
      .orderBy(asc(schema.profiles.position), asc(schema.profiles.createdAt));
  }

  async list(userId: string): Promise<Profile[]> {
    return (await this.rows(this.database.db, userId)).map(toProfile);
  }

  async create(
    auth: AuthContext,
    input: { name: string; color: ProfileColor; engine: "chromium" },
    meta: RequestMeta,
  ): Promise<Profile> {
    const userId = auth.user.id;
    let created: ProfileRow;
    try {
      created = await this.database.db.transaction(async (tx) => {
        await lockAccount(tx, userId);
        const [stats] = await tx
          .select({
            count: sql<number>`count(*)::int`,
            next: sql<number>`coalesce(max(${schema.profiles.position}) + 1, 0)::int`,
          })
          .from(schema.profiles)
          .where(eq(schema.profiles.userId, userId));
        const limit = (await this.billing.limitsFor(userId)).profiles;
        if ((stats?.count ?? 0) >= limit) {
          throw new ApiException(
            "limit_reached",
            409,
            `Your plan allows ${String(limit)} profiles. Delete one, or move to a plan with more.`,
          );
        }
        const [row] = await tx
          .insert(schema.profiles)
          .values({ userId, ...input, position: stats?.next ?? 0 })
          .returning();
        if (!row) throw new Error("Profile insert returned nothing");
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
    await this.events.record({
      type: "profile.created",
      userId,
      sessionId: auth.session.id,
      meta,
    });
    return toProfile(created);
  }

  async update(
    userId: string,
    id: string,
    input: {
      name?: string | undefined;
      color?: ProfileColor | undefined;
      proxyId?: string | null | undefined;
      keepData?: boolean | undefined;
    },
  ): Promise<Profile> {
    if (input.proxyId) {
      // Only the account's own proxies can be assigned.
      const [proxy] = await this.database.db
        .select({ id: schema.proxies.id })
        .from(schema.proxies)
        .where(and(eq(schema.proxies.id, input.proxyId), eq(schema.proxies.userId, userId)))
        .limit(1);
      if (!proxy) throw proxyMissing();
    }
    let row: ProfileRow | undefined;
    try {
      [row] = await this.database.db
        .update(schema.profiles)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.color === undefined ? {} : { color: input.color }),
          ...(input.proxyId === undefined ? {} : { proxyId: input.proxyId }),
          ...(input.keepData === undefined ? {} : { keepData: input.keepData }),
          updatedAt: new Date(),
        })
        .where(and(eq(schema.profiles.id, id), eq(schema.profiles.userId, userId)))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      // The proxy was deleted in the meantime.
      if (isForeignKeyViolation(error)) throw proxyMissing();
      throw error;
    }
    if (!row) throw notFound();
    return toProfile(row);
  }

  /** Deletes a profile and its saved browsing data. An account always keeps at least one. */
  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const userId = auth.user.id;
    const removed = await this.database.db.transaction(async (tx) => {
      await lockAccount(tx, userId);
      const rows = await this.rows(tx, userId);
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw notFound();
      if (rows.length <= 1) {
        throw new ApiException("conflict", 409, "You need at least one profile.");
      }
      await tx
        .delete(schema.profiles)
        .where(and(eq(schema.profiles.id, id), eq(schema.profiles.userId, userId)));
      return row;
    });
    if (removed.dataObjectKey) await this.data.removeObjects([removed.dataObjectKey]);
    await this.events.record({
      type: "profile.deleted",
      userId,
      sessionId: auth.session.id,
      meta,
    });
  }

  /** Forgets the profile's cookies, history and site data. */
  async clearData(auth: AuthContext, id: string, meta: RequestMeta): Promise<Profile> {
    const row = await this.find(auth.user.id, id);
    if (!row) throw notFound();
    await this.data.clear(row);
    await this.events.record({
      type: "profile.data_cleared",
      userId: auth.user.id,
      sessionId: auth.session.id,
      meta,
    });
    const after = await this.find(auth.user.id, id);
    if (!after) throw notFound();
    return toProfile(after);
  }

  /** Puts the account's profiles in the given order; `ids` must list every one of them. */
  async reorder(userId: string, ids: readonly string[]): Promise<Profile[]> {
    return this.database.db.transaction(async (tx) => {
      await lockAccount(tx, userId);
      const rows = await this.rows(tx, userId);
      const current = new Set(rows.map((row) => row.id));
      if (ids.length !== current.size || !ids.every((id) => current.has(id))) {
        throw new ApiException(
          "conflict",
          409,
          "Your profiles changed in the meantime. Reload the page and try again.",
        );
      }
      for (const [position, id] of ids.entries()) {
        await tx
          .update(schema.profiles)
          .set({ position })
          .where(and(eq(schema.profiles.id, id), eq(schema.profiles.userId, userId)));
      }
      return (await this.rows(tx, userId)).map(toProfile);
    });
  }
}
