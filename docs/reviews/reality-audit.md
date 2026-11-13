# Project reality audit

Audited 2026-11-11, on `phase-8-finishing` at commit 0a1d93c, across every
part of the repository: the web app (Next.js), the API (NestJS), the database
(Drizzle, PostgreSQL), the cloud-browser runtime and egress services, the
shared packages, the infrastructure files and the CI and release workflows.
The question was not "does it look finished" but "what actually works", with
every claim checked by running the thing or reading the code that does it.

## How it was checked

| Check                                  | How                                                                                                                                                              | Result                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Types, lint, formatting, unit tests    | `pnpm run check` at the root (13 workspace tasks)                                                                                                                | Green                                                                           |
| API integration tests                  | `pnpm --filter @brawzer/api run test:integration` against the local services and Docker                                                                          | 187 of 188 pass; the one failure (warm pool) passes alone and in CI, see F6     |
| End-to-end tests                       | Playwright, desktop and phone, against the real stack with real cloud browsers in Docker, in development and against the production build as CI runs it          | 201 pass, 29 skipped by design (phone-only or desktop-only variants), both ways |
| CI                                     | GitHub Actions on the branch: lint/types/unit/build, API integration, browser tests, container images, dependency audit                                          | All green at 0a1d93c                                                            |
| Production build and images            | CI builds the standalone web app and the API, runtime and egress images; every image runs as a non-root user                                                     | Green                                                                           |
| Every page and app, by hand (scripted) | A sweep that opens every public page, every signed-in page and every desktop app on desktop and phone, recording console errors, failed requests and screenshots | See "The sweep" below                                                           |
| Schema against migrations              | `drizzle-kit check` and `drizzle-kit generate` (no pending changes)                                                                                              | Consistent: 33 migrations, nothing uncovered                                    |
| Routes against calls                   | Every API path the web app calls, matched against the controllers' routes                                                                                        | No call without a route                                                         |
| Mocks, stubs, placeholders             | Searches for mock, fake, stub, simulated, placeholder, TODO, hardcoded and sample data outside tests                                                             | None in product code (the only "fake" is the test-only Stripe server)           |
| Dead controls                          | Searches for empty handlers, `href="#"`, `alert`, `console.log`, and a button inventory of every app window                                                      | None found                                                                      |
| Unused exports                         | Every exported symbol, checked for a use anywhere else                                                                                                           | 31 unused, mostly types; one dead component (F3)                                |
| Environment and configuration          | `.env.example` against `.env`, the API's config schema and its production-only rules, the production and staging settings templates                              | Consistent; production refuses unsafe values at start                           |

## The verdict in one paragraph

Brawzer is real. Every feature listed in the README has a backend, a
database table where it needs one, and tests that exercise it against the
real services: accounts with passkeys, two-factor and phone sign-in; cloud
browsers that run in isolated containers and stream pixels; Drive with
scanning and encryption; profiles, proxies and egress; teams; plans and
Stripe billing; the desktop with its thirty apps whose records are sealed
per account; the Assistant through Claude when a key is set. There is no
mocked data, no placeholder page, no control that pretends. What the
prototype showed but Brawzer doesn't build is listed in
[docs/plans/phase-9.md](../plans/phase-9.md) under "Not built, and why",
and that list is honest. The findings below are real but small: one feature
enforced only in the page, one missing rate limit, dead code, stale
documentation, duplicated requests, and the things nobody can finish from a
repository (a provider, a domain, a penetration test).

## Status by area

