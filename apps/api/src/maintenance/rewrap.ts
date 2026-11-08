import type { DatabaseHandle } from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { SECRET_BOX } from "../crypto/crypto.module.js";
import type { SecretBox } from "../crypto/secret-box.js";
import { DATABASE } from "../database/database.module.js";

const logger = new Logger("Rewrap");

/** Session-level advisory lock, distinct from the retention job's. */
const LOCK_KEY = 0x6272_7772; // "brwr"

const BATCH = 500;

/** Every column that holds a sealed secret (ADR 0008 format), with the column rows are walked by. */
const SEALED_COLUMNS = [
  { table: "proxies", key: "id", column: "credentials" },
  { table: "totp_factors", key: "user_id", column: "secret" },
  { table: "drive_files", key: "id", column: "wrapped_key" },
  { table: "profiles", key: "id", column: "data_wrapped_key" },
  { table: "browser_sessions", key: "id", column: "agent_secret" },
] as const;

export interface RewrapResult {
  /** Rows re-wrapped, per table. */
  rewrapped: Record<string, number>;
  /** Rows left as they were because they could not be re-wrapped (logged, never dropped). */
  failed: number;
}

/**
 * After the key-encryption key is rotated (ADR 0008), every sealed value
 * still wrapped by the previous key is re-wrapped under the current one, so
 * the previous key can be retired in hours rather than whenever each row
 * happens to be written again. Only the wrapping of each data key changes;
 * ciphertexts stay as they are. Runs with the retention job's cadence and on
 * request from the Admin page.
 */
@Injectable()
export class RewrapService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  /** Runs once. Returns null when another instance is already running it. */
  async run(): Promise<RewrapResult | null> {
    const client = await this.database.pool.connect();
    try {
      const lock = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [LOCK_KEY],
      );
      if (!lock.rows[0]?.locked) return null;
      try {
        const result: RewrapResult = { rewrapped: {}, failed: 0 };
        for (const { table, key, column } of SEALED_COLUMNS) {
          let count = 0;
          let after = "";
          for (;;) {
            const rows = await client.query<{ id: string; value: string }>(
              `select ${key} as id, ${column} as value from ${table}
               where ${column} is not null and ${key} > $1 order by ${key} limit $2`,
              [after || "00000000-0000-0000-0000-000000000000", BATCH],
            );
            for (const row of rows.rows) {
              after = row.id;
              try {
                const fresh = await this.box.rewrap(row.value);
                if (fresh === null) continue;
                // Only if the row is still as read: a concurrent write wins.
                const updated = await client.query(
                  `update ${table} set ${column} = $1 where ${key} = $2 and ${column} = $3`,
                  [fresh, row.id, row.value],
                );
                count += updated.rowCount ?? 0;
              } catch (error) {
                result.failed += 1;
                logger.warn(
                  `Could not re-wrap ${table}.${column} for ${row.id}: ${error instanceof Error ? error.message : "unknown"}`,
                );
              }
            }
            if (rows.rows.length < BATCH) break;
          }
          if (count > 0) result.rewrapped[table] = count;
        }
        return result;
      } finally {
        await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  }
}
