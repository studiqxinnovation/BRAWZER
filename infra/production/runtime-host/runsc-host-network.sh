#!/usr/bin/env bash
# Sets gVisor (runsc) on a runtime host to use the kernel network stack of the
# namespace a container is placed in, and nothing else. Without it sessions
# start and stream but cannot browse: see README.md, step 1. Run as root on
# the runtime host, or from a workstation:
#
#   ssh root@RUNTIME_HOST 'bash -s' < infra/production/runtime-host/runsc-host-network.sh
#
# It keeps a dated copy of /etc/docker/daemon.json, changes the one setting,
# and asks the engine to re-read its configuration (a reload, not a restart:
# running sessions carry on, and sessions started afterwards can browse).
# Idempotent. To undo: put the dated copy back and `systemctl reload docker`.
set -euo pipefail
FILE=/etc/docker/daemon.json
[ -f "$FILE" ] || { echo "$FILE is missing: is this a runtime host?" >&2; exit 1; }
BACKUP="$FILE.before-runsc-host-network-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$FILE" "$BACKUP"
python3 - "$FILE" <<'PY'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
runsc = settings.setdefault("runtimes", {}).setdefault("runsc", {"path": "/usr/bin/runsc"})
args = [arg for arg in runsc.get("runtimeArgs", []) if not arg.startswith("--network=")]
runsc["runtimeArgs"] = args + ["--network=host"]
with open(path, "w") as out:
    json.dump(settings, out, indent=2)
    out.write("\n")
PY
if cmp -s "$FILE" "$BACKUP"; then
  rm -f "$BACKUP"
  echo "already set: runsc uses the kernel network stack"
else
  systemctl reload docker
  sleep 2
  echo "set; the previous file is $BACKUP"
fi
systemctl is-active --quiet docker || { echo "the Docker engine is not running" >&2; exit 1; }
echo "runsc runtime arguments now: $(docker info --format '{{json .Runtimes.runsc.runtimeArgs}}')"
