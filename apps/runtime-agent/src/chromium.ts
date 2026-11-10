import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { CdpConnection } from "./cdp.ts";
import { log } from "./log.ts";

export interface LaunchOptions {
  binary: string;
  scratchDir: string;
  proxyPort: number;
  viewport: { width: number; height: number };
  /** The first tab's page: Brawzer's own start page, through the proxy override. */
  startUrl: string;
  /** Sound: where the engine finds the session's audio server. */
  extraEnv?: Record<string, string> | undefined;
  /**
   * Public keys whose certificate errors are ignored: only the test site's,
   * in development and tests. Every other certificate is checked as usual.
   */
  trustedSpkiHashes?: string[];
  /** The profile's browser account is on: sync and the account's sign-in aren't switched off here. */
  browserAccount?: boolean;
}

export interface LaunchedChromium {
  process: ChildProcess;
  cdp: CdpConnection;
}

/**
 * Starts the engine with no visible UI, no debugging port (the DevTools
 * connection is a pipe), every connection forced through the filtering
 * proxy, and the features Brawzer draws itself or refuses switched off. The
 * managed policy file in the image (policies.json) enforces the refusals a
 * flag could be talked out of.
 */
export function launchChromium(options: LaunchOptions): LaunchedChromium {
  const userDataDir = path.join(options.scratchDir, "profile");
  const cacheDir = path.join(options.scratchDir, "cache");
  const home = path.join(options.scratchDir, "home");
  for (const dir of [userDataDir, cacheDir, home]) mkdirSync(dir, { recursive: true });

  const args = [
    "--headless=new",
    "--remote-debugging-pipe",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${String(options.viewport.width)},${String(options.viewport.height)}`,
    `--proxy-server=http://127.0.0.1:${String(options.proxyPort)}`,
    // Even loopback goes through the proxy, which refuses it.
    "--proxy-bypass-list=<-loopback>",
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--no-first-run",
    "--no-default-browser-check",
    ...(options.browserAccount ? [] : ["--disable-sync"]),
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    // Extensions come from Brawzer's catalogue only, loaded by the agent over the pipe.
    "--enable-unsafe-extension-debugging",
    "--disable-breakpad",
    "--disable-domain-reliability",
    "--no-service-autorun",
    "--disable-crash-reporter",
    "--no-pings",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    // The HTTP cache lives outside the profile: never kept between sessions.
    `--disk-cache-dir=${cacheDir}`,
    "--disk-cache-size=52428800",
    "--password-store=basic",
    "--lang=en-US",
    `--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,${options.browserAccount ? "" : "AccountConsistency,"}DialMediaRouteProvider`,
    ...(options.trustedSpkiHashes?.length
      ? [`--ignore-certificate-errors-spki-list=${options.trustedSpkiHashes.join(",")}`]
      : []),
    options.startUrl,
  ];

  const child = spawn(options.binary, args, {
    // fd 3: our commands to the engine; fd 4: its replies and events.
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      LANG: "en_US.UTF-8",
      TZ: "UTC",
      // No desktop bus in the container; this stops the engine looking for one.
      DBUS_SESSION_BUS_ADDRESS: "disabled:",
      ...options.extraEnv,
    },
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) {
      // Expected in a container without sysfs, D-Bus or a display.
      if (/cpufreq|dbus\/|object_proxy|Fontconfig/.test(line)) continue;
      if (line.includes("ERROR") || line.includes("FATAL")) {
        log("warn", "chromium", { line: line.slice(0, 500) });
      }
    }
  });

  const toEngine = child.stdio[3] as Writable;
  const fromEngine = child.stdio[4] as Readable;
  const cdp = new CdpConnection(toEngine, fromEngine);
  child.on("exit", (code, signal) => {
    cdp.close(new Error(`Chromium exited (${String(code ?? signal)})`));
  });
  return { process: child, cdp };
}
