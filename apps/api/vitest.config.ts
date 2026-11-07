import { defineConfig } from "vitest/config";

/** Unit tests: no database, Redis or network required. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
