import { z } from "zod";
import { browserSessionStatusSchema } from "./browser.ts";
import { browserEngineSchema } from "./profiles.ts";
import { dependencyCheckSchema } from "./health.ts";

/* ── The console's technical pages (Phase 11.4) ── */

const customerRef = z.object({
  id: z.uuid(),
  handle: z.string(),
  /** Masked unless the viewer is a founder. */
  email: z.string(),
});

/* Fleet: the runtime hosts the API knows. One region: the installation's. */

export const fleetSchema = z.object({
  hosts: z.array(
    z.object({
      name: z.string(),
      healthy: z.boolean(),
      live: z.number().int().nonnegative(),
      capacity: z.number().int().positive(),
      /** Session containers actually running there right now, as Docker lists them. */
      containers: z.number().int().nonnegative().nullable(),
    }),
  ),
  warmPool: z.object({
    size: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
  }),
  maxLiveSessions: z.number().int().positive(),
  live: z.number().int().nonnegative(),
  startedLast24h: z.number().int().nonnegative(),
  endedLast24h: z.number().int().nonnegative(),
  /** Median seconds from asking for a browser to its first frame, last 24 hours. */
  medianStartSeconds: z.number().nullable(),
  /** Sessions that never started, last 24 hours. */
  failedStarts24h: z.number().int().nonnegative(),
  runtimeImage: z.string(),
  egressImage: z.string(),
});
export type Fleet = z.infer<typeof fleetSchema>;

/* Live sessions: machine facts only, never what people browse. */

export const liveSessionSchema = z.object({
  id: z.uuid(),
  customer: customerRef,
  engine: browserEngineSchema,
  engineName: z.string(),
  status: browserSessionStatusSchema,
  host: z.string(),
  profileName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  lastViewedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  throughProxy: z.boolean(),
  extensions: z.number().int().nonnegative(),
  /** People watching the stream right now. */
  viewers: z.number().int().nonnegative(),
});
export type LiveSession = z.infer<typeof liveSessionSchema>;
export const liveSessionListSchema = z.object({
  sessions: z.array(liveSessionSchema),
  hosts: z.array(z.string()),
});
export type LiveSessionList = z.infer<typeof liveSessionListSchema>;

/* Browser images: what the containers run from. */

export const browserImagesSchema = z.object({
  runtimeImage: z.string(),
  egressImage: z.string(),
  /** The API's own version, from its build. */
  apiVersion: z.string(),
  engines: z.array(
    z.object({
      engine: browserEngineSchema,
      name: z.string(),
      /** Whether this installation offers it. */
      offered: z.boolean(),
      /** Live sessions on it right now. */
      live: z.number().int().nonnegative(),
      /** Profiles that use it. */
      profiles: z.number().int().nonnegative(),
    }),
  ),
});
export type BrowserImages = z.infer<typeof browserImagesSchema>;

/* Extension catalogue moderation. */

/** Must match `extension_status` in @brawzer/db. */
export const extensionStatuses = ["allowed", "review", "blocked"] as const;
export const extensionStatusSchema = z.enum(extensionStatuses);
export type ExtensionStatus = z.infer<typeof extensionStatusSchema>;
export const extensionStatusNames: Readonly<Record<ExtensionStatus, string>> = {
  allowed: "Allowed",
  review: "Under review",
  blocked: "Blocked",
};

export const moderatedExtensionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  summary: z.string(),
  licence: z.string(),
  homepage: z.string(),
  versions: z.object({ bee: z.string().nullable(), firefox: z.string().nullable() }),
  /** Profiles that have it installed. */
  installs: z.number().int().nonnegative(),
  status: extensionStatusSchema,
  reason: z.string().nullable(),
  changedBy: z.string().nullable(),
  changedAt: z.iso.datetime().nullable(),
});
export type ModeratedExtension = z.infer<typeof moderatedExtensionSchema>;
export const moderatedExtensionListSchema = z.object({
  extensions: z.array(moderatedExtensionSchema),
});
export type ModeratedExtensionList = z.infer<typeof moderatedExtensionListSchema>;

export const setExtensionStatusRequestSchema = z.object({
  status: extensionStatusSchema,
  /** Required when blocking: it goes into the email affected customers get. */
  reason: z.string().trim().max(300).default(""),
});
export type SetExtensionStatusRequest = z.infer<typeof setExtensionStatusRequestSchema>;

/* Proxy & Shield: the saved proxies and their tests; site rules. */

export const networkSchema = z.object({
  proxies: z.object({
    total: z.number().int().nonnegative(),
    working: z.number().int().nonnegative(),
    failing: z.number().int().nonnegative(),
    untested: z.number().int().nonnegative(),
    byProtocol: z.array(z.object({ protocol: z.string(), count: z.number().int() })),
    /** Latest failed tests, with the problem; never the address or credentials. */
    recentFailures: z.array(
      z.object({
        protocol: z.string(),
        testedAt: z.iso.datetime(),
        reason: z.string().nullable(),
        reachable: z.boolean(),
        authenticated: z.boolean().nullable(),
      }),
    ),
    /** Sessions routed through a proxy right now. */
    liveThroughProxy: z.number().int().nonnegative(),
  }),
  siteRules: z.object({
    allow: z.number().int().nonnegative(),
    block: z.number().int().nonnegative(),
    accounts: z.number().int().nonnegative(),
  }),
  /** Whether sessions may leave through the egress container (the installation's network policy). */
  egressImage: z.string(),
});
export type Network = z.infer<typeof networkSchema>;

/* Queues & health: what the API measures about itself. */

export const techHealthSchema = z.object({
  checks: z.array(z.object({ key: z.string(), name: z.string(), check: dependencyCheckSchema })),
  retentionLastRunAt: z.iso.datetime().nullable(),
  warmPool: z.object({
    size: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
  }),
  live: z.number().int().nonnegative(),
  startedLast24h: z.number().int().nonnegative(),
  failedStarts24h: z.number().int().nonnegative(),
  openReports: z.number().int().nonnegative(),
  openTickets: z.number().int().nonnegative(),
  quarantinedFiles: z.number().int().nonnegative(),
  uptimeSeconds: z.number().int().nonnegative(),
  version: z.string(),
});
export type TechHealth = z.infer<typeof techHealthSchema>;
