import { defineConfig, devices } from "@playwright/test";

const webUrl = "http://127.0.0.1:3100";
const apiHealthUrl = "http://127.0.0.1:4100/api/v1/health";

/**
 * End-to-end tests run in real Chromium against the real stack.
 * Prerequisite: local services running (`pnpm infra:up`). The API and web dev
 * servers are started automatically, or reused if `pnpm dev` is already up.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    // The desktop's windows fly to and from the Dock; tests act on where things are, not mid-flight.
    reducedMotion: "reduce",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: process.env.CI
        ? "pnpm --filter @brawzer/api run start"
        : "pnpm --filter @brawzer/api run dev",
      cwd: "../..",
      url: apiHealthUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: process.env.CI ? "pnpm run start:standalone" : "pnpm run dev",
      url: webUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
