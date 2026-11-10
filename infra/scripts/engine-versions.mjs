#!/usr/bin/env node
/**
 * Asks a runtime image's own package manager whether Debian ships newer
 * browser engines than the image holds (Phase 8, idea 18). The image's apt
 * sources include the security archive, so a security release shows up the
 * day Debian publishes it (Chrome and Edge come from Google's and Microsoft's
 * own repositories, also in the image's sources; Edge only on x86-64). Exit 0:
 * current; exit 3: a newer chromium, firefox-esr, google-chrome-stable or
 * microsoft-edge-stable exists, rebuild; exit 1: the check could not run.
 *
 *   node infra/scripts/engine-versions.mjs ghcr.io/owner/brawzer-runtime:nightly
 */
import { execFileSync } from "node:child_process";

const image = process.argv[2];
if (!image) {
  console.error("usage: engine-versions.mjs <runtime image>");
  process.exit(1);
}
const PACKAGES = ["chromium", "firefox-esr", "google-chrome-stable", "microsoft-edge-stable"];

let policy;
try {
  policy = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--user",
      "root",
      "--entrypoint",
      "sh",
      image,
      "-c",
      `apt-get update -qq >/dev/null 2>&1 && apt-cache policy ${PACKAGES.join(" ")}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 },
  );
} catch (error) {
  console.error(`Could not read package versions from ${image}: ${error.message}`);
  process.exit(1);
}

let stale = false;
let current = null;
for (const line of policy.split("\n")) {
  const name = /^(\S+):$/.exec(line)?.[1];
  if (name) current = { name, installed: null, candidate: null };
  const installed = /^\s+Installed:\s*(\S+)/.exec(line)?.[1];
  // "(none)": known to apt but not in this image (Edge on an ARM image).
  if (installed && installed !== "(none)" && current) current.installed = installed;
  const candidate = /^\s+Candidate:\s*(\S+)/.exec(line)?.[1];
  if (candidate && current) {
    current.candidate = candidate;
    const outdated = current.installed !== null && current.installed !== current.candidate;
    stale ||= outdated;
    console.log(
      `${current.name}: image ${current.installed ?? "none"}, Debian ${candidate}${outdated ? "  <- rebuild" : ""}`,
    );
  }
}
if (current === null) {
  console.error("apt-cache policy printed nothing recognisable");
  process.exit(1);
}
process.exit(stale ? 3 : 0);
