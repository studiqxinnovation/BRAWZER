# Phase 2 review

- **Date:** 2026-11-07
- **Scope:** milestones 2.1 to 2.6 on the `phase-2` branch ([plan](../plans/phase-2.md)).
  Milestone 2.7 (sign in with your phone by QR code) was not built; see below.

## What exists

| Area     | Real today                                                                                                                                      | Not built yet                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Secrets  | Envelope encryption (a data key per secret, bound to its record); Vault/OpenBao Transit in production, a local key in development               | A hosted key service (chosen with hosting)                                 |
| Sign-in  | Passwords; passkeys, including a phone over Bluetooth; authenticator-app codes with recovery codes; "confirm it's you" before sensitive changes | Phone sign-in by QR code for computers without Bluetooth (2.7)             |
| Account  | Change the email address, delete the account, download your data                                                                                | Plans and storage (Phase 6)                                                |
| Shield   | Protection overview, recommendations, new-device alerts by email and in Shield, security history                                                | —                                                                          |
| Profiles | Create, rename, colour, reorder, delete, choose a proxy                                                                                         | Browsing in a profile (Phase 3), its own encrypted browser data (Phase 4)  |
| Proxies  | Saved proxies with encrypted, write-only credentials; tests from Brawzer's servers with plain-language results                                  | Browser traffic through proxies, from an isolated egress service (Phase 5) |

Unbuilt parts are absent or carry a development-state notice that says
which phase builds them. Nothing appears to work that doesn't.

## How it was verified

| Check                                       | Result                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (five packages)                  | 290 passing                                                                                                                                                   |
| API integration tests against real services | 104 passing in 10 suites: PostgreSQL, Valkey, Mailpit, OpenBao as the key service, a production-configuration suite, and local SOCKS5, HTTP and HTTPS proxies |
| Browser tests (Chromium, desktop and phone) | 141 passing, 5 skipped by design. Passkeys use Chromium's virtual authenticator                                                                               |
| Accessibility                               | WCAG 2.2 AA checks (axe) on every app page in light and dark themes, and on the new dialogs and pages                                                         |
| Production build                            | Builds cleanly                                                                                                                                                |
| Lint, formatting, type checks               | Clean                                                                                                                                                         |
| Dependency audit                            | The same 3 moderate advisories as Phase 1, none reachable; the one new runtime dependency (`socks`) adds none                                                 |

## Security review

Each new surface was threat-modelled, its code reviewed, and every control
below has a test.

### Threat model additions

| Surface           | Threat                                                                                                | Controls                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passkeys          | A passkey left on a public computer; a cloned authenticator                                           | Shared-computer sessions only save passkeys on a phone or security key; user verification required; signature counters checked                                                                                      |
| Two-factor        | Replayed or guessed codes                                                                             | Each code works once; a sign-in ticket is burned after 5 wrong codes; per-address and per-account limits                                                                                                            |
| Confirm it's you  | A signed-in computer left unattended                                                                  | Sensitive changes need a sign-in or confirmation from the last 10 minutes; wrong passwords count towards a lockout                                                                                                  |
| Email change      | Takeover by swapping the address; finding out who has an account                                      | Recent sign-in; a link to the new address; notices to the old one; the same reply whether or not the address is taken; a password change or reset cancels it                                                        |
| Account deletion  | Accidental or hostile deletion                                                                        | Recent sign-in and the address typed; every device signed out; confirmation email                                                                                                                                   |
| Data download     | The file left on a shared computer; secrets in the file                                               | Recent sign-in; a warning on shared-computer sessions; no hashes, tokens, secrets or codes (checked on the raw response)                                                                                            |
| New-device alerts | Sign-ins the owner never notices                                                                      | Email and a Shield alert with a "This wasn't me" path to Sessions                                                                                                                                                   |
| Proxy tests       | Server-side request forgery against Brawzer's network or cloud metadata; DNS rebinding; port scanning | Strict host syntax; private, reserved and disguised addresses refused; one lookup with every answer checked; connections by IP; a fixed destination; tight limits ([ADR 0010](../adr/0010-proxy-tests-and-ssrf.md)) |
| Proxy credentials | A database leak; credentials reaching the public computer                                             | Encrypted and bound to their row; never returned; the form never pre-fills them                                                                                                                                     |
| Forms             | A password ending up in a URL                                                                         | Every form posts; tested by a source scan and a browser test with scripts off                                                                                                                                       |

### Findings

| #   | Finding                                                                                                                                                | Severity            | Resolution                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A form submitted before the page finished loading was sent by the browser as GET, putting the password in the address bar, the history and server logs | High                | **Fixed.** Every form uses POST; a unit test rejects any form without it; a no-JavaScript browser test checks sign-in and sign-up |
| 2   | Asking to change to an address another account uses would have revealed that the address has an account                                                | Medium              | **Fixed.** Same reply either way; only that inbox learns why                                                                      |
| 3   | A pending email change would have survived a password change or reset                                                                                  | Medium              | **Fixed.** Both cancel it                                                                                                         |
| 4   | The "email changed" notice pointed to a support channel that doesn't exist                                                                             | Low (honesty)       | **Fixed.** It now says what the owner can do themselves                                                                           |
| 5   | Moderate advisories in transitive dependencies (`esbuild` via `drizzle-kit`; `glob` and `minimatch` via `@fastify/static`)                             | Low (not reachable) | **Still accepted until 2026-11-13**, as in Phase 1                                                                                |

### Remaining risks

- **Proxy tests run inside the API.** Address rules are the only barrier between a test and Brawzer's own network until Phase 5 moves tests and traffic into an isolated egress service. That isolation is required before launch.
- **New-device detection can be imitated** by copying a browser's user agent and network. It informs; it never blocks.
- **No undo for an email change.** The old address is told twice; the owner can still sign in with the password and change it back.
- **Deletion is immediate**, by decision, so a stolen session that passes "confirm it's you" could delete the account.
- **Computers without Bluetooth** can't use a phone's passkey, because QR sign-in (2.7) wasn't built. Password sign-in, with a code if two-factor is on, still works there.
- Carried over from Phase 1: public pages still allow inline scripts; others can trigger the password lockout (passkeys avoid it); rate limits are per API instance during a Redis outage.

## Milestone 2.7 was not built

Sign-in with your phone by QR code was planned and approved, but it was not
built in this phase. Nothing in the product refers to it: the sign-in page
offers passwords and passkeys only. It stays in the plan for a later
milestone.

## Decisions needed from you

| Decision                                             | Current working default                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Logo concept and accent colour                       | Stack logo, Cobalt accent                                             |
| Pricing and plans                                    | None shown                                                            |
| Website domain                                       | `localhost`. Decides where passkeys work and the email sending domain |
| Hosting and key service                              | Not chosen. Production refuses to start without a key service         |
| An "undo email change" link for the old address      | Not built. Recommended before launch                                  |
| "Confirm it's you" before changing a profile's proxy | Not required while no traffic flows; recommended from Phase 5         |
| When to build phone sign-in by QR code (2.7)         | Not scheduled                                                         |
