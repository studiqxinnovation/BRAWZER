# Phase 8: the finishing ideas

Twenty-four additions proposed after Phase 7 and accepted as a set on
2026-11-08 ("build all"), each contained, each closing something a review or
plan already named. They are built in value order, one commit each, on the
`phase-8-finishing` branch, and this page tracks them.

| #   | Idea                                                       | Status                                                                                                     |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 10  | Isolation checks as a CI job                               | **Done** 2026-11-08: `apps/api/test/isolation.integration.test.ts`; found and closed a DNS path (ADR 0014) |
| 1   | Brawzer-drawn error pages                                  | Next                                                                                                       |
| 2   | Bookmarks and history as Brawzer records                   | Not built: work on it was stopped on 2026-11-08 and is not resumed; idea 3 (which built on it) waits too   |
| 5   | Find in page, zoom, reader mode                            | **Done** 2026-11-08: both engines, from the menu and Alt shortcuts                                         |
| 4   | Clipboard with intent                                      | **Done** 2026-11-08: deliberate copy and paste, text only, each use recorded                               |
| 9   | Private-address browsing through a saved proxy, on purpose | **Done** 2026-11-08: a per-profile switch, off by default, loopback still refused                          |
| 8   | Per-account destination allow-lists and block-lists        | **Done** 2026-11-08: Site rules page; applied by the egress before anything else                           |
| 11  | Passkey-only phone approval                                | **Done** 2026-11-08: approving needs a passkey whenever the account has one                                |
| 13  | A key re-wrap job                                          | **Done** 2026-11-08: on the maintenance cadence and from the Admin API                                     |
| 14  | Warm pool                                                  | **Done** 2026-11-08: `BROWSER_WARM_POOL` pairs waiting per API instance                                    |
| 15  | A scheduler across runtime hosts                           | **Done** 2026-11-08: `RUNTIME_HOSTS`, the host with the most room, remembered per session                  |
| 16  | Relay back-pressure for downloads                          | Next                                                                                                       |
| 17  | Metrics                                                    |                                                                                                            |
| 18  | Image rebuild on upstream advisories                       |                                                                                                            |
| 20  | Usage emails and in-app nudges                             |                                                                                                            |
| 21  | Trials and promotion codes                                 |                                                                                                            |
| 22  | Admin: sessions and runtime view                           |                                                                                                            |
| 23  | An operator CLI                                            |                                                                                                            |
| 24  | Load test for the stream                                   |                                                                                                            |
| 3   | Session hand-off between devices                           |                                                                                                            |
| 6   | Pop-out work mode                                          |                                                                                                            |
| 12  | Report a page                                              |                                                                                                            |
| 19  | Team accounts                                              |                                                                                                            |
| 7   | Sound, then WebRTC (Phase 3b)                              | Last: needs a virtual display, GStreamer and TURN ([spike](../reviews/phase-3b-spike.md))                  |

## 10. Isolation checks as a CI job

