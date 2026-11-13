#!/usr/bin/env node
// A live test of a production installation, end to end, as a new person
// would meet it: sign up with the smoke mailbox, receive the confirmation
// email through Resend, confirm, start a cloud browser session, watch its
// stream deliver frames, end it, check the runtime host is clean, and delete
// the account. Prints one line per step; exits 1 on the first failure.
//
//   node infra/hostman/smoke.mjs
//
// Reads SITE_HOST and RESEND_API_KEY from .env, SMOKE_MAILBOX from
// infra/hostman/secrets.env (a mailbox on the site's domain whose mail Resend
// can deliver; the confirmation link is read back through Resend's API, so
// the mailbox itself is never opened here), and the runtime host's address
// from state.json. Needs the deploy SSH key for the runtime host check.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = import.meta.dirname;
const root = path.resolve(here, "../..");
const envFile = path.join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const secrets = Object.fromEntries(
  readFileSync(path.join(here, "secrets.env"), "utf8")
    .split("\n")
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const state = JSON.parse(readFileSync(path.join(here, "state.json"), "utf8"));
const runtime = state.servers.find((s) => s.role === "runtime");
const need = (name, from = process.env) => {
  if (!from[name]) throw new Error(`${name} is not set`);
  return from[name];
};
const SITE_HOST = need("SITE_HOST");
const RESEND_API_KEY = need("RESEND_API_KEY");
const SMOKE_MAILBOX = need("SMOKE_MAILBOX", secrets);
const origin = `https://${SITE_HOST}`;
const api = `${origin}/api/v1`;
const key = process.env.HOSTMAN_SSH_KEY ?? path.join(os.homedir(), ".ssh", "brawzer-hostman");

// The protocol pieces the page uses, from the contracts package's build.
const protocol = await import(
  pathToFileURL(path.join(root, "packages/contracts/dist/browser-protocol.js")).href
);
const WebSocket = createRequire(path.join(root, "apps/api/package.json"))("ws");

const started = Date.now();
const step = (text) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${text}`);
const fail = (text) => {
  console.error(`FAILED: ${text}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The API as one signed-in device: a cookie jar and the site's Origin. */
let cookie = "";
async function call(method, route, body) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0];
    const name = pair.split("=")[0];
    cookie = [...cookie.split("; ").filter((c) => c && !c.startsWith(`${name}=`)), pair].join("; ");
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON.
  }
  return { status: response.status, json, text, headers: response.headers };
}

function sshRuntime(script) {
  const result = spawnSync(
    "ssh",
    [
      "-i",
      key,
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=20",
      `root@${runtime.publicIp}`,
      script,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`ssh runtime host: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function resend(route) {
  const response = await fetch(`https://api.resend.com${route}`, {
    headers: { authorization: `Bearer ${RESEND_API_KEY}` },
  });
  if (!response.ok) throw new Error(`Resend ${route}: ${response.status}`);
  return response.json();
}

/** The confirmation email Resend sent to the smoke mailbox after `since`, with its link. */
async function confirmationLink(since) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const list = await resend("/emails?limit=20");
    const email = list.data.find(
      (e) =>
        e.to.map((t) => t.toLowerCase()).includes(SMOKE_MAILBOX.toLowerCase()) &&
        /confirm/i.test(e.subject) &&
        new Date(e.created_at).getTime() >= since - 60_000,
    );
    if (email) {
      const full = await resend(`/emails/${email.id}`);
      const match = /https:\/\/[^\s"'<>]+#token=[A-Za-z0-9_-]+/.exec(full.html ?? full.text ?? "");
      if (match) return { link: match[0], lastEvent: email.last_event, id: email.id };
    }
    await sleep(2000);
  }
  return null;
}

// ---------------------------------------------------------------------------
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const name = "Smoke Test";

const health = await call("GET", "/health");
if (health.status !== 200) fail(`health ${health.status}`);
step(`health ${health.json?.status ?? "?"} (${health.json?.environment ?? "?"})`);

const signUpAt = Date.now();
const registered = await call("POST", "/auth/register", { name, email: SMOKE_MAILBOX, password });
if (registered.status !== 202) fail(`register ${registered.status} ${registered.text}`);
step(`signed up ${SMOKE_MAILBOX} (202)`);

const confirmation = await confirmationLink(signUpAt);
if (!confirmation) fail("no confirmation email reached Resend for the smoke mailbox within 60s");
step(
  `confirmation email sent through Resend (id ${confirmation.id}, state ${confirmation.lastEvent})`,
);
const token = new URL(confirmation.link).hash.replace("#token=", "");
const verified = await call("POST", "/auth/verify-email", { token, password });
if (verified.status !== 200) fail(`verify-email ${verified.status} ${verified.text}`);
step("email confirmed; this device is signed in");

// From here on the account exists: every failure ends the session (if any)
// and deletes the account, so a failed run leaves nothing behind.
let session = null;
async function cleanUp(exitCode) {
  try {
    if (session) await call("DELETE", `/browser/sessions/${session.id}`);
    const deleted = await call("POST", "/account/delete", { email: SMOKE_MAILBOX });
    step(`account deleted (${deleted.status})`);
  } catch (error) {
    console.error(`clean-up: ${error.message}`);
  }
  process.exit(exitCode);
}
process.on("unhandledRejection", (error) => {
  console.error(`FAILED: ${error?.message ?? error}`);
  void cleanUp(1);
});

