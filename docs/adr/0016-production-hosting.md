# ADR 0016: Production hosting

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR 0012](0012-cloud-browser-runtime-isolation.md), [ADR 0014](0014-egress-service.md), [ADR 0011](0011-drive-encryption-and-scanning.md)

## Context

Everything ran on one developer machine: one API process, the container
engine's socket mounted into it, images built locally, no registry, no
schedule for rebuilding them when the base image gets a security update,
and jobs (session reaping, data retention) that assumed a single instance.
Reviews since Phase 3 had pushed to Phase 7: where session containers run,
the root-equivalent Docker socket, several API instances, capacity, orphaned
objects, stronger isolation and an incident runbook.

## Decision

### Two roles of host, one engine endpoint over mutual TLS

Production is **an app tier** (the edge proxy, the web app, the API; managed
PostgreSQL, Valkey, an S3-compatible store, a key service, ClamAV) and **one
or more runtime hosts** that run nothing but session containers. The API
reaches a runtime host's Docker engine over `tcp://host:2376` with mutual
TLS (`DOCKER_HOST`, `DOCKER_TLS_CA/CERT/KEY`), which production requires;
the socket is never mounted into the API container. The engine on a runtime
host is root-equivalent for that host only, which holds no data: this is the
trust separation the "split the orchestrator out" item was for, without a
third service and another internal credential. The orchestrator and relay
stay modules of the API.

### Session containers under a stronger runtime

`BROWSER_CONTAINER_RUNTIME` names an OCI runtime registered with the engine
(gVisor's `runsc`), passed as the container's runtime. The recommended
production setting is `runsc`; the seccomp profile, capability drop and
read-only root stay as they are. Evaluated, not required: an installation
that can't run gVisor keeps the Phase 3 isolation and says so in its risk
register.

### Several API instances

- A session that ends on one instance is announced on a Valkey channel; every instance cuts the viewer it holds.
- The reaper runs on whichever instance wins a short Valkey lock each tick; if Valkey is away, every instance reaps rather than none.
- Data retention and orphan removal already ran under a PostgreSQL advisory lock.
- The installation's live sessions are counted under one advisory lock when a session starts (`BROWSER_MAX_LIVE_SESSIONS`), so two instances can't both admit the last slot.
- Egress testers and orphaned runtime containers were already per instance and per session row.

### Orphaned objects

A maintenance job (with retention, every six hours, one instance at a time)
lists the store under `drive/` and `profiles/`, keeps anything a row refers
to or that is younger than an hour, and removes the rest.

### Images, registry and rebuilds

A release workflow builds the four images (API, web, runtime, egress) on a
version tag and pushes them to GitHub's registry with the version and the
commit as tags; a weekly schedule rebuilds and pushes them from `main`
under the `nightly` tag, so Debian's Chromium and the Node base image get
their security updates even when nothing in Brawzer changed. The staging
stack runs the Browser for real with a TLS-protected engine in a container,
so the production engine path is exercised before any host exists.

## Consequences

- No Kubernetes. A runtime host is a plain Linux machine with Docker, gVisor and nftables; adding capacity is adding a host and, later, an orchestrator that picks one. Until then one `DOCKER_HOST` means one runtime host per API deployment, which is enough to launch and is stated in the runbook.
- Mutual TLS to the engine means certificate rotation is part of operations (the runbook has the steps).
- Capacity is a count, not a queue: at the limit, starting a session answers "at capacity"; nobody is queued. Since Phase 8 (idea 15) the count is per runtime host: `RUNTIME_HOSTS` lists several engines with capacities, the healthy one with the most room takes each session, and the session row remembers its host.
- The weekly rebuild changes images without a code change; deployments pin by digest and roll on purpose.