The by-hand checks from the Phase 3 and 5 reviews, as an integration test
that runs in the same CI job as the other browser tests (it needs the local
engine and the images). For each engine it starts a real session and, from
the engine's own user inside the container, checks: a read-only root and a
`noexec` scratch space; no capabilities and `NoNewPrivs`; the runtime shares
the egress sidecar's network namespace; the sidecar's ruleset (output
policy drop, only the egress user out, private ranges dropped, DNS dropped
ahead of the container engine's NAT); no direct route out and no name
resolution; through the filtering proxy, private addresses, loopback (the
agent, the engine's port), the cloud metadata address and the vendor's
services all answer "Blocked by Brawzer", while Brawzer's start page and the
test site are served; and no debugging port is open to a page. The container
checks read the engine's own view of the session (`docker inspect`).

The test runs with private ranges refused at the network level, as in
production, which the harness asks for with `PROXY_TEST_ALLOW_PRIVATE=false`.

## 1. Brawzer-drawn error pages

A failed navigation used to stream the engine's own error page, the one
piece of engine chrome a person still saw. Now each engine reports the
failure as data on the tab (`error: { url, code }`): Bee from the frame's
unreachable address and the code its error page names, Firefox from
`about:neterror`'s parameters. The web app draws the page over the viewport in
Brawzer's style, sorted into what the code means (no such website, refused by
Brawzer, not answering, too slow, certificate, redirect loop, bad address),
naming the host and never the engine, with "Try again", "Copy the address"
and, for a name that doesn't exist, "Search for it". The engine's code is
shown small for anyone who needs it.

Over HTTPS every refusal by the proxy looks the same to an engine (a failed
tunnel), so the egress now says why in a header on its 403, the agent's proxy
notes the reason per `host:port` for a few seconds, and a tunnel failure for
that address gets Brawzer's own code instead: `BRAWZER_REFUSED_ADDRESS`
(private or internal), `BRAWZER_REFUSED_PORT`, `BRAWZER_REFUSED_ENGINE` (the
engine's own services) or `BRAWZER_REFUSED_UNRESOLVED` (no such name, with
"Search for it"). Checked in the browser integration journeys (both engines)
and the e2e journey, with the accessibility audit.

## 5. Find in page, zoom, reader view

Three tools people reach for, drawn by Brawzer and run inside the page by
either engine through one set of scripts (`apps/runtime-agent/src/page-tools.ts`):

- **Find in page** (Alt+F, or the menu): a bar under the address; each
  keystroke asks the engine for the first match and Enter or the arrows step
  through them, with "3 of 14" from the engine's count. Matches are found in
  the page's visible text nodes, selected and scrolled into view; closing the
  bar clears the selection.
- **Zoom** (Alt+plus, Alt+minus, Alt+0, or the menu): layout zoom on the
  page's root element along the usual steps (50% to 300%), kept per tab and
  re-applied as the tab loads pages; the address bar shows the percentage,
  and clicking it resets.
- **Reader view** (Alt+Shift+R, or the menu): Mozilla's Readability (0.6.0,
  Apache-2.0, via the catalog) extracts the article from a copy of the
  document inside the page, and Brawzer's own reading layout replaces the
  page: scripts, frames, forms, styles and inline handlers never make it
  across. A page without an article says so; leaving reader view reloads the
  page. The tab reports `zoom` and `reader` in its state.

Checked in both integration journeys (the test site gained an article page)
and the e2e journey.

## 4. Clipboard with intent

Copy and paste between the page and the local computer stay off by default:
nothing crosses on its own. Two deliberate actions carry text, and only
text: **Copy selection to this computer** (Alt+C, or the menu) asks the
engine for the page's selected text (a field's selection when a field has
focus) and, after a confirmation that says plainly that the clipboard of the
computer in use is where it goes (asked once per session), writes it to the
local clipboard; **Paste from this computer** (Alt+V, or the menu) reads the
local clipboard and types it into the page's focused field (Chromium's
insert-text input, Firefox's `insertText` command with a typed fallback).
Each transfer is capped at 64 KiB and recorded in the security history as a
count of characters, never the text: `browser.clipboard_copied` and
`browser.clipboard_pasted`, written by the relay on the way through.
Checked in both integration journeys and the e2e journey.

## 9. Private-address browsing through a saved proxy, on purpose

