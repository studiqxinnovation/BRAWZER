/**
 * Applies pending database migrations in deployed environments:
 * `node dist/migrate.js`, run once per release before the new API starts.
 * (Local development uses `pnpm db:migrate`.) Needs only DATABASE_URL.
 */
import { createDatabase, runMigrations } from "@brawzer/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const database = createDatabase({ url, applicationName: "brawzer-migrate", maxConnections: 1 });
try {
  await database.ping();
  const applied = await runMigrations(database);
  process.stdout.write(applied ? "Database is up to date.\n" : "No migrations to apply.\n");
} catch (error) {
  // The connection string may contain a password; never print it.
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Migration failed: ${reason.replaceAll(url, "[DATABASE_URL]")}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
