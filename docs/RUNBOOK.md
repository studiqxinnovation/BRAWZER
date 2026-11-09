# Runbook

What to do when something goes wrong, and the routine operations of a
Brawzer installation ([ADR 0016](adr/0016-production-hosting.md)). Every
step uses what the code already provides; nothing here needs a console on a
database.

## Layout

| Where            | What runs                                                                                                 | Holds                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| App tier         | Caddy (edge), the web app, the API (several instances), from `infra/production`                           | Nothing durable: `caddy-data` (certificates) only  |
| Managed services | PostgreSQL, Valkey, the object store, the key service, ClamAV                                             | Everything durable; all encrypted at the API first |
| Runtime host(s)  | The Docker engine with gVisor, one egress sidecar and one runtime container per session (`runtime-host/`) | Session scratch space, destroyed with the session  |

## Watch

- `GET /api/v1/health` on each API instance: `degraded` names the dependency (database, Valkey, store, scanner, runtime).
- `GET /api/metrics` on each API instance (Prometheus text format; `Authorization: Bearer $METRICS_TOKEN`), to scrape and alert on: `brawzer_sessions_live{host}` against `brawzer_runtime_host_capacity{host}`, `brawzer_runtime_host_healthy{host}` and `brawzer_runtime_available`, `brawzer_session_starts_failed_total` and `brawzer_sessions_ended_total{reason="runtime_failed"}`, `brawzer_stream_viewers`, `brawzer_frames_dropped_total` against `brawzer_frames_relayed_total`, `brawzer_transfers_total{kind,state}` and `brawzer_transfer_pauses_total`, `brawzer_scan_seconds` (sum and count: the mean scan time) and `brawzer_scanner_unavailable_total`, `brawzer_stripe_webhooks_total{result}`, `brawzer_warm_pool_waiting`, `brawzer_maintenance_last_run_timestamp_seconds`, `brawzer_build_info{version}`. Counters are per instance and reset with it.
- The API's logs: `Runtime unavailable`, `Egress tester unavailable`, `Reaping sessions failed`, `Saving profile data … failed`, `Removed orphaned` and `Retention run` lines are the ones to alert on or graph.
- `docker ps --filter label=brawzer.managed` on a runtime host: the live sessions, two containers each.
- Stripe's dashboard: webhook deliveries failing means plans stop following subscriptions; the route answers 401 to a bad signature and 204 otherwise.

## Incidents

### A session or an account is misbehaving

1. From the account's own Sessions page, or by an administrator setting its plan to free, nothing stops a running session. End it: `DELETE /api/v1/browser/sessions/:id` as the account, or remove the pair of containers on the runtime host (`docker rm -f` both containers with the session's label); the reaper marks the session `runtime_failed` within 30 seconds and the viewer is cut.
2. To lock the person out, revoke their sign-ins (Sessions page, or `update auth_sessions set revoked_at = now() where user_id = …`): every stream ends within 10 seconds, and every device must sign in again.

### A runtime host is compromised or suspect

1. Point `DOCKER_HOST` at another host (or stop the API's sessions by setting `BROWSER_MAX_LIVE_SESSIONS=1` and ending what runs) and restart the API instances; sessions on the old host end as `runtime_failed` when the API can't see them.
2. Revoke the host's client certificate by making a new CA set (`make-certs.sh`) and installing it on the remaining hosts and the app tier.
3. Profile data and Drive files were never on the host; the session scratch space is gone with the containers. Proxy credentials of profiles that ran there were in sidecar environments: rotate those proxies' passwords.

### The key service is unavailable

Sign-ins keep working; anything that opens an encrypted value (a proxy
test, a session start under a proxy or a profile with data, Drive previews
and downloads) fails with 503 until it returns. Nothing is lost.

### The object store or scanner is unavailable

Uploads, downloads from the cloud browser and profile saves fail and say so;
the session itself keeps running. A session that ended during a store
outage lost that run's profile changes (the previous archive stays). After
the outage, the maintenance job removes objects whose rows were deleted
meanwhile.

### Valkey is unavailable

Rate limits fall back to per-instance counters, every instance reaps on its
own, stream tickets can't be issued (the Browser page can't connect until
it returns), and session ends are only cut on the instance that ended them
(the 10-second validity check on the others still ends the stream).

## Routine operations

### The operator CLI

Each runbook step that touches the application has one command, run with the
API's own configuration: in production
`docker compose exec api node dist/cli/main.js <command>`, locally
`pnpm brawzer <command>`.

