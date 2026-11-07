# Security

Brawzer is used on computers people don't own. That makes security the
product, and honesty about its limits part of the product. This document is the
working threat model. It is updated with every milestone.

## What Brawzer is designed to protect (when complete)

- **Websites never run on the public computer.** Pages, scripts and plug-ins execute in Brawzer's cloud browser. The public computer receives pixels and sends keyboard and mouse input.
- **Browsing data stays in the cloud.** Cookies, site storage, history, saved sessions and downloads belong to the user's account, not the machine.
- **Downloads don't land on the machine.** Files are saved to Brawzer Drive. Saving one locally is a deliberate, re-authenticated action that is logged.
- **Secrets stay server-side.** Proxy credentials and platform keys never reach the browser.
- **Sessions can be ended from anywhere.** Signing out everywhere disconnects live browser streams immediately.

## What a public computer can still see

No web service can make an untrusted computer trustworthy. Brawzer reduces
exposure; it cannot remove these risks:

- **Keyloggers and screen recorders.** A compromised computer can record what is typed and what is shown. Passkey sign-in from the user's own phone is planned specifically so that no password has to be typed.
- **Malicious browser extensions** on the public computer can read the Brawzer page itself.
- **Shoulder surfing and cameras.**
- **Small traces of Brawzer itself:** a history entry for the Brawzer site, cached static files such as styles and fonts, and a session cookie until sign-out or expiry. Signing out tells the browser to clear Brawzer's cookies, cache and storage (`Clear-Site-Data`) where supported.

Brawzer's marketing and interface must never claim to be "100% invisible",
"zero footprint" or "immune to malware".

## Controls in place today (Phases 1 and 2)

### Web app

- **Content Security Policy:** only Brawzer's own origin; no third-party scripts, fonts or connections; framing forbidden; no `eval` in production.
  - **Account pages and the signed-in app** are rendered per request with a strict policy: a fresh nonce on every response, `'strict-dynamic'`, the theme script allowed by its hash, and no `'unsafe-inline'`. Injected markup such as `<img onerror=…>` can't run there. Links from the public site enter these pages with a full page load, because a browser keeps the first page's policy during client-side navigation ([ADR 0007](adr/0007-content-security-policy.md)).
  - **Public pages** are prerendered and still allow inline scripts (see Remaining risks).
- **Other headers:**
  - `Referrer-Policy: no-referrer`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Cross-Origin-Opener-Policy: same-origin`
  - a `Permissions-Policy` that disables camera, microphone, location, payment, USB, serial, HID and Bluetooth
  - HSTS and `upgrade-insecure-requests` whenever the site is served over HTTPS (`NEXT_PUBLIC_SITE_URL` starts with `https://`)
