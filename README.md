# Brawzer

**Browse anywhere. Leave nothing behind.**

Brawzer is a cloud browser platform. The browser runs in Brawzer's cloud; the
computer in front of you (at a café, library or hotel) is only a window to it.
Profiles, history and downloads stay with your account, not on the machine.

> **Status: Phases 1 to 4 built** (Phase 2: encrypted secrets, passkeys,
> two-factor authentication, account controls and alerts, profiles, proxies;
> phone sign-in by QR code was not built. Phase 3a: the cloud browser, one
> isolated Chromium container per session streamed into Brawzer's own chrome,
> downloads and printed pages into Drive, file choosers answered from Drive,
> profiles that keep their cookies and history encrypted between sessions;
> sound, WebRTC and Firefox are Phase 3b. Phase 4: Drive. Phase 5: an egress
> sidecar per session, traffic through the profile's proxy, proxy tests out
> of the API). Nothing is hosted
> publicly yet (Phase 7). See [the Phase 3 review](docs/reviews/phase-3.md),
> [the Phase 4 review](docs/reviews/phase-4.md),
> [the Phase 2 review](docs/reviews/phase-2.md) and
> [the architecture](docs/ARCHITECTURE.md).

---

## What works today

| Area           | What is real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | NestJS 12 on Fastify. `GET /api/v1/health` checks PostgreSQL, Redis, the object store and the malware scanner live. Validated config, structured logs with secret redaction, one error format, security headers, OpenAPI docs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Accounts       | Create an account, confirm the email (the link asks for the password you chose), sign in with a password or a **passkey** (including your phone), optional **two-factor authentication** with recovery codes, sign out, reset or change your password. Change the email address (the old address can undo it for 7 days), download your data or delete the account. Emails for new-device sign-ins. Shared-computer sessions by default, argon2id, rate limits, "confirm it's you" before sensitive changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Website        | Home, Product, Security, Profiles, Drive, Pricing and About, plus draft Privacy and Terms. Honest pre-launch notice, no invented prices or facts, sitemap, search engines blocked until launch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Web app        | Next.js 16. Account pages and the signed-in app: Home, **Sessions** (every signed-in device, sign any out remotely), **Shield** (protection status, recommendations, new-device alerts, security history), **Account** (email, passkeys, two-factor, password, your data, deletion, appearance), **Browser** (a real Chromium in Brawzer's cloud, started per session in its own hardened container: Brawzer draws the tabs, address bar and page dialogs, only page pixels are streamed, every connection leaves through an egress sidecar that blocks private addresses at the network level and uses the profile's proxy, downloads and printed pages go to Drive, a website asking for a file gets one from Brawzer's Drive picker, and camera, microphone and location are refused and explained), **Profiles** (create, rename, colour, reorder, delete and choose a proxy; a profile opens in the cloud browser with its own cookies, history and sign-ins, saved encrypted between sessions or starting clean if you prefer, with "Clear data"; a temporary session keeps nothing), **Proxy** (save proxies with encrypted credentials and test them from an isolated container; a profile's sessions browse through its proxy, so websites see the proxy's address; changing a profile's proxy asks you to confirm it's you), **Drive** (upload files from your device, folders, search, previews of images, PDFs and text, "Save to this computer" behind confirm-it's-you; every file scanned by ClamAV and stored encrypted with its own key; infected files quarantined). Idle warning and sign-out on shared computers. The unbuilt module (Extensions) is clearly labelled. `/dev` and `/design` are development-only. |
| Design system  | Tokens for light and dark themes, three accent options, three logo concepts, and 20 accessible components built on Base UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Egress         | `apps/egress` ([ADR 0014](docs/adr/0014-egress-service.md)): one sidecar container per session that owns the session's network namespace and installs an nftables ruleset so only it can reach out (the engine has no route and no DNS); it applies the address rules, refuses ports and the engine's background services, and forwards through the profile's saved proxy with credentials the runtime never sees. The same image runs proxy tests for the API. `@brawzer/proxy-client` is the shared tunnel and tester.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Cloud browser  | `apps/runtime-agent` inside each session's container: drives Debian's Chromium over the DevTools pipe (no debugging port), streams JPEG frames with end-to-end acknowledgements, applies input, forwards page dialogs, hands downloads and printed pages to Drive and Drive files to page file choosers over the same connection, refuses device access, restores and packs the profile's data around the engine's life, and runs the filtering proxy every page connection goes through ([ADR 0012](docs/adr/0012-cloud-browser-runtime-isolation.md), [ADR 0013](docs/adr/0013-profile-data-and-drive-hand-off.md)). The API's orchestrator starts containers read-only, without capabilities, under a seccomp profile that keeps Chromium's sandbox on; its relay links the page's WebSocket to the agent after a single-use ticket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Local services | PostgreSQL 18, Valkey (Redis-compatible), Mailpit, OpenBao (Vault-compatible key service), RustFS (S3-compatible object store) and ClamAV in Docker, bound to `127.0.0.1` only; cloud browser sessions run as containers on the same Docker engine from the image built with `pnpm runtime:build`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Quality        | Strict TypeScript, type-aware ESLint with accessibility rules, unit, integration and end-to-end tests including automated WCAG 2.2 AA checks on every page. Lighthouse: 100 for performance, accessibility and best practices. CI on every pull request (`.github/workflows/ci.yml`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Anything not built yet is either absent or clearly marked with a
**Development state** notice. There are no buttons that do nothing.

---

## Requirements

- macOS or Linux
- **Node.js 26** or newer (`node -v`)
- **pnpm 12**. Node 25+ no longer bundles Corepack, so install it once with
  `npm install -g pnpm@12`
- **Docker Desktop** (or another Docker engine), running

## Quick start

```bash
cp .env.example .env      # local development settings (no real secrets)
pnpm install              # install dependencies
pnpm infra:up             # start PostgreSQL, Valkey, Mailpit and OpenBao, wait until healthy
pnpm db:migrate           # check the database connection and apply migrations
pnpm runtime:build        # build the cloud browser runtime image (Debian Chromium + the agent)
pnpm dev                  # start the API and the web app
```

Then open:

| What                        | Address                                |
| --------------------------- | -------------------------------------- |
| Website                     | <http://localhost:3100>                |
| Create an account / sign in | <http://localhost:3100/create-account> |
| Signed-in app               | <http://localhost:3100/app>            |
| Development console         | <http://localhost:3100/dev>            |
| Design system review        | <http://localhost:3100/design>         |
| API health                  | <http://localhost:4100/api/v1/health>  |
| API docs (development only) | <http://localhost:4100/api/docs>       |
| Email inbox (Mailpit)       | <http://localhost:8125>                |

Brawzer uses its own ports (3100, 4100, 5433, 6380, 1125, 8125, 8210) so it can
run beside other projects that use the common defaults. OpenBao on 8210 is a
local, in-memory stand-in for the production key service.

### Try an account locally

1. Open <http://localhost:3100/create-account> and choose an email and password. Any address works: nothing leaves your machine.
2. Open the Mailpit inbox at <http://localhost:8125> and click the link in "Confirm your email for Brawzer".
3. Enter the same password. You're signed in at <http://localhost:3100/app>.
4. Sign in from a second browser (or a private window) and open **Sessions**: both devices are listed, and you can sign either out from the other.
5. **Shield** shows how the account is protected, what it recommends, sign-ins from new devices and the security history. Sign in from a different browser to see a new-device alert (and its email in Mailpit).
6. **Account** changes your email (the link goes to the new address in Mailpit), password, passkeys and two-factor, downloads your data as JSON, or deletes the account.
7. **Profiles** creates, colours, reorders and deletes profiles, and chooses whether each keeps its browsing data; **Proxy** saves proxies and tests them from the API. A SOCKS or HTTP proxy running on your own machine can be tested because `.env` sets the development-only `PROXY_TEST_ALLOW_PRIVATE=true`.
8. Leave a shared-computer session alone for 26 minutes to see the idle warning (the page signs out 2 minutes later).

## Deployment

Container images for the API and web app, a production-like staging stack behind HTTPS, and CI are described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Everyday commands

Run from the repository root.

| Command                            | What it does                                                   |
| ---------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                         | Start every app in watch mode                                  |
| `pnpm build`                       | Production build of every package and app                      |
| `pnpm lint`                        | ESLint across the repository (type-aware, accessibility rules) |
| `pnpm format`                      | Format all files with Prettier                                 |
| `pnpm typecheck`                   | TypeScript checks in every package                             |
| `pnpm test`                        | Unit tests (no services needed)                                |
| `pnpm test:integration`            | API tests against the real local services                      |
| `pnpm test:e2e`                    | Browser tests in Chromium, desktop and mobile sizes            |
| `pnpm check`                       | Lint, format check, type check and unit tests together         |
| `pnpm infra:up` / `infra:down`     | Start or stop local services (data is kept)                    |
| `pnpm infra:reset`                 | Stop local services and **delete** their data                  |
| `pnpm infra:status` / `infra:logs` | Inspect local services                                         |
| `pnpm db:generate`                 | Create a migration from schema changes                         |
| `pnpm db:migrate`                  | Apply pending migrations                                       |
| `pnpm runtime:build`               | Build the cloud browser runtime image (`brawzer-runtime:dev`)  |

The first end-to-end run needs a browser: `pnpm --filter @brawzer/web exec playwright install chromium`.

## Project structure

```
apps/
  web/            Next.js 16: public site, sign-in, app shell, browser workspace
  api/            NestJS 12 on Fastify: REST API under /api/v1, OpenAPI docs
packages/
  contracts/      Zod schemas shared by the web app and the API
  db/             Drizzle ORM schema, migrations and database client
  ui/             Design system: tokens, components, logo and icons
infra/
  compose/        Local development services (Docker Compose)
docs/
  ARCHITECTURE.md Architecture and phase plan
  SECURITY.md     Threat model, current controls, residual risks
  adr/            Architecture decision records
```

The cloud browser's orchestrator and stream relay live in the API
(`apps/api/src/browser`); the runtime agent is `apps/runtime-agent`. Splitting
the orchestrator and relay into their own services is a Phase 7 item.

## Configuration

All settings live in `.env` at the repository root, created from
[`.env.example`](.env.example), which documents every variable. Rules:

- `.env` is never committed. Production values come from the hosting
  platform's secret manager.
- Only variables starting with `NEXT_PUBLIC_` reach the browser. Secrets never
  use that prefix.
- The API validates its configuration at startup and refuses to start with a
  clear message if something is missing. It never prints the values.

## Testing

| Suite                                 | Needs           | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`pnpm test`)                    | Nothing         | Config parsing, log redaction, error handling, health logic, schemas, tokens, password rules, email templates, origin checks, colour maths, theme handling, every component's behaviour and accessibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Integration (`pnpm test:integration`) | `pnpm infra:up` | The real API against PostgreSQL, Valkey, Mailpit, OpenBao, RustFS and ClamAV: every account flow, pre-hijacking, lockout, idle timeout, CSRF, device sessions, password change, security history, data retention, Drive (uploads, the EICAR test file, limits, folders, previews, download tickets), the cloud browser against real runtime containers (sessions, the stream through the relay, browsing the in-container test site over HTTP and HTTPS, dialogs, downloads and printed pages into Drive, over-limit downloads, file choosers fed from Drive, profiles keeping cookies between sessions, blocked addresses, the egress sidecar owning the network, a session browsing through a profile's SOCKS5 proxy, the proxy-change step-up, tickets, ending on sign-out), proxy tests through the egress tester container, and the API in its production configuration |
| End-to-end (`pnpm test:e2e`)          | `pnpm infra:up` | Real Chromium at desktop and phone sizes: pages, the account journey with real emails, the signed-in app (navigation, remote and cross-tab sign-out, the idle warning with a controlled clock, Drive uploads, previews, saving and quarantine, a cloud browser session from start to end with a download, a printed page and the Drive picker, profiles' keep-data switch), the strict script policy, WCAG 2.2 AA (axe), keyboard and focus behaviour                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Dependencies and supply chain

- Every dependency version is pinned once, in the `catalog` of
  [`pnpm-workspace.yaml`](pnpm-workspace.yaml).
- **pnpm only installs releases that have been public for at least 7 days**
  (`minimumReleaseAge`). Pick versions that satisfy this when upgrading; don't add exemptions.
- Install scripts of dependencies are blocked unless listed under `allowBuilds`.

## Security

Brawzer's promise depends on being honest about what it can and cannot
protect. Read [docs/SECURITY.md](docs/SECURITY.md) for the threat model, the
controls in place today and the remaining risks of using a computer you don't
own, and [docs/reviews/phase-1.md](docs/reviews/phase-1.md) for the Phase 1
security review and its findings.

## Troubleshooting

- **A page shows a different app.** Another project is using that port. Brawzer's
  web app is on 3100, not 3000.
- **"Local system status" shows the API as unreachable.** Run `pnpm dev`.
- **PostgreSQL or Redis shows as unreachable.** Start Docker, then run `pnpm infra:up`.
- **`pnpm install` refuses a package as too new.** That's the 7-day release-age
  policy. Choose the newest version that is at least a week old.
- **The API exits with "Invalid API configuration".** Copy `.env.example` to
  `.env`, or fix the variable it names.
- **No email arrives.** Local email never reaches real inboxes; open Mailpit at
  <http://localhost:8125>. If it's empty, check that `pnpm infra:up` is running.
- **"This request didn't come from a Brawzer page."** The API only accepts
  form submissions from `WEB_ORIGIN` and `ALLOWED_ORIGINS`. Browse the site at
  one of those addresses (by default `localhost:3100` or `127.0.0.1:3100`).
- **"Too many attempts."** Rate limits reset after their window (at most an
  hour). In development, `pnpm infra:reset` also clears them, along with all
  local data.
