# Brawzer on Hostman

The production footprint from [ADR 0016](../../docs/adr/0016-production-hosting.md), provisioned on [Hostman](https://hostman.com) through its API. Nothing here is specific to Brawzer's code; it is the "provision per installation" step that [DEPLOYMENT.md](../../docs/DEPLOYMENT.md) leaves to the operator.

## What gets created

| Resource          | Where | Size                      | Price  | Used for                                                         |
| ----------------- | ----- | ------------------------- | ------ | ---------------------------------------------------------------- |
| brawzer-app-1     | us-2  | 4 vCPU, 8 GB, 160 GB NVMe | $20/mo | Caddy, the web app, the API, PostgreSQL, Valkey, OpenBao, ClamAV |
| brawzer-runtime-1 | us-2  | 4 vCPU, 8 GB, 160 GB NVMe | $20/mo | Session containers only; its engine over mutual TLS              |
| brawzer-drive-…   | us-2  | 10 GB private S3 bucket   | $1/mo  | Drive and profile objects (ciphertext, ADR 0011)                 |

Both servers are plain Ubuntu 24.04 in New York (Hostman's Docker image failed to install; `bootstrap-host.sh` installs Docker). Billing is hourly; the whole footprint is about $41 a month. Hostman's managed databases answer only on a local network that the API can't attach servers to, so PostgreSQL and Valkey run on the app host from `infra/production/services.yaml`. Grow the runtime host first when sessions need it.

Deliberate deviations from the production plan, for a first installation:

- **The key service is OpenBao on the app host** (file storage, auto-unsealed from a root-only file on that host), not a managed KMS, because Hostman has none. Back up `/etc/brawzer/openbao` with the database: without it, every sealed secret is unreadable.
- **Images are built on the servers** from a copy of the repository sent by rsync, rather than pulled from GitHub's registry, so no registry credentials live on the hosts. The release workflow still builds the registry images; switch `production.env` to digests when a registry token is set up.
- **One API instance per host** to start (`API_REPLICAS=1`); the compose stack takes more.

## Steps

1. Put `HOSTMAN_TOKEN` in the repository's `.env` and add `~/.ssh/brawzer-hostman.pub` to the account under the name `brawzer-deploy` (the API token can do it: `POST /api/v1/ssh-keys`).
2. `node infra/hostman/provision.mjs --plan` shows what would be created and the price; without `--plan` it creates what's missing, waits until everything is on, and writes `state.json` (addresses) and `secrets.env` (generated database passwords, mode 0600). Both are git-ignored. The bucket's secret key is masked by Hostman's API: copy the real one from the dashboard (S3 Storage, the bucket, Settings, S3 Parameters) into `secrets.env` as `STORAGE_SECRET_ACCESS_KEY`.
3. `node infra/hostman/deploy.mjs` needs `SITE_HOST` (the domain, with its A record pointing at the app server), `RESEND_API_KEY` and `ADMIN_EMAILS` in `.env`. Production-only settings go in `secrets.env`, never in the development `.env`: `EMAIL_FROM` (default `Brawzer <no-reply@SITE_HOST>`), `EMAIL_REPLY_TO`, `RESEND_WEBHOOK_SECRET`, and the optional Stripe and Anthropic keys. It prepares both hosts (hardening, Docker TLS for the engine, gVisor, firewall), builds the images, writes `production.env` on the app host from the state, installs the nightly backup, starts the stack and runs the checks from the runbook.
4. `node infra/hostman/smoke.mjs` proves the installation end to end: a sign-up with the smoke mailbox, the confirmation email through Resend (read back through Resend's API), a session under gVisor on the runtime host, frames on the stream, the session ended and the host clean, the account deleted. Run it after every deploy.

## Mail

- **Sending** goes through Resend from the verified domain (`brawzer.com`: DKIM and the `send`/`rsend` records at the DNS host). `EMAIL_FROM=Brawzer <no-reply@brawzer.com>`; replies go to `EMAIL_REPLY_TO=support@brawzer.com`.
- **Bounces and complaints** come back to `https://brawzer.com/api/v1/webhooks/resend`, a webhook created through Resend's API (`POST /webhooks`, events `email.bounced` and `email.complained`); its signing secret is `RESEND_WEBHOOK_SECRET` in `secrets.env`. Without it the route answers 404; with it, an unsigned post gets 401.
- **Mailboxes** on the domain are Hostman's mail service, created through its API (`POST /api/v1/mail/domains/brawzer.com` with `mailbox`, `password`, `comment`): `support@brawzer.com` for people writing in, `smoke@brawzer.com` for `smoke.mjs`. Their passwords are in `secrets.env` (`SUPPORT_MAILBOX_PASSWORD`, `SMOKE_MAILBOX_PASSWORD`); the mailboxes open in the Hostman panel's webmail, or in any client at `imap.timeweb.ru:993` and `smtp.timeweb.ru:465` (full address as the user name). The domain's MX records must be `10 mx1.timeweb.ru` and `20 mx2.timeweb.ru`: Hostman's domain wizard writes `mx1.hostman.com` and `mx2.hostman.com`, which do not resolve, so mail to the domain sits undelivered until the records are corrected at the DNS host (brawzer.com's zone is at Hostinger, not Hostman). Check with `dig MX brawzer.com` and `dig <mx host>`.

## Backups

`deploy.mjs` installs `brawzer-backup` and `brawzer-restore` on the app host from [`infra/production/backup/`](../production/backup/) with a cron entry at 03:30 UTC. Each night the database, the key service's unseal material and storage, and the settings files go encrypted to `backups/<stamp>/` in the Drive bucket; thirty days are kept. The passphrase is generated once into `secrets.env` as `BACKUP_PASSPHRASE` and copied to `/etc/brawzer/backup/passphrase`: keep `secrets.env` somewhere safe, since it is what makes a backup readable when the host is gone. The runbook has the monthly drill (`brawzer-restore latest --check`) and the recovery steps.

## Lessons from the first installation

- **OpenBao's API token must be periodic.** A plain orphan token expires after the server's default 32 days, and the API would lose every encrypted value with it. The keeper now creates a periodic token and renews it hourly, and rewrites the `brawzer-api` policy on every start (the first policy lacked `datakey/plaintext`, which every session start needs; the symptom was `Key service responded 403` and a 503 from `POST /browser/sessions` while health said ok).
- **Hostman's API masks the S3 secret**; the real one is in the dashboard.
- **The runtime engine's certificate** names the host's address, and the client must check it against that address rather than the `Host: docker` header the engine convention sends.

## Operate

- `node infra/hostman/provision.mjs --status` prints the recorded addresses.
- `node infra/hostman/deploy.mjs --no-build` re-sends the stack files and settings without rebuilding images; `--check` only runs the checks.
- `node infra/hostman/smoke.mjs` is the end-to-end check.
- Everything else is in [RUNBOOK.md](../../docs/RUNBOOK.md); the hosts are plain Docker hosts.
