# Brawzer architecture

This document describes how Brawzer is put together and the order it is built
in. It is updated as each milestone lands. Decisions with lasting consequences
are recorded in [`adr/`](adr/).

## The core idea

**Brawzer draws the browser; the cloud runs the engine.**

The tab bar, address bar, menus, downloads panel and dialogs are Brawzer's own
React interface, drawn on the user's computer. The browser engine (Chromium
first, then Firefox) runs in Brawzer's cloud with no interface of its own. Only
the active tab's page content is streamed into the viewport. Page details such
as the URL, title, favicon, loading state and padlock arrive as data, not
pixels.

There is no remote operating-system screen to stream, so Brawzer can never
feel like remote desktop software. The user's computer is only an access point.

## System overview

```
 PUBLIC COMPUTER                BRAWZER CLOUD
 ┌───────────────────┐  HTTPS   ┌───────────────┐     ┌───────────────────────┐
 │ apps/web          │─────────>│ apps/api      │────>│ Postgres · Redis · S3 │
 │ Brawzer chrome    │          └───────┬───────┘     └───────────────────────┘
 │ + pixel viewport  │                  │ internal
 │ + input capture   │  WSS /   ┌───────┴───────┐     ┌───────────────────────┐
 │                   │<────────>│ apps/gateway  │<───>│ runtime container     │
 └───────────────────┘  WebRTC  └───────────────┘     │ one per live session  │
                                ┌───────────────┐     │ agent + engine        │
                                │ orchestrator  │────>│ egress-proxy sidecar  │
                                └───────────────┘     └───────────────────────┘
```

