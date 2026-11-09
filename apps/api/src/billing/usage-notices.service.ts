import {
  FREE_PLAN_CODE,
  type PlanLimits,
  usageWarnings,
  type UsageWarning,
  type UsageWarningKind,
} from "@brawzer/contracts";
import { and, type DatabaseHandle, eq, schema } from "@brawzer/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import { EmailService } from "../email/email.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { PlanCatalogue } from "./plans.js";

const logger = new Logger("UsageNotices");

/** Session-level advisory lock, distinct from the other jobs'. */
const LOCK_KEY = 0x6272_7573; // "brus"

export interface UsageNoticeResult {
  sent: number;
  cleared: number;
}

const hours = (minutes: number) => {
  const value = minutes / 60;
  const shown = value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${shown} ${shown === "1" ? "hour" : "hours"}`;
};

function bytes(value: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  return unit === 0
    ? `${String(value)} bytes`
    : `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit] ?? ""}`;
}

function worded(warning: UsageWarning): { used: string; limit: string } {
  switch (warning.kind) {
    case "browsing":
      return { used: hours(warning.used), limit: hours(warning.limit) };
    case "storage":
      return { used: bytes(warning.used), limit: bytes(warning.limit) };
    case "files":
      return { used: `${String(warning.used)} files`, limit: `${String(warning.limit)} files` };
  }
}

/**
 * Emails people as their usage reaches 80% and 100% of a plan's limits
 * (Phase 8, idea 20): browsing hours this month on plans that cap them, Drive
 * storage and Drive files. Each threshold is said once per month for hours,
 * and once per crossing for Drive (its record goes when usage falls back
 * under 80%). Runs hourly on one instance at a time.
 */
@Injectable()
export class UsageNoticesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly catalogue: PlanCatalogue;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {
    this.catalogue = new PlanCatalogue(config.billing.plans);
  }

  onApplicationBootstrap(): void {
    const first = setTimeout(() => void this.runSafely(), 2 * 60_000);
    const repeat = setInterval(() => void this.runSafely(), 60 * 60_000);
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
      if (result && result.sent > 0) logger.log(`Usage notices: ${JSON.stringify(result)}`);
    } catch (error) {
      logger.error(`Usage notices failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  /** Runs once. Returns null when another instance is already running it. */
  async run(now = new Date()): Promise<UsageNoticeResult | null> {
    const client = await this.database.pool.connect();
    try {
      const lock = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [LOCK_KEY],
      );
      if (!lock.rows[0]?.locked) return null;
      try {
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const period = monthStart.toISOString().slice(0, 7);
        // Only accounts with something to say: any Drive use, or browsing this month.
        const rows = await client.query<{
          id: string;
          email: string;
          plan_code: string | null;
          drive_bytes: string;
          drive_files: string;
          minutes: string;
        }>(
          `with drive as (
             select user_id, sum(size) as bytes, count(*) as files from drive_files group by user_id
           ), browsing as (
             select user_id,
                    sum(extract(epoch from (coalesce(ended_at, $2) - greatest(started_at, $1)))) / 60 as minutes
             from browser_sessions
             where started_at is not null and coalesce(ended_at, $2) >= $1
             group by user_id
           )
           select u.id, u.email, u.plan_code,
                  coalesce(d.bytes, 0) as drive_bytes, coalesce(d.files, 0) as drive_files,
                  coalesce(b.minutes, 0) as minutes
           from users u
           left join drive d on d.user_id = u.id
           left join browsing b on b.user_id = u.id
           where u.email_verified_at is not null and (d.user_id is not null or b.user_id is not null)`,
          [monthStart, now],
        );
        const result: UsageNoticeResult = { sent: 0, cleared: 0 };
        for (const row of rows.rows) {
          const limits: PlanLimits = this.catalogue.limits(row.plan_code ?? FREE_PLAN_CODE);
          const warnings = usageWarnings(limits, {
            profiles: 0,
            proxies: 0,
            driveBytes: Number(row.drive_bytes),
            driveFiles: Number(row.drive_files),
            browsingMinutesThisMonth: Math.max(0, Math.round(Number(row.minutes))),
          });
          const warned = new Set<UsageWarningKind>(warnings.map((warning) => warning.kind));
          // Drive back under the line: a later crossing is news again.
          for (const kind of ["storage", "files"] as const) {
            if (warned.has(kind)) continue;
            const removed = await this.database.db
              .delete(schema.usageNotices)
              .where(
                and(eq(schema.usageNotices.userId, row.id), eq(schema.usageNotices.kind, kind)),
              )
              .returning({ id: schema.usageNotices.id });
            result.cleared += removed.length;
          }
          for (const warning of warnings) {
            const threshold = warning.percent >= 100 ? 100 : 80;
            const noticePeriod = warning.kind === "browsing" ? period : "current";
            // Both lines are recorded at once, so reaching 100% straight away is said once.
            const inserted = await this.database.db
              .insert(schema.usageNotices)
              .values(
                [80, 100]
                  .filter((line) => line <= threshold)
                  .map((line) => ({
                    userId: row.id,
                    kind: warning.kind,
                    period: noticePeriod,
                    threshold: line,
                  })),
              )
              .onConflictDoNothing()
              .returning({ threshold: schema.usageNotices.threshold });
            if (!inserted.some((entry) => entry.threshold === threshold)) continue;
            const words = worded(warning);
            this.email.sendUsageNotice(
              row.email,
              warning.kind,
              warning.percent,
              words.used,
              words.limit,
            );
            this.metrics.count(
              "brawzer_usage_notices_total",
              "Usage emails sent, by kind and threshold.",
              {
                kind: warning.kind,
                threshold: String(threshold),
              },
            );
            result.sent += 1;
          }
        }
        return result;
      } finally {
        await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  }
}
