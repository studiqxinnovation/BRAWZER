/**
 * Applies pending migrations: `pnpm db:migrate`.
 *
 * Runs directly with Node's built-in TypeScript support. It always checks the
 * database connection first, so a successful run proves the database is
 * reachable even when there is nothing to apply.
 */
import { createDatabase } from "./client.ts";
import { runMigrations } from "./migrator.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env, or export it.");
  process.exit(1);
}

const database = createDatabase({ url, applicationName: "brawzer-migrate", maxConnections: 1 });

try {
  await database.ping();
  const applied = await runMigrations(database);
  console.log(
    applied ? "Database is up to date." : "Connected to the database. No migrations to apply.",
  );
} catch (error) {
  // Print the reason without the connection string, which may contain a password.
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Migration failed: ${reason.replaceAll(url, "[DATABASE_URL]")}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
