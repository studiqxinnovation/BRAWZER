import { index, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authSessions, users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";
import { browserEngine, profiles } from "./profiles.ts";
import { proxies } from "./proxies.ts";

/** Must match `browserSessionStatuses` in @brawzer/contracts (a test in the API enforces this). */
export const browserSessionStatus = pgEnum("browser_session_status", [
  "starting",
  "running",
  "ended",
]);

/**
 * One cloud browser session: a container running the engine, started by a
 * signed-in device and watched through short-lived stream tickets. Rows are
 * kept after the session ends for the account's history and data export.
 */
export const browserSessions = pgTable(
  "browser_sessions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The sign-in that started it; when that sign-in ends, so does the session. */
    authSessionId: uuid()
      .notNull()
      .references(() => authSessions.id, { onDelete: "cascade" }),
    profileId: uuid().references(() => profiles.id, { onDelete: "set null" }),
    /** The profile's proxy when the session started; its traffic goes through it (ADR 0014). */
    proxyId: uuid().references(() => proxies.id, { onDelete: "set null" }),
    engine: browserEngine().notNull().default("bee"),
    status: browserSessionStatus().notNull().default("starting"),
    /** The runtime container, once created. */
    containerId: text(),
    /** The runtime host the containers were placed on (Phase 8, idea 15); null means the primary. */
    runtimeHost: text(),
    /** Where the relay reaches the runtime agent (host:port on the API's side). */
    agentAddress: text(),
    /**
     * The secret the relay presents to the agent, sealed by the key service
     * and bound to this session (ADR 0008). Never returned by the API.
     */
    agentSecret: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    startedAt: timestamptz(),
    lastViewedAt: timestamptz(),
    endedAt: timestamptz(),
    endReason: text(),
  },
  (table) => [
    index("browser_sessions_user_status_idx").on(table.userId, table.status),
    index("browser_sessions_auth_session_idx").on(table.authSessionId),
    index("browser_sessions_profile_idx").on(table.profileId),
  ],
);

export type BrowserSessionRow = typeof browserSessions.$inferSelect;
