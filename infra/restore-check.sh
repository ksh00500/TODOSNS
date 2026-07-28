#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: infra/restore-check.sh /absolute/path/mungsil.sql.gz [compose-file]" >&2
  exit 2
fi

backup="$1"
compose_file="${2:-infra/docker-compose.staging.yml}"
test -f "$backup"
gzip -t "$backup"

database="mungsil_restore_$(date -u +%Y%m%d%H%M%S)"
cleanup() {
  docker compose -f "$compose_file" exec -T postgres dropdb -U mungsil --if-exists "$database" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose -f "$compose_file" exec -T postgres createdb -U mungsil "$database"
gzip -dc "$backup" | docker compose -f "$compose_file" exec -T postgres psql -v ON_ERROR_STOP=1 -U mungsil -d "$database" >/dev/null
docker compose -f "$compose_file" exec -T postgres psql -U mungsil -d "$database" -tAc 'SELECT COUNT(*) FROM "_prisma_migrations";'
echo "restore check passed: $backup"
