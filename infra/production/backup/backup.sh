#!/usr/bin/env bash
# Nightly backup of a Brawzer app host (ADR 0016, infra/hostman): the
# database, the key service's storage and unseal material, and the stack's
# settings files. Each part is encrypted with a passphrase that does not
# live on this host alone (the operator keeps the copy deploy.mjs wrote to
# infra/hostman/secrets.env), then uploaded to the installation's bucket
# under backups/<stamp>/. Backups older than KEEP_DAYS are removed.
#
# Installed by infra/hostman/deploy.mjs as /usr/local/sbin/brawzer-backup and
# run from /etc/cron.d/brawzer-backup. Needs: docker, gpg, curl 7.75+ (for
# --aws-sigv4), python3. Reads /etc/brawzer/backup/env and .../passphrase.
set -euo pipefail

CONF=${BRAWZER_BACKUP_CONF:-/etc/brawzer/backup}
# shellcheck source=/dev/null
. "$CONF/env"
PASSPHRASE_FILE="$CONF/passphrase"
PREFIX=${BACKUP_PREFIX:-backups}
KEEP_DAYS=${KEEP_DAYS:-30}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-brawzer-services-postgres-1}
OPENBAO_VOLUME=${OPENBAO_VOLUME:-brawzer-services_openbao-data}
STACK_DIR=${STACK_DIR:-/srv/brawzer/production}

STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
WORK=$(mktemp -d /var/tmp/brawzer-backup.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
umask 077

# One S3 call: s3 <METHOD> <key> [file to upload]. Path-style addressing,
# which is what Hostman's store speaks.
s3() {
  local method=$1 key=$2 file=${3:-}
  curl -fsS --retry 3 --retry-delay 5 --max-time 900 \
    --aws-sigv4 "aws:amz:${S3_REGION}:s3" \
    --user "${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}" \
    -X "$method" ${file:+-T "$file"} "${S3_ENDPOINT}/${S3_BUCKET}/${key}"
}
s3_size() {
  curl -fsSI --max-time 60 --aws-sigv4 "aws:amz:${S3_REGION}:s3" \
    --user "${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}" \
    "${S3_ENDPOINT}/${S3_BUCKET}/$1" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}'
}
encrypt() {
  gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
    --passphrase-file "$PASSPHRASE_FILE" -o "$1.gpg" "$1"
  rm -f "$1"
}

echo "[$STAMP] backup starting"

# 1. The database, in pg_dump's custom format (restored with pg_restore).
docker exec "$POSTGRES_CONTAINER" pg_dump -U brawzer -d brawzer -Fc --no-owner --no-privileges \
  > "$WORK/database.dump"

# 2. The key service: the unseal keys and API token in /etc/brawzer/openbao,
#    and its file storage. Without both, every encrypted value in the
#    database (proxy credentials, data keys for Drive and profiles) is
#    unreadable. OpenBao's file backend writes each entry atomically, so a
#    copy of a running store is consistent entry by entry.
tar -C / -czf "$WORK/openbao.tar.gz" etc/brawzer/openbao \
  "var/lib/docker/volumes/${OPENBAO_VOLUME}/_data"

# 3. The stack's settings (they carry the database password and the key
#    service token, which is why the whole backup is encrypted).
tar -C "$STACK_DIR" -czf "$WORK/settings.tar.gz" \
  production.env services.env compose.yaml services.yaml Caddyfile openbao.hcl

for part in database.dump openbao.tar.gz settings.tar.gz; do encrypt "$WORK/$part"; done

# 4. Upload, and check each object's size against the file's before trusting it.
for file in "$WORK"/*.gpg; do
  name=$(basename "$file")
  key="$PREFIX/$STAMP/$name"
  local_size=$(stat -c %s "$file")
  s3 PUT "$key" "$file" > /dev/null
  remote_size=$(s3_size "$key")
  if [ "$local_size" != "$remote_size" ]; then
    echo "[$STAMP] $key: uploaded $remote_size bytes, expected $local_size" >&2
    exit 1
  fi
  echo "[$STAMP] $key: $local_size bytes"
done

# 5. Remove backups older than KEEP_DAYS (by the stamp in the key, in UTC).
list_old() {
  local token="" page
  while :; do
    page=$(curl -fsS --max-time 120 --aws-sigv4 "aws:amz:${S3_REGION}:s3" \
      --user "${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}" \
      "${S3_ENDPOINT}/${S3_BUCKET}/?list-type=2&prefix=${PREFIX}/${token:+&continuation-token=$token}")
    printf '%s' "$page" | python3 -I -c '
import sys, re
from datetime import datetime, timedelta, timezone
page = sys.stdin.read()
keep = int(sys.argv[1]); prefix = sys.argv[2]
cutoff = datetime.now(timezone.utc) - timedelta(days=keep)
for key in re.findall(r"<Key>([^<]+)</Key>", page):
    parts = key.split("/")
    if len(parts) < 3 or parts[0] != prefix: continue
    try: stamp = datetime.strptime(parts[1], "%Y-%m-%dT%H-%M-%SZ").replace(tzinfo=timezone.utc)
    except ValueError: continue
    if stamp < cutoff: print(key)
token = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", page)
print("TOKEN " + token.group(1) if token else "TOKEN", file=sys.stderr)
' "$KEEP_DAYS" "$PREFIX" 2> "$WORK/token"
    token=$(sed -n 's/^TOKEN //p' "$WORK/token" | head -1)
    [ -n "$token" ] || break
  done
}
removed=0
while IFS= read -r key; do
  [ -n "$key" ] || continue
  s3 DELETE "$key" > /dev/null
  removed=$((removed + 1))
done < <(list_old)
echo "[$STAMP] backup done; removed $removed object(s) older than $KEEP_DAYS days"
