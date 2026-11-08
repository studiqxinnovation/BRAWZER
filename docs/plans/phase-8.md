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
| 8   | Per-account destination allow-lists and block-lists        | Next                                                                                                       |
| 11  | Passkey-only phone approval                                |                                                                                                            |
| 13  | A key re-wrap job                                          |                                                                                                            |
| 14  | Warm pool                                                  |                                                                                                            |
| 15  | A scheduler across runtime hosts                           |                                                                                                            |
| 16  | Relay back-pressure for downloads                          |                                                                                                            |
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
