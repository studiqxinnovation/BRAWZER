# Phase 7 plan: production hosting

- **Status:** Accepted 2026-11-08 under the standing instruction to build every phase; decisions taken as recommended (table at the end). No hosting provider is chosen here: everything runs on any Linux host with Docker, and the runbook says what to provision.
- **Progress:** Built 2026-11-08: 7.1 (the engine over mutual TLS, container runtime), 7.2 (several API instances, capacity), 7.3 (orphaned objects), 7.4 (release workflow, production stack, staging with real sessions), 7.5 (runbook and review, [docs/reviews/phase-7.md](../reviews/phase-7.md)). Design in [ADR 0016](../adr/0016-production-hosting.md).
- **Date:** 2026-11-08
- **Builds on:** every earlier phase; [docs/DEPLOYMENT.md](../DEPLOYMENT.md).

## Goal

Make Brawzer runnable outside one machine, safely: session containers on a
host of their own reached over mutual TLS, more than one API instance,
images built and rebuilt by a pipeline, a bounded installation, nothing
left behind in the object store, and a runbook for the day something goes
wrong.

## What Phase 7 delivers

- **Runtime hosts**: `DOCKER_HOST=tcp://…` with mutual TLS, required in production; `BROWSER_CONTAINER_RUNTIME` for gVisor.
- **Several API instances**: session ends announced over Valkey, a reaper leader lock, a global live-session limit under a database lock.
- **Orphaned object removal** with retention.
- **Release workflow**: four images to GitHub's registry on tags, rebuilt weekly from `main`.
- **A production stack** (`infra/production`) for the app tier and instructions for a runtime host, and a **staging stack that runs sessions** through a TLS-protected engine in a container.
- **A runbook**: incidents, rotation, rolling images, isolating a host, what to watch.

## Boundaries

- **No scheduler across runtime hosts**: one engine endpoint per API deployment.
- **No warm pool**: a session starts in a few seconds cold; a pool is measured, not assumed.
- **No penetration test performed**: the plan for one is in the runbook; it needs a host.
- **No provider-specific code**: object store, database, Valkey and key service are whatever speaks the protocol.

## Milestones

| #   | Milestone           | Delivered                                                                                                                                                                           |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | The engine endpoint | `DockerClient` over a Unix socket or TCP with mutual TLS; `DOCKER_TLS_*`; `BROWSER_CONTAINER_RUNTIME` passed as the container runtime; production refuses a TCP engine without TLS  |
| 7.2 | Instances, capacity | `brawzer:browser:ended` channel, the relay's subscriber, the reaper lock, `BROWSER_MAX_LIVE_SESSIONS` under an advisory lock                                                        |
| 7.3 | Orphans             | `OrphanService` with the retention job: objects under `drive/` and `profiles/` that no row refers to and that are older than an hour                                                |
| 7.4 | Pipeline and stacks | `.github/workflows/release.yml`; `infra/production` (app tier compose, runtime host notes, certificate script); staging gains a `runtime-engine` service so the Browser works there |
| 7.5 | Runbook and review  | `docs/RUNBOOK.md`; security review of the new trust boundaries; verification                                                                                                        |

## Decisions

| #   | Decision                           | Taken as                                                                                                    |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Where sessions run                 | Runtime hosts reached over mutual TLS; never the API host's socket in production                            |
| 2   | Orchestrator and relay as services | Not split: the trust separation they were for comes from the remote engine; the modules stay inside the API |
| 3   | Stronger isolation                 | gVisor (`runsc`) recommended and supported through configuration; not required                              |
| 4   | Coordination between instances     | Valkey pub/sub for events, a Valkey lock for the reaper, PostgreSQL advisory locks for counts and jobs      |
| 5   | Capacity                           | A global live-session count; at the limit, starting answers 503 with Retry-After                            |
| 6   | Registry                           | GitHub's container registry, images tagged with the version and the commit; weekly `nightly` rebuilds       |
| 7   | Staging                            | Runs real sessions through Docker-in-Docker with TLS, which is privileged and for staging only              |
