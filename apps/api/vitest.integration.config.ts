import path from "node:path";
import { defineConfig } from "vitest/config";

/** Integration tests: boot the real API against the local services (`pnpm infra:up`). */
export default defineConfig({
  test: {
    // Its own module cache: the default is shared by every package at the
    // workspace root, and parallel runs race when it is rebuilt.
    fsModuleCachePath: path.join(import.meta.dirname, "node_modules", ".vitest-cache-integration"),
    include: ["test/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
