import path from "node:path";
import { defineConfig } from "drizzle-kit";

// Local development reads the workspace .env; other environments pass
// DATABASE_URL through the process environment.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {
  // No .env file: rely on the environment.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
