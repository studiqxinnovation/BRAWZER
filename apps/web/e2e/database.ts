import path from "node:path";
import pg from "pg";

/**
 * Direct access to the local development database, for test setup that no
 * page can do (such as ageing a session). Never used by the app itself.
 */
let pool: pg.Pool | undefined;

function database(): pg.Pool {
  if (!pool) {
    try {
      process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
    } catch {
      // Use the environment.
    }
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  }
  return pool;
}

/** Makes the account's sessions look like they confirmed identity more than 10 minutes ago. */
export async function expireIdentityConfirmation(email: string): Promise<void> {
  await database().query(
    `update auth_sessions set reauthenticated_at = now() - interval '11 minutes'
     where user_id = (select id from users where email = $1)`,
    [email],
  );
}
