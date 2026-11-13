#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 host for Brawzer: Docker Engine from Docker's
# repository, a firewall that admits only what the role needs, automatic
# security updates, and a few kernel settings. Run as root, over SSH:
#
#   ssh root@HOST 'bash -s' -- app     < infra/hostman/bootstrap-host.sh
#   ssh root@HOST 'bash -s' -- runtime APP_TIER_IP < infra/hostman/bootstrap-host.sh
#
# Idempotent: safe to run again after a change.
set -euo pipefail
ROLE="${1:?role: app or runtime}"
APP_TIER_IP="${2:-}"
export DEBIAN_FRONTEND=noninteractive

hostnamectl set-hostname "brawzer-${ROLE}-1"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg ufw unattended-upgrades rsync nftables

# Docker Engine, pinned to Docker's own repository.
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# Security updates on their own, reboots at night only when a kernel needs it.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
sed -i 's|^//Unattended-Upgrade::Automatic-Reboot .*|Unattended-Upgrade::Automatic-Reboot "true";|; s|^//Unattended-Upgrade::Automatic-Reboot-Time .*|Unattended-Upgrade::Automatic-Reboot-Time "04:30";|' /etc/apt/apt.conf.d/50unattended-upgrades

# SSH: keys only, root with a key (Hostman's image has no other user yet).
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/90-brawzer.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
X11Forwarding no
EOF
systemctl reload ssh || systemctl reload sshd || true

# Firewall for the host's own ports. Ports that Docker publishes bypass ufw
# (Docker's rules sit in the FORWARD chain), so those are handled below.
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp comment 'ssh'
if [ "$ROLE" = app ]; then
  ufw allow 80/tcp comment 'http (redirects)'
  ufw allow 443/tcp comment 'https'
  ufw allow 443/udp comment 'http/3'
else
  [ -n "$APP_TIER_IP" ] || { echo "runtime role needs the app tier's address" >&2; exit 2; }
  ufw allow from "$APP_TIER_IP" to any port 2376 proto tcp comment 'docker engine, mutual tls, app tier only'
fi
ufw --force enable >/dev/null
ufw status numbered

cat > /etc/sysctl.d/90-brawzer.conf <<'EOF'
net.ipv4.ip_forward = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.tcp_syncookies = 1
kernel.unprivileged_userns_clone = 1
vm.overcommit_memory = 1
EOF
sysctl --system >/dev/null

if [ "$ROLE" = runtime ]; then
  # gVisor for session containers, from gVisor's own apt repository.
  if ! command -v runsc >/dev/null; then
    curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
      > /etc/apt/sources.list.d/gvisor.list
    apt-get update -q
    apt-get install -y -q runsc
  fi

  # Register runsc as a Docker runtime, and tell it to use the kernel network
  # stack of the namespace it is placed in (`--network=host`), not gVisor's own
  # userspace netstack. A session's runtime container shares the egress
  # sidecar's network namespace (ADR 0012, 0014); gVisor's default sandbox
  # netstack would take that namespace's interface into userspace, leaving the
  # runc egress with no routes and a separate loopback, so the runtime could
  # not reach the egress proxy and nothing would browse. Host mode keeps
  # gVisor's syscall sandbox; the egress nftables firewall still confines the
  # namespace. Written with jq so other daemon settings (TLS, hosts) are kept.
  python3 - <<'PY'
import json, os
p = "/etc/docker/daemon.json"
d = json.load(open(p)) if os.path.exists(p) else {}
rs = d.setdefault("runtimes", {}).setdefault("runsc", {"path": "/usr/bin/runsc"})
args = [a for a in rs.get("runtimeArgs", []) if not a.startswith("--network=")]
rs["runtimeArgs"] = args + ["--network=host"]
json.dump(d, open(p, "w"), indent=2)
PY
  systemctl reload docker || systemctl restart docker

  # Session agent ports are published by Docker on random high ports. The
  # DOCKER-USER chain is where Docker lets the host have a say: only the app
  # tier may open connections to them. Re-applied after every engine start.
  cat > /usr/local/sbin/brawzer-docker-user-rules <<EOF
#!/bin/sh
iptables -C DOCKER-USER -i eth0 ! -s $APP_TIER_IP -m conntrack --ctstate NEW -j DROP 2>/dev/null \\
  || iptables -I DOCKER-USER -i eth0 ! -s $APP_TIER_IP -m conntrack --ctstate NEW -j DROP
EOF
  chmod 755 /usr/local/sbin/brawzer-docker-user-rules
  cat > /etc/systemd/system/brawzer-docker-user-rules.service <<'EOF'
[Unit]
Description=Brawzer: restrict published container ports to the app tier
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/brawzer-docker-user-rules
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now brawzer-docker-user-rules
fi

mkdir -p /etc/brawzer /srv/brawzer
chmod 700 /etc/brawzer
echo "bootstrap done: $(hostname) role=$ROLE docker=$(docker --version | cut -d, -f1)"
