# 0012 Cloud browser runtime isolation

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR 0006](0006-browser-streaming.md) (streaming), [ADR 0010](0010-proxy-tests-and-ssrf.md) (address rules), [ADR 0008](0008-secrets-and-step-up.md) (sealed secrets).

## Context

Each cloud browser session runs a real Chromium that executes untrusted
websites. The person's computer must never run that code, and the websites
must never reach Brawzer's own network, other sessions, or the host. Phase 3
runs sessions as containers on a Docker engine; stronger isolation is
evaluated for production in Phase 7.

## Decision

**One container per session**, started by the API's orchestrator with:

- the runtime image (`apps/runtime-agent/Dockerfile`): Debian's Chromium, the runtime agent, a non-root user (`browser`, uid 10001) and no shell entry point;
- a **read-only root file system**, a size-limited `noexec` tmpfs for the engine's profile and cache, a bounded `/dev/shm`;
- **no Linux capabilities** and `no-new-privileges`;
- a **seccomp profile** (`apps/api/src/browser/runtime-seccomp.json`): Docker's default profile plus `clone`, `clone3`, `unshare` and `chroot`, which Chromium's own namespace sandbox needs to put every renderer in its own user, PID and network namespace behind an empty chroot. The engine's sandbox therefore stays **on**; a runtime that can't create namespaces fails to start rather than running unsandboxed;
- memory, CPU and process limits, no restart, log rotation;
- a dedicated bridge network with inter-container communication disabled;
- a maximum lifetime of 4 hours and an idle timeout of 15 minutes without a viewer.

**The engine has no debugging port.** The agent drives it over the DevTools
pipe (`--remote-debugging-pipe`), so nothing on any network can reach its
controls. The agent itself listens on one port inside the container and
accepts a single connection, authenticated with a per-session secret that the
orchestrator passes in; the API keeps that secret sealed by the key service
and bound to the session.

**Every page connection goes through a filtering proxy inside the
container.** Chromium is forced to it by flag and by managed policy, with
loopback included (`<-loopback>`), QUIC off and WebRTC limited to proxied
connections. The proxy resolves names itself, applies ADR 0010's address
rules to every resolved address (any private address refuses the whole name,
which defeats DNS rebinding), and connects to the checked address, never to
a name. Refused plain-HTTP requests get a "Blocked by Brawzer" page; refused
tunnels get 403. The engine's own vendor connections are cut with policies
and flags (no component updates, variations, sign-in, safe-browsing lookups
or crash reports); what remains is listed under consequences.

**Refusals are enforced by the engine, not by Brawzer's UI.** The image
ships a managed policy file that blocks `file:`, `chrome:` and other internal
schemes, blocks every download, disables printing, extensions, password and
payment autofill, and denies camera, microphone, location, sensors, USB,
serial, HID, Bluetooth and local-file access. The agent additionally denies
downloads at the DevTools level and intercepts file choosers, and tells the
viewer what was refused so Brawzer can explain it.

**Only pixels and structured state leave the container**: JPEG frames of
the active tab, tab titles and addresses, loading and security state, page
dialogs. Input goes the other way. Nothing is persisted; the container is
destroyed when the session ends.

**Reaching a session**: the page asks the API for a single-use stream
ticket (60 seconds, bound to the account, the sign-in and the session,
stored hashed), then presents it as the first WebSocket message; the relay
checks the page's origin, redeems the ticket, connects to the agent with the
session secret, validates every message against the shared schema, and cuts
the stream when the session ends, when the sign-in that started it ends, or
every 10 seconds if either stops being valid. One viewer per session; a new
one replaces the old.

## Consequences

- Container escapes remain the main risk: Chromium's sandbox, the seccomp profile and the capability drop reduce it; gVisor or micro-VMs are evaluated for production (Phase 7).
- The proxy enforces address rules, not an allow-list: pages can reach any public address. Phase 5 adds egress controls and traffic through saved proxies.
- Some engine background requests may still occur on first start (the policies cover the known ones); they go through the same proxy and never carry user data. Phase 5's allow-list closes this.
- Docker's socket is root-equivalent: the API process that starts containers must be trusted accordingly, and in production the orchestrator should be split out (Phase 7).
- No audio, no WebRTC streaming and no Firefox yet (ADR 0006, step 3b).
