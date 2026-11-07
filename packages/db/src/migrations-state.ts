import { existsSync } from "node:fs";
import path from "node:path";

/** Folder that drizzle-kit writes generated SQL migrations into. */
export const migrationsFolder = path.resolve(import.meta.dirname, "../migrations");

/** True once at least one migration has been generated with `pnpm db:generate`. */
export function hasMigrations(folder: string = migrationsFolder): boolean {
  return existsSync(path.join(folder, "meta", "_journal.json"));
}
