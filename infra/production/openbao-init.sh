#!/bin/sh
# OpenBao's keeper for the self-hosted services stack. On the first run it
# initialises the server with a single unseal key, enables the Transit
# engine, makes Brawzer's key-encryption key and a token limited to using it,
# and writes all of that to /keys (a root-only directory on the host). On
# every run it unseals the server and then keeps watching, unsealing again
# after a restart. Each step is resumable: a run that stopped half-way
# finishes the next time. The API never sees the root token or the unseal key.
set -eu
KEYS=/keys
MOUNT="${VAULT_TRANSIT_MOUNT:-transit}"
KEY="${VAULT_TRANSIT_KEY:-brawzer}"
export BAO_ADDR="${BAO_ADDR:-http://openbao:8200}"

log() { echo "openbao-keeper: $*"; }

wait_for_server() {
  i=0
  until wget -qO- "$BAO_ADDR/v1/sys/health?standbyok=true&sealedcode=200&uninitcode=200" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -gt 60 ] && { log "server not answering"; exit 1; }
    sleep 2
  done
}

# The CLI prints JSON over several lines; flatten before matching.
flat() { tr -d '\n' | tr -s ' '; }
json_field() { flat | sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | head -n 1; }
json_array_first() { flat | sed -n "s/.*\"$1\": *\[ *\"\([^\"]*\)\".*/\1/p" | head -n 1; }

unseal_key() { json_array_first unseal_keys_b64 < "$KEYS/init.json"; }
root_token() { json_field root_token < "$KEYS/init.json"; }

initialise() {
  log "initialising"
  umask 077
  bao operator init -key-shares=1 -key-threshold=1 -format=json > "$KEYS/init.json.tmp"
  mv "$KEYS/init.json.tmp" "$KEYS/init.json"
  log "initialised; unseal key and root token in $KEYS/init.json"
}

unseal_if_needed() {
  if wget -qO- "$BAO_ADDR/v1/sys/seal-status" | grep -q '"sealed": *true'; then
    bao operator unseal "$(unseal_key)" >/dev/null && log "unsealed"
  fi
}

configure() {
  log "configuring transit"
  umask 077
  export BAO_TOKEN="$(root_token)"
  bao secrets list -format=json | grep -q "\"$MOUNT/\"" || bao secrets enable -path="$MOUNT" transit >/dev/null
  bao write -f "$MOUNT/keys/$KEY" type=aes256-gcm96 >/dev/null
  bao policy write brawzer-api - <<EOF
path "$MOUNT/encrypt/$KEY"  { capabilities = ["update"] }
path "$MOUNT/decrypt/$KEY"  { capabilities = ["update"] }
path "$MOUNT/rewrap/$KEY"   { capabilities = ["update"] }
path "$MOUNT/keys/$KEY"     { capabilities = ["read"] }
path "$MOUNT/keys/$KEY/rotate" { capabilities = ["update"] }
EOF
  bao token create -policy=brawzer-api -orphan -display-name=brawzer-api -format=json \
    | json_field client_token > "$KEYS/api-token.tmp"
  [ -s "$KEYS/api-token.tmp" ] || { log "no token came back"; exit 1; }
  mv "$KEYS/api-token.tmp" "$KEYS/api-token"
  unset BAO_TOKEN
  log "configured: transit \"$MOUNT\", key \"$KEY\", API token in $KEYS/api-token"
}

wait_for_server
if wget -qO- "$BAO_ADDR/v1/sys/init" | grep -q '"initialized": *false'; then
  initialise
fi
[ -f "$KEYS/init.json" ] || { log "server is initialised but $KEYS/init.json is missing"; exit 1; }
unseal_if_needed
[ -s "$KEYS/api-token" ] || configure
log "watching"
while true; do
  sleep 30
  unseal_if_needed || true
done
