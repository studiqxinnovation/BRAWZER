# Brawzer on Hostman

The production footprint from [ADR 0016](../../docs/adr/0016-production-hosting.md), provisioned on [Hostman](https://hostman.com) through its API. Nothing here is specific to Brawzer's code; it is the "provision per installation" step that [DEPLOYMENT.md](../../docs/DEPLOYMENT.md) leaves to the operator.

## What gets created

| Resource          | Where | Size                      | Price  | Used for                                               |
| ----------------- | ----- | ------------------------- | ------ | ------------------------------------------------------ |
| brawzer-app-1     | de-1  | 4 vCPU, 8 GB, 160 GB NVMe | $20/mo | Caddy, the web app, the API instances, OpenBao, ClamAV |
| brawzer-runtime-1 | de-1  | 4 vCPU, 8 GB, 160 GB NVMe | $20/mo | Session containers only; its engine over mutual TLS    |
| brawzer-db        | de-1  | PostgreSQL, 1 vCPU, 1 GB  | $4/mo  | The database                                           |
| brawzer-valkey    | de-1  | Valkey, 1 vCPU, 1 GB      | $4/mo  | Rate limits, session events, locks                     |
| brawzer-drive-…   | us-2  | 10 GB private S3 bucket   | $1/mo  | Drive and profile objects (ciphertext, ADR 0011)       |

Both servers are Ubuntu 24.04 with Hostman's Docker image, on the account's local network so the app tier reaches the runtime host's engine and the databases without crossing the internet. Billing is hourly; the whole footprint is about $49 a month. Grow the runtime host first when sessions need it.

Deliberate deviations from the production plan, for a first installation:

- **The key service is OpenBao on the app host** (file storage, auto-unsealed from a root-only file on that host), not a managed KMS, because Hostman has none. Back up `/etc/brawzer/openbao` with the database: without it, every sealed secret is unreadable.
- **Images are built on the servers** from a copy of the repository sent by rsync, rather than pulled from GitHub's registry, so no registry credentials live on the hosts. The release workflow still builds the registry images; switch `production.env` to digests when a registry token is set up.
- **One API instance per host** to start (`API_REPLICAS=1`); the compose stack takes more.

## Steps

1. Put `HOSTMAN_TOKEN` in the repository's `.env` and add `~/.ssh/brawzer-hostman.pub` to the account under the name `brawzer-deploy` (the API token can do it: `POST /api/v1/ssh-keys`).
2. `node infra/hostman/provision.mjs --plan` shows what would be created and the price; without `--plan` it creates what's missing, waits until everything is on, and writes `state.json` (addresses) and `secrets.env` (generated database passwords, mode 0600). Both are git-ignored.
3. `node infra/hostman/deploy.mjs` needs `SITE_HOST` (the domain, with its A record pointing at the app server), `RESEND_API_KEY` and `ADMIN_EMAILS` in `.env`. It prepares both hosts (hardening, Docker TLS for the engine, gVisor, firewall), builds the images, writes `infra/production/production.env` from the state, starts the stack and runs the checks from the runbook.

## Operate

- `node infra/hostman/provision.mjs --status` prints the recorded addresses.
- Everything else is in [RUNBOOK.md](../../docs/RUNBOOK.md); the hosts are plain Docker hosts.
