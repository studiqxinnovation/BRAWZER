#!/usr/bin/env bash
# Fetches one backup made by backup.sh and either rehearses the restore or
# leaves the decrypted parts in a directory for a real recovery.
#
#   brawzer-restore list                 the backups in the bucket, newest last
#   brawzer-restore <stamp|latest> --check
#       the drill: restores the database into a scratch database beside the
#       live one, counts its tables and accounts, lists the key service and
#       settings archives, then drops the scratch database. Nothing live is
#       touched. Run it monthly; the runbook says what "good" looks like.
#   brawzer-restore <stamp|latest> --to <dir>
#       decrypts database.dump, openbao.tar.gz and settings.tar.gz into <dir>
#       (mode 700) and prints the recovery steps from the runbook.
#
# Reads the same /etc/brawzer/backup/env and passphrase as backup.sh. On a
# new host (the old one is gone), copy both files there first: the
# passphrase is in the operator's infra/hostman/secrets.env.
set -euo pipefail

CONF=${BRAWZER_BACKUP_CONF:-/etc/brawzer/backup}
# shellcheck source=/dev/null
. "$CONF/env"
PASSPHRASE_FILE="$CONF/passphrase"
PREFIX=${BACKUP_PREFIX:-backups}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-brawzer-services-postgres-1}
PARTS="database.dump openbao.tar.gz settings.tar.gz"

s3_get() {
  curl -fsS --retry 3 --retry-delay 5 --max-time 900 --aws-sigv4 "aws:amz:${S3_REGION}:s3" \
    --user "${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}" -o "$2" "${S3_ENDPOINT}/${S3_BUCKET}/$1"
}
stamps() {
  local token="" page
  while :; do
    page=$(curl -fsS --max-time 120 --aws-sigv4 "aws:amz:${S3_REGION}:s3" \
      --user "${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}" \
      "${S3_ENDPOINT}/${S3_BUCKET}/?list-type=2&prefix=${PREFIX}/${token:+&continuation-token=$token}")
    # grep finds nothing on an empty page or a last page: not an error here.
    printf '%s' "$page" | { grep -o '<Key>[^<]*</Key>' || true; } | sed 's/<[^>]*>//g' | awk -F/ 'NF>=3{print $2}'
    token=$(printf '%s' "$page" | { grep -o '<NextContinuationToken>[^<]*' || true; } | sed 's/<[^>]*>//')
    [ -n "$token" ] || break
  done | sort -u
}

command=${1:-}
case "$command" in
  list)
    stamps
    exit 0
    ;;
  "" | -h | --help)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac

stamp=$command
if [ "$stamp" = latest ]; then
  stamp=$(stamps | tail -1)
  [ -n "$stamp" ] || { echo "no backups under $PREFIX/ in $S3_BUCKET" >&2; exit 1; }
fi
mode=${2:-}
case "$mode" in
  --check) dir=$(mktemp -d /var/tmp/brawzer-restore.XXXXXX); trap 'rm -rf "$dir"' EXIT ;;
  --to) dir=${3:?--to needs a directory}; mkdir -p "$dir"; chmod 700 "$dir" ;;
  *) echo "second argument must be --check or --to <dir>" >&2; exit 2 ;;
esac
umask 077

echo "backup $stamp from $S3_BUCKET/$PREFIX"
for part in $PARTS; do
  s3_get "$PREFIX/$stamp/$part.gpg" "$dir/$part.gpg"
  gpg --batch --yes --quiet --pinentry-mode loopback --decrypt \
    --passphrase-file "$PASSPHRASE_FILE" -o "$dir/$part" "$dir/$part.gpg"
  rm -f "$dir/$part.gpg"
  echo "  $part: $(stat -c %s "$dir/$part") bytes"
done

if [ "$mode" = --to ]; then
  cat <<EOF

Decrypted into $dir. To recover an installation from it (RUNBOOK.md,
"Restoring from a backup"):
  1. settings.tar.gz -> /srv/brawzer/production (production.env, services.env, compose files)
  2. openbao.tar.gz  -> / (etc/brawzer/openbao and the openbao-data volume), BEFORE starting the key service
  3. start the services stack; then: docker exec -i $POSTGRES_CONTAINER pg_restore -U brawzer -d brawzer --clean --if-exists --no-owner < $dir/database.dump
  4. start the application stack and run the checks (deploy.mjs --check)
Remove $dir when done; it holds the database password and the unseal keys.
EOF
  exit 0
fi

# The drill: a scratch database beside the live one, filled from the dump.
scratch="brawzer_restore_check"
psql() { docker exec -i "$POSTGRES_CONTAINER" psql -U brawzer -d "$1" -v ON_ERROR_STOP=1 -Atq; }
echo "DROP DATABASE IF EXISTS $scratch; CREATE DATABASE $scratch;" | psql postgres
docker exec -i "$POSTGRES_CONTAINER" pg_restore -U brawzer -d "$scratch" --no-owner --no-privileges \
  < "$dir/database.dump"
tables=$(echo "select count(*) from information_schema.tables where table_schema='public'" | psql "$scratch")
users=$(echo "select count(*) from users" | psql "$scratch")
migrations=$(echo "select count(*) from drizzle.__drizzle_migrations" | psql "$scratch" 2>/dev/null || echo "?")
echo "DROP DATABASE $scratch;" | psql postgres
echo "  database restores: $tables tables, $users account(s), $migrations migration(s) recorded"
echo "  key service archive: $(tar -tzf "$dir/openbao.tar.gz" | wc -l) entries" \
  "(unseal material: $(tar -tzf "$dir/openbao.tar.gz" | grep -c '^etc/brawzer/openbao/' ) files)"
echo "  settings archive: $(tar -tzf "$dir/settings.tar.gz" | tr '\n' ' ')"
echo "restore drill passed for $stamp"
