# Phase 3 review: the cloud browser

- **Date:** 2026-11-08
- **Scope:** milestones 3.1–3.5 ([plan](../plans/phase-3.md)), [ADR 0006](../adr/0006-browser-streaming.md), [ADR 0012](../adr/0012-cloud-browser-runtime-isolation.md).
- **Verdict:** Phase 3a is done. Sessions run in isolated containers, the Browser page draws Brawzer's own chrome around streamed pixels, and every refusal is enforced by the engine and explained by the UI. The findings below are recorded for the following phases; none blocks using the feature in development.

## What was built

| Milestone | Delivered                                                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1       | Screencast spike and settings (ADR 0006)                                                                                                                                                                                                                                                                |
| 3.2       | `apps/runtime-agent`: DevTools pipe transport, engine controller (tabs, navigation, screencast with end-to-end acknowledgements, input, dialogs, refusals), filtering proxy, test site, policies; the runtime image. Protocol in `@brawzer/contracts` (`browser-protocol.ts`)                           |
| 3.3       | `OrchestratorService` and a minimal Docker Engine client: hardened containers, readiness polling, orphan cleanup, idle and age reaping                                                                                                                                                                  |
| 3.4       | `browser_sessions` table, `/browser` routes (overview, start, end, ticket), single-use stream tickets, the WebSocket relay (`StreamGateway`), sessions ended on sign-out through `SessionService` revocation events, security history entries, data export                                              |
| 3.5       | The Browser page: start panel with profile choice, tabs, address bar (addresses or DuckDuckGo searches), back/forward/reload, the streamed viewport with pointer, wheel, keyboard, touch and on-screen-keyboard input, page dialogs, refusal notices, shortcuts, full screen, session status and ending |

## Security review

Checked against the plan's risk list.

1. **Isolation.** Containers run read-only, without capabilities, with `no-new-privileges`, resource limits and a seccomp profile that keeps Chromium's namespace sandbox working (verified: the zygote fails without `chroot`, and the image refuses to start unsandboxed). The agent runs as a non-root user; the engine has no debugging port. _Remaining:_ kernel attack surface shared with the host; gVisor or micro-VMs are a Phase 7 evaluation.
2. **Network reach.** All page traffic passes the in-container proxy, which applies ADR 0010's rules to resolved addresses (covered by unit tests and an integration test that navigates to a loopback address and sees the blocked page). Containers can't talk to each other. The engine's vendor requests observed on first start (component updater, account services) were cut with policies and flags; what remains goes through the same proxy. _Remaining:_ public internet is reachable without an allow-list until Phase 5.
3. **Ticket and relay abuse.** Tickets are random 256-bit values stored hashed, single-use, 60 seconds, bound to account, sign-in and session; presented as the first message so they never appear in URLs or logs; the relay checks the Origin header; every client message is schema-validated at the relay and again at the agent; message size and bad-message counts are capped; frames that the page can't take are dropped and acknowledged so a slow viewer can't stall the engine. Integration tests cover invalid tickets, replay, replacement and ending on sign-out.
4. **Resource exhaustion.** One live session per account, per-account rate limits on starting sessions and issuing tickets, container memory/CPU/PID limits, 16 tabs per session (popup storms are closed before they run), 15-minute idle and 4-hour maximum lifetimes, orphan cleanup at start. _Remaining:_ no global capacity limit (Phase 7).
5. **Information leaving the container.** Pixels, titles, addresses, loading and security state, dialog text. Security history records only that a session started or ended and why; never what was browsed. Exports list sessions, not pages.
6. **Docker socket.** The API needs the engine's socket, which is root-equivalent on that machine. Recorded in ADR 0012 and DEPLOYMENT; the orchestrator is to be split out before production (Phase 7).

## Performance notes

Measured on the development machine (Apple Silicon, Docker Desktop):
starting a container to a ready agent takes well under a second once the
image is cached; the integration suite starts and ends several sessions in
about four seconds; frames follow input within the ADR 0006 figures plus the
relay hop. A viewer that stops acknowledging frames stops receiving them,
which is the intended back-pressure.

## Findings

1. **Tab titles after back/forward cache restores** are refreshed on load events; a page that changes its title without navigating is only picked up when the engine reports it. Low impact; a periodic title check can be added if it shows.
2. **Touch input is basic**: tap to click, drag to scroll, an on-screen keyboard through a hidden field. Pinch zoom and long-press are not mapped.
3. **Reconnection** retries twice with fresh tickets; a longer outage ends the stream and the person starts again from the page (the session itself keeps running until it idles out).
4. **Multiple API instances** would each run the reaper and keep their own relays; revocation events are in-process. Fine for one instance (development); Phase 7 moves both to shared infrastructure.
5. **Staging** doesn't mount the Docker socket into the API container, so the Browser page reports the runtime as unavailable there until Phase 7 decides how production starts sessions.

## Verification

| Check                   | Result                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests              | contracts (protocol, frames), runtime agent (pipe transport, proxy rules and forwarding), API (config, health), web (input helpers, events)                                         |
| Integration tests       | `apps/api/test/browser.integration.test.ts`: overview, full browsing journey through a real container, tickets and replacement, ending on sign-out                                  |
| Browser tests           | `apps/web/e2e/browser.spec.ts`: start, stream, address bar, click, back, typing, page dialog, download refusal, tabs, end; accessibility checks at each step; start panel on phones |
| Lint, types, formatting | clean                                                                                                                                                                               |
| Images                  | API, web and runtime images run as non-root users (CI)                                                                                                                              |
