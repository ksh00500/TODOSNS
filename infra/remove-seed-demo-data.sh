#!/usr/bin/env sh
set -eu

compose_file="${1:-infra/docker-compose.yml}"
env_file="${2:-/srv/mungsil/.env}"

docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U mungsil -d mungsil <<'SQL'
BEGIN;
DELETE FROM "Challenge" WHERE id = 'official-morning-30';
DELETE FROM "Post" WHERE id = 'demo-evening-walk-post';
DELETE FROM "Todo" WHERE id = 'demo-evening-walk';
DELETE FROM "User" WHERE email = 'demo@mungsil.local';
COMMIT;
SQL
