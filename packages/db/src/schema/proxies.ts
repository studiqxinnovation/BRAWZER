import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/** These three must match @brawzer/contracts (a test in the API enforces this). */
export const proxyProtocol = pgEnum("proxy_protocol", [
  "http",
  "https",
  "socks4",
  "socks4a",
  "socks5",
]);
export const proxyKind = pgEnum("proxy_kind", [
  "unspecified",
  "residential",
  "datacenter",
  "mobile",
]);
export const proxyRotation = pgEnum("proxy_rotation", ["unknown", "static", "rotating"]);

/** The outcome of the last test, without its message (worded when it's read). */
export interface StoredProxyTest {
  ok: boolean;
  reachable: boolean;
  authenticated: boolean | null;
  latencyMs: number | null;
  exitAddress: string | null;
  reason: string | null;
  testedAt: string;
}

/**
 * A proxy the account can route profiles through (traffic from Phase 5).
 * `credentials` is the username and password as one envelope-encrypted value
 * (ADR 0008), bound to this row; it is never returned by the API.
 */
export const proxies = pgTable(
  "proxies",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Trimmed; unique per account, ignoring case. */
    name: text().notNull(),
    protocol: proxyProtocol().notNull(),
    /** Lower-cased host name or IP address (IPv6 without brackets). */
    host: text().notNull(),
    port: integer().notNull(),
    credentials: text(),
    kind: proxyKind().notNull().default("unspecified"),
    rotation: proxyRotation().notNull().default("unknown"),
    lastTest: jsonb().$type<StoredProxyTest>(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("proxies_user_name_unique").on(table.userId, sql`lower(${table.name})`),
    index("proxies_user_idx").on(table.userId),
    check("proxies_port_range", sql`${table.port} between 1 and 65535`),
  ],
);

export type ProxyRow = typeof proxies.$inferSelect;
