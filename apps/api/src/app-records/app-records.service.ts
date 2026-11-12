import {
  type AppRecord,
  type AppRecordApp,
  EXAM_APP,
  EXAM_KEY,
  type ExamRecord,
  examRecordSchema,
  MAX_APP_RECORD_BYTES,
  MAX_APP_RECORDS,
} from "@brawzer/contracts";
import { and, count, type DatabaseHandle, eq, schema } from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import { SECRET_BOX } from "../crypto/crypto.module.js";
import type { SecretBox } from "../crypto/secret-box.js";
import { DATABASE } from "../database/database.module.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";

/** Bound to the account, the app and the key: a record moved anywhere else won't open. */
const contextOf = (userId: string, app: AppRecordApp, key: string) =>
  `app-record:${userId}:${app}:${key}`;

/**
 * The desktop apps' records (Phase 9): any JSON an app keeps, sealed with its
 * own data key, per account. Brawzer never reads inside them except to hand
 * them back to their owner (and in the owner's data export).
 */
@Injectable()
export class AppRecordsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /** The exam running for this account, if any: what Exam Mode allows until when. */
  async currentExam(userId: string): Promise<ExamRecord | null> {
    const [row] = await this.database.db
      .select({ sealed: schema.appRecords.sealed })
      .from(schema.appRecords)
      .where(
        and(
          eq(schema.appRecords.userId, userId),
          eq(schema.appRecords.app, EXAM_APP),
          eq(schema.appRecords.key, EXAM_KEY),
        ),
      )
      .limit(1);
    if (!row) return null;
    const parsed = examRecordSchema.safeParse(
      JSON.parse(await this.box.open(row.sealed, contextOf(userId, EXAM_APP, EXAM_KEY))),
    );
    return parsed.success && parsed.data.endsAt > Date.now() ? parsed.data : null;
  }

  async list(userId: string, app: AppRecordApp): Promise<AppRecord[]> {
    const rows = await this.database.db
      .select({
        key: schema.appRecords.key,
        sealed: schema.appRecords.sealed,
        updatedAt: schema.appRecords.updatedAt,
      })
      .from(schema.appRecords)
      .where(and(eq(schema.appRecords.userId, userId), eq(schema.appRecords.app, app)))
      .orderBy(schema.appRecords.key);
    return Promise.all(
      rows.map(async (row) => ({
        key: row.key,
        data: JSON.parse(
          await this.box.open(row.sealed, contextOf(userId, app, row.key)),
        ) as AppRecord["data"],
        updatedAt: row.updatedAt.toISOString(),
      })),
    );
  }

  async put(userId: string, app: AppRecordApp, key: string, data: unknown): Promise<AppRecord> {
    // Every write seals with the key service: a loop mustn't be able to run it flat out.
    await this.limiter.enforce(RATE_LIMITS.appRecordWritesPerAccount, userId);
    const json = JSON.stringify(data);
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > MAX_APP_RECORD_BYTES) {
      throw new ApiException(
        "payload_too_large",
        413,
        `A record can be up to ${String(MAX_APP_RECORD_BYTES / 1024)} KB.`,
      );
    }
    const [existing] = await this.database.db
      .select({ id: schema.appRecords.id })
      .from(schema.appRecords)
      .where(
        and(
          eq(schema.appRecords.userId, userId),
          eq(schema.appRecords.app, app),
          eq(schema.appRecords.key, key),
        ),
      )
      .limit(1);
    if (!existing) {
      const [row] = await this.database.db
        .select({ records: count() })
        .from(schema.appRecords)
        .where(and(eq(schema.appRecords.userId, userId), eq(schema.appRecords.app, app)));
      if ((row?.records ?? 0) >= MAX_APP_RECORDS) {
        throw new ApiException(
          "limit_reached",
          409,
          `An app can keep up to ${String(MAX_APP_RECORDS)} records. Delete some first.`,
        );
      }
    }
    const sealed = await this.box.seal(json, contextOf(userId, app, key));
    const updatedAt = new Date();
    await this.database.db
      .insert(schema.appRecords)
      .values({ userId, app, key, sealed, bytes, updatedAt })
      .onConflictDoUpdate({
        target: [schema.appRecords.userId, schema.appRecords.app, schema.appRecords.key],
        set: { sealed, bytes, updatedAt },
      });
    return { key, data: data as AppRecord["data"], updatedAt: updatedAt.toISOString() };
  }

  async remove(userId: string, app: AppRecordApp, key: string): Promise<boolean> {
    const removed = await this.database.db
      .delete(schema.appRecords)
      .where(
        and(
          eq(schema.appRecords.userId, userId),
          eq(schema.appRecords.app, app),
          eq(schema.appRecords.key, key),
        ),
      )
      .returning({ id: schema.appRecords.id });
    return removed.length > 0;
  }

  /** Every record, opened, for the account's data export. */
  async forExport(userId: string): Promise<(AppRecord & { app: string })[]> {
    const rows = await this.database.db
      .select()
      .from(schema.appRecords)
      .where(eq(schema.appRecords.userId, userId))
      .orderBy(schema.appRecords.app, schema.appRecords.key);
    return Promise.all(
      rows.map(async (row) => ({
        app: row.app,
        key: row.key,
        data: JSON.parse(
          await this.box.open(row.sealed, contextOf(userId, row.app as AppRecordApp, row.key)),
        ) as AppRecord["data"],
        updatedAt: row.updatedAt.toISOString(),
      })),
    );
  }
}
