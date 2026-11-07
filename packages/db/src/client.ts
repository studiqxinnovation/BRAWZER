import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.ts";

export interface DatabaseOptions {
  /** postgres:// connection string. */
  url: string;
  /** Shown in pg_stat_activity, which makes connections easy to attribute. */
  applicationName?: string;
  maxConnections?: number;
}

/** Creates the connection pool and Drizzle client used by Brawzer services. */
export function createDatabase(options: DatabaseOptions) {
  const pool = new Pool({
    connectionString: options.url,
    application_name: options.applicationName ?? "brawzer",
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
  });

  // An idle client can error when the server restarts. Without a listener
  // Node treats it as an unhandled 'error' event and exits the process; the
  // pool discards the broken client and reconnects on the next query.
  pool.on("error", () => undefined);

  const db = drizzle({ client: pool, schema, casing: "snake_case" });

  return {
    db,
    pool,
    /** Runs a trivial query to confirm the database is reachable. */
    async ping(): Promise<void> {
      await pool.query("select 1");
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export type DatabaseHandle = ReturnType<typeof createDatabase>;
export type Database = DatabaseHandle["db"];
/** The `tx` handle passed to `db.transaction(async (tx) => ...)`. */
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run a query: the database itself or an open transaction. */
export type DatabaseExecutor = Database | DatabaseTransaction;