| Area                                                                                           | Status            | Notes                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts: sign up, email confirmation, sign in                                                 | WORKING           | argon2id, breached-password check, email links by fragment; integration and e2e tests                                                                                                                                                 |
| Sessions: shared-computer default, keep signed in, idle sign-out, sign out everywhere          | WORKING           | Server-side lifetimes, token rotation, `Clear-Site-Data`; e2e covers idle and cross-tab sign-out                                                                                                                                      |
| Passkeys                                                                                       | WORKING           | Registration, sign-in, confirmation, rename, delete; shared-computer rule (phone or key only); virtual authenticator tests                                                                                                            |
| Two-factor (TOTP, recovery codes)                                                              | WORKING           | Integration and e2e                                                                                                                                                                                                                   |
| Sign in with your phone (QR approval)                                                          | WORKING           | Passkey required for approval when the account has one                                                                                                                                                                                |
| Lock screen                                                                                    | WORKING           | Server-enforced: 423 on every route but unlock and sign-out; streams stop                                                                                                                                                             |
| Account: email change and undo, password, export, delete                                       | WORKING           | Recent-authentication guard on sensitive routes                                                                                                                                                                                       |
| Profiles, per-profile data (cookies, history)                                                  | WORKING           | Encrypted archives in the object store, per-profile keys                                                                                                                                                                              |
| History and bookmarks                                                                          | WORKING           | Encrypted per profile; visit budget                                                                                                                                                                                                   |
| Proxies and proxy tests                                                                        | WORKING           | SSRF rules, tester container, credentials sealed                                                                                                                                                                                      |
| Site rules                                                                                     | WORKING           | Applied by each session's egress                                                                                                                                                                                                      |
| Cloud browsers (Bee, Chrome, Firefox, Edge, Chromium)                                          | WORKING           | One hardened container pair per session, pixels streamed, downloads to Drive, sound; e2e drives real sessions. Edge only on x86-64 runtimes, as documented                                                                            |
| Extensions from the catalogue                                                                  | WORKING           | Fetched at image build by pinned URL and SHA-256                                                                                                                                                                                      |
| Drive: upload, folders, preview, download tickets, trash                                       | WORKING           | ClamAV scan before storage; encrypted chunks; restore and empty trash                                                                                                                                                                 |
| Teams                                                                                          | WORKING           | Roles under row locks, seats, shared proxies and Drive                                                                                                                                                                                |
| Plans and billing                                                                              | WORKING           | Stripe checkout, portal and webhook (raw-body signature check); free plan only without a key, and the page says so                                                                                                                    |
| Admin                                                                                          | WORKING           | Accounts, plans by hand, runtime view, reports, re-wrap job; admin role plus recent authentication                                                                                                                                    |
| Shield and the security history                                                                | WORKING           | Real events only                                                                                                                                                                                                                      |
| The desktop: windows, Dock and taskbar, Launchpad, Control Centre, switcher, menus, wallpapers | WORKING           | Prefs in the `desktop` app record; wallpapers are real photographs with credits; a photo of one's own goes to Drive                                                                                                                   |
| Files, Trash, Photos, PDF Viewer, Music                                                        | WORKING           | All over Drive's real files                                                                                                                                                                                                           |
| Notepad, Writer, Calc, Code, Templates                                                         | WORKING           | Save to Drive                                                                                                                                                                                                                         |
| Assignments, Citations, Focus Timer, Money, Invoices                                           | WORKING           | Sealed app records; Invoices makes real PDFs                                                                                                                                                                                          |
| Exam Mode                                                                                      | PARTIALLY WORKING | Kept with the account and ends early only after confirming it's you, but the API enforced none of it: a browser could still be started from another tab or by a direct request, and the record deleted without confirming (F1, fixed) |
| App Store (web apps), Web Store (extensions)                                                   | WORKING           | Web apps are shortcuts opened in a cloud browser; nothing installs on the device, as the copy says                                                                                                                                    |
| Passwords, Mail                                                                                | WORKING           | Honest launchers: they open the person's own password manager or mail provider in a cloud browser. Brawzer runs neither                                                                                                               |
| Usage                                                                                          | WORKING           | Screen time measured in the page per app, browsing minutes from the API                                                                                                                                                               |
| Screenshot                                                                                     | WORKING           | Captures a cloud browser's streamed page and saves a PNG to Drive                                                                                                                                                                     |
| Send to Phone                                                                                  | WORKING           | QR codes drawn in the page; a Drive file's link opens Drive after sign-in                                                                                                                                                             |
| Terminal                                                                                       | WORKING           | Brawzer's own commands over the account's Drive, apps and browsers; no shell on a server, by design                                                                                                                                   |
| Assistant, Study Notes                                                                         | WORKING           | Through Claude when `ANTHROPIC_API_KEY` is set; off and said so otherwise; rate limited per account                                                                                                                                   |
| Public site                                                                                    | WORKING           | Honest copy; no third-party assets; strict CSP on account pages                                                                                                                                                                       |
| Production hosting                                                                             | PARTIALLY WORKING | Images, compose files, Caddy, runbook and release pipeline exist and CI builds the images; nothing is hosted yet (a provider, a domain, a verified sending domain and a penetration test are outside the repository)                  |
| Metrics and health                                                                             | WORKING           | Prometheus text format behind a token in production                                                                                                                                                                                   |
| WebRTC video streaming                                                                         | MISSING by design | Spiked and declined ([phase-3b-spike](phase-3b-spike.md)); the frame stream is what ships                                                                                                                                             |
| Exit locations, VPN, tracker counts, bundled music, guest mode                                 | MISSING by design | Prototype features that only looked like features; see Phase 9's "Not built, and why"                                                                                                                                                 |

## Findings

Each finding: what, where, why it matters, what right looks like, what was
done.

### F1. Exam Mode was enforced only in the page

