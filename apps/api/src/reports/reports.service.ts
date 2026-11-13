import { randomUUID } from "node:crypto";
import {
  type AdminPageReport,
  type BrowserEngine,
  type AdminPageReportList,
  type createPageReportRequestSchema,
  MAX_REPORT_PICTURE_BYTES,
  type PageReportCreated,
} from "@brawzer/contracts";
import { and, type DatabaseHandle, desc, eq, isNotNull, isNull, schema, sql } from "@brawzer/db";
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../auth/session.service.js";
import { ApiException } from "../common/api-exception.js";
import { EmailService } from "../email/email.js";
import type { RequestMeta } from "../common/request-meta.js";
import { SECRET_BOX } from "../crypto/crypto.module.js";
import type { SecretBox } from "../crypto/secret-box.js";
import { DATABASE } from "../database/database.module.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../security-events/security-events.js";

/** How many reports the Admin page lists at once. */
const LIST_LIMIT = 100;

const logger = new Logger("Reports");

const notFound = () => new ApiException("not_found", 404, "That report doesn’t exist.");

const pictureContext = (id: string) => `page-report:${id}`;

/**
 * Pages people report to Brawzer's team (Phase 8, idea 12). A report holds
 * only what its sender chose to send; an attached picture is sealed and
 * deleted when the report is closed (or by the retention job after 30 days).
 */
@Injectable()
export class ReportsService implements OnApplicationBootstrap {
  constructor(
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    this.metrics.gauge(
      "brawzer_page_reports_open",
      "Reported pages waiting for a look.",
      async () => {
        return [{ value: await this.countOpen() }];
      },
    );
  }

  async create(
    auth: AuthContext,
    input: z.output<typeof createPageReportRequestSchema>,
    meta: RequestMeta,
  ): Promise<PageReportCreated> {
    let picture: string | null = null;
    if (input.picture !== null) {
      const bytes = Buffer.from(input.picture, "base64");
      // The schema checked the start and the length of the text; check what it decodes to.
      if (
        bytes.length < 4 ||
        bytes.length > MAX_REPORT_PICTURE_BYTES ||
        bytes[0] !== 0xff ||
        bytes[1] !== 0xd8 ||
        bytes[bytes.length - 2] !== 0xff ||
        bytes[bytes.length - 1] !== 0xd9
      ) {
        throw new ApiException(
          "validation_failed",
          400,
          "Some of the submitted values are invalid.",
          {
            details: ["picture: The picture must be a whole JPEG under 600 KB."],
          },
        );
      }
      picture = bytes.toString("base64");
    }
    // Counted once the report is known to be well formed.
    await this.limiter.enforce(RATE_LIMITS.pageReportsPerAccount, auth.user.id);
    // A session is named only if it is the sender's own; its engine comes from the record.
    let session: { id: string; engine: BrowserEngine } | null = null;
    if (input.sessionId !== null) {
      const [row] = await this.database.db
        .select({ id: schema.browserSessions.id, engine: schema.browserSessions.engine })
        .from(schema.browserSessions)
        .where(
          and(
            eq(schema.browserSessions.id, input.sessionId),
            eq(schema.browserSessions.userId, auth.user.id),
          ),
        );
      session = row ?? null;
    }
    const id = randomUUID();
    const [row] = await this.database.db
      .insert(schema.pageReports)
      .values({
        id,
        userId: auth.user.id,
        sessionId: session?.id ?? null,
        engine: session?.engine ?? null,
        kind: input.kind,
        message: input.message,
        url: input.url,
        title: input.title,
        errorCode: input.errorCode,
        picture: picture === null ? null : await this.box.seal(picture, pictureContext(id)),
      })
      .returning({ id: schema.pageReports.id, createdAt: schema.pageReports.createdAt });
    if (!row) throw new Error("The report was not saved");
    await this.events.record({
      type: "browser.page_reported",
      userId: auth.user.id,
      sessionId: auth.session.id,
      meta,
      metadata: { kind: input.kind, picture: picture !== null },
    });
    this.email.notifyAdmins(
      "report",
      [
        ["Kind", input.kind],
        ["Page", input.url ?? "(not given)"],
        ["Engine", session?.engine ?? "(none)"],
        ["Message", input.message.slice(0, 200)],
      ],
      `report:${id}`,
    );
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }

  async list(state: "open" | "closed"): Promise<AdminPageReportList> {
    const reports = schema.pageReports;
    const rows = await this.database.db
      .select({
        report: {
          id: reports.id,
          kind: reports.kind,
          message: reports.message,
          url: reports.url,
          title: reports.title,
          errorCode: reports.errorCode,
          engine: reports.engine,
          createdAt: reports.createdAt,
          closedAt: reports.closedAt,
          hasPicture: sql<boolean>`${reports.picture} is not null`,
        },
        account: { id: schema.users.id, email: schema.users.email },
      })
      .from(reports)
      .innerJoin(schema.users, eq(schema.users.id, reports.userId))
      .where(state === "open" ? isNull(reports.closedAt) : isNotNull(reports.closedAt))
      .orderBy(desc(state === "open" ? reports.createdAt : reports.closedAt))
      .limit(LIST_LIMIT);
    return {
      reports: rows.map(({ report, account }): AdminPageReport => ({
        ...report,
        createdAt: report.createdAt.toISOString(),
        closedAt: report.closedAt?.toISOString() ?? null,
        account,
      })),
      open: await this.countOpen(),
    };
  }

  /** Opening a picture is logged for the operators: who looked, at which report. */
  async picture(id: string, adminId: string): Promise<string> {
    const [row] = await this.database.db
      .select({ picture: schema.pageReports.picture })
      .from(schema.pageReports)
      .where(eq(schema.pageReports.id, id));
    if (!row) throw notFound();
    if (row.picture === null) {
      throw new ApiException("not_found", 404, "This report has no picture, or it was deleted.");
    }
    logger.log(`Administrator ${adminId} opened the picture of report ${id}`);
    return this.box.open(row.picture, pictureContext(id));
  }

  /** Closing deletes the picture at once; the rest goes with the retention job. */
  async close(id: string, adminId: string): Promise<void> {
    const updated = await this.database.db
      .update(schema.pageReports)
      .set({ closedAt: new Date(), closedBy: adminId, picture: null })
      .where(and(eq(schema.pageReports.id, id), isNull(schema.pageReports.closedAt)))
      .returning({ id: schema.pageReports.id });
    if (updated.length > 0) return;
    const [exists] = await this.database.db
      .select({ id: schema.pageReports.id })
      .from(schema.pageReports)
      .where(eq(schema.pageReports.id, id));
    if (!exists) throw notFound();
  }

  /** The sender's own reports, for "download your data". */
  async forExport(userId: string) {
    const reports = schema.pageReports;
    const rows = await this.database.db
      .select({
        kind: reports.kind,
        message: reports.message,
        url: reports.url,
        createdAt: reports.createdAt,
        closedAt: reports.closedAt,
        hasPicture: sql<boolean>`${reports.picture} is not null`,
      })
      .from(reports)
      .where(eq(reports.userId, userId))
      .orderBy(desc(reports.createdAt));
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
    }));
  }

  private async countOpen(): Promise<number> {
    const [row] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.pageReports)
      .where(isNull(schema.pageReports.closedAt));
    return row?.count ?? 0;
  }
}
