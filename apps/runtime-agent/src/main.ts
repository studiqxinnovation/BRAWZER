import path from "node:path";
import type { Readable } from "node:stream";
import { STREAM_CLOSE_CODES } from "@brawzer/contracts";
import { type LaunchedChromium, launchChromium } from "./chromium.ts";
import { readConfig } from "./config.ts";
import { BrowserEngine } from "./engine.ts";
import { log } from "./log.ts";
import { packProfile, restoreProfile } from "./profile-data.ts";
import type { ProxyOverride } from "./proxy.ts";
import { createFilteringProxy } from "./proxy.ts";
import { type AgentLifecycle, type AgentState, createAgentServer } from "./server.ts";
import {
  createTestSite,
  generateTestSiteCertificate,
  TEST_SITE_HOST,
  TEST_SITE_PORTS,
} from "./test-site.ts";

const config = readConfig(process.env);

const overrides = new Map<string, ProxyOverride>();
const trustedSpkiHashes: string[] = [];
if (config.testSite) {
  const certificate = await generateTestSiteCertificate(config.scratchDir);
  const site = createTestSite();
  const secureSite = createTestSite(certificate);
  await Promise.all([
    new Promise<void>((resolve) => site.listen(TEST_SITE_PORTS.http, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => secureSite.listen(TEST_SITE_PORTS.https, "127.0.0.1", resolve)),
  ]);
  overrides.set(TEST_SITE_HOST, {
    host: "127.0.0.1",
    port: TEST_SITE_PORTS.http,
    tlsPort: TEST_SITE_PORTS.https,
  });
  trustedSpkiHashes.push(certificate.spkiHash);
  log("info", "test site enabled", { host: TEST_SITE_HOST });
}

const proxy = createFilteringProxy({
  overrides,
  egress: config.egress ?? undefined,
  onRefused: (host) => log("info", "refused connection", { host: host.slice(0, 253) }),
});
if (config.egress) log("info", "egress proxy in use", config.egress);
await new Promise<void>((resolve) => proxy.listen(config.proxyPort, "127.0.0.1", resolve));

// The engine starts when the orchestrator says so, after any profile data
// has been restored (PUT /profile, then POST /start).
let state: AgentState = "waiting";
let chromium: LaunchedChromium | null = null;
let engine: BrowserEngine | null = null;
let exiting = false;

function exit(code: number, reason: string): void {
  if (exiting) return;
  exiting = true;
  log(code === 0 ? "info" : "error", "agent exiting", { reason });
  server.closeViewer(STREAM_CLOSE_CODES.runtimeClosed, reason);
  const killTimer = setTimeout(() => process.exit(code), 3_000);
  killTimer.unref();
  void stopEngine().finally(() => {
    server.close(() => process.exit(code));
  });
}

/** Closes the engine and waits for the process to leave, so its files are complete. */
async function stopEngine(): Promise<void> {
  const launched = chromium;
  const running = engine;
  chromium = null;
  engine = null;
  if (!launched || !running) return;
  const exited = new Promise<void>((resolve) => {
    if (launched.process.exitCode !== null || launched.process.signalCode !== null) {
      resolve();
      return;
    }
    launched.process.once("exit", () => resolve());
  });
  await running.close();
  const forceTimer = setTimeout(() => launched.process.kill("SIGKILL"), 8_000);
  forceTimer.unref();
  await exited;
  clearTimeout(forceTimer);
}

const lifecycle: AgentLifecycle = {
  state: () => state,
  engine: () => engine,
  restore: (archive: Readable) => restoreProfile(config.scratchDir, archive),
  async start() {
    state = "starting";
    const launched = launchChromium({
      binary: config.chromiumBinary,
      scratchDir: config.scratchDir,
      proxyPort: config.proxyPort,
      viewport: config.initialViewport,
      trustedSpkiHashes,
    });
    const started = new BrowserEngine(launched.cdp, config.initialViewport, {
      downloadDir: path.join(config.scratchDir, "downloads"),
      uploadDir: path.join(config.scratchDir, "uploads"),
      maxFileBytes: config.maxFileBytes,
    });
    chromium = launched;
    engine = started;
    launched.cdp.onClose((error) => {
      // The engine left on its own (crash, kill): the session is over.
      if (state === "running" || state === "starting") exit(1, error.message);
    });
    try {
      await started.start();
    } catch (error) {
      state = "stopped";
      throw error;
    }
    state = "running";
    log("info", "engine ready");
  },
  async pack() {
    state = "stopped";
    await stopEngine();
    return packProfile(config.scratchDir);
  },
};

const server = createAgentServer(lifecycle, config.sessionSecret);

process.on("SIGTERM", () => {
  exit(0, "SIGTERM");
});
process.on("SIGINT", () => {
  exit(0, "SIGINT");
});

await new Promise<void>((resolve) => server.listen(config.port, "0.0.0.0", resolve));
log("info", "agent ready", { port: config.port });
