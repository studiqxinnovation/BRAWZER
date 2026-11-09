import { CLOSED_REPORT_DAYS, REPORT_PICTURE_DAYS } from "@brawzer/contracts";
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
import { StorageModule } from "../storage/storage.module.js";
import { OrphanService } from "./orphans.js";
import { RewrapService } from "./rewrap.js";
import { MetricsService } from "../metrics/metrics.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed periods; only the security history's is configurable. */
export const RETENTION = {
  endedSessionDays: 30,
  usedLinkDays: 7,
  unconfirmedAccountDays: 30,
  knownDeviceDays: 90,
  /** A reported page's picture (Phase 8, idea 12), when nobody closed the report sooner. */
  reportPictureDays: REPORT_PICTURE_DAYS,
  closedReportDays: CLOSED_REPORT_DAYS,
} as const;

/** Session-level advisory lock, so only one API instance runs the job at a time. */
const LOCK_KEY = 0x62_72_7a_72;

export interface RetentionResult {
  securityEvents: number;
  sessions: number;
  emailTokens: number;
  challenges: number;
  knownDevices: number;
  unconfirmedAccounts: number;
  reportPictures: number;
  reports: number;
  teamInvitations: number;
}

const logger = new Logger("Retention");

/**
 * Deletes data Brawzer no longer needs: security history past its retention
 * period, sessions and email links that ended long ago, sign-ups that were
 * never confirmed (possibly someone else's address), and reported pages'
 * pictures and old closed reports, and team invitations nobody took up.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OrphanService) private readonly orphans: OrphanService,
    @Inject(RewrapService) private readonly rewrap: RewrapService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  private lastRun: Date | null = null;

  onApplicationBootstrap(): void {
    this.metrics.gauge(
      "brawzer_maintenance_last_run_timestamp_seconds",
      "When retention last ran here, as a Unix time; 0 before the first run.",
      () =>
        Promise.resolve([{ value: this.lastRun ? Math.floor(this.lastRun.getTime() / 1000) : 0 }]),
    );
    this.metrics.gauge("brawzer_build_info", "The running version, as a label.", () =>
      Promise.resolve([{ labels: { version: this.config.version }, value: 1 }]),
    );
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
      if (result) {
        this.lastRun = new Date();
        logger.log(`Removed expired data: ${JSON.stringify(result)}`);
        // Same lock holder, same cadence: objects nothing refers to any more.
        const orphans = await this.orphans.run();
        if (orphans.removed > 0) logger.log(`Orphaned objects: ${JSON.stringify(orphans)}`);
        // And any secret still wrapped by a previous key-encryption key.
        const rewrapped = await this.rewrap.run();
        if (rewrapped && (Object.keys(rewrapped.rewrapped).length > 0 || rewrapped.failed > 0)) {
          logger.log(`Re-wrapped secrets: ${JSON.stringify(rewrapped)}`);
        }
      }
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
        const devices = await client.query("delete from known_devices where last_seen_at < $1", [
          before(RETENTION.knownDeviceDays),
        ]);
        const challenges = await client.query("delete from auth_challenges where expires_at < $1", [
          before(1),
        ]);
        const accounts = await client.query(
          `delete from users u
           where u.email_verified_at is null and u.created_at < $1
             and not exists (
               select 1 from email_tokens t
               where t.user_id = u.id and t.used_at is null and t.expires_at > $2
             )`,
          [before(RETENTION.unconfirmedAccountDays), now],
        );
        const pictures = await client.query(
          `update page_reports set picture = null
           where picture is not null and (closed_at is not null or created_at < $1)`,
          [before(RETENTION.reportPictureDays)],
        );
        const reports = await client.query("delete from page_reports where closed_at < $1", [
          before(RETENTION.closedReportDays),
        ]);
        const invitations = await client.query(
          "delete from team_invitations where expires_at < $1",
          [now],
        );
        return {
          securityEvents: events.rowCount ?? 0,
          sessions: sessions.rowCount ?? 0,
          emailTokens: tokens.rowCount ?? 0,
          challenges: challenges.rowCount ?? 0,
          knownDevices: devices.rowCount ?? 0,
          unconfirmedAccounts: accounts.rowCount ?? 0,
          reportPictures: pictures.rowCount ?? 0,
          reports: reports.rowCount ?? 0,
          teamInvitations: invitations.rowCount ?? 0,
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
  imports: [DatabaseModule, StorageModule],
  providers: [RetentionService, OrphanService, RewrapService],
  exports: [RetentionService, RewrapService],
})
export class MaintenanceModule {}
