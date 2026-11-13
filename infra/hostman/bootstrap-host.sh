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

# Firewall. Docker publishes ports around ufw's INPUT chain, so the stacks
# bind published ports to specific addresses and ufw guards the host's own.
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
  ufw allow from "$APP_TIER_IP" to any port 20000:29999 proto tcp comment 'session agents, app tier only'
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

# gVisor for session containers on the runtime host.
if [ "$ROLE" = runtime ] && ! command -v runsc >/dev/null; then
  ARCH=$(uname -m)
  URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"
  cd /tmp && curl -fsSLO "${URL}/runsc" && curl -fsSLO "${URL}/runsc.sha512" \
    && curl -fsSLO "${URL}/containerd-shim-runsc-v1" && curl -fsSLO "${URL}/containerd-shim-runsc-v1.sha512"
  sha512sum -c runsc.sha512 containerd-shim-runsc-v1.sha512
  install -m 0755 runsc containerd-shim-runsc-v1 /usr/local/bin/
  rm -f runsc* containerd-shim-runsc-v1*
fi

mkdir -p /etc/brawzer /srv/brawzer
chmod 700 /etc/brawzer
echo "bootstrap done: $(hostname) role=$ROLE docker=$(docker --version | cut -d, -f1)"
