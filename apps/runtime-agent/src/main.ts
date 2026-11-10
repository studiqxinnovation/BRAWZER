import path from "node:path";
import type { Readable } from "node:stream";
import { STREAM_CLOSE_CODES } from "@brawzer/contracts";
import { BEE_HOME_HOST, BEE_HOME_PORT, BEE_HOME_URL, createBeeHome } from "./bee.ts";
import { type LaunchedChromium, launchChromium } from "./chromium.ts";
import { type AgentEngine, readConfig } from "./config.ts";
import { cpSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { type Engine, type InstallableExtension, RefusalLog } from "./engine-types.ts";
import { readerScript } from "./page-tools.ts";
import { SessionAudio } from "./audio.ts";
import { BrowserEngine } from "./engine.ts";
import { type LaunchedFirefox, launchFirefox } from "./firefox.ts";
import { FirefoxEngine } from "./firefox-engine.ts";
import { log } from "./log.ts";
import { writePolicies } from "./policies.ts";
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
// Bee's start page: the new tab, served here and never from the internet.
const beeHome = createBeeHome();
await new Promise<void>((resolve) => beeHome.listen(BEE_HOME_PORT, "127.0.0.1", resolve));
overrides.set(BEE_HOME_HOST, { host: "127.0.0.1", port: BEE_HOME_PORT });
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

// Sound: the session's own audio server, started before either engine.
const audio = new SessionAudio(config.scratchDir);
const soundReady = await audio.start();

/** The catalogue index the image was built with: which builds exist, for which engine. */
function installableExtensions(engine: AgentEngine): InstallableExtension[] {
  if (config.extensions.length === 0) return [];
  let index: Record<string, Record<string, { path: string }>>;
  try {
    index = JSON.parse(
      readFileSync(path.join(config.extensionsDir, "index.json"), "utf8"),
    ) as typeof index;
  } catch (error) {
    log("warn", "no extension catalogue in this image", {
      message: error instanceof Error ? error.message : "",
    });
    return [];
  }
  const found: InstallableExtension[] = [];
  // Chrome, Edge and Chromium run the same builds as Bee: all are Chromium.
  const family = engine === "firefox" ? "firefox" : "bee";
  for (const slug of config.extensions) {
    const build = index[slug]?.[family];
    if (!build) {
      log("warn", "extension not in the catalogue for this engine", { slug, engine });
      continue;
    }
    if (engine === "firefox") {
      found.push({ slug, path: build.path });
      continue;
    }
    // Chromium writes an unpacked extension's indexed rules into its own
    // directory, and the image is read-only: each session loads a copy from
    // its scratch space. The path is the same every session, so the
    // extension's id, and what it keeps in the profile, stay the same.
    const copy = path.join(config.scratchDir, "extensions", slug);
    try {
      cpSync(build.path, copy, { recursive: true });
      found.push({ slug, path: copy });
    } catch (error) {
      log("warn", "extension could not be copied", {
        slug,
        message: error instanceof Error ? error.message : "",
      });
    }
  }
  return found;
}

const refusals = new RefusalLog();
// Reader view runs Mozilla's Readability inside the page; its source is read once.
const readabilitySource = readFileSync(
  createRequire(import.meta.url).resolve("@mozilla/readability/Readability.js"),
  "utf8",
);
const proxy = createFilteringProxy({
  overrides,
  egress: config.egress ?? undefined,
  privateViaEgress: config.privateViaEgress,
  onRefused: (host, reason) => {
    log("info", "refused connection", { host: host.slice(0, 253), reason });
    refusals.note(host.replace(/^\[|\]$/g, "").slice(0, 300), reason);
  },
});
if (config.egress) log("info", "egress proxy in use", config.egress);
await new Promise<void>((resolve) => proxy.listen(config.proxyPort, "127.0.0.1", resolve));

// The engine starts when the orchestrator says so, after any profile data
// has been restored (PUT /profile, then POST /start).
let state: AgentState = "waiting";
let chromium: LaunchedChromium | LaunchedFirefox | null = null;
let engine: Engine | null = null;
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

/**
 * Each browser's own pages for a profile with its browser account on (ADR
 * 0021): its saved passwords, and signing in to its maker's account. Only
 * Google's own Chrome can sign in to a Google account; Bee and Chromium keep
 * their passwords in the profile, with no account to sync them.
 */
const BROWSER_PAGES: Record<AgentEngine, { passwords: string; account: string | null }> = {
  bee: { passwords: "chrome://password-manager/passwords", account: null },
  chromium: { passwords: "chrome://password-manager/passwords", account: null },
  chrome: {
    passwords: "chrome://password-manager/passwords",
    account: "chrome://settings/syncSetup",
  },
  edge: { passwords: "edge://wallet/passwords", account: "edge://settings/profiles" },
  firefox: { passwords: "about:logins", account: "about:preferences#sync" },
};

const lifecycle: AgentLifecycle = {
  state: () => state,
  engine: () => engine,
  restore: (archive: Readable) => restoreProfile(config.scratchDir, archive),
  async start() {
    state = "starting";
    // The engines' policies for this session: written first, or no engine starts (ADR 0021).
    writePolicies({ scratchDir: config.scratchDir, browserAccount: config.browserAccount });
    const engineOptions = {
      downloadDir: path.join(config.scratchDir, "downloads"),
      uploadDir: path.join(config.scratchDir, "uploads"),
      maxFileBytes: config.maxFileBytes,
      homeUrl: BEE_HOME_URL,
      refusalFor: (url: string) => refusals.codeFor(url),
      readerScript: readerScript(readabilitySource),
      extensions: installableExtensions(config.engine),
      browserPages: config.browserAccount ? BROWSER_PAGES[config.engine] : null,
    };
    const onGone = (error: Error) => {
      // The engine left on its own (crash, kill): the session is over.
      if (state === "running" || state === "starting") exit(1, error.message);
    };
    let started: Engine;
    if (config.engine === "firefox") {
      const launched = await launchFirefox({
        binary: config.firefoxBinary,
        scratchDir: config.scratchDir,
        extraEnv: soundReady ? audio.env() : {},
        proxyPort: config.proxyPort,
        downloadDir: engineOptions.downloadDir,
        viewport: config.initialViewport,
        startUrl: BEE_HOME_URL,
      });
      started = new FirefoxEngine(launched.bidi, config.initialViewport, {
        ...engineOptions,
        // Only the test site's certificate is unknown; in tests that is what this allows.
        acceptInsecureCerts: config.testSite,
      });
      chromium = launched;
      launched.bidi.onClose(onGone);
    } else {
      const launched = launchChromium({
        binary:
          config.engine === "chrome"
            ? config.chromeBinary
            : config.engine === "edge"
              ? config.edgeBinary
              : config.chromiumBinary,
        scratchDir: config.scratchDir,
        extraEnv: soundReady ? audio.env() : {},
        proxyPort: config.proxyPort,
        viewport: config.initialViewport,
        startUrl: BEE_HOME_URL,
        trustedSpkiHashes,
        browserAccount: config.browserAccount,
      });
      started = new BrowserEngine(launched.cdp, config.initialViewport, {
        ...engineOptions,
        brand: config.engine,
      });
      chromium = launched;
      launched.cdp.onClose(onGone);
    }
    engine = started;
    try {
      await started.start();
    } catch (error) {
      state = "stopped";
      throw error;
    }
    state = "running";
    log("info", "engine ready", { engine: config.engine });
  },
  async pack() {
    state = "stopped";
    audio.close();
    await stopEngine();
    return packProfile(config.scratchDir);
  },
};

const server = createAgentServer(lifecycle, config.sessionSecret, audio);

process.on("SIGTERM", () => {
  exit(0, "SIGTERM");
});
process.on("SIGINT", () => {
  exit(0, "SIGINT");
});

await new Promise<void>((resolve) => server.listen(config.port, "0.0.0.0", resolve));
log("info", "agent ready", { port: config.port });
