# Deployment

How Brawzer is built, checked and run outside a developer's machine. No
hosting provider is assumed ([ADR 0016](adr/0016-production-hosting.md)):
the app tier is a compose stack on any Linux host, sessions run on runtime
hosts reached over mutual TLS, and the managed services are whatever speaks
PostgreSQL, Valkey, S3 and the key service's API. Operations are in
[RUNBOOK.md](RUNBOOK.md).

## Container images

| Image   | Dockerfile            | Runs                      | Port |
| ------- | --------------------- | ------------------------- | ---- |
| API     | `apps/api/Dockerfile` | `node dist/main.js`       | 4100 |
| Web app | `apps/web/Dockerfile` | `node apps/web/server.js` | 3100 |

Build both from the repository root. Both images:

- start from the same Node 26 base, pinned by digest;
- install with `--frozen-lockfile`, so the lockfile and the 7-day release-age policy apply;
- run as the unprivileged `node` user, with files owned by root;
- work with a read-only file system, no Linux capabilities and `no-new-privileges` (the staging stack runs them that way);
- have a health check (`/api/v1/health` and `/`).

```sh
docker build -f apps/api/Dockerfile -t brawzer-api .
docker build -f apps/web/Dockerfile -t brawzer-web \
  --build-arg NEXT_PUBLIC_SITE_URL=https://brawzer.example \
  --build-arg API_INTERNAL_URL=http://api:4100 .
```

The web image needs two values **at build time**: the public site URL (used in
metadata, and it turns on HTTPS-only headers) and the API's internal address
(the `/api/v1` forwarding is fixed when the app is built). At run time it also
reads `API_INTERNAL_URL` for server-side requests.

## Releasing

`.github/workflows/release.yml` builds the four images (API, web, runtime,
egress) on a `v*` tag and pushes them to `ghcr.io/<owner>/brawzer-*` tagged
with the version and the commit; every Monday it rebuilds `nightly` from
`main` so base-image security updates reach the images. Deployments pin by
digest. Then:

1. Pull the runtime and egress images on the runtime host.
2. Set the digests in `infra/production/production.env` and `docker compose -f infra/production/compose.yaml --env-file infra/production/production.env up -d --wait`: migrations run once from the API image, then the API instances, then the web app.

The API refuses to start with an unsafe production configuration: plain HTTP,
email that isn't Resend, a local encryption key, development proxy-test
settings, and so on. `.env.example` documents every setting.

## Routing

Put a TLS-terminating proxy in front:

- `/api/v1/*` goes straight to the API, and `TRUST_PROXY` lists only that proxy's address, so the API records real client addresses and nothing else can claim to be a client.
- Everything else goes to the web app.

`infra/staging/Caddyfile` is a working example.

## Staging stack

`infra/staging/compose.yaml` runs the real images with production settings
behind Caddy on `https://brawzer.localhost:8443`. It also runs PostgreSQL,
Valkey, OpenBao, RustFS (Drive's object store), ClamAV, and a one-off migration step.

```sh
cp infra/staging/staging.env.example infra/staging/staging.env   # fill in
docker compose -f infra/staging/compose.yaml --env-file infra/staging/staging.env up -d --build --wait
```

- **OpenBao runs in dev mode** as a stand-in for a managed key service: its keys live in memory, so anything encrypted with them becomes unreadable after a restart. It's for checking the stack, not for real data.
- **Email needs a real Resend key** and a verified sending domain; without one, sign-up confirmation emails aren't delivered.
- **Checked on 2026-11-07:**
  - Every service became healthy, and migrations and key setup ran once and exited.
  - Pages were served over HTTP/2 with HSTS and the security headers, with a fresh nonce for each account page.
  - `/app` redirected to sign-in, and `/design`, `/dev` and the API docs returned 404.
  - Cross-site requests were refused.
  - The session cookie was `__Host-…; HttpOnly; Secure; SameSite=Lax`.
  - The security history recorded the client's address rather than the proxy's.
  - Both app containers ran as `node` with a read-only root and no capabilities.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

| Job                            | What it does                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| Lint, types, unit tests, build | `pnpm check`, then `pnpm build`                                                          |
| API integration tests          | Starts the local services (`pnpm infra:up`), migrates, runs `pnpm test:integration`      |
| Browser tests                  | The same services, Chromium for Playwright, `pnpm test:e2e`; keeps the report on failure |
| Container images               | Builds both images and checks they run as a non-root user                                |
| Dependency audit               | Fails on high or critical advisories                                                     |

Every action is pinned to a full commit SHA, the token is read-only,
checkout doesn't keep credentials, and pnpm is installed from npm at the
version in `package.json`. The workflow passes `actionlint`. The browser tests run against the production build (below), because `next dev` compiles routes on demand and is too slow on a shared runner.

## Plans and billing

Without `STRIPE_SECRET_KEY`, only the free plan exists and the Account page
says paid plans aren't set up; that is a valid production state. To offer
plans ([ADR 0015](adr/0015-plans-and-billing.md)):

- Create the Prices in Stripe and describe the plans in `BILLING_PLANS` (code, name, Stripe price id, limits); the amounts shown come from Stripe.
- Set `STRIPE_SECRET_KEY` (a live key in production) and `STRIPE_WEBHOOK_SECRET`, and point a Stripe webhook at `POST /api/v1/billing/webhook` for `checkout.session.completed` and `customer.subscription.*`. The route takes the raw body; the reverse proxy must pass it through unchanged.
- Name administrators in `ADMIN_EMAILS`; they get the Admin page after their next start of the API (or at account creation).

## Drive storage and scanning

Drive needs two services the API can't do without:

- **An S3-compatible object store** (`STORAGE_*`): AWS S3, Cloudflare R2 or similar. The bucket must exist in production (development creates it); its only client is the API, with credentials from the secret manager or an IAM role. Objects are ciphertext (ADR 0011), so bucket-level encryption and versioning are optional extras, not controls Brawzer relies on. Custom endpoints must be `https`.
- **ClamAV's `clamd`** (`CLAMAV_HOST`, `CLAMAV_PORT`): reachable only from the API. Uploads are refused while it is down, so run it with a health check and keep signatures updated with `freshclam` (the compose files disable updates and use the image's bundled signatures). Set `StreamMaxLength` to at least 100M, as the compose files do with `CLAMD_CONF_StreamMaxLength`.

