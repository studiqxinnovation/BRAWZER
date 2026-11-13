import { z } from "zod";

/* ── Announcements: banners inside Brawzer (Phase 11.2) ── */

/** Must match `announcement_kind` in @brawzer/db. */
export const announcementKinds = ["news", "incident", "maintenance", "tip"] as const;
export const announcementKindSchema = z.enum(announcementKinds);
export type AnnouncementKind = z.infer<typeof announcementKindSchema>;
export const announcementKindNames: Readonly<Record<AnnouncementKind, string>> = {
  news: "News",
  incident: "Incident",
  maintenance: "Maintenance",
  tip: "Tip",
};

/** Who sees a banner: everyone, members of organisations, or one plan's accounts. */
export const audienceSchema = z
  .string()
  .regex(/^(everyone|teams|plan:[a-z0-9_-]{1,40})$/, { error: "Choose who sees it." });
export const audienceName = (audience: string): string =>
  audience === "everyone"
    ? "Everyone"
    : audience === "teams"
      ? "Organisations only"
      : `Plan: ${audience.slice("plan:".length)}`;

/** A banner as the person sees it. */
export const announcementSchema = z.object({
  id: z.uuid(),
  kind: announcementKindSchema,
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  startsAt: z.iso.datetime(),
});
export type Announcement = z.infer<typeof announcementSchema>;
export const announcementListSchema = z.object({ announcements: z.array(announcementSchema) });
export type AnnouncementList = z.infer<typeof announcementListSchema>;

/** A banner as the console sees it: audience, schedule, counted views and clicks. */
export const staffAnnouncementSchema = announcementSchema.extend({
  audience: audienceSchema,
  on: z.boolean(),
  endsAt: z.iso.datetime().nullable(),
  incidentId: z.uuid().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Accounts that saw it, and that clicked its link. */
  views: z.number().int(),
  clicks: z.number().int(),
});
export type StaffAnnouncement = z.infer<typeof staffAnnouncementSchema>;
export const staffAnnouncementListSchema = z.object({
  announcements: z.array(staffAnnouncementSchema),
  /** Plans the installation offers, for the audience choice. */
  plans: z.array(z.object({ code: z.string(), name: z.string() })),
});
export type StaffAnnouncementList = z.infer<typeof staffAnnouncementListSchema>;

export const announcementRequestSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(600),
  kind: announcementKindSchema,
  audience: audienceSchema,
  /** A path on Brawzer, such as /app/shield. */
  link: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9/_?=&.-]*$/, { error: "Links go to a page on Brawzer, like /app/shield." })
    .max(200)
    .nullable()
    .optional(),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
});
export type AnnouncementRequest = z.infer<typeof announcementRequestSchema>;

export const announcementToggleSchema = z.object({ on: z.boolean() });

/* ── Incidents and the status page ── */

/** Must match `incident_severity` in @brawzer/db. */
export const incidentSeverities = ["sev1", "sev2", "sev3"] as const;
export const incidentSeveritySchema = z.enum(incidentSeverities);
export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>;
export const incidentSeverityNames: Readonly<Record<IncidentSeverity, string>> = {
  sev1: "SEV-1 (everyone affected)",
  sev2: "SEV-2 (many affected)",
  sev3: "SEV-3 (some people affected)",
};

/** Must match `incident_status` in @brawzer/db. */
export const incidentStatuses = ["investigating", "identified", "monitoring", "resolved"] as const;
export const incidentStatusSchema = z.enum(incidentStatuses);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;
export const incidentStatusNames: Readonly<Record<IncidentStatus, string>> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

/** The parts of Brawzer the status page reports on. */
export const statusComponents = ["cloud_browsers", "sign_in", "drive", "email", "billing"] as const;
export const statusComponentSchema = z.enum(statusComponents);
export type StatusComponent = z.infer<typeof statusComponentSchema>;
export const statusComponentNames: Readonly<Record<StatusComponent, string>> = {
  cloud_browsers: "Cloud browsers",
  sign_in: "Sign-in and accounts",
  drive: "Drive",
  email: "Email",
  billing: "Billing",
};

export const incidentUpdateSchema = z.object({
  id: z.uuid(),
  status: incidentStatusSchema,
  body: z.string(),
  author: z.string().nullable(),
  at: z.iso.datetime(),
});
export type IncidentUpdate = z.infer<typeof incidentUpdateSchema>;

export const incidentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  severity: incidentSeveritySchema,
  status: incidentStatusSchema,
  isPublic: z.boolean(),
  components: z.array(statusComponentSchema),
  owner: z.string().nullable(),
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  updates: z.array(incidentUpdateSchema),
});
export type Incident = z.infer<typeof incidentSchema>;
export const incidentListSchema = z.object({ incidents: z.array(incidentSchema) });
export type IncidentList = z.infer<typeof incidentListSchema>;

export const declareIncidentRequestSchema = z.object({
  title: z.string().trim().min(3).max(140),
  severity: incidentSeveritySchema,
  components: z.array(statusComponentSchema).max(statusComponents.length).default([]),
  isPublic: z.boolean().default(true),
  /** The first update; what people are told. */
  body: z.string().trim().min(3).max(1000),
});
export type DeclareIncidentRequest = z.infer<typeof declareIncidentRequestSchema>;

export const incidentUpdateRequestSchema = z.object({
  status: incidentStatusSchema,
  body: z.string().trim().min(3).max(1000),
});
export type IncidentUpdateRequest = z.infer<typeof incidentUpdateRequestSchema>;

/** The public status page: components as the health checks and open incidents find them. */
export const componentStateSchema = z.enum(["operational", "degraded", "down", "incident"]);
export type ComponentState = z.infer<typeof componentStateSchema>;

export const publicStatusSchema = z.object({
  /** The worst of the components. */
  overall: componentStateSchema,
  components: z.array(
    z.object({
      key: statusComponentSchema,
      name: z.string(),
      state: componentStateSchema,
    }),
  ),
  /** Open public incidents, and public ones resolved in the last 7 days. */
  incidents: z.array(incidentSchema.omit({ isPublic: true, owner: true })),
  /** Maintenance banners that are on, from their start. */
  maintenance: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      body: z.string(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime().nullable(),
    }),
  ),
  generatedAt: z.iso.datetime(),
});
export type PublicStatus = z.infer<typeof publicStatusSchema>;
