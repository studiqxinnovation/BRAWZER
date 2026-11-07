# Phase 2 plan: identity, profiles and proxies

- **Status:** Approved 2026-11-07, with every decision taken as recommended (table at the end).
- **Date:** 2026-11-07
- **Builds on:** Phase 1 ([review](../reviews/phase-1.md)).

## Goal

Make signing in on a computer you don't own safe **without typing a password
on its keyboard**, give every account real security controls, and turn
Profiles and Proxy from "planned" pages into real, stored, tested
configuration. The cloud browser (Phase 3) and proxy routing (Phase 5) will
use that configuration.

## What Phase 2 delivers

- **Passkeys:** sign in with Face ID, Touch ID, Windows Hello, a security key, or your phone held near the computer. Passkeys are managed in Account.
- **Two-factor authentication:** authenticator-app codes plus single-use recovery codes, for anyone who still signs in with a password.
- **Sign in with your phone (QR):** for public computers without Bluetooth, which can't use the phone-passkey option. _Needs your decision; see the end._
- **Re-confirm before sensitive changes:** changing your email, removing a passkey or turning off two-factor asks you to confirm it's you, if you haven't recently.
- **Account controls:** change email (verified, old address notified), delete the account, and download your data.
- **New-device alerts:** an email and a Shield alert when your account signs in from a browser and network it hasn't seen in 90 days.
- **Shield overview:** recommendations (add a passkey, turn on two-factor, review devices) above the existing activity history.
- **Profiles:** create, rename, colour, reorder and delete profiles, and assign a proxy to each.
- **Proxies:** save SOCKS4, SOCKS5, HTTP and HTTPS proxies, with credentials encrypted and never shown again. Test a connection from Brawzer's servers: reachable, authenticated, latency, and the public address websites will see.

## Boundaries: what Phase 2 does not do

- **No browsing yet.** Profiles and proxies are stored and testable. Browsing in a profile arrives with the cloud browser in Phase 3, and browser traffic through proxies in Phase 5. The pages will say so.
- **No settings that do nothing.** Profiles get only what is pure organisation (name, colour, order, proxy assignment). Privacy settings such as cookie or WebRTC behaviour arrive when the browser can enforce them.
- **No billing.** Temporary limits apply (proposed: 10 profiles and 20 proxies per account) until plans exist in Phase 6.
- **No production key service yet.** Encryption is built behind an interface. Production hosting and its key management service are chosen in Phase 7, and the API refuses to start in production without one.

## Architecture to approve before building

These change how Brawzer handles secrets, identity and outbound connections.
Each gets an ADR when its milestone starts.

1. **Secrets at rest: envelope encryption (ADR 0008).**
   - Every secret (TOTP secrets, proxy credentials) is encrypted with its own random AES-256-GCM data key.
   - That data key is encrypted ("wrapped") by a key-encryption key that never leaves a key service.
   - Stored values record which key wrapped them, so keys can be rotated without downtime.
   - Locally, the key-encryption key comes from a development-only `ENCRYPTION_KEY`. In production it lives in a KMS (AWS KMS, Google Cloud KMS, Azure Key Vault or HashiCorp Vault), and the API won't start without one.
2. **Recent sign-in for sensitive actions ("step-up").** Each session records when its owner last proved who they are. Sensitive actions require that to be within 10 minutes; otherwise the page asks for a passkey, or the password plus a code if two-factor is on, and then continues.
3. **Passkeys (ADR 0009).**
   - WebAuthn via SimpleWebAuthn. Discoverable credentials, so you can sign in without typing your email; user verification is always required.
   - **Passkeys are bound to the website's domain.** The production domain must be decided before real users create passkeys; development uses `localhost`.
   - **Shared-computer rule:** while in shared-computer mode, Brawzer won't create a passkey stored on that computer, only on a phone or security key. A Windows Hello passkey on a library PC would stay with that PC's shared Windows account.
4. **Two-factor sign-in.** A correct password for an account with two-factor gives a single-use ticket valid for 5 minutes, not a session. `POST /api/v1/auth/mfa/verify` exchanges the ticket and a code (or a recovery code) for a session. Passkey sign-in needs no second step, because a passkey is already phishing-resistant multi-factor.
5. **Proxy tests and server-side request forgery (ADR 0010).** Testing a proxy means Brawzer's servers connect to an address you typed, which attackers could aim at Brawzer's own internal network. Defences:
   - Resolve the hostname once, then connect to that exact address (no second lookup an attacker could swap).
   - Refuse private, loopback, link-local, carrier-grade NAT, multicast and cloud-metadata addresses, for IPv4 and IPv6, including disguised forms such as `::ffff:127.0.0.1`.
   - Use a fixed test destination, short timeouts and size limits, and limit concurrent tests per account and in total.
   - In production, tests run in a network-isolated worker that can't reach internal services. That's part of the Phase 5 egress design; until then, the address checks above apply.