- **Fonts:** downloaded at build time and served from Brawzer's origin, so the browser never contacts a font provider.
- **Appearance preferences:** theme and accent are kept in `sessionStorage`, so they disappear when the browser closes. No cookies or `localStorage` are used.
- **Search engines:** every page is `noindex` and `robots.txt` disallows everything until launch (`SITE_INDEXING=enabled` turns indexing on). Account pages and signed-in pages are always `noindex`.
- **Signed-in pages** (`/app`) are sent with `Cache-Control: no-store` and `X-Robots-Tag: noindex`. Visitors without a session cookie are redirected to sign in before anything renders; the page itself asks the API whether the session is valid.
- **Account forms:** password fields are hidden by default (show/hide is opt-in) and warn when Caps Lock is on. "Keep me signed in" is off by default. After sign-in and sign-out the page fully reloads, because Next.js keeps recently visited pages mounted in memory; sign-out also replaces the history entry so Back doesn't return to the signed-in page.
- **Idle sign-out on shared computers:** after 26 minutes without activity the page warns ("Are you still there?") and at 28 minutes it signs out and reloads into the sign-in page, so the next person at the computer sees nothing. Focus starts on **Sign out**, so a passer-by pressing Enter ends the session rather than extending it. "Keep me signed in" sessions are exempt.
- **Ended elsewhere, cleared here:** an open signed-in page checks every 30 seconds (without counting as activity) whether its session still exists. If it was signed out from another device, the page clears itself. Signing out in one tab signs out every Brawzer tab in that browser.
- **Email-link tokens** travel in the URL fragment (`/verify-email#token=…`), which browsers never send to servers or put in logs. The page removes the token from the address bar as soon as it has read it and keeps it only in memory. Confirming a new email address takes a click, so a mail scanner that opens links can't confirm a change.
- **Forms are sent with POST.** Someone who presses Enter before a page has finished loading submits the form through the browser itself. With the default GET, what they typed, passwords included, would land in the address bar, the history of a shared computer and server logs. With POST the page just reloads. A unit test fails if a form without `method="post"` is added, and a browser test with scripts turned off checks the sign-in and sign-up forms.
- **Downloads on shared computers.** "Download your data" is built in the browser's memory and saved as a file. On a shared-computer session the page warns that the file stays in the computer's downloads.
- **Development-only pages:** `/design` and `/dev` are excluded from production builds (`BRAWZER_DEV_PAGES=enabled` overrides this for private staging).

### API

- **Configuration:** validated at startup. Invalid or missing values stop the API with a message that names the variable but never prints its value.
- **Logs:**
  - Credentials, tokens, cookies and authorization headers are redacted at the source.
  - Request logs contain the method, path and request ID only: no headers, query strings or IP addresses.
- **Errors:** every error uses one envelope. Server errors never expose stack traces, SQL or internal addresses.
- **Request IDs:** generated server-side; client-supplied IDs are ignored.
- **Responses:**
  - Every response is `Cache-Control: no-store`.
  - JSON responses carry `Content-Security-Policy: default-src 'none'`.
  - Helmet sets the standard security headers; HSTS is on in production.
- **Contracts:** request bodies are validated and responses filtered through Zod schemas, so a field that isn't part of the contract can't leak.
- **Health details:** dependency status is reported only outside production.
- **API docs:** off by default in production.
- **Cross-site request forgery:** every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an `Origin` from `WEB_ORIGIN` or `ALLOWED_ORIGINS`, or, when a browser omits `Origin`, `Sec-Fetch-Site: same-origin`. Everything else gets `403`. Together with `SameSite=Lax` cookies and same-origin routing, there is no CORS surface at all.

### Accounts and sessions (milestone 1.4)

**Passwords**

