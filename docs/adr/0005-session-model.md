# 0005 Session model

- **Status:** Accepted. Implemented in milestones 1.4 (sign-up, email confirmation, sign-in, sign-out, refresh, password reset) and 1.5 (signed-in devices, password change, idle handling in the page). Stream tickets follow in Phase 3.
- **Date:** 2026-11-06

## Context

People sign in to Brawzer on computers they don't control and may forget to
sign out. They must be able to end those sessions from anywhere, immediately,
including any live cloud browser. Tokens must not sit in storage that page
scripts can read.

## Decision

- **Opaque server-side sessions.**
  - A random 256-bit token is set in an HttpOnly, `SameSite=Lax`, `Path=/` cookie. Over HTTPS it is `Secure` and named `__Host-brawzer_session`; plain-HTTP localhost uses `brawzer_session`, because browsers reject `__Host-` cookies without HTTPS.
  - Only the token's SHA-256 hash is stored.
  - Sessions have an idle timeout and an absolute lifetime. Idle or expired sessions are revoked, not merely ignored.
  - `/auth/refresh` rotates the token. The previous token stays valid for 60 seconds so in-flight requests from other tabs don't sign the person out, and a request made with that previous token never triggers a second rotation.
- **Shared-computer mode by default.** The cookie has no `Max-Age`, so it ends when the browser closes; the session ends after 30 idle minutes and 12 hours at most. "Keep me signed in on this device" is an explicit opt-in: 14 idle days, 30 days at most.
- **Sign-up confirmation requires the chosen password.** The password picked at sign-up is stored (hashed) with the confirmation link and only becomes the account's password when the person who opens the link types it again. Confirming signs in and invalidates every other pending link for the address. This prevents account pre-hijacking: registering someone else's address gains nothing.
- **Sessions can be ended from anywhere** (milestone 1.5). `GET /auth/sessions` lists the account's active sessions; `DELETE /auth/sessions/:id` ends one and `POST /auth/sessions/revoke-others` ends all but the current one. Changing the password also ends every other session.
- **Open pages follow the session** (milestone 1.5). Signed-in pages report activity at most once a minute and rotate the token every 15 minutes of use. Every 30 seconds they call `GET /auth/session/status`, which checks validity without counting as activity (otherwise a forgotten tab would keep its session alive forever). On a shared computer the page warns 2 minutes before, and signs out 2 minutes ahead of, the server's idle timeout, because the server hears about activity up to 2 minutes late.
- **Stream tickets** (Phase 3). The cloud-browser stream connects with a single-use ticket that expires within 60 seconds, bound to the user, session and device. The gateway checks revocation continuously.
- **Sign-out:** revoke the session, clear the cookie, send `Clear-Site-Data: "cache", "cookies", "storage"`, then reload the page fully (Next.js keeps recently visited pages mounted in memory). On plain-HTTP localhost `"cookies"` is omitted, because every localhost app shares cookies.
- **CSRF:** SameSite cookies plus an origin check on every state-changing request (`Origin` must be an allowed origin; without `Origin`, `Sec-Fetch-Site` must be `same-origin`). Same-origin routing means no CORS at all.
- **Built in-house** on well-tested libraries: `@node-rs/argon2` now; `@simplewebauthn/server` and `otplib` in Phase 2. Better Auth was considered. The product-specific needs (stream revocation, workspace lock, step-up checks before exports) would fight its abstractions.

## Consequences

- Revocation is instant. The cost is one indexed database lookup per authenticated request. A Redis cache can be added if profiling shows a need; revoking a session must then purge it.
- Activity is written at most once a minute per session, so reads don't each cause a write.
- The auth code needs its own security review (milestone 1.6) and thorough tests. Integration tests cover the flows against real PostgreSQL, Valkey and Mailpit, including pre-hijacking, lockout, idle timeout and reset-revokes-everything.
