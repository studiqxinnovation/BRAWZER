import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BidiConnection } from "./bidi.ts";
import { log } from "./log.ts";

export interface FirefoxLaunchOptions {
  binary: string;
  scratchDir: string;
  proxyPort: number;
  downloadDir: string;
  viewport: { width: number; height: number };
  /** The first tab's page: Brawzer's own start page, through the proxy. */
  startUrl: string;
  /** Sound: where the engine finds the session's audio server. */
  extraEnv?: Record<string, string> | undefined;
}

export interface LaunchedFirefox {
  process: ChildProcess;
  bidi: BidiConnection;
}

const BIDI_PORT = 9222;

/**
 * Firefox's settings for a session, written to the profile at every start
 * (so a restored profile can't change them): everything through the
 * filtering proxy, loopback included; downloads to the scratch directory
 * without dialogs; no telemetry, updates, studies or sign-in; WebRTC only
 * through the proxy. The managed policy file in the image locks the rest.
 */
function prefs(options: FirefoxLaunchOptions): string {
  const entries: [string, string | number | boolean][] = [
    ["network.proxy.type", 1],
    ["network.proxy.http", "127.0.0.1"],
    ["network.proxy.http_port", options.proxyPort],
    ["network.proxy.ssl", "127.0.0.1"],
    ["network.proxy.ssl_port", options.proxyPort],
    ["network.proxy.no_proxies_on", ""],
    ["network.proxy.allow_hijacking_localhost", true],
    ["network.trr.mode", 5],
    ["media.peerconnection.ice.proxy_only", true],
    ["media.peerconnection.ice.default_address_only", true],
    ["browser.download.dir", options.downloadDir],
    ["browser.download.folderList", 2],
    ["browser.download.useDownloadDir", true],
    ["browser.download.always_ask_before_handling_new_types", false],
    ["browser.download.manager.showWhenStarting", false],
    ["browser.download.start_downloads_in_tmp_dir", false],
    ["pdfjs.disabled", false],
    ["browser.sessionstore.resume_from_crash", false],
    ["browser.shell.checkDefaultBrowser", false],
    ["browser.startup.homepage_override.mstone", "ignore"],
    ["toolkit.telemetry.enabled", false],
    ["datareporting.healthreport.uploadEnabled", false],
    ["app.update.enabled", false],
    ["app.normandy.enabled", false],
    ["extensions.update.enabled", false],
    ["identity.fxaccounts.enabled", false],
    ["signon.rememberSignons", false],
    ["dom.disable_open_during_load", false],
    // Developer tools stay closed: "DisableDeveloperTools" as a policy would
    // also switch off the Remote Agent the agent drives Firefox through.
    ["devtools.chrome.enabled", false],
    ["devtools.debugger.remote-enabled", false],
    ["devtools.toolbox.host", "window"],
    ["remote.active-protocols", 1],
    ["remote.prefs.recommended", true],
  ];
  return entries
    .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join("\n");
}

/** Starts Firefox headless with WebDriver BiDi on the loopback and connects to it. */
export async function launchFirefox(options: FirefoxLaunchOptions): Promise<LaunchedFirefox> {
  const profile = path.join(options.scratchDir, "profile");
  const home = path.join(options.scratchDir, "home");
  for (const dir of [profile, home, options.downloadDir]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(profile, "user.js"), `${prefs(options)}\n`);

  const child = spawn(
    options.binary,
    [
      "--headless",
      "--no-remote",
      "--profile",
      profile,
      "--remote-debugging-port",
      String(BIDI_PORT),
      "--width",
      String(options.viewport.width),
      "--height",
      String(options.viewport.height),
      options.startUrl,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        MOZ_HEADLESS: "1",
        MOZ_CRASHREPORTER_DISABLE: "1",
        LANG: "en_US.UTF-8",
        TZ: "UTC",
        DBUS_SESSION_BUS_ADDRESS: "disabled:",
        ...options.extraEnv,
      },
    },
  );
  // "WebDriver BiDi listening on …" goes to stdout; warnings to stderr.
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (/Gtk|dbus|Fontconfig|glib/i.test(line) || line.trim() === "") continue;
        if (/listening on/i.test(line)) log("info", "firefox", { line: line.slice(0, 200) });
        else if (/error|fatal|crash/i.test(line))
          log("warn", "firefox", { line: line.slice(0, 500) });
      }
    });
  }

  const bidi = new BidiConnection();
  const exited = new Promise<never>((_resolve, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`Firefox exited (${String(code ?? signal)})`));
    });
  });
  // A first start on a slow host can take a while; the orchestrator allows 45 s overall.
  await Promise.race([bidi.connect(`ws://127.0.0.1:${String(BIDI_PORT)}/session`, 40_000), exited]);
  child.on("exit", (code, signal) => {
    bidi.close();
    log("info", "firefox exited", { code: code ?? signal });
  });
  return { process: child, bidi };
}