- Hashed with argon2id (19 MiB memory, 2 passes, 1 lane: OWASP's recommended minimum). Hashes made with weaker parameters are upgraded at the next sign-in.
- 10 to 128 characters. Very common passwords, simple sequences, a single repeated character and passwords containing the email address are refused, with a message that says why.
- **Breached passwords are refused** (production default; `BREACHED_PASSWORD_CHECK`). New passwords are checked against the Pwned Passwords range API with k-anonymity: only the first 5 characters of the password's SHA-1 hash leave Brawzer, responses are padded, and nothing is stored. If the service can't be reached, the check is skipped and logged rather than blocking sign-up.

**Sessions** ([ADR 0005](adr/0005-session-model.md))

- A random 256-bit token in an HttpOnly, `SameSite=Lax`, `Path=/` cookie. Over HTTPS the cookie is `Secure` and named `__Host-brawzer_session`; on plain-HTTP localhost it is `brawzer_session`. The database stores only the token's SHA-256 hash.
- **Shared-computer mode (default):** the cookie ends when the browser closes, the session ends after 30 minutes without activity and after 12 hours at most.
- **Keep me signed in:** 14 days without activity, 30 days at most. Never the default.
- Expired and idle sessions are revoked for good, not just ignored.
- `POST /auth/refresh` rotates the token. The previous token works for 60 more seconds so requests already in flight don't sign the person out.
- Sign-out revokes the session, clears the cookie and sends `Clear-Site-Data`. Signing in again from a browser that still holds a session revokes the old one.
- A password reset signs out every device.
- **Signed-in devices** (Sessions): every active session with its device, IP address and last activity. Any other device can be signed out individually, or all of them at once; the session ends immediately on the server.
- **Changing the password** needs the current one (5 wrong tries per 15 minutes, then a lockout), signs out every other device, cancels outstanding reset links, gives this one a new token and emails a notice.

**Sign-up and email links**

- Links are single-use, stored as hashes, and expire after 24 hours (confirm email) or 30 minutes (reset password).
- **Account pre-hijacking is prevented.** The password chosen at sign-up is stored with the confirmation link, not on the account. It becomes the account's password only when the person who opens the link types that same password. Someone who registers another person's address can neither confirm it (no inbox access) nor keep a password on it: once the real owner confirms, every other pending link dies.

**No account enumeration**

- Sign-up and "forgot password" give the same response whether or not the address has an account. The owner of an existing account is told by email instead.
- Emails are sent in the background, so response times don't depend on whether one was sent.
- Sign-in performs a full password check even when the address has no account, and gives one message for both cases.
- Only someone who knows the password chosen at sign-up learns that an address is still unconfirmed (and gets a fresh link).

**Rate limits** (production values; development multiplies them by `RATE_LIMIT_SCALE`, default 20)

| What                                | Limit                                    |
| ----------------------------------- | ---------------------------------------- |
| Sign-in attempts per client address | 30 per 15 minutes                        |
| Wrong passwords per email address   | 8 per 15 minutes, then sign-in is locked |
| Sign-ups per client address         | 10 per hour                              |
| Emails requested per client address | 10 per hour                              |
| Emails sent to one account          | 3 per hour (extra ones are skipped)      |
| Email-link submissions per address  | 30 per 15 minutes                        |
| Wrong passwords on one sign-up link | 5 per hour                               |
| Wrong current passwords (change)    | 5 per 15 minutes                         |

Counters live in Redis and keys contain only hashes, never addresses or tokens.
If Redis is unreachable, each API instance keeps enforcing the limits with
bounded in-memory counters until Redis returns. The client address comes from
the connection unless `TRUST_PROXY` lists the reverse proxies allowed to
report it, and anything that isn't a valid IP address is discarded.

**Passkeys** ([ADR 0009](adr/0009-passkeys-and-two-factor.md)). Sign-in with Face ID, a fingerprint, a device PIN, a security key or a phone, with no password typed. Only public keys are stored. User verification is always required. Challenges are single use, expire after 5 minutes and are bound to their session. Signature counters reveal cloned device-bound authenticators. Passkeys carry a random user handle, never the email address. In shared-computer sessions, new passkeys can only be saved on a phone or security key, never on the computer itself. Adding or removing one needs a recent sign-in and sends an email.

**Two-factor authentication** ([ADR 0009](adr/0009-passkeys-and-two-factor.md)). Optional authenticator-app codes for password sign-in: secrets encrypted at rest, codes accepted one step either side and never twice, ten hashed single-use recovery codes shown once. A correct password yields a 5-minute single-use ticket, burned after 5 wrong codes, with per-address and per-account limits. Turning it on or off, using a recovery code, and creating new codes send emails. Passkey sign-in doesn't need a second step.

**Secrets at rest** ([ADR 0008](adr/0008-secrets-and-step-up.md)). Secrets Brawzer must read back (authenticator-app secrets, proxy credentials) use envelope encryption: a fresh AES-256-GCM data key per secret, wrapped by a key-encryption key held in Vault/OpenBao Transit in production (a local key in development, refused in production). Each ciphertext is bound to its record, so values can't be swapped between rows.

**Confirm it's you.** Sensitive changes need a sign-in or confirmation from the last 10 minutes on that session; otherwise Brawzer asks for the password (or a passkey) first. Wrong passwords count towards a lockout (5 per 15 minutes). It protects signing other devices out, adding and removing passkeys, two-factor changes, changing the email address, downloading your data and deleting the account.

**Changing the email address.** Needs a recent sign-in. The new address gets a single-use link (24 hours) and the current one gets a notice; nothing changes until the link is opened, and the old address is told again when it does. Only the newest request's link works, and changing or resetting the password cancels it. If another confirmed account already uses the new address, the reply is the same and that inbox gets an explanation instead of a link, so the form can't be used to find out who has an account. A never-confirmed sign-up holding the address is removed when its real owner confirms.

**Deleting the account.** Needs a recent sign-in and the email address typed. Deletion is immediate and complete: the account row goes, and the database removes its sessions, passkeys, two-factor secrets, recovery codes, email links, known devices and security history with it. Every device is signed out, the browser is asked to clear Brawzer's site data, and a confirmation goes to the address. Server logs keep request metadata (account ID, IP address) only for their own retention period.

**Downloading your data.** Needs a recent sign-in. A JSON file with the account, two-factor status, passkey names, signed-in devices and full security history. It never contains password hashes, session tokens, two-factor secrets or recovery codes (a test checks the raw response). The download itself is recorded in the history.

**New-device alerts.** Each sign-in's browser and OS family plus network (IPv4 /24, IPv6 /48) is hashed into a known-device key, kept for 90 days after it was last seen. A sign-in from a key the account hasn't used sends an email and appears in Shield with a "This wasn't me" path to Sessions. An account's first sign-in never alerts. It's a notice, not a barrier: see Remaining risks.

**Profiles.** Each account's profiles are only ever read or changed through queries scoped to that account (another account's profile is "not found"). Names are limited to 40 characters and can't contain control characters or text-direction overrides that could disguise them. Creating and deleting take a lock on the account, so simultaneous requests can't exceed the temporary limit of 10 or delete the last profile. Profiles hold no browsing data until Phases 3 and 4; creating and deleting them is recorded in the security history.

