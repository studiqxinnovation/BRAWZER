import { BROWSER_LIMITS } from "@brawzer/contracts";

export interface AgentConfig {
  /** Presented by the relay on every connection; set per session by the orchestrator. */
  sessionSecret: string;
  /** Where the relay connects (inside the container). */
  port: number;
  chromiumBinary: string;
  /** The filtering proxy every page connection goes through (loopback only). */
  proxyPort: number;
  /** Development and tests only: a local site reachable as http://testsite.invalid/. */
  testSite: boolean;
  /** Writable scratch space; the root file system is read-only. */
  scratchDir: string;
  initialViewport: { width: number; height: number };
}

export function readConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const secret = env.BRAWZER_SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("BRAWZER_SESSION_SECRET must be set (32+ characters)");
  const port = Number(env.BRAWZER_AGENT_PORT ?? "7000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("BRAWZER_AGENT_PORT must be a port number");
  }
  return {
    sessionSecret: secret,
    port,
    chromiumBinary: env.CHROMIUM_BIN ?? "/usr/bin/chromium",
    proxyPort: 3128,
    testSite: env.BRAWZER_TEST_SITE === "true",
    scratchDir: env.BRAWZER_SCRATCH_DIR ?? "/tmp",
    initialViewport: {
      width: Math.min(1280, BROWSER_LIMITS.viewport.maxWidth),
      height: Math.min(800, BROWSER_LIMITS.viewport.maxHeight),
    },
  };
}
