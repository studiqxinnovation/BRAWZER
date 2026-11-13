import { boolean, index, pgEnum, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/* Each enum must match its list in @brawzer/contracts (care.ts). */
export const announcementKind = pgEnum("announcement_kind", [
  "news",
  "incident",
  "maintenance",
  "tip",
]);
export const incidentSeverity = pgEnum("incident_severity", ["sev1", "sev2", "sev3"]);
export const incidentStatus = pgEnum("incident_status", [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
]);

/**
 * An incident (Phase 11.2): something wrong with Brawzer, declared by the
 * team, with updates until it is resolved. Public ones show on the status
 * page and as a banner inside Brawzer.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: id(),
    title: text().notNull(),
    severity: incidentSeverity().notNull(),
    status: incidentStatus().notNull().default("investigating"),
    isPublic: boolean().notNull().default(true),
    /** Status-page components affected, from `statusComponents` in the contracts. */
    components: text().array().notNull().default([]),
    ownerId: uuid().references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamptz().notNull().defaultNow(),
    resolvedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("incidents_status_idx").on(table.status, table.startedAt)],
);

export const incidentUpdates = pgTable(
  "incident_updates",
  {
    id: id(),
    incidentId: uuid()
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    status: incidentStatus().notNull(),
    body: text().notNull(),
    authorId: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("incident_updates_incident_idx").on(table.incidentId, table.createdAt)],
);

/**
 * A banner shown inside Brawzer to an audience: everyone, a plan's accounts
 * or members of organisations. Views and clicks are counted per account in
 * `announcement_views`, never guessed.
 */
export const announcements = pgTable(
  "announcements",
  {
    id: id(),
    title: text().notNull(),
    body: text().notNull(),
    kind: announcementKind().notNull(),
    /** "everyone", "teams" or "plan:<code>". */
    audience: text().notNull().default("everyone"),
    /** Where "Learn more" goes, if anywhere; Brawzer's own pages only. */
    link: text(),
    on: boolean().notNull().default(true),
    startsAt: timestamptz().notNull().defaultNow(),
    endsAt: timestamptz(),
    /** The incident this banner belongs to; resolving it turns the banner off. */
    incidentId: uuid().references(() => incidents.id, { onDelete: "set null" }),
    createdById: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [index("announcements_on_idx").on(table.on, table.startsAt)],
);

export const announcementViews = pgTable(
  "announcement_views",
  {
    announcementId: uuid()
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seenAt: timestamptz().notNull().defaultNow(),
    dismissedAt: timestamptz(),
    clickedAt: timestamptz(),
  },
  (table) => [primaryKey({ columns: [table.announcementId, table.userId] })],
);