People with a legitimate reason to reach a company intranet through their
own proxy couldn't: the egress refused private targets even when the proxy
would do the resolving and connecting on its own network. A profile with a
proxy now has a switch, **Reach private addresses through the proxy**, off
by default and needing "confirm it's you" to change. With it on, both
filters (the agent's cheap first check and the egress rules) hand private
and internal addresses to the proxy unresolved instead of refusing them;
nothing in Brawzer connects to those addresses, and loopback (`127.*`,
`::1`, `localhost`) stays refused on both hops, since that is the session's
own container. Without a proxy the switch has no effect. The session's
containers get `EGRESS_PRIVATE_VIA_UPSTREAM` and `BRAWZER_PRIVATE_VIA_EGRESS`
only for such profiles. Checked in the egress and agent rule tests, the
proxy integration journey (refused, then through the proxy, loopback still
refused) and the proxies e2e journey.

## 8. Per-account destination allow-lists and block-lists

A **Site rules** page under Protect. Two lists: blocked sites, which never
open, and allowed sites, which once any exist are the only sites that open
(a child's profile, a work-only computer). A rule is a host as a resolver
reads it (lower-cased, international names to ASCII, a leading `www.` or
`*.` dropped, no schemes or paths), covering the host and everything under
it; an IP address is a host too. Up to 200 per account, listed in the data
export, deleted with the account.

Every session's egress receives the account's rules at start
(`EGRESS_SITE_RULES`) and applies them before anything else in its decision,
on the host as asked for: HTTP pages get the "Blocked by Brawzer" page with
the reason, HTTPS tunnels are refused with `policy` as the reason, which the
agent carries to the error page as `BRAWZER_REFUSED_POLICY` ("Your site rules
stopped this"). The engine sees a refusal, never the list. Checked in the
egress rule tests, the site rules API test (normalisation, limits, export,
another account), the proxy journey (a subdomain of a blocked host refused
at the egress, another host through the proxy) and the e2e page journey.

## 11. Passkey-only phone approval

Approving a sign-in from the phone used "confirm it's you", which accepts a
password: the one place a password could still be typed on a phone. A
session now remembers how its owner last proved who they are (`password`
or `passkey`, and the sign-in's own method at first). Approving a phone
request needs a passkey confirmation from the last ten minutes whenever the
account has a passkey; the API answers `reauthentication_required` with the
detail `method: passkey`, and the confirmation dialog then offers the
passkey alone, with the reason stated. An account with no passkey can still
approve with its password, and the approval page says a passkey would make
that unnecessary. Checked in the phone sign-in integration test (a password
confirmation refused, a passkey confirmation accepted, no passkey falls back).

## 13. A key re-wrap job

The runbook said rotation re-wraps rows when they are next written, which
could take months. Now the key providers can say whether a wrapped data key
still uses the current key (locally: the first key in `ENCRYPTION_KEYS`;
Transit: the key's latest version, read from the ciphertext's `vault:vN:`
prefix against the key's `latest_version`) and re-wrap it (locally by
unwrapping and wrapping again; Transit through its `rewrap` call, so the
data key never leaves the key service). A maintenance job walks every sealed
column (proxy credentials, TOTP secrets, Drive file keys, profile data keys,
session agent secrets) in batches under its own advisory lock and updates a
row only if it is still as read, so a concurrent write wins. It runs with the
retention cadence and from `POST /admin/maintenance/rewrap`, reporting rows
per table and rows it had to leave. Checked in the secret box unit tests and
an integration test that seals under one key, rotates, re-wraps through the
Admin API and opens the secret with the new key alone.

## 14. Warm pool

A session took a few seconds to start cold: two containers created and
started, the sidecar's firewall applied, the agent's readiness awaited. With
`BROWSER_WARM_POOL=n`, each API instance keeps `n` egress-plus-runtime pairs
started and waiting at the agent's "waiting" state (before any profile data
or engine start), each with a session id reserved for it and its own secret,
and labelled with when it was made. A session that needs nothing special
(Bee, no proxy, no site rules) claims a pair, checked once more to be
healthy and fresh, and the session row is made with the reserved id; the
start then only restores the profile's data and starts the engine. Anything
else starts cold as before, and the pool refills in the background. Pairs
belong to the instance that made them: it discards them on shutdown, and
reconciliation on any instance leaves pooled pairs alone for an hour. Pooled
pairs hold the runtime's memory limit while they wait, so the default is 0
and the runbook says what one costs. Checked in an integration test that
waits for a pair, starts a session within a few seconds on that pair's
container, and sees the pool refill.

## 15. A scheduler across runtime hosts

The orchestrator took one engine endpoint. `RUNTIME_HOSTS` now lists
several: a name, an engine (a socket path or `tcp://host:port`, every TCP
engine reached with the same client certificate, which production
requires), where the API reaches the agent ports, and a capacity. Without it
`DOCKER_HOST` is the one host, named "local". Each host gets its own engine
client and a cached health (asked at most every half minute). Placement is
small on purpose: under the capacity lock, the live sessions per host are
counted and the healthy host with the most room takes the session, ties in
turn; when every healthy host is full, or none is healthy, starting answers
503 with Retry-After, as the global limit does. The session row remembers
its host, so stopping, packing, reaping and reconciling go to the right
engine; a row without a host (older) means the primary. The warm pool
spreads its pairs over the reachable hosts in turn, and this instance's
proxy tester runs on the primary. Checked in the config tests and an
integration test with two hosts of capacity one on this machine's engine
and one host nobody answers on.
