#!/usr/bin/env node
// Deploys Brawzer to the hosts that provision.mjs recorded: sends the source,
// starts the self-hosted services, builds the images on the app host, writes
// the production settings there, starts the stack and checks the site.
//
//   node infra/hostman/deploy.mjs                # everything
//   node infra/hostman/deploy.mjs --no-build     # reuse the images already on the host
//   node infra/hostman/deploy.mjs --runtime      # also push runtime+egress images to the runtime host
//   node infra/hostman/deploy.mjs --check        # only the checks at the end
//
// Reads from the repository's .env: SITE_HOST (the domain, pointing at the
// app host), RESEND_API_KEY and ADMIN_EMAILS. Production-only settings come
// from infra/hostman/secrets.env (never from the development .env): EMAIL_FROM
// (default no-reply at SITE_HOST), EMAIL_REPLY_TO, RESEND_WEBHOOK_SECRET,
// STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, BILLING_PLANS, ANTHROPIC_API_KEY.
// Secrets go to the host over SSH and into files with mode 0600; nothing is
// printed.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const here = import.meta.dirname;
const root = path.resolve(here, "../..");
const envFile = path.join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const args = new Set(process.argv.slice(2));
const build = !args.has("--no-build");
const onlyCheck = args.has("--check");
const pushRuntime = args.has("--runtime");
// --api-only: migrations and the API alone, for checking the settings before
// the domain exists (the web image bakes the site URL in; Caddy needs it).
const apiOnly = args.has("--api-only");

const key = process.env.HOSTMAN_SSH_KEY ?? path.join(os.homedir(), ".ssh", "brawzer-hostman");
const state = JSON.parse(readFileSync(path.join(here, "state.json"), "utf8"));
const app = state.servers.find((s) => s.role === "app");
const runtime = state.servers.find((s) => s.role === "runtime");
if (!app?.publicIp || !runtime?.publicIp)
  throw new Error("state.json has no addresses; run provision.mjs first");