const who = await call("GET", "/auth/session");
const account = who.json?.account ?? {};
if (who.status !== 200 || account.name !== name) {
  console.error(`FAILED: session ${who.status} ${who.text}`);
  await cleanUp(1);
}
step(`account reads back: ${account.name} <${account.email}>`);

const start = await call("POST", "/browser/sessions", {});
if (start.status !== 201) {
  console.error(`FAILED: start session ${start.status} ${start.text}`);
  await cleanUp(1);
}
session = start.json;
step(
  `session ${session.id} ${session.status} (${session.engine ?? "default engine"}) on ${session.host ?? "the runtime host"}`,
);

const containers = sshRuntime(
  "docker ps --filter label=brawzer.managed --format '{{.Names}} runtime={{.Label \"brawzer.runtime\"}}' ; " +
    "for c in $(docker ps -q --filter label=brawzer.managed); do docker inspect -f '{{.Name}} -> {{.HostConfig.Runtime}}' $c; done",
);
step(`runtime host: ${containers.split("\n").join(" | ") || "no containers (!)"}`);
if (!/-> runsc/.test(containers)) {
  console.error("FAILED: no session container runs under gVisor (runsc)");
  await cleanUp(1);
}

const ticket = await call("POST", `/browser/sessions/${session.id}/ticket`, undefined);
if (ticket.status !== 200) {
  console.error(`FAILED: ticket ${ticket.status} ${ticket.text}`);
  await cleanUp(1);
}
step(`stream ticket for ${ticket.json.url}`);

const stream = await new Promise((resolve) => {
  const counts = { frames: 0, video: 0, audio: 0, messages: {} };
  const socket = new WebSocket(ticket.json.url, { headers: { origin }, perMessageDeflate: false });
  socket.binaryType = "nodebuffer";
  const done = (why) => {
    clearTimeout(timer);
    try {
      socket.close(1000, "left");
    } catch {
      // Already closed.
    }
    resolve({ ...counts, why });
  };
  const timer = setTimeout(() => done("10 seconds elapsed"), 10_000);
  socket.on("open", () => {
    socket.send(JSON.stringify({ type: "ticket", ticket: ticket.json.ticket }));
    socket.send(
      JSON.stringify({
        type: "hello",
        viewport: { width: 1280, height: 800, scale: 1 },
        codecs: [],
      }),
    );
  });
  socket.on("message", (data, isBinary) => {
    if (!isBinary) {
      try {
        const message = JSON.parse(data.toString());
        counts.messages[message.type] = (counts.messages[message.type] ?? 0) + 1;
        if (message.type === "error") done(`agent error: ${JSON.stringify(message)}`);
      } catch {
        // Ignored.
      }
      return;
    }
    const bytes = new Uint8Array(data);
    const kind = protocol.binaryKind(bytes);
    if (kind === "frame") {
      const frame = protocol.decodeFrame(bytes);
      if (frame) counts.frames += 1;
    } else if (kind === "video") counts.video += 1;
    else if (kind === "audio") counts.audio += 1;
  });
  socket.on("close", (code, reason) => done(`closed ${code} ${reason.toString()}`));
  socket.on("error", (error) => done(`socket error: ${error.message}`));
});
step(
  `stream: ${stream.frames} picture frame(s), ${stream.video} video chunk(s); messages ${JSON.stringify(stream.messages)}; ${stream.why}`,
);
if (stream.frames + stream.video === 0) {
  console.error("FAILED: the stream delivered no frames in 10 seconds");
  await cleanUp(1);
}

const ended = await call("DELETE", `/browser/sessions/${session.id}`);
if (ended.status !== 204) {
  console.error(`FAILED: end session ${ended.status} ${ended.text}`);
  await cleanUp(1);
}
step("session ended (204)");
session = null;

let left = "";
for (let attempt = 0; attempt < 15; attempt += 1) {
  left = sshRuntime(
    "docker ps -a --filter label=brawzer.managed --format '{{.Names}} {{.Status}}'",
  );
  if (!left) break;
  await sleep(2000);
}
if (left) {
  console.error(`FAILED: containers still on the runtime host: ${left}`);
  await cleanUp(1);
}
step("runtime host clean: no session containers left");

let delivery = confirmation.lastEvent;
for (
  let attempt = 0;
  attempt < 15 && !/delivered|bounced|complained/.test(delivery);
  attempt += 1
) {
  await sleep(2000);
  delivery = (await resend(`/emails/${confirmation.id}`)).last_event;
}
step(
  `confirmation email at Resend: ${delivery} (the site's own mailbox ${delivery === "delivered" ? "receives mail" : "did not get it"})`,
);

const overview = await call("GET", "/browser");
step(`browser overview after the end: live=${JSON.stringify(overview.json?.session ?? null)}`);

await cleanUp(0);
