#!/usr/bin/env node
// Provisions Brawzer's production footprint on Hostman (ADR 0016's shape):
// two cloud servers in one location (the app tier and a runtime host), a
// managed PostgreSQL, a managed Valkey and a private S3 bucket for Drive.
//
// Idempotent: resources are found by name before they are created, and the
// result is written to infra/hostman/state.json (git-ignored). Generated
// passwords go to infra/hostman/secrets.env (git-ignored, mode 0600) and
// nowhere else. Reads HOSTMAN_TOKEN from the repository's .env.
//
//   node infra/hostman/provision.mjs            # create what's missing, wait, write state
//   node infra/hostman/provision.mjs --plan     # only say what would be created and the price
//   node infra/hostman/provision.mjs --status   # print the current state
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const here = import.meta.dirname;
const root = path.resolve(here, "../..");
const envFile = path.join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const token = process.env.HOSTMAN_TOKEN;
if (!token) throw new Error("HOSTMAN_TOKEN is not set (put it in .env)");

const API = "https://api.hostman.com/api/v1";
const stateFile = path.join(here, "state.json");
const secretsFile = path.join(here, "secrets.env");
const plan = process.argv.includes("--plan");
const status = process.argv.includes("--status");

// Everything in New York (us-2), where the object storage also lives. The
// managed databases turned out to be reachable only from a local network the
// API can't configure, so PostgreSQL and Valkey are self-hosted on the app
// host (infra/production/services.yaml) and no database is created here.
const WANT = {
  location: "us-2",
  // Plain Ubuntu: Hostman's "Docker" software image left both servers in
  // status "error" (2026-11-13); deploy.mjs installs Docker itself.
  os: { id: 99, name: "Ubuntu 24.04" },
  servers: [
    { name: "brawzer-app-1", preset: 5145, role: "app" }, // 4 vCPU, 8 GB, 160 GB NVMe, $20/mo
    { name: "brawzer-runtime-1", preset: 5145, role: "runtime" }, // the same, sessions only
  ],
  databases: [],
  bucket: { prefix: "brawzer-drive", preset: 1475, type: "private" }, // 10 GB in us-2, $1/mo
};