6. **Short-lived challenges.** Passkey challenges, two-factor tickets and phone-approval requests live in one `auth_challenges` table: single-use, expiring within 5 minutes, removed by the retention job.

## Milestones

Each milestone ships on its own, with tests, docs and a commit, like Phase 1.

### 2.1 Foundations: encryption and step-up

- **API:**
  - encryption module (envelope encryption, key-provider interface, local provider, key IDs for rotation)
  - `auth_challenges` table
  - `POST /api/v1/auth/reauthenticate` (password now; passkey added in 2.2)
  - a guard that requires a recent sign-in on chosen routes
  - production refuses to start without a key service
- **Web:** a reusable "Confirm it's you" dialog that sensitive actions open when needed.
- **Tests:** encryption round-trip, tampering detected, rotation; guard behaviour; dialog in the browser.
- **Done when:** any route can require a recent sign-in, and secrets can be stored encrypted.

### 2.2 Passkeys

- **Data:** `webauthn_credentials` (credential ID, public key, signature counter, transports, authenticator type, backed-up flag, your name for it, created and last-used times).
- **API:** registration options and verify (signed in and recently confirmed); authentication options and verify (public, creates a session); list, rename and remove (removing needs a recent sign-in).
- **Web:**
  - "Sign in with a passkey" on the sign-in page. The browser's own dialog includes "use a phone or tablet" (QR plus Bluetooth).
  - A Passkeys section in Account.
  - Passkeys in the "Confirm it's you" dialog.
- **Security:**
  - origin and domain checks
  - user verification required
  - signature-counter checks
  - single-use challenges
  - rate limits
  - security events for adding, removing and signing in with a passkey
  - an email when a passkey is added or removed
  - the shared-computer rule above
- **Tests:** browser tests with Chromium's virtual authenticator (register, sign in, remove), plus a manual checklist on real devices (iPhone, Android, Mac, Windows Hello, a security key, and the phone-QR flow), because those can't be automated.
- **Done when:** someone can sign in on a computer without typing a password, using their phone where the computer has Bluetooth.

### 2.3 Two-factor authentication

