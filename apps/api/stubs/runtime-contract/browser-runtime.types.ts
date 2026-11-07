import { z } from "zod";

/**
 * The contract between Brawzer and whatever runs its cloud browsers.
 *
 * Brawzer's API asks a runtime to start and end sessions; the runtime reports
 * what happens through events. Everything Phases 4 to 7 need from the cloud
 * browser goes through this contract: downloads for Drive (Phase 4), a proxy
 * per session (Phase 5), usage for plans and billing (Phase 6), and limits and
 * lifecycle for running at scale (Phase 7).
 *
 * See docs/runtime/runtime-handoff-brief.md for what a runtime must guarantee.
 */

export const runtimeEngines = ["chromium", "firefox"] as const;

export const runtimeSessionStates = ["starting", "ready", "ending", "ended", "failed"] as const;

export const runtimeEndReasons = [
  "user",
  "idle",
  "lifetime",
  "signed_out",
  "account_deleted",
  "failed",
  "shutdown",
] as const;

/** The profile's proxy, with its password decrypted only inside Brawzer's servers (Phase 5). */
export const runtimeProxySchema = z.object({
  protocol: z.enum(["http", "https", "socks4", "socks4a", "socks5"]),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  username: z.string().optional(),
  password: z.string().optional(),
});

/** Where a finished download goes: refused, or uploaded to Drive with a short-lived URL (Phase 4). */
export const runtimeDownloadPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("blocked") }),
  z.object({
    mode: z.literal("drive"),
    /** A one-session upload URL issued by the API; never a storage credential. */
    uploadUrl: z.url(),
    maxBytes: z.number().int().positive(),
  }),
]);

export const runtimeSessionRequestSchema = z.object({
  /** Brawzer's ID for the session; the runtime uses it in every event. */
  sessionId: z.uuid(),
  userId: z.uuid(),
  profileId: z.uuid(),
  engine: z.enum(runtimeEngines),
  viewport: z.object({
    width: z.number().int().min(320).max(1920),
    height: z.number().int().min(240).max(1080),
  }),
  proxy: runtimeProxySchema.nullable(),
  downloads: runtimeDownloadPolicySchema,
  limits: z.object({
    /** The session ends after this long, whatever happens. */
    maxLifetimeSeconds: z.number().int().positive(),
    /** The session ends after this long without a viewer. */
    idleTimeoutSeconds: z.number().int().positive(),
    memoryMb: z.number().int().positive(),
    cpus: z.number().positive(),
  }),
});

/**
 * How Brawzer's gateway reaches a ready session. Internal only: the person's
 * computer never sees this, only a short-lived ticket for the gateway.
 */
export const runtimeStreamEndpointSchema = z.object({
  protocol: z.enum(["cdp-screencast", "webrtc"]),
  internalUrl: z.url(),
  /** Proves to the runtime that the gateway is the caller. */
  secret: z.string().min(32),
});

export const runtimeSessionSchema = z.object({
  sessionId: z.uuid(),
  /** The runtime's own name for it, such as a container or pod ID. */
  runtimeId: z.string().min(1),
  state: z.enum(runtimeSessionStates),
  /** Present only when the session is ready to stream. */
  stream: runtimeStreamEndpointSchema.nullable(),
  startedAt: z.iso.datetime(),
});

const at = z.iso.datetime();

/** Everything a runtime reports. Each event names the session it belongs to. */
export const runtimeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.ready"), sessionId: z.uuid(), at }),
  z.object({
    type: z.literal("session.ended"),
    sessionId: z.uuid(),
    reason: z.enum(runtimeEndReasons),
    at,
  }),
  /** A download was stored in Drive's upload area (Phase 4 scans and files it). */
  z.object({
    type: z.literal("download.completed"),
    sessionId: z.uuid(),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().max(255),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Key in the upload area, as returned by the upload URL. */
    uploadKey: z.string().min(1),
    at,
  }),
  z.object({
    type: z.literal("download.blocked"),
    sessionId: z.uuid(),
    fileName: z.string().max(255),
    reason: z.enum(["policy", "too_large", "failed"]),
    at,
  }),
  /** Usage for one period of a session (Phase 6 meters it). */
  z.object({
    type: z.literal("usage"),
    sessionId: z.uuid(),
    periodStart: at,
    periodEnd: at,
    /** Seconds with a viewer connected. */
    activeSeconds: z.number().int().nonnegative(),
    bytesStreamed: z.number().int().nonnegative(),
    bytesEgress: z.number().int().nonnegative(),
    at,
  }),
  /** The session's proxy stopped working (Phase 5 tells the person). */
  z.object({
    type: z.literal("proxy.failed"),
    sessionId: z.uuid(),
    reason: z.enum(["unreachable", "auth_failed", "blocked_address", "other"]),
    at,
  }),
]);

export type RuntimeEngine = (typeof runtimeEngines)[number];
export type RuntimeSessionState = (typeof runtimeSessionStates)[number];
export type RuntimeEndReason = (typeof runtimeEndReasons)[number];
export type RuntimeProxy = z.infer<typeof runtimeProxySchema>;
export type RuntimeDownloadPolicy = z.infer<typeof runtimeDownloadPolicySchema>;
export type RuntimeSessionRequest = z.infer<typeof runtimeSessionRequestSchema>;
export type RuntimeStreamEndpoint = z.infer<typeof runtimeStreamEndpointSchema>;
export type RuntimeSession = z.infer<typeof runtimeSessionSchema>;
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;
export type RuntimeEventType = RuntimeEvent["type"];

/** What Brawzer's API needs from a runtime. A real driver and the stub both implement it. */
export interface BrowserRuntime {
  /** Whether this driver can actually stream a browser (the stub can't). */
  readonly streams: boolean;
  start(request: RuntimeSessionRequest): Promise<RuntimeSession>;
  get(sessionId: string): Promise<RuntimeSession | null>;
  end(sessionId: string, reason: RuntimeEndReason): Promise<void>;
  /** Every session the runtime knows about, so Brawzer can reconcile after a restart. */
  list(): Promise<RuntimeSession[]>;
}

/** How runtime events reach the rest of Brawzer (Redis Streams or similar in production). */
export interface RuntimeEventBus {
  publish(event: RuntimeEvent): Promise<void>;
  /** Returns a function that stops the subscription. */
  subscribe<T extends RuntimeEventType>(
    type: T,
    handler: (event: Extract<RuntimeEvent, { type: T }>) => Promise<void> | void,
  ): () => void;
}

/** Short-lived, single-use access to a session's stream through the gateway. */
export interface StreamGateway {
  issueTicket(input: { sessionId: string; userId: string }): Promise<{ ticket: string; expiresAt: string }>;
  /** Uses the ticket up; null if it's unknown, expired or already used. */
  redeem(ticket: string): Promise<{ sessionId: string; userId: string } | null>;
  /** Closes every stream of a session at once, for sign-out and ending. */
  disconnect(sessionId: string): Promise<void>;
}
