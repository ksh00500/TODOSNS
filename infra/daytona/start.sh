#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ ! -f .env ]; then echo 'Run install-project.sh first.' >&2; exit 1; fi
if ! docker info >/dev/null 2>&1; then
  nohup dockerd --host=unix:///var/run/docker.sock > /var/log/mungsil-docker.log 2>&1 < /dev/null &
  for attempt in $(seq 1 45); do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
docker compose --env-file .env -f infra/daytona/compose.yml up -d --wait --wait-timeout 120
mkdir -p .daytona-private outputs/daytona
set -a
. ./.env
set +a
export NODE_ENV=development
start_process() {
  local name="$1"
  shift
  local pid_file=".daytona-private/${name}.pid"
  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then return; fi
  nohup "$@" > "outputs/daytona/${name}.log" 2>&1 < /dev/null &
  printf '%s\n' "$!" > "$pid_file"
}
start_process api env -u DATABASE_URL DATABASE_URL_FILE="$PWD/.daytona-private/runtime-url" EXPECTED_DB_SESSION_ROLE=mungsil_runtime EXPECTED_DB_CURRENT_ROLE=mungsil_runtime node apps/api/scripts/start-runtime.cjs
start_process web env NODE_ENV=production node node_modules/next/dist/bin/next start apps/web -H 0.0.0.0 -p 3000
start_process proxy node infra/daytona/dev-proxy.cjs
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8080/api/v1/ready && curl -fsS -o /dev/null http://127.0.0.1:8080/; then
    printf '\nDevelopment services are ready on port 8080.\n'
    exit 0
  fi
  sleep 1
done
echo 'Services did not become ready; inspect outputs/daytona/*.log.' >&2
exit 1
