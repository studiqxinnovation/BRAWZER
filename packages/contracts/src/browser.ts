import { z } from "zod";
import { browserEngineSchema } from "./profiles.ts";

/** Must match the database enum `browser_session_status` (a test in the API enforces this). */
export const browserSessionStatuses = ["starting", "running", "ended"] as const;
export const browserSessionStatusSchema = z.enum(browserSessionStatuses);

/** Why a cloud browser session ended. Stored as text; the UI explains each one. */
export const browserSessionEndReasons = [
  /** Ended from the Browser page. */
  "user",
  /** Nobody was looking at it for BROWSER_LIMITS.idleMinutes. */
  "idle",
  /** It reached BROWSER_LIMITS.maxHours. */
  "max_lifetime",
  /** The sign-in that started it ended (sign-out, remote sign-out, password change). */
  "signed_out",
  /** The runtime container stopped or never became ready. */
  "runtime_failed",
  /** The account was deleted. */
  "account_deleted",
  /** An administrator ended it from the Admin page (Phase 8, idea 22). */
  "admin",
  /** It browsed through the team's proxy, and its owner left the team or the team went (ADR 0019). */
  "team_left",
] as const;
export const browserSessionEndReasonSchema = z.enum(browserSessionEndReasons);

/** Temporary limits until plans exist (Phase 6); the durations are Phase 3 decisions. */
export const BROWSER_LIMITS = {
  /** Live sessions per account. */
  liveSessions: 1,
  /** A session nobody is viewing ends after this. */
  idleMinutes: 15,
  /** Longest a session can live, viewed or not. */
  maxHours: 4,
  /** How long starting a container may take before it counts as failed. */
  startTimeoutSeconds: 45,
  /** Streamed page size, at device pixel ratio 1 (ADR 0006). */
  viewport: { minWidth: 320, minHeight: 240, maxWidth: 1920, maxHeight: 1080 },
} as const;

/** How long a stream ticket can be used for, in seconds. */
export const STREAM_TICKET_SECONDS = 60;

export const browserSessionSchema = z.object({
  id: z.uuid(),
  status: browserSessionStatusSchema,
  engine: browserEngineSchema,
  /** The profile chosen at start: its kept data and its proxy apply to the session. */
  profileId: z.uuid().nullable(),
  /** The saved proxy the session's traffic goes through, if the profile had one at start. */
  proxyId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  /** When the runtime became ready; null while starting or if it never did. */
  startedAt: z.iso.datetime().nullable(),
  /** When someone last watched the stream. */
  lastViewedAt: z.iso.datetime().nullable(),
  /** When the session ends at the latest (createdAt + maxHours). */
  expiresAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  endReason: browserSessionEndReasonSchema.nullable(),
});

export const browserOverviewSchema = z.object({
  /** The account's live session (starting or running), if any. */
  session: browserSessionSchema.nullable(),
  limits: z.object({
    idleMinutes: z.number().int().positive(),
    maxHours: z.number().int().positive(),
  }),
  /** Whether the service that starts cloud browsers can be reached right now. */
  runtime: z.enum(["available", "unavailable"]),
  /** Where sessions run, as the installation names it (a city or a region), or null. */
  region: z.string().max(80).nullable(),
});

export const startBrowserSessionRequestSchema = z.object({
  profileId: z.uuid({ error: "Choose one of your profiles." }).optional(),
});

/** Where and how to open the stream. The ticket is sent as the first message, never in the URL. */
export const streamTicketSchema = z.object({
  url: z.url({ protocol: /^wss?$/ }),
  ticket: z.string().length(43),
  expiresAt: z.iso.datetime(),
});

export type BrowserSessionStatus = z.infer<typeof browserSessionStatusSchema>;
export type BrowserSessionEndReason = z.infer<typeof browserSessionEndReasonSchema>;
export type BrowserSession = z.infer<typeof browserSessionSchema>;
export type BrowserOverview = z.infer<typeof browserOverviewSchema>;
export type StartBrowserSessionRequest = z.infer<typeof startBrowserSessionRequestSchema>;
export type StreamTicket = z.infer<typeof streamTicketSchema>;

/** What the Admin page shows of the cloud browser (Phase 8, idea 22). Never what a session browses. */
export const adminRuntimeSchema = z.object({
  hosts: z.array(
    z.object({
      name: z.string(),
      healthy: z.boolean(),
      live: z.number().int().nonnegative(),
      capacity: z.number().int().positive(),
    }),
  ),
  warmPool: z.object({
    size: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
  }),
  sessions: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      engine: browserEngineSchema,
      status: browserSessionStatusSchema,
      host: z.string(),
      createdAt: z.iso.datetime(),
      lastViewedAt: z.iso.datetime().nullable(),
      expiresAt: z.iso.datetime(),
      throughProxy: z.boolean(),
      extensions: z.number().int().nonnegative(),
    }),
  ),
});

export type AdminRuntime = z.infer<typeof adminRuntimeSchema>;
