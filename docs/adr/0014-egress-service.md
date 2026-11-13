# ADR 0014: The egress service

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR 0010](0010-proxy-tests-and-ssrf.md) (address rules, proxy tests), [ADR 0012](0012-cloud-browser-runtime-isolation.md) (runtime isolation)

## Context

Phase 3a made every page connection go through a filtering proxy inside the
runtime container. That proxy is a process next to the engine: it applies
the address rules, but it is the only thing between a compromised engine and
the network, it resolves names on the container's own resolver, and it knows
nothing about the proxies people save. ADR 0010 also left proxy tests inside
the API process, with the address rules as the only barrier between a test
and Brawzer's own services, and said both had to move out before launch.

## Decision

### One egress sidecar per session, owning the network

Each session is two containers. The **egress sidecar** (`apps/egress`,
image `brawzer-egress`) is created first and owns the session's network
namespace and published ports; the **runtime** joins that namespace
(`NetworkMode: container:<egress>`) and has no network of its own. Inside the
namespace, the egress installs an nftables ruleset (it starts as root with
`CAP_NET_ADMIN`, `SETUID` and `SETGID` only, applies the rules, then drops to
an unprivileged user before it listens):

- output policy drop; loopback allowed; replies to established connections allowed (the host reaching the agent);
- only the egress user's sockets may leave; the engine's user, and anything else in the runtime, has no route out and no DNS;
- private, link-local, metadata, multicast and the IPv4-in-IPv6 ranges are dropped even for the egress user (belt and braces over the rules in code), except in development, where the test proxies run on the host.

The runtime's own proxy stays as a cheap first refusal and for the test
site, but with an egress it forwards everything else unresolved
(`CONNECT host:port`, absolute-URI requests) to the egress on the
namespace's loopback.

### What the egress does with a connection

`decideEgress` (unit-tested): the port must be 80, 443 or unprivileged;
IP literals must be public; obviously local names are refused; the engine's
own background services (component updates, account services, safe-browsing
lookups) are refused by suffix. Then:

- **Without a saved proxy**, the name is resolved in the egress and every answer must be public (DNS rebinding is defeated by connecting to the checked address).
- **With the profile's saved proxy**, the name is handed to the proxy unresolved through `@brawzer/proxy-client` (SOCKS5, SOCKS4a or HTTP CONNECT; SOCKS4 can only carry IPv4, so there the name is resolved first). The proxy resolves it on its own network, so nothing about the destination leaves through Brawzer's resolver, and websites see the proxy's address. The proxy's credentials are decrypted by the API for the sidecar's environment only; the runtime never has them, and a page can't ask the egress for them.

### Proxy tests out of the API

The same image in `tester` mode is one long-lived container per API
instance, started on first use with a secret made at start, with one
authenticated route. The API applies ADR 0010's limits and sends the target
(credentials included, over the host's loopback) and the fixed echo URL; the
container does the test and answers with the outcome. Production refuses the
`inline` runner that keeps the old in-process path for development without a
container engine.

### Changing a profile's proxy

Because traffic now goes through it, choosing a profile's proxy is a
sensitive change: it needs a sign-in or confirmation from the last 10
minutes, like deleting a passkey.

## Consequences

- Two containers per session, the sidecar small (256 MiB, one CPU). Starting a session takes one more container start.
- `host.docker.internal` is the only private address development egress containers need (test proxies and echo servers on the host); `EGRESS_LOOPBACK_HOST` rewrites loopback targets to it and is refused in production.
- A WebRTC or DNS leak would need a route the namespace doesn't have; the engine's flags stay as a second layer.
- SOCKS4 proxies leak destination names to the egress's resolver (the protocol has no room for a name). Documented on the Proxy page's protocol choice is left to Phase 5's review.
- The engine's background services are a block list, not an allow-list of destinations. A per-account allow-list is a product decision for later; the rules are in one place for it.
- The tester container is per API instance and dies with it; stale testers from earlier instances are removed at start.
