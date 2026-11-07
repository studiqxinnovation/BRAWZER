# Deployment

How Brawzer is built, checked and run outside a developer's machine. Production
hosting is not chosen yet (Phase 7); everything here works on any host that
runs containers.

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

1. Build and push both images (a registry is chosen with hosting).
2. Run migrations once, with the new API image: `node dist/migrate.js`. It needs only `DATABASE_URL`.
3. Start the new API, then the new web app.

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
Valkey, OpenBao, and a one-off migration step.

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
version in `package.json`. The workflow passes `actionlint`. The repository has
no GitHub remote yet, so it hasn't run on GitHub; its steps were run locally.

## Not done yet

- **Image registry, production hosting and a managed key service:** chosen in Phase 7.
- **A verified Resend sending domain.** It needs the website domain.
- **The cloud browser runtime and its TURN servers:** see `docs/plans/phase-3.md`.
- **Automated image rebuilds for base-image security updates:** Phase 7.