- **Data:** `totp_factors` (encrypted secret, confirmation time, last code step used, so a code can't be replayed); `recovery_codes` (10 per account, stored hashed, single use).
- **API:**
  - set up: needs a recent sign-in; returns the secret and a QR code drawn on the server as SVG
  - confirm with a first code: returns recovery codes once
  - turn off and regenerate codes: both need a recent sign-in
  - the ticket exchange at `POST /api/v1/auth/mfa/verify`
- **Web:**
  - setup in Account: QR, a key to type in instead, a confirmation code
  - recovery codes shown once, with no download, because downloads stay on shared computers
  - a second sign-in step for codes or recovery codes
- **Security:**
  - codes accepted one 30-second step either side
  - replays refused
  - 5 wrong codes per ticket, and an account-wide limit
  - emails when two-factor is turned on or off, or a recovery code is used
  - a strong warning against setting it up on a shared computer, since cameras and onlookers can capture the QR code
- **Tests:** unit (time window, replay); integration (every flow, with real codes generated in the test); browser (set up, sign out, sign in with a code, then with a recovery code).

### 2.4 Account controls and alerts

- **Change email:** needs a recent sign-in. A link goes to the new address, and a notice goes to the old one. Confirming switches the address and tells the old one.
- **Delete account:** needs a recent sign-in and typing your email to confirm. Everything is deleted at once, and a confirmation email is sent. Immediate deletion versus a grace period is your decision; see the end.
- **Download your data:** account, devices, security history, profiles and proxies, never credentials, as JSON. The page warns that a download stays on the computer.
- **New-device alerts:** a `known_devices` record (browser and OS family plus network, last 90 days). A sign-in from somewhere new sends an email and adds a Shield alert with a "This wasn't me" path to Sessions.
- **Shield overview:** recommendations and recent alerts above the activity history.
- **Sessions:** each device shows how it signed in (password, passkey, phone).
- **Tests:** integration and browser tests for each flow, including the emails.

### 2.5 Profiles

- **Data:** `profiles` (name, colour from the palette, engine, position, proxy, timestamps). A first profile, "Personal", is created when the account is confirmed.
- **API:** create, list, update, delete and reorder, with validation (names 1 to 40 characters and unique per account) and the temporary limit.
- **Web:**
  - The Profiles page becomes real.
  - Engine choice shows Chromium; Firefox appears as planned for Phase 3b.
  - Deleting asks for confirmation.
  - The page states that browsing in a profile arrives in Phase 3.
- **Tests:** API, integration and browser.

### 2.6 Proxies

- **Data:** `proxies` (name, protocol, host, port, encrypted credentials, kind (residential, datacenter, mobile or unspecified), rotation (static, rotating or unknown), last test result, timestamps). A profile's proxy is cleared if the proxy is deleted.
- **API:**
  - create, list, update and delete
  - credentials are write-only: never returned, only "has credentials"; editing keeps the stored ones unless replaced
  - `POST /api/v1/proxies/:id/test` returns reachable, authenticated, latency, exit address and a plain-language reason on failure
- **Tester:**
  - SOCKS4, SOCKS4a and SOCKS5 through the `socks` library
  - HTTP proxies via CONNECT, and HTTPS proxies via TLS first
  - every server-side request forgery defence above
- **Web:**
  - The Proxy page becomes real: list; a form whose password field is never pre-filled; test results; assignment to profiles.
  - The page states that browser traffic uses proxies from Phase 5.
- **Tests:**
  - **Unit:** address blocking, including IPv6, mapped, decimal and zero-address tricks, and a DNS answer that changes between lookups.
  - **Integration:** small SOCKS5 and HTTP proxies started by the tests. Private addresses are allowed only with a test-only flag.
  - **Browser:** add, test and assign.

### 2.7 Sign in with your phone (QR approval)

_Build only if you approve it._

- **For:** public computers without Bluetooth, which can't use the phone-passkey option. That's common on library and café PCs.
- **Flow:**
  1. The public computer shows a QR code and a two-digit number.
  2. Your phone, signed in to Brawzer, scans it.
  3. The phone shows the computer's browser, system and network and asks you to pick the matching number.
  4. You approve with your phone's passkey.
  5. The computer gets a shared-computer session.
- **Threat: QR-login phishing**, where an attacker shows you _their_ code. Defences: number matching, device details, 2-minute single-use requests, rate limits, a security event and an email.
- **Tests:** integration and browser tests with two browser contexts.

### 2.8 Phase 2 review

Security review of the new surfaces (passkeys, two-factor, account controls,
proxy tests), threat-model update, dependency audit, extended
production-configuration tests, and `docs/reviews/phase-2.md`.

## Data model changes

| Table                          | Purpose                                                             | Notes                                                      |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `auth_challenges`              | Passkey challenges, two-factor tickets, phone approvals             | Single use, expires within 5 minutes, cleaned by retention |
| `webauthn_credentials`         | Passkeys                                                            | Public keys only; Brawzer never sees private keys          |
| `totp_factors`                 | Authenticator-app secrets                                           | Secret encrypted (2.1)                                     |
| `recovery_codes`               | Two-factor recovery codes                                           | Hashed, single use                                         |
| `known_devices`                | New-device detection                                                | Browser and network family only; kept 90 days              |
| `profiles`                     | Profiles                                                            | Organisation data only in Phase 2                          |
| `proxies`                      | Proxy settings                                                      | Credentials encrypted and write-only                       |
| `auth_sessions` (change)       | Adds `reauthenticated_at`, `auth_method`                            | For step-up and the Sessions list                          |
| `email_tokens` (change)        | New purpose `change_email` with the pending address                 | Same single-use rules as today                             |
| `security_event_type` (change) | Events for passkeys, two-factor, email change, profiles and proxies | Never contains secrets                                     |

## API additions

| Endpoint                                                                                              | Purpose                                                          |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /api/v1/auth/reauthenticate`                                                                    | Confirm it's you (password, plus code if two-factor; or passkey) |
| `POST /api/v1/auth/passkeys/registration/options`, `…/verify`                                         | Add a passkey                                                    |
| `POST /api/v1/auth/passkeys/authentication/options`, `…/verify`                                       | Sign in with a passkey                                           |
| `GET`, `PATCH`, `DELETE /api/v1/auth/passkeys[/:id]`                                                  | Manage passkeys                                                  |
| `POST /api/v1/auth/mfa/totp/setup`, `…/confirm`; `DELETE /api/v1/auth/mfa/totp`                       | Two-factor setup and removal                                     |
| `POST /api/v1/auth/mfa/verify`                                                                        | Second sign-in step (code or recovery code)                      |
| `POST /api/v1/auth/mfa/recovery-codes`                                                                | New recovery codes                                               |
| `POST /api/v1/account/email`, `POST /api/v1/account/email/verify`                                     | Change email                                                     |
| `DELETE /api/v1/account`, `GET /api/v1/account/export`                                                | Delete account, download data                                    |
| `GET /api/v1/security/overview`                                                                       | Shield recommendations and alerts                                |
| `GET`, `POST /api/v1/profiles`; `PATCH`, `DELETE /api/v1/profiles/:id`                                | Profiles                                                         |
| `GET`, `POST /api/v1/proxies`; `PATCH`, `DELETE /api/v1/proxies/:id`; `POST /api/v1/proxies/:id/test` | Proxies                                                          |
| `POST /api/v1/auth/phone-approval/*`                                                                  | QR approval (2.7, if approved)                                   |

## New dependencies

Versions that meet the 7-day release-age policy today; they'll be checked
again when installed.

| Package                   | Version | Used by | Why                                          |
| ------------------------- | ------- | ------- | -------------------------------------------- |
| `@simplewebauthn/server`  | 14.0.3  | API     | Verifies passkey registration and sign-in    |
| `@simplewebauthn/browser` | 14.0.0  | Web     | Calls the browser's passkey API              |
| `otplib`                  | 13.5.0  | API     | Authenticator-app codes (RFC 6238)           |
| `qrcode`                  | 1.5.4   | API     | Draws the setup QR code as SVG on the server |
| `socks`                   | 2.8.10  | API     | SOCKS client for proxy tests                 |

## External services and configuration

| Need                               | When                             | Local development                   | Production                                                            |
| ---------------------------------- | -------------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Key management service             | 2.1                              | `ENCRYPTION_KEY` (development only) | Chosen with hosting; required before launch                           |
| Website domain                     | Before passkeys reach real users | `localhost`                         | Decides the passkey domain and the email sending domain               |
| Email (Resend)                     | Already planned                  | Mailpit                             | Verified sending domain and `RESEND_API_KEY`                          |
| Exit-address check for proxy tests | 2.6                              | Configurable endpoint               | Recommended: a tiny echo endpoint Brawzer runs itself                 |
| Approximate location for alerts    | Optional                         | None                                | MaxMind GeoLite2 (free licence key), only if you want locations shown |

## How it will be tested

- **Unit:** crypto, time windows, address blocking, validation and copy.
- **Integration:** every flow against real PostgreSQL, Valkey and Mailpit, including real two-factor codes, local test proxies and the production configuration.
- **Browser:** Chromium's virtual authenticator for passkeys, generated codes for two-factor, two browser contexts for phone approval, and accessibility checks on every new page.
- **Manual device checklist:** for passkeys and phone sign-in on real phones and computers. You'll need to try the phone QR flow with your own phone.

## Decisions needed from you

| #   | Decision                                                                | Recommendation                                                                              |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Production domain (passkeys are bound to it)                            | Decide before passkeys reach real users; development can proceed without it                 |
| 2   | Build "Sign in with your phone" QR approval (2.7)?                      | **Yes.** Public PCs often lack Bluetooth, so phone passkeys alone won't cover them          |
| 3   | Recovery when someone loses both their authenticator and recovery codes | No self-service bypass (it would undo two-factor); a support-verified process before launch |
| 4   | Account deletion: immediate, or a grace period?                         | **Immediate**, after confirming it's you and typing your email                              |
| 5   | Two-factor setup on a shared computer: block or warn?                   | Warn clearly and recommend your own device; don't block                                     |
| 6   | Passkeys in shared-computer mode                                        | Only phone or security key passkeys, never ones stored on that computer                     |
| 7   | Exit-address and location providers                                     | Brawzer's own echo endpoint; skip locations for now                                         |
| 8   | Temporary limits before plans                                           | 10 profiles and 20 proxies per account                                                      |
| 9   | Data download in 2.4                                                    | **Include** it, as JSON, with a shared-computer warning                                     |

## Risks

- **Browser differences in passkeys:** handled with SimpleWebAuthn, automated virtual-authenticator tests and the real-device checklist.
- **Passkeys tied to a domain:** decide the domain before launch, or users would have to re-create their passkeys.
- **Server-side request forgery through proxy tests:** the defences above, plus an isolated worker in production.
- **Secrets protected only by a local key:** production can't start without a key service.
- **Scope:** milestones ship independently. 2.7 can move later without blocking anything.
