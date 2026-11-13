import { index, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { browserSessions } from "./browser.ts";
import { id, timestamptz } from "./columns.ts";
import { browserEngine } from "./profiles.ts";

/** Must match `pageReportKinds` in @brawzer/contracts (a test in the API enforces this). */
export const pageReportKind = pgEnum("page_report_kind", ["broken", "blocked", "other"]);

/**
 * A page someone reported to Brawzer's team (Phase 8, idea 12). Holds only
 * what they chose to send. The picture is sealed (ADR 0008) and removed
 * when the report is closed or after 30 days; a closed report goes after 90.
 */
export const pageReports = pgTable(
  "page_reports",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid().references(() => browserSessions.id, { onDelete: "set null" }),
    engine: browserEngine(),
    kind: pageReportKind().notNull(),
    message: text().notNull(),
    url: text(),
    title: text(),
    errorCode: text(),
    /** A JPEG as base64, sealed with the context "page-report:<id>". */
    picture: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    closedAt: timestamptz(),
    closedBy: uuid().references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    index("page_reports_state_idx").on(table.closedAt, table.createdAt),
    index("page_reports_user_idx").on(table.userId),
  ],
);

export type PageReportRow = typeof pageReports.$inferSelect;
