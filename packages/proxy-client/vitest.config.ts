import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Its own module cache: the default is shared by every package at the
    // workspace root, and parallel runs race when it is rebuilt.
    fsModuleCachePath: path.join(import.meta.dirname, "node_modules", ".vitest-cache"),
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
