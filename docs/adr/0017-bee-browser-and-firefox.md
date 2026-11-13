# ADR 0017: Bee Browser and Firefox as the two engines

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR 0006](0006-browser-streaming.md), [ADR 0012](0012-cloud-browser-runtime-isolation.md), [ADR 0014](0014-egress-service.md)

## Context

Phase 3a shipped one engine, Debian's Chromium, and the product promised
"Chromium first, Firefox next". Two things were missing. The browser had no
identity of its own: it was presented as "Chromium", the profile form had no
engine choice, and a new tab opened on `about:blank`. And Firefox, planned
for Phase 3b behind WebRTC capture, waited on a media pipeline the 3b spike
ruled out ([findings](../reviews/phase-3b-spike.md)). The spike also showed
that nothing in Firefox needs WebRTC: WebDriver BiDi exposes screenshots,
input, navigation, downloads, prompts and file dialogs well enough for the
frame-acknowledged stream of ADR 0006 step 3a.

## Decision

### Bee Browser is Brawzer's own browser, built on Chromium

The Chromium engine is presented as **Bee Browser**: Brawzer's browser, with
Brawzer's mark, built on Chromium (Blink). It is honest about its basis
everywhere it is named (`engineDetails` in the contracts, the profile form,
the product page), and it is Chromium under a managed policy file, not a
fork. What makes it Bee is Brawzer's side of it:

- the **chrome** (tabs with a coloured initial per site, the address with the
  host in ink and the path lighter, the padlock, the "Isolated" badge, the
  profile chip, the downloads panel "Saved to Brawzer Drive", the "…" menu,
  and a status bar naming the cloud session's region, the proxy and what the
  profile keeps) is drawn by the web app;
- the **start page** (`http://bee.invalid/`) is served by the agent inside the
  container on loopback and reached through the engine's proxy override, so
  a new tab is a Brawzer page with the mark and a search box, never a vendor
  page; it is the only page the filtering proxy answers itself;
- the **user agent** carries `Bee/1.0` after Chromium's own token, set per tab
  through the DevTools protocol, so websites see a standard Chromium with a
  product token, as Edge and Brave do; and
- the vendor's surfaces (sign-in, sync, updates, variations, crash reporting,
  safe-browsing lookups) are off by policy, as ADR 0012 already set.

The database enum value `chromium` is renamed `bee` in place (migration 0014,
`ALTER TYPE … RENAME VALUE`), so existing profiles and session rows keep
their meaning without a rewrite.

### Firefox is the second engine, over WebDriver BiDi, with the same stream

Firefox ESR from Debian runs in the same runtime image and container, chosen
per profile (`engine: "firefox"`). The agent drives it over **WebDriver BiDi**
on a loopback port inside the container, with the same `Engine` interface as
Bee: the relay, the protocol, the web app and the tests do not know which
engine is behind a session beyond the welcome message's `engine` field.

- **Frames** are `browsingContext.captureScreenshot` JPEGs, paced by the
  viewer's acknowledgements as ADR 0006 requires, with an idle backoff (80 to
  400 ms) and a hash to skip unchanged frames. This is slower than
  Chromium's screencast but well under the 1-second acknowledgement budget.
- **Input** maps to `input.performActions` (pointer, wheel, key with WebDriver
  key codes). **Navigation, history and the viewport** use the BiDi
  `browsingContext` module; the title and the history state are polled with
  `script.evaluate`.
- **Downloads** use the `downloadWillBegin` and `downloadEnd` events and the
  same hand-over to Drive as Bee. **File choosers** use
  `input.fileDialogOpened` and `input.setFiles` on files streamed from Drive
  into the scratch directory. **Printing** uses `browsingContext.print`.
  **Prompts** are left to the agent (`unhandledPromptBehavior: ignore`) and
  forwarded as Brawzer's dialogs.
- **Policy** is an enterprise `policies.json`: updates, telemetry, studies,
  Firefox Accounts, Pocket, developer tools and extensions off; DNS over
  HTTPS off (the egress resolves); camera, microphone, location,
  notifications and autoplay blocked. `user.js` forces every connection,
  loopback included, through the filtering proxy, WebRTC to proxied
  connections only, and the download directory.
- **Profile data** packs and restores as Bee's does, with Firefox's caches,
  locks, crash reports and session backups excluded.

### What this does not decide

Sound and WebRTC streaming (3b) stay unbuilt; the frame stream serves both
engines. WebKit is not an engine. Firefox's user agent is unchanged: a Bee
token on a Gecko user agent would be misleading.

### A fix the second engine surfaced

Firefox's journey failed one run in two, three different ways, until the
runtime's own log showed the agent dying: Node 26 treats a file handle
collected without being closed as fatal. The chunk writer that receives a
Drive file for a page's file chooser opened the file once per chunk when
chunks arrived together, and the first handle leaked. Writes are now queued,
and a unit test sends chunks together. Bee used the same writer and was
exposed too; it only failed less often because its chooser path was quicker.

## Consequences

- The profile form offers two engines, with their basis stated. Default: Bee
  Browser.
- The runtime image grows by Firefox ESR (about 90 MB compressed).
  Both engines are rebuilt weekly by the release pipeline.
- The agent's BiDi port is bound to loopback inside the container and the
  page cannot reach it: the proxy hijacks loopback, and the proxy answers
  only `bee.invalid`. The egress sidecar shares the network namespace and
  could reach it; it is Brawzer's own code, runs under its own user, and
  holds no page content.
- The product page says what is true: Bee Browser (Chromium) and Firefox
  (Gecko) built; WebKit explored.
