import {
  and,
  type AuthChallenge,
  type AuthChallengePurpose,
  type DatabaseHandle,
  eq,
  gt,
  isNull,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { DATABASE } from "../database/database.module.js";

export interface NewChallenge {
  purpose: AuthChallengePurpose;
  challenge: string;
  userId?: string | null;
  sessionId?: string | null;
  data?: Record<string, string | number | boolean | null>;
  /** Default 5 minutes. */
  ttlSeconds?: number;
}

/**
 * Short-lived, single-use challenges for passkeys, two-factor tickets and
 * phone approvals. Expired rows are removed by the retention job.
 */
@Injectable()
export class ChallengeService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async create(input: NewChallenge): Promise<string> {
    const [row] = await this.database.db
      .insert(schema.authChallenges)
      .values({
        purpose: input.purpose,
        challenge: input.challenge,
        userId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
        data: input.data ?? {},
        expiresAt: new Date(Date.now() + (input.ttlSeconds ?? 300) * 1000),
      })
      .returning({ id: schema.authChallenges.id });
    if (!row) throw new Error("Creating a challenge returned no row");
    return row.id;
  }

  /** Reads a live challenge without using it up. */
  async peek(id: string, purpose: AuthChallengePurpose): Promise<AuthChallenge | null> {
    const [row] = await this.database.db
      .select()
      .from(schema.authChallenges)
      .where(this.live(id, purpose))
      .limit(1);
    return row ?? null;
  }

  /** Atomically uses a challenge up. Null when unknown, expired, already used or for another purpose. */
  async consume(id: string, purpose: AuthChallengePurpose): Promise<AuthChallenge | null> {
    const [row] = await this.database.db
      .update(schema.authChallenges)
      .set({ usedAt: new Date() })
      .where(this.live(id, purpose))
      .returning();
    return row ?? null;
  }

  /** Merges fields into a live challenge's data (phone approvals change state). */
  async updateData(
    id: string,
    purpose: AuthChallengePurpose,
    patch: Record<string, string | number | boolean | null>,
    userId?: string,
  ): Promise<boolean> {
    const [row] = await this.database.db
      .update(schema.authChallenges)
      .set({
        data: sql`${schema.authChallenges.data} || ${JSON.stringify(patch)}::jsonb`,
        ...(userId ? { userId } : {}),
      })
      .where(this.live(id, purpose))
      .returning({ id: schema.authChallenges.id });
    return row !== undefined;
  }

  /** Counts a failed attempt against a live challenge; returns the new count. */
  async recordFailure(id: string): Promise<number> {
    const [row] = await this.database.db
      .update(schema.authChallenges)
      .set({ attempts: sql`${schema.authChallenges.attempts} + 1` })
      .where(eq(schema.authChallenges.id, id))
      .returning({ attempts: schema.authChallenges.attempts });
    return row?.attempts ?? Number.POSITIVE_INFINITY;
  }

  private live(id: string, purpose: AuthChallengePurpose) {
    return and(
      eq(schema.authChallenges.id, id),
      eq(schema.authChallenges.purpose, purpose),
      isNull(schema.authChallenges.usedAt),
      gt(schema.authChallenges.expiresAt, new Date()),
    );
  }
}
