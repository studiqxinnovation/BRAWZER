// Phase 3.1 spike: CDP screencast frame rate, frame size and input latency.
// Run: node infra/bench/screencast.mjs
/* global document, window, requestAnimationFrame -- buildScene and the evaluate callbacks run in the page */
import { createRequire } from "node:module";
import path from "node:path";

// Uses the Chromium that Playwright installs for the web app's tests.
const require = createRequire(path.resolve(import.meta.dirname, "../../apps/web/package.json"));
const { chromium } = require("@playwright/test");

const WIDTH = 1280;
const HEIGHT = 800;

/** Builds the test scene with DOM calls: a moving box, and a counter that key presses change. */
function buildScene() {
  document.body.style.margin = "0";
  document.body.style.font = "48px sans-serif";
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "absolute",
    width: "200px",
    height: "200px",
    background: "#4a5bd4",
    top: "300px",
  });
  const counter = document.createElement("p");
  counter.id = "counter";
  counter.textContent = "0";
  counter.style.padding = "24px";
  document.body.append(box, counter);
  let presses = 0;
  window.addEventListener("keydown", () => {
    presses += 1;
    counter.textContent = String(presses);
    document.body.style.background = presses % 2 ? "#eef" : "#fff";
  });
  window.animating = true;
  const step = (time) => {
    if (window.animating) box.style.left = `${String((time / 4) % 1080)}px`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function measure(quality) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto("about:blank");
  await page.evaluate(buildScene);
  const cdp = await page.context().newCDPSession(page);

  const frames = [];
  let onFrame = null;
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push({ at: performance.now(), bytes: Buffer.byteLength(frame.data, "base64") });
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    if (onFrame) onFrame();
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality,
    maxWidth: WIDTH,
    maxHeight: HEIGHT,
    everyNthFrame: 1,
  });

  // Animated scene: frame rate and bandwidth over 5 seconds.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const start = frames.length;
  const startedAt = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const window5 = frames.slice(start);
  const seconds = (performance.now() - startedAt) / 1000;
  const totalBytes = window5.reduce((sum, frame) => sum + frame.bytes, 0);

  // Still scene: time from a key press to the next frame.
  await page.evaluate(() => {
    window.animating = false;
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const latencies = [];
  for (let i = 0; i < 20; i++) {
    const sent = performance.now();
    const next = new Promise((resolve) => {
      onFrame = () => {
        onFrame = null;
        resolve(performance.now() - sent);
      };
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      text: "a",
    });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA" });
    latencies.push(await next);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  latencies.sort((a, b) => a - b);

  await cdp.send("Page.stopScreencast");
  await browser.close();
  return {
    quality,
    fps: Number((window5.length / seconds).toFixed(1)),
    kbPerFrame: Math.round(totalBytes / window5.length / 1024),
    mbitPerSecond: Number(((totalBytes * 8) / seconds / 1_000_000).toFixed(2)),
    latencyMs: {
      median: Math.round(latencies[10]),
      p90: Math.round(latencies[18]),
      max: Math.round(latencies[19]),
    },
  };
}

for (const quality of [50, 70, 85]) {
  console.log(JSON.stringify(await measure(quality)));
}