- **What:** Exam Mode limits which apps and browsers open for a set time; ending it early asks for the password. The limits were applied by the desktop's own code, and the API knew nothing of them: `DELETE /api/v1/apps/exam-mode/records/current` deleted the record for anyone with the session, and `POST /api/v1/browser/sessions` started any browser.
- **Where:** `apps/api/src/app-records/app-records.controller.ts`, `apps/api/src/browser/browser.service.ts`; the page's checks in `apps/web/src/lib/exam.ts`.
- **Why it matters:** a second tab in the classic layout, a phone, or a direct request walked around it. A tool that says "only these open until the time is up" should mean it.
- **Right:** the API refuses to start a browser that the running exam doesn't allow, and deleting the running exam's record requires confirming it's you (as the page already does); once the time is up, the record goes without confirmation.
- **Done:** implemented in the API with integration tests (see "Fixes").

### F2. App-record writes had no rate limit

- **What:** `PUT /api/v1/apps/:app/records/:key` seals each write with the key service and had no per-account rate limit, unlike uploads, tickets and the assistant.
- **Where:** `apps/api/src/app-records/app-records.service.ts`, `apps/api/src/rate-limit/rate-limiter.ts`.
- **Why it matters:** a script holding one session could make the API call the key service as fast as it liked. Not a data risk (records are the account's own, bounded to 500 of 256 KB), but a resource one.
- **Right:** a per-account limit generous enough for sliders and auto-save (the page already debounces) and small enough to stop a loop.
- **Done:** 600 writes per 15 minutes per account, with a test.

### F3. Dead code

- **What:** `PlannedModulePage` (a "not built yet" page from Phase 1, no longer rendered anywhere); the unused API helper `mfaStatus`; the unused helpers `isFavourite`, `subscribeToCutFile`, `planLabel`, `isThemePreference`; the UI kit's unused `PopoverClose` and `focusRing`.
- **Why it matters:** a placeholder-page component invites placeholder pages; the rest is weight.
- **Done:** removed. The empty `plannedModules` map and its test stay: they force any future "planned" navigation item to declare what it needs.

### F4. Documentation that lagged the code

- **What:** the README said "eight wallpapers"; `docs/DEPLOYMENT.md` listed the warm pool and the runtime-host scheduler under "Not done yet" although Phase 8 built both; `docs/SECURITY.md` said the wallpaper is kept only in `sessionStorage`.
- **Done:** corrected.

### F5. The same data fetched several times per page load

- **What:** opening a signed-in page fetched `/api/v1/drive` three times, `/api/v1/health` four times and `/api/v1/security/events` twice, because the status bar, the dashboard's cards and the shell each ask for their own copy (and development's strict mode doubles effects).
- **Where:** `apps/web/src/lib/api/client.ts` and the components that call `fetchDriveOverview`, `fetchHealth`, `fetchSecurityEvents`.
- **Why it matters:** wasted round trips on every page, more under load.
- **Right:** concurrent identical GETs share one request.
- **Done:** the API client shares an in-flight GET with everyone who asks for the same path while it's pending; nothing is cached after it settles, so a read after a write still reads fresh.

### F6. One integration test is sensitive to a shared Docker engine

