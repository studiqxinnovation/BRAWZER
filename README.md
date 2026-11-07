# Brawzer

**Browse anywhere. Leave nothing behind.**

Brawzer is a cloud browser platform. The browser runs in Brawzer's cloud; the
computer in front of you (at a café, library or hotel) is only a window to it.
Profiles, history and downloads stay with your account, not on the machine.

> **Status: Phase 1 complete; Phase 2 in progress** (milestones 2.1–2.5 done:
> encrypted secrets, passkeys, two-factor authentication, account controls and
> alerts, profiles). Next: proxy settings and phone sign-in by QR code. There
> is no cloud browser yet; it is built in Phase 3. See
> [the Phase 2 plan](docs/plans/phase-2.md), [the Phase 1 review](docs/reviews/phase-1.md)
> and [the architecture](docs/ARCHITECTURE.md).

---

## What works today

| Area           | What is real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | NestJS 12 on Fastify. `GET /api/v1/health` checks PostgreSQL and Redis live. Validated config, structured logs with secret redaction, one error format, security headers, OpenAPI docs.                                                                                                                                                                                                                                                                                                                                                                              |
| Accounts       | Create an account, confirm the email (the link asks for the password you chose), sign in with a password or a **passkey** (including your phone), optional **two-factor authentication** with recovery codes, sign out, reset or change your password. Change the email address, download your data or delete the account. Emails for new-device sign-ins. Shared-computer sessions by default, argon2id, rate limits, "confirm it's you" before sensitive changes.                                                                                                  |
| Website        | Home, Product, Security, Profiles, Drive, Pricing and About, plus draft Privacy and Terms. Honest pre-launch notice, no invented prices or facts, sitemap, search engines blocked until launch.                                                                                                                                                                                                                                                                                                                                                                      |
| Web app        | Next.js 16. Account pages and the signed-in app: Home, **Sessions** (every signed-in device, sign any out remotely), **Shield** (protection status, recommendations, new-device alerts, security history), **Account** (email, passkeys, two-factor, password, your data, deletion, appearance), **Profiles** (create, rename, colour, reorder and delete; browsing in them arrives in Phase 3). Idle warning and sign-out on shared computers. Unbuilt modules (Browser, Drive, Proxy, Extensions) are clearly labelled. `/dev` and `/design` are development-only. |
| Design system  | Tokens for light and dark themes, three accent options, three logo concepts, and 20 accessible components built on Base UI.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Local services | PostgreSQL 18, Valkey (Redis-compatible), Mailpit and OpenBao (Vault-compatible key service) in Docker, bound to `127.0.0.1` only.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Quality        | Strict TypeScript, type-aware ESLint with accessibility rules, unit, integration and end-to-end tests including automated WCAG 2.2 AA checks on every page. Lighthouse: 100 for performance, accessibility and best practices.                                                                                                                                                                                                                                                                                                                                       |

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
7. Leave a shared-computer session alone for 26 minutes to see the idle warning (the page signs out 2 minutes later).

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

Apps for the cloud browser itself (session gateway, orchestrator, runtime
agent) are added in Phase 3.

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

| Suite                                 | Needs           | Covers                                                                                                                                                                                                                                                                    |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`pnpm test`)                    | Nothing         | Config parsing, log redaction, error handling, health logic, schemas, tokens, password rules, email templates, origin checks, colour maths, theme handling, every component's behaviour and accessibility                                                                 |
| Integration (`pnpm test:integration`) | `pnpm infra:up` | The real API against PostgreSQL, Valkey and Mailpit: every account flow, pre-hijacking, lockout, idle timeout, CSRF, device sessions, password change, security history, data retention, and the API in its production configuration                                      |
| End-to-end (`pnpm test:e2e`)          | `pnpm infra:up` | Real Chromium at desktop and phone sizes: pages, the account journey with real emails, the signed-in app (navigation, remote and cross-tab sign-out, the idle warning with a controlled clock), the strict script policy, WCAG 2.2 AA (axe), keyboard and focus behaviour |

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
