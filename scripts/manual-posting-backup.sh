#!/bin/sh
# Run explicitly in the database container. Never on app startup.
set -eu
umask 077
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
backup_path="/tmp/manual-posting-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
if [ -e "$backup_path" ]; then
  echo 'Backup path already exists; stop.' >&2
  exit 1
fi
pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$backup_path"
pg_restore --list "$backup_path" >/dev/null
printf '%s\n' "$backup_path"
