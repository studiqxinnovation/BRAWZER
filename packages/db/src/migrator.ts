import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { DatabaseHandle } from "./client.ts";
import { hasMigrations, migrationsFolder } from "./migrations-state.ts";

/** Applies pending migrations. Returns false when none have been generated yet. */
export async function runMigrations(database: DatabaseHandle): Promise<boolean> {
  if (!hasMigrations()) return false;
  await migrate(database.db, { migrationsFolder });
  return true;
}
