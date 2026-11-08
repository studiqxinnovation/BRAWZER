# Phase 5 plan: egress

- **Status:** Accepted 2026-11-08 under the standing instruction to build every phase; decisions taken as recommended (table at the end).
- **Progress:** Built 2026-11-08: 5.1 (`@brawzer/proxy-client`), 5.2 (`apps/egress`), 5.3 (sessions through the egress), 5.4 (proxy tests in the egress, confirm it's you for a profile's proxy, the pages), 5.5 (review, appended to [the Phase 3 review](../reviews/phase-3.md)). Design in [ADR 0014](../adr/0014-egress-service.md).
- **Date:** 2026-11-08
- **Builds on:** Phase 3 ([plan](phase-3.md), [continued](phase-3-files-and-profiles.md)), [ADR 0010](../adr/0010-proxy-tests-and-ssrf.md), [ADR 0012](../adr/0012-cloud-browser-runtime-isolation.md).

## Goal

Every byte a cloud browser session sends leaves through one place that
Brawzer controls, applies the address rules at the network level rather than
in a process next to the engine, and uses the profile's saved proxy so that
websites see the proxy's address, with its password never near the engine.
Proxy tests leave the API process, as ADR 0010 required before launch.

## What Phase 5 delivers

- **An egress sidecar per session** that owns the session's network namespace; the runtime joins it and has no network of its own. An nftables ruleset in that namespace lets only the egress process out and gives the engine no route and no DNS.
- **Traffic through the profile's proxy** (SOCKS5, SOCKS4a, SOCKS4, HTTP, HTTPS with certificate verification), names handed to the proxy unresolved; credentials in the sidecar only.
- **Egress rules in one place**: public addresses only, DNS-rebinding safe, ports 80, 443 and unprivileged only, the engine's own background services refused.
- **Proxy tests in a tester container** of the same image, one per API instance; the in-API path remains for development without a container engine and is refused in production.
- **Confirm it's you** before a profile's proxy changes.
- **Honest pages:** the start panel says which proxy a session will use, the session status bar shows it, the Proxy and Profiles pages no longer call this unbuilt.

## Boundaries

- **No destination allow-list per account.** The engine's services are a block list; an allow-list is a product decision.
- **No proxy rotation or health monitoring.** A proxy that stops working makes pages fail with "The site didn't answer"; the Proxy page's test says why.
- **One tester per API instance**, in that instance's lifetime; Phase 7 may share one.
- **SOCKS4** resolves destination names in the egress (the protocol can't carry names); SOCKS4a and SOCKS5 don't.

## Milestones

### 5.1 `@brawzer/proxy-client`

The API's proxy tester split into a reusable tunnel (connect through a saved proxy to a destination under ADR 0010's rules) and the tester on top of it, with the existing unit tests; shared by the API and the egress.

### 5.2 `apps/egress`

Session mode: the firewall, the forwarding proxy (CONNECT and plain HTTP) with the egress rules and the optional upstream; tester mode: the authenticated test route. Loopback rewriting for development. The image, starting as root for `nft` and dropping privileges. Unit tests for the rules and the ruleset.

### 5.3 Sessions through the egress

The orchestrator creates the sidecar, waits for it, then the runtime in its namespace; both are removed with the session, orphans included. The runtime's proxy forwards to the egress unresolved. `browser_sessions.proxy_id` records the proxy in use. Integration tests: the sidecar owns the network and the runtime adds no capabilities; a session under a profile with a SOCKS5 proxy fetches a name that exists nowhere, answered by the proxy, with the password absent from the runtime's environment.

### 5.4 Proxy tests, step-up and the pages

`EgressService` runs tests in the tester container (`PROXY_TEST_RUNNER`, egress by default and in production); the proxies' integration tests run through it. A recent sign-in is required to change a profile's proxy (API and the web's confirm-it's-you flow). The Browser, Proxy and Profiles pages say what is true now.

### 5.5 Review

Appended to the Phase 3 review: network reach with the firewall, credentials' path, what a compromised engine can still do.

## Decisions

| #   | Decision                           | Taken as                                                                                                                                                                                |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Where the egress runs              | A sidecar container per session sharing the runtime's network namespace, rather than a shared egress service: no per-session routing state, credentials of one profile in one container |
| 2   | Network-level enforcement          | nftables in the shared namespace, applied by the sidecar with `CAP_NET_ADMIN` before dropping privileges; the runtime keeps no capabilities at all                                      |
| 3   | Name resolution with a saved proxy | Names go to the proxy unresolved (remote DNS); only literal and obviously local targets are refused locally                                                                             |
| 4   | Ports                              | 80, 443 and 1024 and up; mail, shell, file-sharing and other well-known ports are refused                                                                                               |
| 5   | Engine background services         | Refused by host suffix in the egress; an allow-list of destinations is deferred                                                                                                         |
| 6   | Proxy tests                        | In a tester container of the egress image, one per API instance; the in-process path stays for development and is refused in production                                                 |
| 7   | Development reach                  | `EGRESS_LOOPBACK_HOST` (host.docker.internal) rewrites loopback targets for test proxies on the host, and the firewall's private-range drop is off when private addresses are allowed   |
| 8   | Step-up                            | Changing a profile's proxy requires a recent sign-in; saving a proxy itself does not, since a saved proxy does nothing until a profile uses it                                          |
