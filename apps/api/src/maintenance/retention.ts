import type { DatabaseHandle } from "@brawzer/db";
import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE, DatabaseModule } from "../database/database.module.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed periods; only the security history's is configurable. */
export const RETENTION = {
  endedSessionDays: 30,
  usedLinkDays: 7,
  unconfirmedAccountDays: 30,
} as const;

/** Session-level advisory lock, so only one API instance runs the job at a time. */
const LOCK_KEY = 0x62_72_7a_72;

export interface RetentionResult {
  securityEvents: number;
  sessions: number;
  emailTokens: number;
  unconfirmedAccounts: number;
}

const logger = new Logger("Retention");

/**
 * Deletes data Brawzer no longer needs: security history past its retention
 * period, sessions and email links that ended long ago, and sign-ups that
 * were never confirmed (possibly someone else's address).
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    // A few minutes after start, then every 6 hours. Timers never keep the process alive.
    const first = setTimeout(() => void this.runSafely(), 5 * 60_000);
    const repeat = setInterval(() => void this.runSafely(), 6 * 60 * 60_000);
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
  }

  private async runSafely(): Promise<void> {
    try {
      const result = await this.run();
      if (result) logger.log(`Removed expired data: ${JSON.stringify(result)}`);
    } catch (error) {
      logger.error(`Retention run failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  /** Runs once. Returns null when another instance is already running it. */
  async run(now = new Date()): Promise<RetentionResult | null> {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const client = await this.database.pool.connect();
    try {
      const lock = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [LOCK_KEY],
      );
      if (!lock.rows[0]?.locked) return null;
      try {
        const events = await client.query("delete from security_events where occurred_at < $1", [
          before(this.config.securityHistoryRetentionDays),
        ]);
        const sessions = await client.query(
          `delete from auth_sessions
           where expires_at < $1 or (revoked_at is not null and revoked_at < $1)`,
          [before(RETENTION.endedSessionDays)],
        );
        const tokens = await client.query(
          `delete from email_tokens
           where expires_at < $1 or (used_at is not null and used_at < $1)`,
          [before(RETENTION.usedLinkDays)],
        );
        const accounts = await client.query(
          `delete from users u
           where u.email_verified_at is null and u.created_at < $1
             and not exists (
               select 1 from email_tokens t
               where t.user_id = u.id and t.used_at is null and t.expires_at > $2
             )`,
          [before(RETENTION.unconfirmedAccountDays), now],
        );
        return {
          securityEvents: events.rowCount ?? 0,
          sessions: sessions.rowCount ?? 0,
          emailTokens: tokens.rowCount ?? 0,
          unconfirmedAccounts: accounts.rowCount ?? 0,
        };
      } finally {
        await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  }
}

@Module({
  imports: [DatabaseModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class MaintenanceModule {}
