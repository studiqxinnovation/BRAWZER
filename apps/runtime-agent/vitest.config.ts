import path from "node:path";
import { defineConfig } from "vitest/config";

/** Unit tests: no Chromium or network required. */
export default defineConfig({
  test: {
    fsModuleCachePath: path.join(import.meta.dirname, "node_modules", ".vitest-cache"),
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
