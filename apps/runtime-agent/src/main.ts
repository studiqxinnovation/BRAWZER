import { STREAM_CLOSE_CODES } from "@brawzer/contracts";
import { launchChromium } from "./chromium.ts";
import { readConfig } from "./config.ts";
import { BrowserEngine } from "./engine.ts";
import { log } from "./log.ts";
import { createFilteringProxy } from "./proxy.ts";
import { createAgentServer } from "./server.ts";
import { createTestSite, TEST_SITE_HOST } from "./test-site.ts";

const config = readConfig(process.env);

const overrides = new Map<string, { host: string; port: number }>();
if (config.testSite) {
  const site = createTestSite();
  await new Promise<void>((resolve) => site.listen(8090, "127.0.0.1", resolve));
  overrides.set(TEST_SITE_HOST, { host: "127.0.0.1", port: 8090 });
  log("info", "test site enabled", { host: TEST_SITE_HOST });
}

const proxy = createFilteringProxy({
  overrides,
  onRefused: (host) => log("info", "refused connection", { host: host.slice(0, 253) }),
});
await new Promise<void>((resolve) => proxy.listen(config.proxyPort, "127.0.0.1", resolve));

const chromium = launchChromium({
  binary: config.chromiumBinary,
  scratchDir: config.scratchDir,
  proxyPort: config.proxyPort,
  viewport: config.initialViewport,
});
const engine = new BrowserEngine(chromium.cdp, config.initialViewport);
const server = createAgentServer(engine, config.sessionSecret) as ReturnType<
  typeof createAgentServer
> & { closeViewer(code: number, reason: string): void };

let exiting = false;
function exit(code: number, reason: string): void {
  if (exiting) return;
  exiting = true;
  log(code === 0 ? "info" : "error", "agent exiting", { reason });
  server.closeViewer(STREAM_CLOSE_CODES.runtimeClosed, reason);
  const killTimer = setTimeout(() => process.exit(code), 3_000);
  killTimer.unref();
  void engine.close().finally(() => {
    chromium.process.kill("SIGTERM");
    server.close(() => process.exit(code));
  });
}

chromium.cdp.onClose((error) => {
  exit(1, error.message);
});
process.on("SIGTERM", () => {
  exit(0, "SIGTERM");
});
process.on("SIGINT", () => {
  exit(0, "SIGINT");
});

try {
  await engine.start();
} catch (error) {
  exit(1, `engine start failed: ${error instanceof Error ? error.message : "unknown"}`);
}
await new Promise<void>((resolve) => server.listen(config.port, "0.0.0.0", resolve));
log("info", "agent ready", { port: config.port });