| Command                           | Does                                                                   |
| --------------------------------- | ---------------------------------------------------------------------- |
| `sessions`                        | Runtime hosts (reachable, load), the warm pool, every live session     |
| `end-session <id>`                | Ends a session as the Admin page would; the owner's history says so    |
| `find-account <text>`             | Accounts whose email contains the text, with plan and role             |
| `grant-plan <email> <plan> <why>` | Sets a plan by hand with a reason; `free` hands control back to Stripe |
| `rewrap`                          | Re-wraps every secret under the current encryption key                 |
| `usage-notices`                   | Sends due usage emails now                                             |
| `retention`                       | Deletes expired data now                                               |

Exit codes: 0 done, 1 failed (or another instance holds the job's lock), 2
not understood. Certificates for a runtime host stay a script:
`infra/production/runtime-host/make-certs.sh`.

### Rolling a release

1. Tag `vX.Y.Z`; the release workflow pushes the four images. Note the digests it prints.
2. On each runtime host: `docker pull` the runtime and egress images by digest.
3. On the app tier: set the digests in `production.env`, run `docker compose … up -d --wait`. Migrations run once from the new API image before the API starts; the API refuses an unsafe configuration.
4. Running sessions keep their old runtime image until they end; new sessions use the new one.

### Weekly rebuilds

The release workflow rebuilds `nightly` every Monday from `main` so base-image
security updates (Node, Debian's Chromium, nftables) reach the images. Roll
them like a release when the changes matter (the Chromium version is in the
image's `docker image inspect` labels and in each session's status bar).

### Rotating the engine certificates

1. `make-certs.sh <host>` on a safe machine; install the server files on the runtime host and restart its engine (sessions survive an engine restart; the API reconnects).
2. Put the client files in the app tier's `DOCKER_TLS_DIR` and restart the API instances.

### Rotating the encryption key

The key service's key-encryption key wraps every data key (ADR 0008).
Rotate it in the key service (Transit: `POST transit/keys/brawzer/rotate`;
local development: put a new `id:key` first in `ENCRYPTION_KEYS` and keep
the old one after it), then re-wrap every row: `POST /api/v1/admin/maintenance/rewrap`
from the Admin page's account (confirm it's you first), or wait for the
maintenance cadence (every six hours, five minutes after a start). The
response counts rows per table and rows it had to leave; when every run
reports nothing left, retire the previous key version (Transit:
`min_decryption_version`; local: drop the old key from `ENCRYPTION_KEYS`).
Only the wrapping of each data key changes; ciphertexts stay as they are.

### Adding a runtime host

1. Prepare the host as `infra/production/runtime-host/README.md` describes (engine over mutual TLS with the same CA; images pulled).
2. Add it to `RUNTIME_HOSTS` on every API instance: `{"name":"rt-2","docker":"tcp://rt2.internal:2376","capacity":3}` (the name is written on each session's row, so keep it stable), and restart the instances one by one.
3. Watch the health log line for the new host; sessions go to the healthy host with the most room. Removing a host: drain it (set its capacity to 0 is not supported; remove it from the list once its sessions have ended, or end them from the Admin page).

### Capacity

Measure a candidate runtime host before sizing it:
`node infra/bench/stream-load.mjs --sessions 8 --seconds 30` (and
`--engine firefox`) on the host, with the runtime image pulled. It reports
frame rate, bandwidth, CPU and memory per session while every session
scrolls at once; on a developer machine Bee held 32 frames a second at eight
sessions with about half a core each, and needed about 17 Mbit/s each, so
check the host's uplink as well as its CPUs (Phase 8 page, idea 24).

`BROWSER_MAX_LIVE_SESSIONS` bounds the installation; a runtime host with
8 GB and 4 cores runs about 3 sessions comfortably (2 GB and 2 CPUs each at
most, less in practice). `BROWSER_WARM_POOL=n` keeps `n` container pairs
waiting per API instance so a plain Bee session starts at once; each waiting
pair counts against the host like a session, so size the pool from the
capacity left after the expected live sessions. When the limit is reached, starting a session
answers 503 with `Retry-After: 60`, and the Browser page says so.

## Before launch

- An independent penetration test of the app tier and a runtime host, with the threat model in [SECURITY.md](SECURITY.md); the isolation tests to repeat are the by-hand checks in the Phase 3 and 5 reviews (a runtime's engine user has no route out and no DNS; a session can't reach private addresses or the engine's services).
- A verified Resend sending domain, a real `SITE_HOST`, live Stripe keys if plans are offered.
- Backups of PostgreSQL and the object store, and a restore rehearsal: objects are useless without their rows and the key service.