async function call(method, route, body) {
  const response = await fetch(`${API}/${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const message = Array.isArray(json.message) ? json.message.join("; ") : json.message;
    throw new Error(`${method} ${route} -> ${response.status}: ${message ?? text.slice(0, 200)}`);
  }
  return json;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const password = () =>
  `${randomBytes(24).toString("base64url").replace(/[-_]/g, "").slice(0, 22)}Qx7`;

function readSecrets() {
  const out = {};
  if (!existsSync(secretsFile)) return out;
  for (const line of readFileSync(secretsFile, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function writeSecrets(secrets) {
  mkdirSync(here, { recursive: true });
  const body = Object.entries(secrets)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(secretsFile, `${body}\n`, { mode: 0o600 });
}

async function main() {
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
  if (status) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const [servers, dbs, buckets, keys, presets] = await Promise.all([
    call("GET", "servers").then((r) => r.servers ?? []),
    call("GET", "dbs").then((r) => r.dbs ?? []),
    call("GET", "storages/buckets").then((r) => r.buckets ?? []),
    call("GET", "ssh-keys").then((r) => r.ssh_keys ?? []),
    call("GET", "presets/servers").then((r) => r.server_presets ?? []),
  ]);
  const priceOf = (id) => presets.find((p) => p.id === id)?.price ?? "?";

  const sshKey = keys.find((k) => k.name === "brawzer-deploy");
  if (!sshKey)
    throw new Error(
      "No SSH key named brawzer-deploy on the account; add ~/.ssh/brawzer-hostman.pub first",
    );

  const todo = [];
  for (const want of WANT.servers)
    if (!servers.some((s) => s.name === want.name))
      todo.push({ kind: "server", ...want, price: priceOf(want.preset) });
  for (const want of WANT.databases)
    if (!dbs.some((d) => d.name === want.name)) todo.push({ kind: "database", ...want });
  if (!buckets.some((b) => b.name.startsWith(WANT.bucket.prefix)))
    todo.push({ kind: "bucket", ...WANT.bucket });

  const finances = await call("GET", "account/finances").catch(() => null);
  const balance = finances?.finances?.balance ?? finances?.balance;
  console.log(`Account balance: ${balance ?? "?"} USD`);
  if (todo.length === 0) console.log("Nothing to create; everything named in the plan exists.");
  for (const item of todo)
    console.log(
      `  create ${item.kind} ${item.name ?? item.prefix} (preset ${item.preset}${item.price ? `, $${item.price}/mo` : ""})`,
    );
  console.log(
    "  monthly total for the whole footprint: about $41 (2 x $20 servers, $1 bucket), billed hourly",
  );
  if (plan) return;

  const secrets = readSecrets();
  for (const item of todo) {
    if (item.kind === "server") {
      const r = await call("POST", "servers", {
        name: item.name,
        preset_id: item.preset,
        os_id: WANT.os.id,
        ssh_keys_ids: [sshKey.id],
        is_ddos_guard: false,
        bandwidth: 200,
        // No local-network flag: the API answers 500 with it. Servers and
        // databases meet on the account's local network regardless.
      });
      console.log(`created server ${item.name} id ${r.server.id}`);
    } else if (item.kind === "database") {
      const key = `${item.type.replace(/\d+$/, "").toUpperCase()}_PASSWORD`;
      secrets[key] ??= password();
      writeSecrets(secrets);
      const body = {
        name: item.name,
        type: item.type,
        preset_id: item.preset,
        password: secrets[key],
      };
      if (item.login) body.login = item.login;
      const r = await call("POST", "dbs", body);
      console.log(`created ${item.type} ${item.name} id ${r.db.id}`);
    } else if (item.kind === "bucket") {
      const name = `${item.prefix}-${randomBytes(3).toString("hex")}`;
      const r = await call("POST", "storages/buckets", {
        name,
        type: item.type,
        preset_id: item.preset,
      });
      console.log(`created bucket ${r.bucket.name} id ${r.bucket.id}`);
    }
  }

  // Wait until everything is on, then record addresses.
  const started = Date.now();
  let snapshot;
  for (;;) {
    const [s, d, b] = await Promise.all([
      call("GET", "servers").then((r) => r.servers ?? []),
      call("GET", "dbs").then((r) => r.dbs ?? []),
      call("GET", "storages/buckets").then((r) => r.buckets ?? []),
    ]);
    snapshot = {
      servers: await Promise.all(
        WANT.servers.map(async (w) => {
          const srv = s.find((x) => x.name === w.name);
          // The server record lists no addresses; they live on their own route.
          const ips = srv
            ? await call("GET", `servers/${srv.id}/ips`).then((r) => r.server_ips ?? [])
            : [];
          return {
            role: w.role,
            name: w.name,
            id: srv?.id,
            status: srv?.status,
            publicIp: ips.find((ip) => ip.type === "ipv4")?.ip ?? null,
            location: srv?.location,
          };
        }),
      ),
      databases: WANT.databases.map((w) => {
        const db = d.find((x) => x.name === w.name);
        const nets = db?.networks ?? [];
        return {
          type: w.type,
          name: w.name,
          id: db?.id,
          status: db?.status,
          login: db?.login ?? w.login ?? null,
          host: db?.host ?? db?.ip ?? nets[0]?.ips?.[0]?.ip ?? null,
          localIp: db?.local_ip ?? nets.find((n) => n.type === "local")?.ips?.[0]?.ip ?? null,
          port: db?.port ?? null,
        };
      }),
      bucket: (() => {
        const bk = b.find((x) => x.name.startsWith(WANT.bucket.prefix));
        return bk
          ? {
              id: bk.id,
              name: bk.name,
              hostname: bk.hostname,
              location: bk.location,
              status: bk.status,
            }
          : null;
      })(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(stateFile, JSON.stringify(snapshot, null, 2));
    const pending = [
      ...snapshot.servers.filter((x) => x.status !== "on"),
      ...snapshot.databases.filter((x) => x.status !== "started"),
    ];
    if (pending.length === 0 || Date.now() - started > 15 * 60_000) break;
    console.log(`waiting: ${pending.map((p) => `${p.name}=${p.status ?? "missing"}`).join(", ")}`);
    await sleep(10_000);
  }
  console.log(JSON.stringify(snapshot, null, 2));
  console.log(
    `\nState written to ${stateFile}; passwords in ${secretsFile}. Next: node infra/hostman/deploy.mjs (see README.md).`,
  );
}

await main();