## Cloud browser runtime

Browser sessions run as containers started by the API through the Docker
Engine API ([ADR 0012](adr/0012-cloud-browser-runtime-isolation.md)):

- **The runtime image** is built from the repository root with `pnpm runtime:build` (`apps/runtime-agent/Dockerfile`: Debian's Chromium plus the agent, non-root). The API expects it under `BROWSER_RUNTIME_IMAGE` (default `brawzer-runtime:dev`); rebuild it for Chromium security updates.
- **The engine.** In development, the local socket (`DOCKER_HOST`, or the usual locations). In production, a runtime host's engine over `DOCKER_HOST=tcp://host:2376` with mutual TLS (`DOCKER_TLS_CA`, `DOCKER_TLS_CERT`, `DOCKER_TLS_KEY`), which the configuration requires; the socket is never mounted into the API container. `infra/production/runtime-host/README.md` provisions a host and `make-certs.sh` makes the certificates. The agent ports the engine publishes bind on the runtime host (`BROWSER_AGENT_BIND`, every interface for a remote engine: firewall them to the app tier) and are reached at `BROWSER_AGENT_HOST` (the engine's host by default). `BROWSER_CONTAINER_RUNTIME=runsc` runs sessions under gVisor. `BROWSER_MAX_LIVE_SESSIONS` bounds the installation. The staging stack runs sessions for real through a TLS-protected engine in a container.
- **The stream URL** (`BROWSER_STREAM_URL`) is where the Browser page opens its WebSocket. It defaults to the API's own address, which works in development; in production it must be a `wss://` URL on the site's own origin, routed to the API by the edge (the web server's `/api/v1` rewrite doesn't carry WebSockets). A different origin needs `NEXT_PUBLIC_STREAM_ORIGIN` in the web app's build so the page's `connect-src` allows it.
- **The egress image** (`apps/egress/Dockerfile`, built by `pnpm runtime:build` too, `EGRESS_IMAGE`) runs one sidecar per session and one proxy tester per API instance ([ADR 0014](adr/0014-egress-service.md)). Sidecars need `CAP_NET_ADMIN`, `SETUID` and `SETGID` (the orchestrator grants exactly those) and the kernel's nftables; the runtime shares each sidecar's network namespace. `PROXY_TEST_RUNNER` must be `egress` in production; `EGRESS_LOOPBACK_HOST` is for development only.
- **Profile data and cloud browser downloads** use the same object store and scanner as Drive ([ADR 0013](adr/0013-profile-data-and-drive-hand-off.md)): profile archives under `profiles/<account>/`, downloads as Drive files. The runtime learns Drive's per-file limit from the API (`DRIVE_MAX_FILE_BYTES`, passed into the container); profile archives are capped at 256 MiB compressed. Budget object storage for both.
- **The test site** (`BROWSER_TEST_SITE`) serves `testsite.invalid` over HTTP and HTTPS inside each runtime for the browser tests (the HTTPS certificate is made per container and trusted only by that container's engine, for that one key). Development and CI only; refused in production.

## Not done yet

- **A provider and the managed services themselves** (PostgreSQL, Valkey, the object store, a key service, ClamAV): provisioned per installation; the stacks reach them by address.
- **A verified Resend sending domain.** It needs the website domain.
- **TURN servers for WebRTC streaming** (Phase 3b): declined after the spike; the frame stream is what ships. (The runtime-host scheduler and the warm pool were built in Phase 8.)
- **An independent penetration test** and the isolation checks on a real host (runbook).

## Running the browser tests against a production build

CI runs the e2e suite against the standalone production build, not `next dev`.
To reproduce that locally:

```bash
BRAWZER_DEV_PAGES=enabled pnpm build   # /dev and /design are compiled out otherwise
CI=1 pnpm --filter @brawzer/web exec playwright test
```

Notes:

- `next start` does not serve `output: "standalone"`; use `pnpm --filter @brawzer/web run start:standalone`.
- Zod probes `Function("")` once to detect a strict CSP. The browser reports it
  as `script-src eval` with an empty sample; `e2e/csp.spec.ts` ignores that one case.
- `BRAWZER_DEV_PAGES` is read at build time and is part of Turbo's cache key (`globalEnv`).
