# 0007 Content Security Policy

- **Status:** Accepted. Implemented in milestone 1.6.
- **Date:** 2026-11-07

## Context

The web app and the API share one origin, so a script injected into any
Brawzer page can call the API as the signed-in person. A Content Security
Policy (CSP) is the defence in depth against that: React escapes everything it
renders, but a policy also stops injected markup if escaping is ever bypassed.

The strongest practical policy uses a fresh nonce per response. Next.js adds
the nonce to its own scripts, but only while rendering a request. Prerendered
pages, including the static shells of partially prerendered pages, are
produced at build time and can't carry one. The Next.js documentation states
that nonces and partial prerendering are incompatible.

## Decision

Two policies, chosen by what a page does:

- **Strict, per request:** account pages (`/sign-in`, `/create-account`, `/verify-email`, `/forgot-password`, `/reset-password`) and the signed-in app (`/app/*`). These are where passwords are typed and account data is shown.
  - `src/proxy.ts` generates a 128-bit nonce per request and sets `script-src 'self' 'nonce-…' 'strict-dynamic'` on both the request (Next.js reads it from there) and the response.
  - The only inline script Brawzer writes, which sets the theme before first paint, is allowed by its SHA-256 hash.
  - No `'unsafe-inline'` for scripts, no `'unsafe-eval'` in production.
  - Their layouts set `export const instant = false` and await `connection()`, so the whole route renders per request and every script carries the nonce.
- **Site-wide, prerendered:** the public pages keep `script-src 'self' 'unsafe-inline'` (no `eval` in production). They render no user data or input.
- **Entering the strict area is always a full page load.** A browser keeps the policy of the document it loaded first during client-side navigation. Links from public pages into account pages are plain `<a>` elements, and sign-in and sign-out leave with `location.replace`.
- **Styles keep `'unsafe-inline'`.** Positioning uses style attributes, which nonces can't cover. Style injection is a far smaller risk than script injection.

## Alternatives considered

- **Render every page per request with nonces.** The whole site would be strict, but the public pages would lose prerendering and the speed it gives, for pages that show no user data.
- **Hash-based CSP with Next.js's experimental Subresource Integrity.** It covers external scripts, not the inline scripts Next.js streams with each page.
- **Trusted Types** (`require-trusted-types-for 'script'`). This is worth adding later as a further layer once tested with React and Next.js, and it works only in Chromium-based browsers.

## Consequences

- An injected `<img onerror=…>` or `<script>` in markup doesn't run on account pages or in the app. `e2e/csp.spec.ts` checks this, along with a fresh nonce on every response, no violations from Brawzer's own code, and full page loads into the strict area.
- Account pages lose their static shells and render per request. The signed-in pages already depended on per-request data, so the extra cost is small.
- Public pages still allow inline scripts. If they ever render user-provided content, or Next.js supports nonces with prerendering, this decision must be revisited.