| Component            | Responsibility                                                                                                                                                                                                      | Must never hold                                                                 | Status                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Public site, sign-in, app shell, browser chrome, viewport, input capture                                                                                                                                            | Secrets, cookies of visited sites, profile data, files                          | Built (1.5, 2, 3.5, 4.4)                                                                                                                |
| `apps/api`           | REST `/api/v1`: accounts and devices, profiles, encrypted proxy settings, Drive records, security events, billing; today also the cloud browser's orchestrator and stream relay (`src/browser`, Phase 3 decision 6) | Credentials that control containers (except the engine socket it needs for now) | Built (1.4, 2, 3.3, 3.4, 4)                                                                                                             |
| `apps/gateway`       | Short-lived stream tickets, relay between user and cloud browser, real-time revocation and idle lock                                                                                                                | Stored user data                                                                | Built as an API module; own service in Phase 7                                                                                          |
| `apps/orchestrator`  | Starts and stops browser containers (Docker locally, Kubernetes later), warm pool, quotas                                                                                                                           | Any public endpoint                                                             | Built as an API module; own service in Phase 7                                                                                          |
| `apps/runtime-agent` | Inside each container: engine control, frame capture, input, downloads and printed pages out to Drive, Drive files in to file choosers, profile data restore and pack, filtering proxy forwarding to the egress     | Other users' data, platform credentials, proxy credentials                      | Built (3.2, 3.7, 3.8; [ADR 0012](adr/0012-cloud-browser-runtime-isolation.md), [ADR 0013](adr/0013-profile-data-and-drive-hand-off.md)) |
| `apps/egress`        | The egress sidecar of each session (firewall, address rules, the profile's proxy) and the proxy tester                                                                                                              | Page content, user data                                                         | Built (5.2, [ADR 0014](adr/0014-egress-service.md))                                                                                     |
| `packages/contracts` | Zod schemas shared by every service                                                                                                                                                                                 | —                                                                               | Started                                                                                                                                 |
| `packages/db`        | Drizzle schema, migrations, client                                                                                                                                                                                  | —                                                                               | Account tables (1.4)                                                                                                                    |
| `packages/ui`        | Design tokens, components, brand                                                                                                                                                                                    | —                                                                               | Built (1.2)                                                                                                                             |

### Request path today

The browser only ever talks to one origin. The web server forwards `/api/v1/*`
to the API, so cookies stay first-party (`__Host-` prefix) and there is no
cross-origin surface. Every API response is `Cache-Control: no-store`; on a
shared computer, a cached response is a leaked response.

Signed-in pages are protected twice: `apps/web/src/proxy.ts` redirects
visitors without a session cookie to `/sign-in` before rendering, and the page
asks the API (`GET /api/v1/auth/session`, cookie forwarded server-side)
whether the session is valid. The API is the only judge of a session.

```
 Browser ──POST /api/v1/auth/login──> web (rewrite) ──> API ── argon2id, sessions ──> Postgres
                                                         └── rate limits ──> Valkey
                                                         └── emails (background) ──> Mailpit / Resend
```

Account pages and the signed-in app render per request with a strict,
nonce-based script policy set by `src/proxy.ts`; public pages are prerendered
([ADR 0007](adr/0007-content-security-policy.md)).

Open signed-in pages keep their session honest from the browser
(`SessionKeeper`): they report activity at most once a minute, rotate the
token every 15 minutes of use, and check every 30 seconds, without counting
as activity (`GET /auth/session/status`), whether the session was ended
elsewhere. On a shared computer they warn after 26 idle minutes and sign out at
28, two minutes before the server would. Tabs share activity and sign-outs
through a `BroadcastChannel`.

In production the edge should route `/api/v1` straight to the API, so that
`TRUST_PROXY` can name the edge as the only source of client addresses (see
[SECURITY.md](SECURITY.md)).

### API modules (milestones 1.4–4.4 and 3.3–3.4)

| Module            | Responsibility                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`            | Sign-up, email confirmation, sign-in/out (password, passkey, two-factor), refresh, password reset and change, passkeys, authenticator codes and recovery codes, confirm-it's-you, signed-in devices, new-device detection; `SessionGuard`, `RecentAuthGuard`                                   |
| `crypto`          | Envelope encryption for secrets at rest; key providers: local (development) and Vault/OpenBao Transit                                                                                                                                                                                          |
| `security`        | Shield: the protection overview and recommendations (`/security/overview`) and the security history (`/security/events`)                                                                                                                                                                       |
| `account`         | Changing the email address, deleting the account, downloading its data (`/account/*`)                                                                                                                                                                                                          |
| `profiles`        | Browser profiles: create, rename, recolour, reorder, delete, keep or clear browsing data (`/profiles`); the first profile, "Personal", is created when an account is confirmed. `ProfileDataService` keeps each profile's encrypted archive in the object store (ADR 0013)                     |
| `proxies`         | Proxy settings with encrypted, write-only credentials (`/proxies`); tests run in the egress tester container (ADR 0010, ADR 0014; `inline` in development without a container engine); the echo endpoint proxy tests fetch (`/network/echo`); the profile's proxy handed to a session's egress |
| `billing`         | Plans (the free plan built in, paid plans from `BILLING_PLANS`), the one reader of limits for every module, usage, Stripe checkout, portal and webhooks (`/billing`, ADR 0015)                                                                                                                 |
| `admin`           | Administrators (`ADMIN_EMAILS`): accounts listed and searched, one account's plan and usage, a plan set by hand with a reason (`/admin`)                                                                                                                                                       |
| `egress`          | The egress service's host side (ADR 0014): the container engine client and the per-instance proxy tester container; the cloud browser's orchestrator builds each session's egress sidecar on it                                                                                                |
| `storage`         | Drive's object store client and the encrypted object format (ADR 0011); creates the bucket in development                                                                                                                                                                                      |
| `scanning`        | ClamAV (`clamd`) client that every Drive upload goes through                                                                                                                                                                                                                                   |
| `drive`           | Brawzer Drive (`/drive`): folders and files, streaming uploads scanned and encrypted as they arrive, content types sniffed from bytes, quarantine, search, limits, previews of safe types, single-use download tickets behind `RecentAuthGuard`                                                |
| `browser`         | The cloud browser (`/browser`): sessions (start, end, overview), single-use stream tickets, the WebSocket relay to each session's runtime agent, the orchestrator and its Docker Engine client, idle and age reaping, orphan cleanup, ending sessions when their sign-in ends                  |
| `maintenance`     | Retention job: deletes expired security history, ended sessions, used links, expired challenges, stale known devices and abandoned sign-ups                                                                                                                                                    |
| `rate-limit`      | Fixed-window counters in Redis, keyed by hashed subjects                                                                                                                                                                                                                                       |
| `email`           | Templates (HTML + text, escaped) and transports: Mailpit, Resend, log                                                                                                                                                                                                                          |
| `security-events` | The account's security history; recording never fails a request                                                                                                                                                                                                                                |
| `health`          | Database, Redis, object store, scanner and container engine (with the runtime image) reachability                                                                                                                                                                                              |

## Key decisions

1. **Streaming in two steps** ([ADR 0006](adr/0006-browser-streaming.md)).
   - **Phase 3a:** Chrome DevTools Protocol screencast over secure WebSocket. Real browsing, quick to build, Chromium only, no audio, about 15–30 fps.
   - **Phase 3b:** WebRTC. The engine runs full-screen in a virtual display sized to the viewport, so the display holds only page content. It's captured with GStreamer and streamed with audio and an input channel, through TURN on port 443 for strict networks.
   - Because WebRTC capture works with any engine, it is what makes Firefox practical. Step 3a remains the fallback where UDP is blocked.
2. **Engines behind one adapter.** Chromium is controlled through CDP, Firefox through WebDriver BiDi on standard Firefox. Edge is Chromium-based and is not presented as a separate engine.
3. **Server-side sessions** ([ADR 0005](adr/0005-session-model.md)).
   - Opaque tokens live in `__Host-` HttpOnly cookies, stored only as hashes.
   - Sessions can be revoked instantly, including live streams.
   - Streams connect with single-use tickets that expire within 60 seconds.
   - Shared-computer mode is the default.
4. **Authentication built in-house** on well-tested libraries (argon2id, SimpleWebAuthn, otplib). Passkey sign-in from the user's phone comes first in Phase 2, so nobody has to type a password on a public keyboard.
5. **Profiles as encrypted archives** ([ADR 0013](adr/0013-profile-data-and-drive-hand-off.md)). One engine data directory per profile, restored into the container before the engine starts and packed, encrypted, when the session ends cleanly. One live session per account means a profile runs in at most one session. Bookmarks and history as Brawzer-owned records are still to come.
6. **Files stay in the cloud** (built, milestone 3.7).
   - Downloads are handed to Brawzer Drive, scanned and encrypted on the way.
   - When a site asks for an upload, Brawzer shows a Drive file picker.
   - Printing produces a PDF in Drive.
   - Saving to the local computer needs an explicit action and a second authentication check.
7. **Egress sidecar** (built, Phase 5, [ADR 0014](adr/0014-egress-service.md)).
   - One `apps/egress` container per session owns the session's network namespace; the runtime joins it with no network of its own.
   - An nftables ruleset lets only the egress process out: the engine has no route and no DNS, so WebRTC and DNS can't leak.
   - The egress forwards through the profile's SOCKS4/4a/5 or HTTP(S) proxy, names unresolved; proxy credentials never reach the runtime.
   - It refuses private, link-local and cloud-metadata addresses, ports a browser has no business with, and the engine's own background services.
   - Proxy tests run in a tester container of the same image, not in the API.
8. **Isolation per session.** One container per live session: non-root, read-only filesystem, Chromium's sandbox kept on. Production adds gVisor or lightweight VMs on separate servers.
9. **The public computer never contacts visited sites.** Favicons and suggestions are fetched in the cloud. Clipboard, file drop, camera, microphone, location and local printing are off by default.
10. **Contracts first.** Zod 4 schemas validate every request, filter every response so unlisted fields can't leak, generate the OpenAPI document, and type the web client.
11. **Provider-neutral infrastructure.** Docker locally, Kubernetes when scale requires it. Hosting is chosen in Phase 7 from measured streaming costs.

## Supported client browsers

Brawzer's own interface targets browsers from 2023 onward: Chrome and Edge
111+, Safari 16.4+ and Firefox 128+. These are the Tailwind CSS 4 baseline;
WebRTC and modern CSS colour functions need them anyway. Before Phase 3 an
"unsupported browser" notice will be added for older computers, which are
common in public places.

## Phases

| Phase | Scope                                                                                                                                                                                                                                     | Status                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1.1   | Workspace, tooling, API foundation, local services, docs                                                                                                                                                                                  | **Done**                                                        |
| 1.2   | Brand concepts, design tokens, components, `/design` review page                                                                                                                                                                          | **Done**, awaiting brand decisions                              |
| 1.3   | Public website: Home, Product, Security, Profiles, Drive, Pricing, About                                                                                                                                                                  | **Done**                                                        |
| 1.4   | Authentication end to end (register, verify, sign in/out, reset)                                                                                                                                                                          | **Done**                                                        |
| 1.5   | Signed-in app shell and navigation                                                                                                                                                                                                        | **Done**                                                        |
| 1.6   | Phase review and security review ([review](reviews/phase-1.md))                                                                                                                                                                           | **Done**                                                        |
| 2     | Passkeys and MFA, profiles, proxies, sessions, security centre, account ([plan](plans/phase-2.md))                                                                                                                                        | **Done** except 2.7 (phone QR sign-in)                          |
| 3     | Cloud browser: gateway, orchestrator, runtime, Chromium (3a), files through Drive and profile data (3.7, 3.8; [plan](plans/phase-3-files-and-profiles.md)), WebRTC (3b), Firefox ([plan](plans/phase-3.md), [review](reviews/phase-3.md)) | **3a and 3.7 to 3.9 done**; 3b (WebRTC, sound, Firefox) planned |
| 4     | Brawzer Drive: uploads, encryption, scanning, folders, previews, saving ([plan](plans/phase-4.md), [review](reviews/phase-4.md))                                                                                                          | **Done**; extensions wait for a reviewed catalogue              |
| 5     | Egress: a sidecar per session, traffic through the profile's proxy, network-level address rules, proxy tests out of the API ([plan](plans/phase-5.md), [ADR 0014](adr/0014-egress-service.md))                                            | **Done**; a per-account destination allow-list is deferred      |
| 6     | Plans and limits, Stripe checkout, portal and webhooks, administration ([plan](plans/phase-6.md), [ADR 0015](adr/0015-plans-and-billing.md), [review](reviews/phase-6.md))                                                                | **Done**; pricing itself undecided, no prices anywhere          |
| 7     | Load, isolation and security testing; deployment                                                                                                                                                                                          | Planned                                                         |

## Decision records

- [0001 Monorepo and toolchain](adr/0001-monorepo-and-toolchain.md)
- [0002 API: NestJS on Fastify with Zod contracts](adr/0002-api-nestjs-fastify-zod.md)
- [0003 Supply-chain policy](adr/0003-supply-chain-policy.md)
- [0004 Design system](adr/0004-design-system.md)
- [0005 Session model](adr/0005-session-model.md)
- [0006 Browser streaming](adr/0006-browser-streaming.md)
- [0007 Content Security Policy](adr/0007-content-security-policy.md)
- [0008 Secrets at rest and recent sign-in](adr/0008-secrets-and-step-up.md)
- [0009 Passkeys and two-factor authentication](adr/0009-passkeys-and-two-factor.md)
