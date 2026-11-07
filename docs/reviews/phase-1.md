# Phase 1 review

- **Date:** 2026-11-07
- **Scope:** milestones 1.1–1.6: foundation, design system, public website, accounts, signed-in app shell, and this review.
- **Verdict:** Phase 1 is complete. The foundation is ready for Phase 2 (passkeys and two-factor authentication, profiles, proxy settings). Several product decisions are still needed before launch; see the end.

## What exists

| Area           | Real today                                                                                                                                                                                 | Labelled as not built yet                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Public website | Home, Product, Security, Profiles, Drive, Pricing, About, draft Privacy and Terms, pre-launch notice, noindex until launch                                                                 | Prices (none invented)                                                                              |
| Accounts       | Sign-up with email confirmation that requires the chosen password, sign-in, sign-out, forgot and reset password, change password                                                           | Passkeys, two-factor authentication, changing email, deleting the account (Phase 2)                 |
| Sessions       | Shared-computer mode by default, "keep me signed in" opt-in, list of signed-in devices, signing any device out remotely, idle warning and sign-out on shared computers, cross-tab sign-out | Cloud browser sessions (Phase 3)                                                                    |
| Shield         | The account's security history                                                                                                                                                             | Alerts and recommendations (Phase 2)                                                                |
| App shell      | Sidebar and phone drawer, Home, Sessions, Shield, Account                                                                                                                                  | Browser, Profiles, Drive, Proxy, Extensions: each page says which phase builds it and what it needs |
| API            | Versioned REST under `/api/v1`, OpenAPI docs in development, one error format, validation and response filtering on every route                                                            | Billing, profiles, proxies, files (later phases)                                                    |
| Infrastructure | PostgreSQL 18, Valkey, Mailpit locally; migrations; data-retention job                                                                                                                     | Hosting, Resend domain, TURN, object storage (later phases)                                         |

## How it was verified

| Check                                                             | Result                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (five packages)                                        | 257 passing                                                                                                                                                         |
| API integration tests against real PostgreSQL, Valkey and Mailpit | 39 passing, including a production-configuration suite                                                                                                              |
| Browser tests (Chromium, desktop and phone)                       | 115 passing, 5 skipped by design                                                                                                                                    |
| Accessibility                                                     | WCAG 2.2 AA checks (axe) on every page in light and dark themes, plus keyboard and focus tests                                                                      |
| Production build                                                  | Builds cleanly. Public pages are prerendered; account pages and the app render per request                                                                          |
| Production server, checked by hand                                | Dev pages return 404, `/app` redirects to sign-in, strict policy and hydration work on account pages, no `eval` allowed, security headers present, crawlers blocked |
| Lint, formatting, type checks                                     | Clean                                                                                                                                                               |
| Dependency audit                                                  | 3 moderate advisories, none reachable (see below)                                                                                                                   |

## Security review

**Method.** The review read every authentication and session path in the
API and the web app against the threat model in [SECURITY.md](../SECURITY.md).
It covered injection, cross-site request forgery, session handling, account
enumeration, rate limiting, logging and data retention, plus automated scans
for raw HTML, `eval`, raw SQL and request logging. It also exercised the
production configuration (API) and production build (web), and audited the
dependencies.

**Already sound.** Passwords use argon2id. Session tokens are random and
stored only as hashes, in HttpOnly SameSite cookies (`__Host-` over HTTPS).
Every state-changing request needs an origin check. Responses don't reveal
which addresses have accounts. Sign-up confirmation requires the chosen
password, which prevents account pre-hijacking. Every response is no-store.
Logs carry no secrets. Responses are filtered so internal fields can't leak.
Raw HTML is never rendered, apart from one static script allowed by its hash.

### Findings

| #   | Finding                                                                                                                | Severity                | Resolution                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Pages where passwords are typed or account data is shown allowed inline scripts, so injected markup could run there    | High (defence in depth) | **Fixed.** Strict per-request nonce policy on account pages and the app; full page loads into that area ([ADR 0007](../adr/0007-content-security-policy.md)) |
| 2   | Rate limiting switched off entirely if Redis was unreachable                                                           | Medium                  | **Fixed.** Bounded in-memory counters per API instance until Redis returns                                                                                   |
| 3   | No screening of passwords exposed in data breaches                                                                     | Medium                  | **Fixed.** Pwned Passwords range check with k-anonymity, on in production, skipped if the service is down                                                    |
| 4   | No retention limit for the security history, ended sessions, used links or abandoned sign-ups                          | Medium (privacy)        | **Fixed.** Retention job every 6 hours (history 365 days by default)                                                                                         |
| 5   | A reset link requested before a password change still worked afterwards                                                | Low                     | **Fixed.** Changing the password cancels outstanding reset links                                                                                             |
| 6   | With a trusted proxy, a forged `X-Forwarded-For` could store arbitrary text as the client address                      | Low                     | **Fixed.** Only valid IP addresses are kept                                                                                                                  |
| 7   | Focus didn't always move to the first invalid field after a server error (timing-dependent)                            | Low (accessibility)     | **Fixed.** Focus now waits for the field to render                                                                                                           |
| 8   | Moderate advisories in transitive dependencies (`esbuild` via `drizzle-kit`; `glob`/`minimatch` via `@fastify/static`) | Low (not reachable)     | **Accepted until 2026-11-13.** Patched versions are newer than the 7-day release-age policy allows                                                           |

### Remaining risks

Listed with reasons in [SECURITY.md → Remaining risks](../SECURITY.md#remaining-risks-reviewed-in-milestone-16):

- public pages allow inline scripts
- other people can trigger the sign-in lockout (until passkeys arrive)
- small timing differences between existing and unknown addresses
- no email retry queue
- rate limits during a Redis outage apply per API instance
- the production proxy setup for client addresses must be configured at deployment

None blocks Phase 2.

## Decisions needed from you

| Decision                                          | Current working default                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| Logo concept and accent colour                    | Stack logo, Cobalt accent                                                  |
| Pricing and plans                                 | None shown ("no prices yet")                                               |
| About page facts (company, people, location)      | Mission only                                                               |
| Domain, and the sending domain for email          | Not set. Production needs a verified domain at Resend and `RESEND_API_KEY` |
| Email provider                                    | Resend                                                                     |
| Security history retention                        | 365 days (`SECURITY_HISTORY_RETENTION_DAYS`)                               |
| Breached-password check                           | On in production (`BREACHED_PASSWORD_CHECK`)                               |
| Security contact and disclosure policy            | Needed before launch                                                       |
| Legal review of the draft Privacy and Terms pages | Needed before launch                                                       |

## Next: Phase 2

Passkeys (including signing in on a public computer with your phone, so no
password is typed there) and two-factor authentication. Then profiles,
proxy settings with server-side encryption, alerts for new-device sign-ins, and
the remaining account controls (change email, delete account). See
[ARCHITECTURE.md](../ARCHITECTURE.md#phases).
