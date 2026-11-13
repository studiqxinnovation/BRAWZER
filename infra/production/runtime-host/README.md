# A runtime host

A Linux machine that runs nothing but cloud browser sessions (ADR 0016).
The API reaches its Docker engine over mutual TLS and starts, for every
session, an egress sidecar and a runtime container.

## Provision

1. Docker Engine, and gVisor (`runsc`) registered as a runtime (`/etc/docker/daemon.json`: `"runtimes": {"runsc": {"path": "/usr/local/bin/runsc"}}`). nftables must be available to containers (it is on any current kernel).
2. Certificates: run `./make-certs.sh <host name or address>` here. It makes a CA, a server certificate for the engine and a client certificate for the API, under `certs/`. Install `ca.pem`, `server-cert.pem` and `server-key.pem` on the host; copy `ca.pem`, `cert.pem` and `key.pem` to the app tier's `DOCKER_TLS_DIR`.
3. The engine listens with TLS only: in `daemon.json`, `"hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:2376"], "tls": true, "tlsverify": true, "tlscacert": "/etc/docker/ca.pem", "tlscert": "/etc/docker/server-cert.pem", "tlskey": "/etc/docker/server-key.pem"`.
4. Firewall: port 2376 and the published agent ports (ephemeral, `BROWSER_AGENT_BIND`, every interface by default) only from the app tier's addresses; nothing inbound from the internet. Outbound is what sessions browse; the egress sidecars enforce the address rules.
5. Pull the runtime and egress images (`docker pull`) the API's configuration names, by digest.

## Operate

- One runtime host per API deployment (`DOCKER_HOST`); add capacity by adding a host and an orchestrator that picks one (not built).
- Rotate certificates by making a new set, installing it on the host and restarting the engine, then switching the app tier (the runbook has the order).
- `docker ps --filter label=brawzer.managed` shows every session container; the API removes orphans at start and sessions at their limits.