- **What:** `warm-pool.integration.test.ts` failed once in the full local run (the session got a container that wasn't the pooled one) and passed when run alone; it is green in CI.
- **Why:** every suite starts its own API with its own pool on the one local engine, and a development API was running beside them. The test already notes this.
- **Done:** nothing in the code; recorded here. UNVERIFIED as deterministic under a shared engine.

### F7. Noise in the development console

- **What:** the `motion` library warns "You have Reduced Motion enabled" on every public page when the browser asks for less motion. It is a library message in development builds only, not an error, and not shown in production.
- **Done:** nothing; recorded so nobody chases it.

### F8. Things that cannot be finished from the repository

- A hosting provider and the managed services (PostgreSQL, Valkey, object store, key service, ClamAV), a domain with a verified Resend sending domain, live Stripe keys and prices, and an independent penetration test. The code is ready for them: production refuses to start with unsafe values and the runbook says how to operate it.
- Gaming wallpapers: no freely licensed photographs were found; no trademarked art may be used.

## The sweep

Every public page (13), every signed-in page (12) and every desktop app
(28), on desktop and phone, with the console and the network watched.

- Public pages: no errors; the one 404 is the deliberate not-found probe.
- Signed-in pages (desktop and phone): no errors, no failed requests. The
  only console line is the `motion` library's reduced-motion notice (F7).
- Every app opened in its window with no error and no failed request. The
  controls each window exposes were inventoried (close, minimise and zoom,
  then the app's own); every one of them is wired to code that was read in
  this audit. Files, Trash, Photos, PDF Viewer, Music, Notepad, Writer,
  Calc, Code, App Store, Web Store, Passwords, Usage, Screenshot, Send to
  Phone, Mail, Assistant, Study Notes, Terminal, Templates, Calculator,
  Settings, Assignments, Citations, Focus Timer, Exam Mode, Money, Invoices.
- One inconsistency found by eye: a non-administrator opening `/app/admin`
  got the 404 page (correct: the page doesn't exist for them) under a window
  title that still said "Admin, accounts, plans and the cloud". Fixed: the
  window's title says "Not found" while a 404 shows (F9).

### F9. The window title named a page that wasn't there

- **What:** the dashboard window's title bar takes the page's name from the address; on a 404 it still named the page the address looked like.
- **Where:** `apps/web/src/components/desktop/dashboard-bar.tsx`, `apps/web/src/app/not-found.tsx`.
- **Done:** the 404 page marks itself (`NotFoundMark`) and the title bar says "Not found" while it shows.

### F11. Streamed page segments linger for a moment, and tests must not count them

- **What:** on the production build, the server streams each card of a page as a hidden segment (`<div hidden id="S:…">`) that React swaps into place. When the desktop shell takes the page into its window as the client takes over, a segment can stay in the body, hidden, for a few hundred milliseconds after the same content is already shown. Nobody sees it (it is hidden, to eyes and to assistive technology), but a test that finds text anywhere on the page then finds it twice and stops on the first look.
- **Where:** seen on `/app/account` (the Plan and two-factor cards) in the team and two-factor journeys, in CI and reproduced against a local production build; never in development, where there is no streaming of this kind.
- **Right:** tests read the card they mean, so a hidden copy elsewhere is not their business.
- **Done:** the team and two-factor journeys read their cards by name (the passkey journey already did). Whether the shell should keep the page in one place across hydration, so segments never go stale, is noted for the next phase; it is a refactor of the desktop shell, not a defect people meet.

### F10. The last preference change could be lost on reload

- **What:** desktop preferences (wallpaper, Dock, sounds) are written 400 ms after they settle; a reload inside that window flushed the write on `pagehide` with a plain `fetch`, which a browser may cancel as the page goes.
- **Done:** the flush is sent with `keepalive`, which the browser finishes after the page is gone; the wallpaper test waits for the account to hold the last choice before reloading.

## Fixes

| Fix                                            | Files                                                                                                                                                                          | Verified by                                                                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 Exam Mode enforced by the API               | `packages/contracts/src/app-records.ts` (the record's shape), `app-records.service.ts` (`currentExam`), `app-records.controller.ts`, `browser.service.ts`, `browser.module.ts` | `test/app-records.integration.test.ts`: a disallowed browser answers 403; deleting the running exam answers 403 `reauthentication_required` until confirmed, 204 after, and 204 once over; the e2e Exam Mode journey still passes |
| F2 App-record write limit                      | `rate-limiter.ts`, `app-records.service.ts`                                                                                                                                    | Integration test with `RATE_LIMIT_SCALE=1`: 600 writes pass, the 601st answers 429, reads are unlimited                                                                                                                           |
| F3 Dead code removed                           | `planned-module-page.tsx` (deleted), `mfa.ts`, `desktop-prefs.ts`, `file-clipboard.ts`, `plans.ts`, `theme.ts`, `popover.tsx`, `popup.ts`                                      | Types, lint and unit tests                                                                                                                                                                                                        |
| F4 Documentation corrected                     | `README.md`, `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/plans/phase-9.md`                                                                                                 | Read                                                                                                                                                                                                                              |
| F5 Concurrent identical GETs share one request | `apps/web/src/lib/api/client.ts`                                                                                                                                               | Unit tests of the client; the desktop, apps, home and extensions e2e specs                                                                                                                                                        |
| F9 "Not found" in the window title on a 404    | `dashboard-bar.tsx`, `not-found.tsx`, `not-found-mark.tsx`, `desktop-focus.ts`                                                                                                 | Types and the app-shell e2e spec                                                                                                                                                                                                  |
| F10 The last preference save survives a reload | `client.ts` (`keepalive`), `app-records.ts`, `desktop-prefs.ts`, `e2e/desktop.spec.ts`                                                                                         | The desktop e2e spec                                                                                                                                                                                                              |

Kept on purpose: `plannedModules` and its test, which force any future
"planned" navigation item to declare what it needs; the map is empty
because every module is built.

## Production readiness

Ready to deploy as far as the repository goes: images build from pinned
bases, settings are validated, secrets stay server-side, every write is
origin-checked, every response is uncacheable, sessions are revocable from
anywhere, and the runbook covers the incidents that matter. What stands
between this and a public launch is outside the code: the provider and
managed services, the domain and sending domain, live billing keys, and a
penetration test with the isolation checks run on a real runtime host.

## Recommended next priorities

1. Provision staging on a provider with the managed services and run the runbook's isolation checks on a real host.
2. The penetration test, with the Phase 8 and 9 code in scope.
3. A verified sending domain and live Stripe prices (pricing itself is undecided).
4. Then the next product phase, as planned with the owner.
