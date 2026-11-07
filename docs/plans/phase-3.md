# Phase 3 plan: the cloud browser

- **Status:** Accepted 2026-11-07 under the standing instruction to build every phase; decisions taken as recommended (table at the end).
- **Progress:** 3.1 done (results in ADR 0006).
- **Date:** 2026-11-07
- **Builds on:** Phase 2 ([review](../reviews/phase-2.md)), [ADR 0006](../adr/0006-browser-streaming.md) (streaming), [ADR 0010](../adr/0010-proxy-tests-and-ssrf.md) (address rules).

## Goal

Real browsing in Brawzer's cloud. A signed-in person opens **Browser**, and a
Chromium instance starts in its own isolated container. Brawzer's own chrome
(tabs, address bar, back, forward, reload) is drawn in the page; only the
website's pixels are streamed. The computer in front of the person never runs
the websites' code and keeps none of their cookies, history or downloads.

## What Phase 3 delivers

- **One isolated container per browser session**, with Chromium's sandbox on, no Linux capabilities, a read-only file system, memory, CPU and process limits, and a maximum lifetime.
- **Streaming by Chrome DevTools Protocol screencast** over a secure WebSocket (ADR 0006, step 3a), with mouse, keyboard, scrolling and text input sent back.
- **Tabs, navigation and page state** in Brawzer's chrome: URL, title, loading, back and forward.
- **Safe defaults:** downloads, uploads, printing, clipboard, notifications, camera, microphone and location are refused, each with a clear message in Brawzer's UI. Page dialogs (alert, confirm, prompt) are shown by Brawzer.
- **No reaching Brawzer's own network:** pages in the cloud browser connect through a filtering proxy inside the container that applies ADR 0010's address rules, with QUIC off and WebRTC limited to proxied connections.
- **Short-lived stream tickets** (60 seconds, single use) and immediate disconnection when the person signs out, is signed out remotely, or the session ends; an idle timeout.

## Boundaries: what Phase 3 does not do

- **Sessions are not kept.** Each session starts clean and is destroyed when it ends. Persistent profiles (cookies and history kept between sessions, encrypted) are Phase 4; profiles are chosen at start but only their names are used until then.
- **No downloads to Drive** (Phase 4) and **no traffic through saved proxies** (Phase 5).
- **No WebRTC streaming, audio or Firefox.** Those are ADR 0006's step 3b. They need a media pipeline and TURN servers, and are planned separately once 3a is measured.
- **No production hosting.** Containers run on the local Docker engine; Kubernetes, the warm pool and capacity planning are Phase 7.

## Architecture

```
web app ──HTTPS──> API (sessions, tickets) ──internal──> orchestrator ──Docker──> runtime container
   │                                                                              │ agent + Chromium
   └──────WSS (ticket)──> gateway ──internal WS (session secret)──────────────────┘ filtering proxy
```

1. **`apps/runtime-agent`** runs inside each container. It starts Chromium with `--remote-debugging-pipe` (no debugging port to reach), drives it over CDP, sends screencast frames and page state, applies input, and refuses downloads, uploads, permissions and printing. It runs the filtering proxy Chromium is forced to use. It accepts one connection from the gateway, authenticated by a per-session secret.
2. **`apps/orchestrator`** starts and stops runtime containers through the Docker Engine API, with labels, limits and lifetimes, and removes orphans. It has no public endpoint; the API calls it with an internal token.
3. **`apps/gateway`** accepts the browser's WebSocket only with a valid stream ticket, relays to the agent, and closes the stream as soon as the session or the person's sign-in ends (Redis notifications).
4. **`apps/api`** owns `browser_sessions` records, per-account limits, starting and ending sessions, and issuing tickets.
5. **`packages/net-policy`**: ADR 0010's address rules, shared by the API's proxy tester and the agent's filtering proxy.

## Milestones

### 3.1 Spike: measure the screencast

Run headless Chromium locally, start a CDP screencast at 1280×800 and measure
frame rate, input-to-frame latency and bandwidth. Record the results and the
chosen settings in ADR 0006 and mark it accepted.

### 3.2 Runtime agent and image

- `packages/net-policy` (moved from the API) and the agent's filtering proxy.
- The agent: Chromium lifecycle, tabs, navigation, screencast, input, page dialogs, refusals; its message protocol in `packages/contracts`.
- The runtime image: Debian with Chromium, a non-root user, a seccomp profile that keeps Chromium's sandbox working without extra capabilities.
- **Tests:** unit (protocol, filtering proxy), integration (agent against a real Chromium and a local test site).

### 3.3 Orchestrator

- Docker driver: create, start, inspect and remove containers with limits and labels; a dedicated network that can't reach Brawzer's services.
- Lifetimes, idle reaping and orphan cleanup.
- **Tests:** integration with the real Docker engine.

### 3.4 Sessions, tickets and gateway

- `browser_sessions` table; start, list and end in the API; one live session per account while in development.
- Stream tickets; the gateway relay; revocation on sign-out and session end; idle timeout.
- **Tests:** integration across API, orchestrator, gateway and a real container.

### 3.5 Browser workspace

- The Browser page: tabs, address bar, navigation, the streamed viewport, input, resizing, status and ending the session.
- Brawzer UI for page dialogs and for every refused action.
- **Tests:** browser tests that browse a local test site through a real container, plus accessibility checks of Brawzer's own UI.

### 3.6 Phase 3 review

Security review (isolation, escape paths, network reach, ticket and relay
abuse, resource exhaustion), performance notes, and `docs/reviews/phase-3.md`.

## Decisions

| #   | Decision                              | Taken as                                                           |
| --- | ------------------------------------- | ------------------------------------------------------------------ |
| 1   | Streaming method for Phase 3          | CDP screencast (ADR 0006, 3a); WebRTC and Firefox later            |
| 2   | Engine package in the image           | Debian's Chromium package, updated with the image                  |
| 3   | Live sessions per account (temporary) | 1                                                                  |
| 4   | Session limits                        | 15 minutes without a viewer ends a session; 4 hours at most        |
| 5   | Where the services run in development | Containers on the local Docker engine; services as local processes |

## Risks

- **Container escape.** Mitigated by Chromium's sandbox, no capabilities, seccomp, a non-root user and a read-only file system. Stronger isolation (gVisor or micro-VMs) is evaluated for production in Phase 7.
- **Pages attacking Brawzer's network.** Mitigated by the filtering proxy; replaced by network-level egress isolation in Phase 5.
- **Resource exhaustion.** Container limits, one session per account, lifetimes and idle reaping.
- **Image size and update cadence.** Chromium security updates must flow into the image quickly; Phase 7 automates rebuilds.
