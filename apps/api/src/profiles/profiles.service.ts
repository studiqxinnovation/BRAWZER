import { MAX_PROFILES, type Profile, type ProfileColor } from "@brawzer/contracts";
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
import { ApiException } from "../common/api-exception.js";
import { isUniqueViolation } from "../common/database-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE } from "../database/database.module.js";
import { SecurityEventsService } from "../security-events/security-events.js";

const notFound = () => new ApiException("not_found", 404, "That profile doesn’t exist.");

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
  ) {}

  private async lockAccount(tx: DatabaseExecutor, userId: string): Promise<void> {
    await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for("update");
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
        await this.lockAccount(tx, userId);
        const [stats] = await tx
          .select({
            count: sql<number>`count(*)::int`,
            next: sql<number>`coalesce(max(${schema.profiles.position}) + 1, 0)::int`,
          })
          .from(schema.profiles)
          .where(eq(schema.profiles.userId, userId));
        if ((stats?.count ?? 0) >= MAX_PROFILES) {
          throw new ApiException(
            "limit_reached",
            409,
            `You can have up to ${String(MAX_PROFILES)} profiles while Brawzer is in development.`,
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
    input: { name?: string | undefined; color?: ProfileColor | undefined },
  ): Promise<Profile> {
    let row: ProfileRow | undefined;
    try {
      [row] = await this.database.db
        .update(schema.profiles)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.color === undefined ? {} : { color: input.color }),
          updatedAt: new Date(),
        })
        .where(and(eq(schema.profiles.id, id), eq(schema.profiles.userId, userId)))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
    if (!row) throw notFound();
    return toProfile(row);
  }

  /** Deletes a profile. An account always keeps at least one. */
  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const userId = auth.user.id;
    await this.database.db.transaction(async (tx) => {
      await this.lockAccount(tx, userId);
      const rows = await this.rows(tx, userId);
      if (!rows.some((row) => row.id === id)) throw notFound();
      if (rows.length <= 1) {
        throw new ApiException("conflict", 409, "You need at least one profile.");
      }
      await tx
        .delete(schema.profiles)
        .where(and(eq(schema.profiles.id, id), eq(schema.profiles.userId, userId)));
    });
    await this.events.record({
      type: "profile.deleted",
      userId,
      sessionId: auth.session.id,
      meta,
    });
  }

  /** Puts the account's profiles in the given order; `ids` must list every one of them. */
  async reorder(userId: string, ids: readonly string[]): Promise<Profile[]> {
    return this.database.db.transaction(async (tx) => {
      await this.lockAccount(tx, userId);
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