**Proxies and proxy tests** ([ADR 0010](adr/0010-proxy-tests-and-ssrf.md)). A proxy's username and password are one encrypted value bound to its row; the API never returns them, only whether some are saved, and the edit form never pre-fills them. Testing a proxy means Brawzer's servers connect to an address someone typed, so the tester accepts only strictly formed hosts (no decimal, octal, hex or shortened IPv4), resolves a name once and refuses it if any answer is private, local, reserved or special-purpose (IPv4 and IPv6, including mapped, NAT64, 6to4 and Teredo forms), then connects to that exact address. Every test fetches one fixed echo URL through the proxy, with a 10-second limit, small response limits, at most 2 tests at once per account and 30 per 15 minutes. Private addresses are allowed only with a development flag that production refuses.

**Shield overview.** Shows how the account is protected (passkeys, two-factor, signed-in devices, failed attempts in the last 7 days), recommends what's missing, and lists sign-ins from new devices in the last 30 days.

**Security history** (Shield). Sign-ups, confirmations, sign-ins (successful
and failed), sign-outs, reset requests, resets, password changes and
revocations are recorded with time, IP address and user agent, and shown to
the account owner, as are passkey and two-factor changes, email changes, data
downloads and new-device sign-ins. Never passwords, tokens or anything about browsing. Device
names come from the browser's self-reported user agent, so they can be faked;
they help recognition and are never used for security decisions.

**Email delivery.** Mailpit locally; Resend in production (enforced at
startup). Message bodies, which contain links, are never logged.

