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

## Controls in place today (milestones 1.1–1.5)

### Web app

- **Content Security Policy:** only Brawzer's own origin; no third-party scripts, fonts or connections; framing forbidden.
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
- **Email-link tokens** travel in the URL fragment (`/verify-email#token=…`), which browsers never send to servers or put in logs. The page removes the token from the address bar as soon as it has read it and keeps it only in memory.
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

**Sessions** ([ADR 0005](adr/0005-session-model.md))

- A random 256-bit token in an HttpOnly, `SameSite=Lax`, `Path=/` cookie. Over HTTPS the cookie is `Secure` and named `__Host-brawzer_session`; on plain-HTTP localhost it is `brawzer_session`. The database stores only the token's SHA-256 hash.
- **Shared-computer mode (default):** the cookie ends when the browser closes, the session ends after 30 minutes without activity and after 12 hours at most.
- **Keep me signed in:** 14 days without activity, 30 days at most. Never the default.
- Expired and idle sessions are revoked for good, not just ignored.
- `POST /auth/refresh` rotates the token. The previous token works for 60 more seconds so requests already in flight don't sign the person out.
- Sign-out revokes the session, clears the cookie and sends `Clear-Site-Data`. Signing in again from a browser that still holds a session revokes the old one.
- A password reset signs out every device.
- **Signed-in devices** (Sessions): every active session with its device, IP address and last activity. Any other device can be signed out individually, or all of them at once; the session ends immediately on the server.
- **Changing the password** needs the current one (5 wrong tries per 15 minutes, then a lockout), signs out every other device, gives this one a new token and emails a notice.

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
The client address comes from the connection unless `TRUST_PROXY` lists the
reverse proxies allowed to report it.

**Security history** (Shield). Sign-ups, confirmations, sign-ins (successful
and failed), sign-outs, reset requests, resets, password changes and
revocations are recorded with time, IP address and user agent, and shown to
the account owner. Never passwords, tokens or anything about browsing. Device
names come from the browser's self-reported user agent, so they can be faked;
they help recognition and are never used for security decisions.

**Email delivery.** Mailpit locally; Resend in production (enforced at
startup). Message bodies, which contain links, are never logged.

### Local infrastructure

- **Network exposure:** services bind to `127.0.0.1` only.
- **Credentials:** development values only, clearly labelled in `.env.example`. `.env` is ignored by git.

### Supply chain

- **Pinned versions:** every dependency is pinned exactly in one catalog.
- **7-day minimum release age:** pnpm refuses packages younger than seven days.
- **Install scripts:** dependency install scripts are blocked unless allow-listed. Telemetry scripts such as `@scarf/scarf` are explicitly denied.

## Known gaps, to be decided in the milestone 1.6 security review

- **Script CSP still allows `'unsafe-inline'`.** Per-request nonces would remove it, but nonces require rendering every page per request, which is incompatible with the partial prerendering the web app uses. Options: render signed-in pages fully dynamically with nonces, or adopt hash-based CSP (experimental in Next.js). Until then, the defence against injected scripts is React's escaping and the absence of any raw-HTML rendering.
- **Rate limiting fails open.** If Redis is unreachable, limits are skipped (logged loudly; health reports `degraded`) rather than blocking all sign-ins. Failing closed for sign-in in production is the alternative.
- **Lockout can be triggered by others.** Someone who knows your address can lock password sign-in for 15 minutes by guessing wrong. Password reset still works. Passkeys (Phase 2) remove the problem.
- **Small common-password list.** A breached-password check (for example the k-anonymity Pwned Passwords API, which receives only a 5-character hash prefix) needs a product decision because it contacts a third party.
- **Timing.** Responses for existing and unknown addresses differ by a few database queries (milliseconds). Password hashing dominates, but this is not constant-time.
- **Security-history retention** is not defined yet. IP addresses are personal data; a retention period must be set before launch.
- **Email delivery has no retry queue.** A failed send is logged; the person can request another email.
- **Client addresses in production.** The web server's rewrite keeps a client-supplied `X-Forwarded-For`, so it must not be listed in `TRUST_PROXY`. Production should route `/api/v1` to the API at the edge and trust only the edge.
- **Development differences.** On localhost, `Clear-Site-Data` omits `"cookies"` (all localhost apps share cookies), and cookies are not `Secure`.

## Planned controls

| When | Control                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.6  | Security review of authentication; decisions on the known gaps above (CSP for signed-in pages, rate-limit failure mode, history retention)  |
| 2    | Passkeys (including phone sign-in by QR code), TOTP, step-up authentication, alerts for new-device sign-ins                                 |
| 3    | One isolated container per session, Chromium sandbox on, 60-second single-use stream tickets, gateway-enforced revocation and idle lock     |
| 4    | Encryption at rest per profile, download scanning, signed short-lived export links                                                          |
| 5    | Egress-proxy sidecar, private and metadata address blocking, envelope encryption of proxy credentials (KMS), WebRTC and DNS leak prevention |
| 7    | Independent penetration test, isolation testing, incident response runbook                                                                  |

## Reporting a vulnerability

A security contact and disclosure policy will be published before launch.
Until then, report issues privately to the project owner.
