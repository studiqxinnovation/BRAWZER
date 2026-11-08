# Phase 8: the finishing ideas

Twenty-four additions proposed after Phase 7 and accepted as a set on
2026-11-08 ("build all"), each contained, each closing something a review or
plan already named. They are built in value order, one commit each, on the
`phase-8-finishing` branch, and this page tracks them.

| #   | Idea                                                       | Status                                                                                                     |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 10  | Isolation checks as a CI job                               | **Done** 2026-11-08: `apps/api/test/isolation.integration.test.ts`; found and closed a DNS path (ADR 0014) |
| 1   | Brawzer-drawn error pages                                  | Next                                                                                                       |
| 2   | Bookmarks and history as Brawzer records                   |                                                                                                            |
| 5   | Find in page, zoom, reader mode                            |                                                                                                            |
| 4   | Clipboard with intent                                      |                                                                                                            |
| 9   | Private-address browsing through a saved proxy, on purpose |                                                                                                            |
| 8   | Per-account destination allow-lists and block-lists        |                                                                                                            |
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