function readEnvFile(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const secretsFile = path.join(here, "secrets.env");
const secrets = readEnvFile(secretsFile);
function need(name, from = process.env) {
  const value = from[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// One multiplexed connection per host: the hosts rate-limit new SSH
// connections (ufw limit), and this script would otherwise open dozens.
const sshArgs = [
  "-i",
  key,
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ControlMaster=auto",
  "-o",
  `ControlPath=${os.tmpdir()}/brawzer-ssh-%r@%h`,
  "-o",
  "ControlPersist=120",
];
function ssh(host, script, { input, quiet = false } = {}) {
  const result = spawnSync("ssh", [...sshArgs, `root@${host}`, "bash", "-s"], {
    input: script + (input ? "" : ""),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (result.status !== 0) throw new Error(`ssh ${host}: exit ${result.status}`);
  if (!quiet && result.stdout.trim()) console.log(result.stdout.trimEnd());
  return result.stdout;
}
function sshWrite(host, file, content, mode = "600") {
  // Content goes through stdin, never through the command line.
  const result = spawnSync(
    "ssh",
    [...sshArgs, `root@${host}`, `umask 077; cat > '${file}' && chmod ${mode} '${file}'`],
    {
      input: content,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(`writing ${file} on ${host} failed`);
}
function rsync(from, to, excludes = []) {
  execFileSync(
    "rsync",
    [
      "-az",
      "--delete",
      "-e",
      `ssh ${sshArgs.join(" ")}`,
      ...excludes.flatMap((e) => ["--exclude", e]),
      from,
      to,
    ],
    { stdio: "inherit" },
  );
}

const SITE_HOST = need("SITE_HOST");
const origin = `https://${SITE_HOST}`;

function checks() {
  console.log(`\nChecks against ${origin}`);
  const curl = (url, extra = []) =>
    spawnSync(
      "curl",
      [
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code} %{redirect_url}",
        "--max-time",
        "20",
        ...extra,
        url,
      ],
      {
        encoding: "utf8",
      },
    ).stdout;
  console.log(`  GET ${origin}/api/v1/health -> ${curl(`${origin}/api/v1/health`)}`);
  console.log(`  GET ${origin}/ -> ${curl(`${origin}/`)}`);
  console.log(`  GET ${origin}/app -> ${curl(`${origin}/app`)}`);
  console.log(`  GET ${origin}/admin/sign-in -> ${curl(`${origin}/admin/sign-in`)}`);
  console.log(`  GET http://${SITE_HOST}/ -> ${curl(`http://${SITE_HOST}/`)}`);
  const headers = spawnSync("curl", ["-sSI", "--max-time", "20", `${origin}/`], {
    encoding: "utf8",
  }).stdout;
  for (const h of ["strict-transport-security", "content-security-policy", "x-frame-options"])
    console.log(`  ${h}: ${headers.toLowerCase().includes(h) ? "present" : "MISSING"}`);
  // Read only. Without this setting sessions start and stream but cannot load
  // a page (runtime-host/README.md, step 1); nothing else here would notice.
  try {
    const runsc = ssh(runtime.publicIp, "docker info --format '{{json .Runtimes.runsc}}'", {
      quiet: true,
    });
    console.log(
      runsc.includes("--network=host")
        ? "  runtime host: runsc uses the kernel network stack"
        : `  runtime host: runsc is NOT set to --network=host, so sessions cannot browse.
    Fix: ssh root@${runtime.publicIp} 'bash -s' < infra/production/runtime-host/runsc-host-network.sh`,
    );
  } catch (error) {
    console.log(`  runtime host: could not be asked (${error.message})`);
  }
}

if (onlyCheck) {
  checks();
  process.exit(0);
}

const RESEND_API_KEY = need("RESEND_API_KEY");
const ADMIN_EMAILS = need("ADMIN_EMAILS");
const EMAIL_FROM = secrets.EMAIL_FROM ?? `Brawzer <no-reply@${SITE_HOST}>`;
const POSTGRES_PASSWORD = need("POSTGRES_PASSWORD", secrets);
const VALKEY_PASSWORD = need("VALKEY_PASSWORD", secrets);
const STORAGE_ACCESS_KEY_ID = need("STORAGE_ACCESS_KEY_ID", secrets);
const STORAGE_SECRET_ACCESS_KEY = need("STORAGE_SECRET_ACCESS_KEY", secrets);
function saveSecrets() {
  writeFileSync(
    secretsFile,
    `${Object.entries(secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
}
if (!secrets.METRICS_TOKEN) {
  secrets.METRICS_TOKEN = randomBytes(24).toString("base64url");
  saveSecrets();
}
// The backups' passphrase: generated once, kept here as well as on the host,
// because a backup must be readable when the host is gone.
if (!secrets.BACKUP_PASSPHRASE) {
  secrets.BACKUP_PASSPHRASE = randomBytes(32).toString("base64url");
  saveSecrets();
}

console.log(`\n1. Source and production files to ${app.publicIp}`);
ssh(
  app.publicIp,
  "mkdir -p /srv/brawzer/src /srv/brawzer/production /etc/brawzer/docker-tls /etc/brawzer/openbao && chown 100:1000 /etc/brawzer/openbao && chmod 700 /etc/brawzer/openbao /etc/brawzer/docker-tls",
);
rsync(`${root}/`, `root@${app.publicIp}:/srv/brawzer/src/`, [
  "node_modules",
  ".git",
  ".next",
  "dist",
  ".turbo",
  "playwright-report",
  "test-results",
  ".env",
  ".env.*",
  "infra/hostman/secrets.env",
  "infra/hostman/state.json",
  "infra/production/production.env",
  "infra/production/docker-tls",
  "*.log",
]);
for (const f of ["services.yaml", "openbao.hcl", "openbao-init.sh", "compose.yaml", "Caddyfile"])
  rsync(
    path.join(root, "infra/production", f),
    `root@${app.publicIp}:/srv/brawzer/production/${f}`,
  );
for (const f of ["ca.pem", "cert.pem", "key.pem"])
  rsync(
    path.join(root, "infra/production/docker-tls", f),
    `root@${app.publicIp}:/etc/brawzer/docker-tls/${f}`,
  );
// The API runs as the image's "node" user (uid 1000) and must read the client key.
ssh(
  app.publicIp,
  "chown -R root:1000 /etc/brawzer/docker-tls && chmod 750 /etc/brawzer/docker-tls && chmod 640 /etc/brawzer/docker-tls/key.pem && chmod 644 /etc/brawzer/docker-tls/ca.pem /etc/brawzer/docker-tls/cert.pem",
  { quiet: true },
);
sshWrite(
  app.publicIp,
  "/srv/brawzer/production/services.env",
  `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}\nVALKEY_PASSWORD=${VALKEY_PASSWORD}\n`,
);

console.log("\n2. Services (PostgreSQL, Valkey, OpenBao, ClamAV)");
ssh(
  app.publicIp,
  `set -e; cd /srv/brawzer/production
docker network inspect brawzer_app >/dev/null 2>&1 || docker network create --subnet 172.30.0.0/24 brawzer_app >/dev/null
docker compose -f services.yaml --env-file services.env up -d --wait --quiet-pull 2>&1 | tail -1
# The keeper is stateless and its script may have changed: start it afresh so it
# brings the policy and the API token up to date before the settings are written.
docker compose -f services.yaml --env-file services.env up -d --force-recreate openbao-unseal 2>&1 | tail -1
docker compose -f services.yaml --env-file services.env ps --format "  {{.Service}}: {{.Status}}"
for i in $(seq 1 45); do docker compose -f services.yaml --env-file services.env logs --since 2m openbao-unseal 2>/dev/null | grep -q "openbao-keeper: watching" && break; sleep 2; done
docker compose -f services.yaml --env-file services.env logs --since 2m openbao-unseal 2>/dev/null | grep "openbao-keeper:" | sed 's/^.*openbao-keeper:/  keeper:/'
[ -s /etc/brawzer/openbao/api-token ] || { echo "OpenBao's keeper has not produced the API token"; exit 1; }`,
);

if (build) {
  console.log("\n3. Images on the app host (API and web); this takes several minutes");
  ssh(
    app.publicIp,
    `set -e; cd /srv/brawzer/src
docker build -q -f apps/api/Dockerfile -t brawzer-api:local . | sed 's/^/  api: /'
${apiOnly ? "" : `docker build -q -f apps/web/Dockerfile -t brawzer-web:local --build-arg NEXT_PUBLIC_SITE_URL=${origin} --build-arg API_INTERNAL_URL=http://api:4100 . | sed 's/^/  web: /'`}`,
  );
  if (pushRuntime) {
    console.log(
      "   Runtime and egress images, built on the app host and streamed to the runtime host",
    );
    ssh(
      app.publicIp,
      `set -e; cd /srv/brawzer/src
docker build -q -f apps/runtime-agent/Dockerfile -t brawzer-runtime:local . | sed 's/^/  runtime: /'
docker build -q -f apps/egress/Dockerfile -t brawzer-egress:local . | sed 's/^/  egress: /'
docker save brawzer-runtime:local brawzer-egress:local | ssh -o BatchMode=yes root@${runtime.publicIp} docker load | sed 's/^/  /'`,
    );
  }
}

console.log("\n4. Production settings");
const vaultToken = ssh(app.publicIp, "cat /etc/brawzer/openbao/api-token", { quiet: true }).trim();
// Production-only settings live in secrets.env, not in the development .env.
const optional = (name) => (secrets[name] ? `${name}=${secrets[name]}\n` : "");
const productionEnv = `# Written by infra/hostman/deploy.mjs on ${new Date().toISOString()}. Not in git.
API_IMAGE=brawzer-api:local
WEB_IMAGE=brawzer-web:local
API_REPLICAS=1
SITE_HOST=${SITE_HOST}

WEB_ORIGIN=${origin}
DATABASE_URL=postgres://brawzer:${POSTGRES_PASSWORD}@postgres:5432/brawzer
REDIS_URL=redis://:${VALKEY_PASSWORD}@valkey:6379
EMAIL_TRANSPORT=resend
RESEND_API_KEY=${RESEND_API_KEY}
EMAIL_FROM=${EMAIL_FROM}
${optional("EMAIL_REPLY_TO")}${optional("RESEND_WEBHOOK_SECRET")}KEY_PROVIDER=vault
VAULT_ADDR=http://openbao:8200
VAULT_TOKEN=${vaultToken}
PROXY_TEST_URL=${origin}/api/v1/network/echo
PROXY_TEST_RUNNER=egress
STORAGE_ENDPOINT=https://s3.hmstorage.net
STORAGE_REGION=us-2
STORAGE_BUCKET=${state.bucket.name}
STORAGE_ACCESS_KEY_ID=${STORAGE_ACCESS_KEY_ID}
STORAGE_SECRET_ACCESS_KEY=${STORAGE_SECRET_ACCESS_KEY}
CLAMAV_HOST=clamav
CLAMAV_PORT=3310

DOCKER_HOST=tcp://${runtime.publicIp}:2376
DOCKER_TLS_DIR=/etc/brawzer/docker-tls
DOCKER_TLS_CA=/run/docker-tls/ca.pem
DOCKER_TLS_CERT=/run/docker-tls/cert.pem
DOCKER_TLS_KEY=/run/docker-tls/key.pem
BROWSER_RUNTIME_IMAGE=brawzer-runtime:local
EGRESS_IMAGE=brawzer-egress:local
BROWSER_CONTAINER_RUNTIME=runsc
BROWSER_MAX_LIVE_SESSIONS=6
BROWSER_STREAM_URL=wss://${SITE_HOST}
METRICS_TOKEN=${secrets.METRICS_TOKEN}
STAFF_SECOND_FACTOR=required

ADMIN_EMAILS=${ADMIN_EMAILS}
${optional("STRIPE_SECRET_KEY")}${optional("STRIPE_WEBHOOK_SECRET")}${optional("BILLING_PLANS")}${optional("ANTHROPIC_API_KEY")}`;
sshWrite(app.publicIp, "/srv/brawzer/production/production.env", productionEnv);
console.log("  written to /srv/brawzer/production/production.env (mode 600)");

if (apiOnly) {
  console.log("\n6. Migrations and the API only");
  ssh(
    app.publicIp,
    `set -e; cd /srv/brawzer/production
WEB_IMAGE=unused docker compose -f compose.yaml --env-file production.env up -d --wait --quiet-pull migrate api 2>&1 | tail -2
WEB_IMAGE=unused docker compose -f compose.yaml --env-file production.env ps -a --format "  {{.Service}}: {{.Status}}"
echo "  health from inside the network: $(docker run --rm --network brawzer_app curlimages/curl:8.14.1 -sS --max-time 10 http://api:4100/api/v1/health)"`,
  );
  process.exit(0);
}

console.log("\n5. Backups: nightly to the bucket, encrypted");
ssh(app.publicIp, "mkdir -p /etc/brawzer/backup && chmod 700 /etc/brawzer/backup");
sshWrite(
  app.publicIp,
  "/etc/brawzer/backup/env",
  `S3_ENDPOINT=https://s3.hmstorage.net
S3_REGION=us-2
S3_BUCKET=${state.bucket.name}
S3_ACCESS_KEY_ID=${STORAGE_ACCESS_KEY_ID}
S3_SECRET_ACCESS_KEY=${STORAGE_SECRET_ACCESS_KEY}
KEEP_DAYS=30
`,
);
sshWrite(app.publicIp, "/etc/brawzer/backup/passphrase", `${secrets.BACKUP_PASSPHRASE}\n`);
ssh(
  app.publicIp,
  `set -e
install -m 755 /srv/brawzer/src/infra/production/backup/backup.sh /usr/local/sbin/brawzer-backup
install -m 755 /srv/brawzer/src/infra/production/backup/restore.sh /usr/local/sbin/brawzer-restore
printf '%s\n' 'SHELL=/bin/bash' 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' '30 3 * * * root /usr/local/sbin/brawzer-backup >> /var/log/brawzer-backup.log 2>&1' > /etc/cron.d/brawzer-backup
chmod 644 /etc/cron.d/brawzer-backup
echo "  brawzer-backup installed; runs at 03:30 UTC (log: /var/log/brawzer-backup.log)"`,
);

console.log("\n6. The stack (migrations, API, web, Caddy)");
ssh(
  app.publicIp,
  `set -e; cd /srv/brawzer/production
docker compose -f compose.yaml --env-file production.env up -d --wait --quiet-pull 2>&1 | tail -2
docker compose -f compose.yaml --env-file production.env ps --format "  {{.Service}}: {{.Status}}"`,
);

checks();
console.log(
  "\nDone. Logs: ssh root@" +
    app.publicIp +
    " 'cd /srv/brawzer/production && docker compose -f compose.yaml --env-file production.env logs -f api'",
);
