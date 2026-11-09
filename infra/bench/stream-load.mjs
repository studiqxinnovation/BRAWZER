#!/usr/bin/env node
// Phase 8, idea 24: how many sessions a runtime host carries, with the
// figures ADR 0006 asks for. Starts N runtime containers with the same
// hardening the orchestrator applies (read-only root, no capabilities, the
// session seccomp profile, 2 GB and 2 CPUs each), opens each agent's stream
// as a viewer would (acknowledging every frame), scrolls a long test page in
// every session at once, and reports frame rate, bandwidth, CPU and memory.
//
// Needs the runtime image (`pnpm runtime:build`) and the local Docker engine.
//   node infra/bench/stream-load.mjs [--sessions 4] [--seconds 30] [--engine bee|firefox]
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(
  path.resolve(import.meta.dirname, "../../apps/runtime-agent/package.json"),
);
const { WebSocket } = require("ws");

const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const sessions = Number(option("sessions", "4"));
const seconds = Number(option("seconds", "30"));
const engine = option("engine", "bee");
const image = option("image", "brawzer-runtime:dev");
const seccomp = path.resolve(
  import.meta.dirname,
  "../../apps/api/src/browser/runtime-seccomp.json",
);
const WARMUP_MS = 3_000;
const VIEWPORT = { width: 1280, height: 800 };

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const containers = [];

function cleanUp() {
  for (const name of containers.splice(0)) {
    try {
      docker("rm", "-f", name);
    } catch {
      // Already gone.
    }
  }
}
process.on("SIGINT", () => {
  cleanUp();
  process.exit(130);
});

async function startOne(index) {
  const name = `brawzer-load-${String(index)}-${randomBytes(3).toString("hex")}`;
  const secret = randomBytes(32).toString("base64url");
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=1024m",
    "--shm-size",
    "512m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--security-opt",
    `seccomp=${seccomp}`,
    "--memory",
    "2g",
    "--memory-swap",
    "2g",
    "--cpus",
    "2",
    "--pids-limit",
    "1024",
    "-p",
    "127.0.0.1::7000",
    "-e",
    `BRAWZER_SESSION_SECRET=${secret}`,
    "-e",
    `BRAWZER_SESSION_ID=${name}`,
    "-e",
    `BRAWZER_ENGINE=${engine}`,
    "-e",
    "BRAWZER_TEST_SITE=true",
    image,
  );
  containers.push(name);
  const port = docker("port", name, "7000").split("\n")[0].split(":").pop();
  const headers = { authorization: `Bearer ${secret}` };
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (health.ok) break;
    } catch {
      // Not listening yet.
    }
    await sleep(100);
  }
  const started = await fetch(`http://127.0.0.1:${port}/start`, { method: "POST", headers });
  if (!started.ok) throw new Error(`${name}: the engine didn't start (${String(started.status)})`);
  return { name, port, headers };
}

function watch(session) {
  const stats = { frames: 0, bytes: 0, measuredFrames: 0, measuredBytes: 0, tab: null, from: 0 };
  const ws = new WebSocket(`ws://127.0.0.1:${session.port}/stream`, { headers: session.headers });
  const send = (message) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      const message = JSON.parse(data.toString());
      if (message.type === "welcome") {
        stats.tab = message.activeTabId;
        send({ type: "navigate", tabId: stats.tab, url: "http://testsite.invalid/long" });
      }
      return;
    }
    const bytes = Buffer.from(data);
    if (bytes[0] !== 0x42) return;
    const length = bytes.readUInt32BE(2);
    const header = JSON.parse(bytes.subarray(6, 6 + length).toString());
    stats.frames += 1;
    stats.bytes += bytes.length;
    if (stats.from > 0 && Date.now() >= stats.from) {
      stats.measuredFrames += 1;
      stats.measuredBytes += bytes.length;
    }
    send({ type: "frame-ack", tabId: header.tabId, frameId: header.frameId });
  });
  ws.on("open", () => send({ type: "hello", viewport: VIEWPORT }));
  return { ws, stats, send };
}

/** Sampled without blocking: a blocking call would pause the scrolling it measures. */
async function containerStats() {
  const { stdout } = await promisify(execFile)("docker", [
    "stats",
    "--no-stream",
    "--format",
    "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}",
    ...containers,
  ]);
  return new Map(
    stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [name, cpu, memory] = line.split("\t");
        return [name, { cpu, memory: memory.split(" / ")[0] }];
      }),
  );
}

try {
  console.log(`Starting ${String(sessions)} ${engine} sessions…`);
  const started = await Promise.all(
    Array.from({ length: sessions }, (_value, index) => startOne(index)),
  );
  const viewers = started.map((session) => ({ session, ...watch(session) }));
  await sleep(2_000);
  const measureFrom = Date.now() + WARMUP_MS;
  for (const viewer of viewers) viewer.stats.from = measureFrom;
  // Every session scrolls at once, 30 wheel steps a second (faster than the stream can
  // follow, so the frame rate measures the pipeline, not the input), turning back now and then.
  const until = measureFrom + seconds * 1000;
  let step = 0;
  const samples = [];
  while (Date.now() < until) {
    const direction = Math.floor(step / 300) % 2 === 0 ? 1 : -1;
    for (const viewer of viewers) {
      if (!viewer.stats.tab) continue;
      viewer.send({
        type: "mouse",
        tabId: viewer.stats.tab,
        kind: "wheel",
        x: 600,
        y: 400,
        deltaX: 0,
        deltaY: 60 * direction,
        modifiers: 0,
      });
    }
    step += 1;
    if (step % 90 === 0 && Date.now() > measureFrom) {
      samples.push(containerStats().catch(() => null));
    }
    await sleep(33);
  }
  const cpuSamples = (await Promise.all(samples)).filter(Boolean);
  const elapsed = seconds;
  const rows = viewers.map((viewer) => {
    const usage = cpuSamples.map((sample) => sample.get(viewer.session.name)).filter(Boolean);
    const cpu = usage.map((entry) => Number.parseFloat(entry.cpu));
    return {
      session: viewer.session.name.replace(/-[0-9a-f]{6}$/, ""),
      fps: (viewer.stats.measuredFrames / elapsed).toFixed(1),
      kbps: Math.round((viewer.stats.measuredBytes * 8) / 1000 / elapsed),
      frameKB: viewer.stats.measuredFrames
        ? Math.round(viewer.stats.measuredBytes / viewer.stats.measuredFrames / 1000)
        : 0,
      cpu: cpu.length ? `${(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(0)}%` : "?",
      memory: usage.at(-1)?.memory ?? "?",
    };
  });
  console.log(
    `\n${engine}, ${String(sessions)} sessions scrolling for ${String(seconds)} s, ${String(VIEWPORT.width)}×${String(VIEWPORT.height)}:\n`,
  );
  console.log("| Session | Frames/s | kbit/s | KB/frame | CPU (of one core) | Memory |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(
      `| ${row.session} | ${row.fps} | ${String(row.kbps)} | ${String(row.frameKB)} | ${row.cpu} | ${row.memory} |`,
    );
  }
  const fps = rows.map((row) => Number(row.fps));
  console.log(
    `\nMean ${(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1)} frames/s per session, lowest ${Math.min(...fps).toFixed(1)}; ${String(rows.reduce((a, row) => a + row.kbps, 0))} kbit/s in all.`,
  );
  for (const viewer of viewers) viewer.ws.close();
} finally {
  cleanUp();
}
