import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import type { Readable } from "node:stream";
import { log } from "./log.ts";

/**
 * The profile directory is Chromium's user data directory. What is kept
 * between sessions is what makes a profile a profile (cookies, history, site
 * data, settings); caches, locks and crash reports are left behind. The HTTP
 * cache is kept outside this directory altogether (see chromium.ts).
 */
const EXCLUDED = [
  "profile/SingletonLock",
  "profile/SingletonSocket",
  "profile/SingletonCookie",
  "profile/lockfile",
  "profile/DevToolsActivePort",
  "profile/Crashpad",
  "profile/BrowserMetrics*",
  "profile/*_crx_cache",
  "profile/GrShaderCache",
  "profile/GraphiteDawnCache",
  "profile/ShaderCache",
  "profile/Default/Cache",
  "profile/Default/Code Cache",
  "profile/Default/GPUCache",
  "profile/Default/DawnCache",
  "profile/Default/DawnGraphiteCache",
  "profile/Default/DawnWebGPUCache",
  "profile/Default/blob_storage",
  "profile/Default/Service Worker/CacheStorage",
  "profile/Default/Service Worker/ScriptCache",
  "profile/Default/Download Service",
  "profile/Default/optimization_guide_*",
  "profile/Default/Site Characteristics Database",
  "*.log",
  "*.journal",
];

/** The arguments that make the archive: exported so a test can check what is left out. */
export function packArguments(): string[] {
  return [
    "-cz",
    "--no-xattrs",
    ...EXCLUDED.map((pattern) => `--exclude=${pattern}`),
    "-f",
    "-",
    "profile",
  ];
}

/** A gzip tar of the profile directory, streamed; the caller reads it to the end. */
export function packProfile(scratchDir: string): Readable {
  const child = spawn("tar", packArguments(), {
    cwd: scratchDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (line: string) => {
    // "file changed as we read it" and friends are expected for a live profile; keep them visible.
    log("warn", "pack", { line: line.trim().slice(0, 300) });
  });
  child.on("exit", (code) => {
    if (code !== 0) log("warn", "pack exited", { code });
  });
  return child.stdout;
}

/** Unpacks a profile archive made by {@link packProfile} into the scratch directory. */
export async function restoreProfile(scratchDir: string, archive: Readable): Promise<void> {
  await mkdir(scratchDir, { recursive: true });
  const child = spawn(
    "tar",
    ["-xz", "--no-same-owner", "--no-same-permissions", "--no-overwrite-dir", "-f", "-"],
    { cwd: scratchDir, stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (line: string) => {
    stderr += line;
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with ${String(code)}: ${stderr.trim().slice(0, 300)}`));
    });
  });
  archive.pipe(child.stdin);
  archive.on("error", (error) => child.stdin.destroy(error));
  await exited;
}
