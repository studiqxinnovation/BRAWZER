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

The key service's key-encryption key wraps every data key (ADR 0008);
rotate it in the key service and keep the previous version readable until
every row has been re-wrapped (a re-wrap job is not built; rows are
re-wrapped when they are next written).

### Capacity

`BROWSER_MAX_LIVE_SESSIONS` bounds the installation; a runtime host with
8 GB and 4 cores runs about 3 sessions comfortably (2 GB and 2 CPUs each at
most, less in practice). When the limit is reached, starting a session
answers 503 with `Retry-After: 60`, and the Browser page says so.

## Before launch

- An independent penetration test of the app tier and a runtime host, with the threat model in [SECURITY.md](SECURITY.md); the isolation tests to repeat are the by-hand checks in the Phase 3 and 5 reviews (a runtime's engine user has no route out and no DNS; a session can't reach private addresses or the engine's services).
- A verified Resend sending domain, a real `SITE_HOST`, live Stripe keys if plans are offered.
- Backups of PostgreSQL and the object store, and a restore rehearsal: objects are useless without their rows and the key service.
