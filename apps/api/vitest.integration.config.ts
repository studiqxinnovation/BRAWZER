import { defineConfig } from "vitest/config";

/** Integration tests: boot the real API against the local services (`pnpm infra:up`). */
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
