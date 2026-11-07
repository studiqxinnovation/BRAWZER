import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    // Its own module cache: the default is shared by every package at the
    // workspace root, and parallel runs race when it is rebuilt.
    fsModuleCachePath: path.join(import.meta.dirname, "node_modules", ".vitest-cache"),
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