**Data retention.** A job in the API deletes, every 6 hours: security history
older than `SECURITY_HISTORY_RETENTION_DAYS` (default 365); sessions that
ended more than 30 days ago; email links used or expired more than 7 days ago;
sign-ups never confirmed within 30 days (often someone else's address);
passkey and sign-in challenges a day after they expire; and known devices not
seen for 90 days.
A database lock ensures only one API instance runs it at a time.

### Local infrastructure

- **Network exposure:** services bind to `127.0.0.1` only.
- **Credentials:** development values only, clearly labelled in `.env.example`. `.env` is ignored by git.

### Supply chain

- **Pinned versions:** every dependency is pinned exactly in one catalog.
- **7-day minimum release age:** pnpm refuses packages younger than seven days.
- **Install scripts:** dependency install scripts are blocked unless allow-listed. Telemetry scripts such as `@scarf/scarf` are explicitly denied.

## Remaining risks (reviewed in milestones 1.6 and 2.8)

The Phase 1 and Phase 2 security reviews ([phase 1](reviews/phase-1.md),
[phase 2](reviews/phase-2.md)) closed most earlier gaps. These remain,
deliberately:

- **Public pages still allow inline scripts.** The prerendered public pages (home, product, pricing and so on) keep `script-src 'self' 'unsafe-inline'`, because per-request nonces can't be combined with prerendering. They render no user data or input. Account pages and the signed-in app use the strict policy ([ADR 0007](adr/0007-content-security-policy.md)).
- **Lockout can be triggered by others.** Someone who knows your address can lock password sign-in for 15 minutes by guessing wrong. Password reset still works. Passkeys (Phase 2) remove the problem.
- **Timing.** Responses for existing and unknown addresses differ by a few database queries (milliseconds). Password hashing dominates, but this is not constant-time.
- **Email delivery has no retry queue.** A failed send is logged; the person can request another email.
- **Rate limits during a Redis outage are per API instance.** Each instance falls back to its own counters, so with several instances the effective limit multiplies until Redis returns.
- **Client addresses in production.** The web server's rewrite keeps a client-supplied `X-Forwarded-For`, so it must not be listed in `TRUST_PROXY`. Production should route `/api/v1` to the API at the edge and trust only the edge (Phase 7).
- **Dependency advisories.** Three moderate advisories in transitive dependencies, none reachable: `esbuild` inside the development-only `drizzle-kit` (affects esbuild's own dev server, never started), and `glob`/`minimatch` inside `@fastify/static` (need attacker-controlled glob patterns; it only serves the API docs' assets, which are off in production). Patched versions are too new for the 7-day policy; re-check on 2026-11-13.
- **New-device detection can be imitated.** The key comes from the self-reported user agent and the network prefix, so someone who copies both looks like a known device. It informs; it never blocks a sign-in.
- **Proxy tests run inside the API.** The address rules are the only barrier between a test and Brawzer's own network until Phase 5 moves tests and browsing traffic into an isolated egress service, which is required before launch ([ADR 0010](adr/0010-proxy-tests-and-ssrf.md)).
- **No undo for an email change.** Someone who has your password (and second factor, if on) can change the address. The old address is told twice, but has no one-click way to reverse it; the owner can still sign in with the password and change it back. An undo link is considered in the Phase 2 review.
- **Deletion is immediate.** By decision there's no grace period, so a stolen session that can pass "confirm it's you" could delete the account.
- **Development differences.** On localhost, `Clear-Site-Data` omits `"cookies"` (all localhost apps share cookies), and cookies are not `Secure`.

## Planned controls

| When | Control                                                                                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | Phone sign-in by QR code for computers without Bluetooth (approved, not scheduled)                                                                                                                             |
| 3    | One isolated container per session, Chromium sandbox on, 60-second single-use stream tickets, gateway-enforced revocation and idle lock                                                                        |
| 4    | Encryption at rest per profile, download scanning, signed short-lived export links                                                                                                                             |
| 5    | Isolated egress service for proxy tests and browsing traffic, private and metadata address blocking at the network level, WebRTC and DNS leak prevention, "confirm it's you" before changing a profile's proxy |
| 7    | Independent penetration test, isolation testing, incident response runbook                                                                                                                                     |

## Reporting a vulnerability

A security contact and disclosure policy will be published before launch.
Until then, report issues privately to the project owner.
