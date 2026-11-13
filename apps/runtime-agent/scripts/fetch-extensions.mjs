#!/usr/bin/env node
/**
 * Fetches the extension catalogue's builds into a directory for the runtime
 * image (run at image build): each asset is checked against its pinned
 * SHA-256, Chromium zips are unpacked, Firefox xpis kept as they are, and an
 * index names where each lives.
 *
 *   node scripts/fetch-extensions.mjs <out dir> <install dir as seen in the image>
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXTENSION_CATALOGUE } from "@brawzer/contracts";

const [outDir, installDir = outDir] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: fetch-extensions.mjs <out dir> [install dir]");
  process.exit(1);
}

async function fetchChecked(build) {
  const response = await fetch(build.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${build.url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== build.sha256)
    throw new Error(`${build.url}: expected ${build.sha256}, got ${digest}`);
  return bytes;
}

const index = {};
for (const entry of EXTENSION_CATALOGUE) {
  const dir = path.join(outDir, entry.slug);
  mkdirSync(dir, { recursive: true });
  const record = {};
  if (entry.bee) {
    const zip = path.join(dir, "chromium.zip");
    writeFileSync(zip, await fetchChecked(entry.bee));
    mkdirSync(path.join(dir, "chromium"), { recursive: true });
    execFileSync("unzip", ["-q", "-o", zip, "-d", path.join(dir, "chromium")]);
    execFileSync("rm", [zip]);
    // The agent loads a copy from the session's scratch space (Chromium writes into an
    // unpacked extension's directory); the id is derived from that copy's path.
    record.bee = {
      path: path.join(installDir, entry.slug, "chromium"),
      version: entry.bee.version,
    };
  }
  if (entry.firefox) {
    writeFileSync(path.join(dir, "firefox.xpi"), await fetchChecked(entry.firefox));
    record.firefox = {
      path: path.join(installDir, entry.slug, "firefox.xpi"),
      id: entry.firefox.id,
      version: entry.firefox.version,
    };
  }
  index[entry.slug] = record;
  console.log(`${entry.slug}: ${Object.keys(record).join(", ")}`);
}
writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 2));
