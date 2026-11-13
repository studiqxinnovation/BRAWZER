# Phase 7 review: production hosting

Reviewed 2026-11-08 at the end of milestone 7.5. Plan:
[docs/plans/phase-7.md](../plans/phase-7.md); design:
[ADR 0016](../adr/0016-production-hosting.md); operations:
[docs/RUNBOOK.md](../RUNBOOK.md).

## What was built

| Milestone | Delivered                                                                                                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1       | `DockerClient` over a Unix socket or TCP with mutual TLS (`DOCKER_HOST=tcp://…`, `DOCKER_TLS_CA/CERT/KEY`, required in production), `BROWSER_CONTAINER_RUNTIME` as the container runtime (gVisor), agent ports bound on and reached at the engine host (`BROWSER_AGENT_BIND/HOST`)           |
| 7.2       | Session ends announced on a Valkey channel and heard by every instance's relay, the reaper under a Valkey lock (every instance reaps when Valkey is away), `BROWSER_MAX_LIVE_SESSIONS` counted under a PostgreSQL advisory lock, `Retry-After` kept on 503 responses                         |
| 7.3       | `OrphanService` with the retention job: objects under `drive/` and `profiles/` that no row refers to and that are older than an hour are removed                                                                                                                                             |
| 7.4       | `.github/workflows/release.yml` (four images to GitHub's registry on tags, weekly `nightly` rebuilds), `infra/production` (app tier compose, Caddyfile, settings example, runtime host notes and certificate script), the staging stack running real sessions through a TLS-protected engine |
| 7.5       | The runbook, this review                                                                                                                                                                                                                                                                     |

## Security review

1. **The engine endpoint.** Mutual TLS is required for a TCP engine in production (config test); the certificate script makes separate server and client certificates under one CA with the right extended key usages; key material is read at start and never logged (`describe()` prints the endpoint only). _Remaining:_ the engine on a runtime host is root-equivalent for that host; the host holds no data and is firewalled to the app tier (runbook).
2. **Agent ports on a runtime host** are bound on every interface by default so the app tier can reach them, protected by the per-session secret on every connection and by the host firewall. _Remaining:_ a mis-configured firewall exposes agent ports to whoever can reach the host; the secret still gates them.
3. **Isolation.** gVisor through configuration, recommended in the production settings; the seccomp profile, capability drop and read-only root stay in force under it. Not verified on a host here: the by-hand checks to repeat are in the runbook.
4. **Several instances.** Ends are announced over Valkey and the relay's 10-second validity check backs them up; the reaper lock prevents double reaping but a lost lock only means two reapers, which is harmless (every change is idempotent). Capacity is counted under a database lock, so instances can't both admit the last slot (integration test with two instances sharing one database and Valkey).
5. **Orphans.** Only unreferenced objects older than an hour go, under the same lock as retention; a referenced file stays (integration test). _Remaining:_ an object written by an upload that then fails for over an hour before its row would exist can't happen (rows are written at the end of the same request), but a clock an hour wrong on the store would.
6. **Images.** Built in CI from pinned bases, pushed with the commit as a tag, deployments pin by digest; the weekly rebuild means an image can change without a Brawzer change, which the runbook says to roll on purpose.
7. **Staging** runs Docker-in-Docker privileged; it is for staging only and the compose file says so.

## Verification

| Check             | Result                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit tests        | configuration: socket and TCP engines, TLS required in production, files set together and readable, the runtime and capacity settings, agent bind and host defaults; the error filter keeps `Retry-After` on 503                                                                           |
| Integration tests | `apps/api/test/production.hosting.integration.test.ts`: two API instances on one database and Valkey, a viewer on one cut when the session ends on the other, the installation's capacity refused with `Retry-After`; orphaned objects removed only when old enough, referenced files kept |
| Compose           | `infra/staging/compose.yaml` and `infra/production/compose.yaml` validate (`docker compose config`); the certificate script parses; the release workflow passes actionlint                                                                                                                 |
| Lint, types       | clean                                                                                                                                                                                                                                                                                      |
