#!/usr/bin/env bash
# Local Docker deploy only. Database/schema/data migrations require a separate
# reviewed release operation. Never run this against native Windows services.
set -Eeuo pipefail
# Git Bash must not rewrite container paths. Convert host copy paths explicitly.
export MSYS_NO_PATHCONV=1
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
CONTAINER="${ZALOCRM_CONTAINER:-zalo-crm-app}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_BACKEND=0
SKIP_FRONTEND=0
SKIP_PRISMA=0
DO_RESTART=1
READY_ATTEMPTS="${ZALOCRM_READY_ATTEMPTS:-30}"
READY_DELAY="${ZALOCRM_READY_DELAY_SECONDS:-2}"
for arg in "$@"; do
  case "$arg" in
    --skip-backend) SKIP_BACKEND=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --skip-prisma) SKIP_PRISMA=1 ;;
    --no-restart) DO_RESTART=0 ;;
    -h|--help) echo 'deploy-local.sh [--skip-backend] [--skip-frontend] [--skip-prisma] [--no-restart]'; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done
[[ "$CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid container name' >&2; exit 2; }
[[ "$READY_ATTEMPTS" =~ ^[0-9]+$ && "$READY_ATTEMPTS" -ge 1 && "$READY_ATTEMPTS" -le 60 ]] || exit 2
[[ "$READY_DELAY" =~ ^[0-9]+$ && "$READY_DELAY" -le 10 ]] || exit 2
if ! docker ps --format '{{.Names}}' | grep -Fxq -- "$CONTAINER"; then
  echo 'Target container is not running; no deployment performed' >&2; exit 1
fi
# Restarting a legacy image would still execute its old schema-writing command.
STARTUP="$(docker inspect --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}' "$CONTAINER")"
if printf '%s' "$STARTUP" | grep -Eqi 'prisma[[:space:]]+(db[[:space:]]+(push|execute)|migrate)'; then
  echo 'BLOCKED: legacy image mutates the database at startup. Rebuild using the corrected Dockerfile through a separately approved release.' >&2
  exit 1
fi
# Refuse overlapping deploys. A stale lock requires explicit operator inspection.
docker exec "$CONTAINER" mkdir /app/.deploy-lock
release_lock() { docker exec "$CONTAINER" rmdir /app/.deploy-lock >/dev/null 2>&1 || echo 'Inspect stale /app/.deploy-lock' >&2; }
trap release_lock EXIT
# Build both layers before mutating the target. No package download via npx.
if [[ "$SKIP_BACKEND" -eq 0 ]]; then
  (cd "$ROOT/backend" && node node_modules/typescript/bin/tsc)
fi
if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
  (cd "$ROOT/frontend" && npm run build)
fi
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
STATE="/app/.deploy-backups/$RELEASE_ID"
docker exec "$CONTAINER" sh -c 'test -d /app/dist && test ! -L /app/dist && test -d /app/static && test ! -L /app/static && test -d /app/prisma && test ! -L /app/prisma && test ! -L /app/prisma/schema && mkdir -p "$1"' sh "$STATE"
docker cp "$(host_path "$ROOT/scripts/bot-auto-backfill.cjs")" "$CONTAINER:$STATE/bot-auto-backfill.cjs" >/dev/null
docker cp "$(host_path "$ROOT/scripts/readiness-probe.cjs")" "$CONTAINER:$STATE/readiness-probe.cjs" >/dev/null
# Read-only query: fail BEFORE replacing app files if existing grants need migration.
docker exec "$CONTAINER" node "$STATE/bot-auto-backfill.cjs" --check
docker exec "$CONTAINER" sh -c 'cp -a /app/dist "$1/dist" && cp -a /app/static "$1/static" && cp -a /app/prisma "$1/prisma"' sh "$STATE"
wait_ready() {
  local attempt
  for ((attempt=1; attempt<=READY_ATTEMPTS; attempt++)); do
    if docker exec "$CONTAINER" node "$STATE/readiness-probe.cjs"; then return 0; fi
    sleep "$READY_DELAY"
  done
  return 1
}
rollback() {
  trap - ERR
  echo "Deployment failed. Restoring files from $STATE; database was not migrated." >&2
  if docker exec "$CONTAINER" sh -c 'find /app/dist -mindepth 1 -delete && find /app/static -mindepth 1 -delete && find /app/prisma -mindepth 1 -delete && cp -a "$1/dist/." /app/dist/ && cp -a "$1/static/." /app/static/ && cp -a "$1/prisma/." /app/prisma/' sh "$STATE"; then
    if [[ "$SKIP_BACKEND" -eq 0 && "$SKIP_PRISMA" -eq 0 ]]; then
      docker exec "$CONTAINER" sh -c 'cd /app && node node_modules/prisma/build/index.js generate' || echo 'Rollback Prisma generation failed' >&2
    fi
    if docker restart "$CONTAINER" >/dev/null && wait_ready; then
      echo 'Previous files restored and readiness passed; deployment remains FAILED.' >&2
    else
      echo 'ROLLBACK READINESS FAILED: operator intervention required.' >&2
    fi
  else
    echo 'ROLLBACK FILE RESTORE FAILED: operator intervention required.' >&2
  fi
  exit 1
}
trap rollback ERR
if [[ "$SKIP_BACKEND" -eq 0 ]]; then
  docker exec "$CONTAINER" sh -c 'find /app/dist -mindepth 1 -delete'
  docker cp "$(host_path "$ROOT/backend/dist/.")" "$CONTAINER:/app/dist/" >/dev/null
  if [[ "$SKIP_PRISMA" -eq 0 ]]; then
    docker exec "$CONTAINER" sh -c 'find /app/prisma/schema -mindepth 1 -delete'
    docker cp "$(host_path "$ROOT/backend/prisma/schema/.")" "$CONTAINER:/app/prisma/schema/" >/dev/null
    docker exec "$CONTAINER" sh -c 'cd /app && node node_modules/prisma/build/index.js generate'
  fi
fi
if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
  docker exec "$CONTAINER" sh -c 'find /app/static -mindepth 1 -delete'
  # Preserve Windows/Git Bash compatible explicit copy semantics.
  while IFS= read -r -d '' item; do
    docker cp "$(host_path "$item")" "$CONTAINER:/app/static/" >/dev/null
  done < <(find "$ROOT/frontend/dist" -mindepth 1 -maxdepth 1 -print0)
fi
if [[ "$DO_RESTART" -eq 1 ]]; then
  docker restart "$CONTAINER" >/dev/null
  wait_ready
  trap - ERR
  echo "Deployment passed readiness (HTTP + database). Rollback files: $STATE"
else
  trap - ERR
  echo "Files copied; activation/readiness NOT VERIFIED (--no-restart). Backup: $STATE"
fi
