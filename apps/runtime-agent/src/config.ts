import { BROWSER_LIMITS } from "@brawzer/contracts";

export interface AgentConfig {
  /** Presented by the relay on every connection; set per session by the orchestrator. */
  sessionSecret: string;
  /** Where the relay connects (inside the container). */
  port: number;
  /** Bee (Brawzer's own browser, on Chromium) or Firefox. */
  engine: "bee" | "firefox";
  chromiumBinary: string;
  firefoxBinary: string;
  /** The filtering proxy every page connection goes through (loopback only). */
  proxyPort: number;
  /** Development and tests only: a local site reachable as http://testsite.invalid/. */
  testSite: boolean;
  /** The session's egress proxy, when the orchestrator runs one (ADR 0014). */
  egress: { host: string; port: number } | null;
  /** The profile's choice: private addresses are handed to the egress (and its proxy) instead of refused here. */
  privateViaEgress: boolean;
  /** Catalogue extensions (slugs) to install into this session, and where the catalogue lives. */
  extensions: string[];
  extensionsDir: string;
  /** Writable scratch space; the root file system is read-only. */
  scratchDir: string;
  /** The largest file the engine may download or print; Drive's per-file limit, set by the orchestrator. */
  maxFileBytes: number;
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
    engine: env.BRAWZER_ENGINE === "firefox" ? "firefox" : "bee",
    chromiumBinary: env.CHROMIUM_BIN ?? "/usr/bin/chromium",
    firefoxBinary: env.FIREFOX_BIN ?? "/usr/bin/firefox-esr",
    proxyPort: 3128,
    testSite: env.BRAWZER_TEST_SITE === "true",
    egress: readEgress(env.BRAWZER_EGRESS_PROXY),
    privateViaEgress: env.BRAWZER_PRIVATE_VIA_EGRESS === "true",
    extensions: (env.BRAWZER_EXTENSIONS ?? "")
      .split(",")
      .map((slug) => slug.trim())
      .filter((slug) => /^[a-z0-9-]{1,64}$/.test(slug)),
    extensionsDir: env.BRAWZER_EXTENSIONS_DIR ?? "/opt/brawzer/extensions",
    scratchDir: env.BRAWZER_SCRATCH_DIR ?? "/tmp",
    maxFileBytes: Math.max(1, Number(env.BRAWZER_MAX_FILE_BYTES ?? "") || 100 * 1024 * 1024),
    initialViewport: {
      width: Math.min(1280, BROWSER_LIMITS.viewport.maxWidth),
      height: Math.min(800, BROWSER_LIMITS.viewport.maxHeight),
    },
  };
}

/** `host:port` of the egress proxy, or null for a session that connects on its own. */
function readEgress(value: string | undefined): { host: string; port: number } | null {
  if (!value) return null;
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(value);
  if (!match) throw new Error("BRAWZER_EGRESS_PROXY must be host:port");
  return { host: (match[1] ?? "").replace(/^\[|\]$/g, ""), port: Number(match[2]) };
}
