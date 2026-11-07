// Phase 3.1 spike, part 2: frame size and rate on a content-rich page while scrolling.
// Run with the web app running (pnpm dev): node infra/bench/screencast-rich.mjs
import { createRequire } from "node:module";
import path from "node:path";

// Uses the Chromium that Playwright installs for the web app's tests.
const require = createRequire(path.resolve(import.meta.dirname, "../../apps/web/package.json"));
const { chromium } = require("@playwright/test");

async function measure(quality, { ackDelayMs = 0 } = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("http://127.0.0.1:3100/", { waitUntil: "networkidle" });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push({ at: performance.now(), bytes: Buffer.byteLength(frame.data, "base64") });
    // A slow viewer acknowledges late; Chromium waits for acknowledgements.
    setTimeout(() => {
      cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    }, ackDelayMs);
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality,
    maxWidth: 1280,
    maxHeight: 800,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const start = frames.length;
  const startedAt = performance.now();
  let direction = 1;
  while (performance.now() - startedAt < 5000) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 640,
      y: 400,
      deltaX: 0,
      deltaY: 120 * direction,
    });
    if (Math.random() < 0.02) direction = -direction;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  const seconds = (performance.now() - startedAt) / 1000;
  const sample = frames.slice(start);
  const bytes = sample.reduce((sum, frame) => sum + frame.bytes, 0);
  await browser.close();
  return {
    quality,
    ackDelayMs,
    fps: Number((sample.length / seconds).toFixed(1)),
    kbPerFrame: Math.round(bytes / Math.max(sample.length, 1) / 1024),
    mbitPerSecond: Number(((bytes * 8) / seconds / 1_000_000).toFixed(2)),
  };
}

for (const quality of [50, 70]) console.log(JSON.stringify(await measure(quality)));
// A viewer on a slow link acknowledges each frame late; Chromium sends fewer frames.
for (const delay of [100, 250])
  console.log(JSON.stringify(await measure(50, { ackDelayMs: delay })));
