#!/usr/bin/env bash
set -euo pipefail

verify_root=/srv/mungsil-dg-verify-20260909
expected_root=/srv/mungsil-dg-verify-20260909
run_label=com.mungsil.scope=data-governance-verification
network_name=mungsil-dg-verify-20260909-net
postgres_name=mungsil-dg-verify-20260909-postgres
postgres_volume=mungsil-dg_verify_20260909_pgdata
minio_name=mungsil-dg-verify-20260909-minio
minio_volume=mungsil-dg_verify_20260909_minio
api_image=mungsil-api:latest

if [[ "$verify_root" != "$expected_root" || ! -d "$verify_root/bundle/apps/api/prisma/migrations" ]]; then
  printf 'verification root is missing or unsafe: %s\n' "$verify_root" >&2
  exit 2
fi
if docker ps -a --format '{{.Names}}' | grep -Eq '^mungsil-dg-verify-20260909-'; then
  printf 'stale verification containers exist; inspect before retrying\n' >&2
  exit 2
fi
if docker volume ls --format '{{.Name}}' | grep -Fxq "$postgres_volume" \
  || docker volume ls --format '{{.Name}}' | grep -Fxq "$minio_volume" \
  || docker network ls --format '{{.Name}}' | grep -Fxq "$network_name"; then
  printf 'stale verification network or volume exists; inspect before retrying\n' >&2
  exit 2
fi

artifact_dir="$verify_root/artifacts"
mkdir -p "$artifact_dir"
artifact_path="$artifact_dir/verification-$(date -u +%Y%m%d-%H%M%S).log"
postgres_password="$(openssl rand -hex 24)"
minio_access="synthetic$(openssl rand -hex 6)"
minio_secret="$(openssl rand -hex 24)"

check_production() {
  local name
  for name in mungsil-api-1 mungsil-web-1 mungsil-postgres-1 mungsil-redis-1 mungsil-caddy-1; do
    if [[ "$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null)" != true ]]; then
      printf 'production container is not running: %s\n' "$name" >&2
      return 1
    fi
  done
  if [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' mungsil-api-1)" != healthy ]]; then
    printf 'production API is not healthy\n' >&2
    return 1
  fi
  docker exec mungsil-api-1 node -e "fetch('http://127.0.0.1:4000/api/v1/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
}

remove_if_present() {
  local kind="$1"
  local name="$2"
  case "$kind" in
    container) docker rm -f "$name" >/dev/null 2>&1 || true ;;
    volume) docker volume rm "$name" >/dev/null 2>&1 || true ;;
    network) docker network rm "$name" >/dev/null 2>&1 || true ;;
    *) return 2 ;;
  esac
}

cleanup() {
  remove_if_present container mungsil-dg-verify-20260909-object-versioned
  remove_if_present container mungsil-dg-verify-20260909-object-unversioned
  remove_if_present container mungsil-dg-verify-20260909-migrator
  remove_if_present container "$postgres_name"
  remove_if_present container "$minio_name"
  remove_if_present volume "$postgres_volume"
  remove_if_present volume "$minio_volume"
  remove_if_present network "$network_name"
}
trap cleanup EXIT

{
  printf 'verification_started_at=%s\n' "$(date -u +%FT%TZ)"
  printf 'verification_root=%s\n' "$verify_root"
  check_production
  awk '/MemAvailable:/ { printf "mem_available_before_kib=%s\n", $2 }' /proc/meminfo
  df -Pk / | awk 'NR == 2 { printf "disk_available_before_kib=%s\n", $4 }'

  printf 'stage=create_database_isolation\n'
  docker network create --label "$run_label" "$network_name" >/dev/null
  docker volume create --label "$run_label" "$postgres_volume" >/dev/null
  printf 'stage=start_synthetic_postgres\n'
  docker run --detach \
    --name "$postgres_name" \
    --label "$run_label" \
    --network "$network_name" \
    --memory 192m --memory-swap 320m --cpus 0.25 --pids-limit 100 \
    --env POSTGRES_DB=postgres \
    --env POSTGRES_USER=verify_owner \
    --env POSTGRES_PASSWORD="$postgres_password" \
    --volume "$postgres_volume:/var/lib/postgresql/data" \
    --volume "$verify_root/bundle:/verify:ro" \
    postgres:17-alpine >/dev/null

  printf 'stage=wait_synthetic_postgres\n'
  for _ in $(seq 1 40); do
    if docker exec "$postgres_name" pg_isready -U verify_owner -d postgres >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker exec "$postgres_name" pg_isready -U verify_owner -d postgres >/dev/null
  printf 'stage=create_synthetic_databases\n'
  docker exec "$postgres_name" createdb -U verify_owner mungsil_fresh
  docker exec "$postgres_name" createdb -U verify_owner mungsil_upgrade

  baseline_root="$verify_root/baseline-prisma"
  mkdir -p "$baseline_root/migrations"
  cp "$verify_root/bundle/apps/api/prisma/schema.prisma" "$baseline_root/schema.prisma"
  cp "$verify_root/bundle/apps/api/prisma/migrations/migration_lock.toml" "$baseline_root/migrations/migration_lock.toml"
  for migration in "$verify_root"/bundle/apps/api/prisma/migrations/*; do
    migration_name="$(basename "$migration")"
    case "$migration_name" in
      migration_lock.toml|20260908120000_data_governance_expand|20260908130000_post_snapshot_expand) continue ;;
    esac
    cp -R "$migration" "$baseline_root/migrations/"
  done

  run_migrator() {
    local database_url="$1"
    local schema_path="$2"
    docker run --rm \
      --name mungsil-dg-verify-20260909-migrator \
      --label "$run_label" \
      --network "$network_name" \
      --memory 192m --memory-swap 256m --cpus 0.25 --pids-limit 120 \
      --env DATABASE_URL="$database_url" \
      --volume "$verify_root/bundle:/verify:ro" \
      --volume "$baseline_root:/baseline:ro" \
      --entrypoint /app/apps/api/node_modules/.bin/prisma \
      "$api_image" migrate deploy --schema "$schema_path"
  }

  fresh_url="postgresql://verify_owner:${postgres_password}@${postgres_name}:5432/mungsil_fresh?schema=public"
  upgrade_url="postgresql://verify_owner:${postgres_password}@${postgres_name}:5432/mungsil_upgrade?schema=public"
  printf 'stage=fresh_database_migrations\n'
  run_migrator "$fresh_url" /verify/apps/api/prisma/schema.prisma
  docker exec "$postgres_name" psql -U verify_owner -d mungsil_fresh -v ON_ERROR_STOP=1 -f /verify/infra/database/roles.sql
  docker exec "$postgres_name" psql -U verify_owner -d mungsil_fresh -v ON_ERROR_STOP=1 -f /verify/infra/database/verify-role-boundaries.sql
  docker exec "$postgres_name" psql -U verify_owner -d mungsil_fresh -v ON_ERROR_STOP=1 -f /verify/infra/verification/data-governance/verify-schema.sql

  printf 'stage=upgrade_database_baseline\n'
  run_migrator "$upgrade_url" /baseline/schema.prisma
  docker exec "$postgres_name" psql -U verify_owner -d mungsil_upgrade -v ON_ERROR_STOP=1 -f /verify/infra/verification/data-governance/synthetic-pre-upgrade.sql
  run_migrator "$upgrade_url" /verify/apps/api/prisma/schema.prisma
  docker exec "$postgres_name" psql -U verify_owner -d mungsil_upgrade -v ON_ERROR_STOP=1 -f /verify/infra/database/backfill-post-snapshots.sql
  docker exec "$postgres_name" psql -U verify_owner -d mungsil_upgrade -v ON_ERROR_STOP=1 -f /verify/infra/database/roles.sql
  docker exec "$postgres_name" psql -U verify_owner -d mungsil_upgrade -v ON_ERROR_STOP=1 -f /verify/infra/database/verify-role-boundaries.sql
  docker exec "$postgres_name" psql -U verify_owner -d mungsil_upgrade -v ON_ERROR_STOP=1 -f /verify/infra/verification/data-governance/verify-schema.sql
  docker exec "$postgres_name" psql -U verify_owner -d mungsil_upgrade -v ON_ERROR_STOP=1 -f /verify/infra/verification/data-governance/verify-upgrade-and-triggers.sql
  docker stats --no-stream --format 'database_container={{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}}' "$postgres_name"

  remove_if_present container "$postgres_name"
  remove_if_present volume "$postgres_volume"
  check_production

  printf 'stage=pull_and_start_synthetic_minio\n'
  docker pull minio/minio:latest >/dev/null
  docker volume create --label "$run_label" "$minio_volume" >/dev/null
  docker run --detach \
    --name "$minio_name" \
    --label "$run_label" \
    --network "$network_name" \
    --memory 256m --memory-swap 384m --cpus 0.25 --pids-limit 100 \
    --env MINIO_ROOT_USER="$minio_access" \
    --env MINIO_ROOT_PASSWORD="$minio_secret" \
    --volume "$minio_volume:/data" \
    minio/minio:latest server /data >/dev/null
  for _ in $(seq 1 40); do
    if docker exec "$minio_name" mc ready local >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker exec "$minio_name" mc ready local >/dev/null

  run_object_test() {
    local mode="$1"
    local bucket="$2"
    docker run --rm \
      --name "mungsil-dg-verify-20260909-object-${mode}" \
      --label "$run_label" \
      --network "$network_name" \
      --memory 160m --memory-swap 224m --cpus 0.25 --pids-limit 100 \
      --env NODE_OPTIONS=--max-old-space-size=80 \
      --env RUN_OBJECT_STORAGE_E2E=1 \
      --env OBJECT_STORAGE_CREATE_BUCKET=1 \
      --env OBJECT_STORAGE_VERSIONED="$([[ "$mode" == versioned ]] && printf 1 || printf 0)" \
      --env STORAGE_ENDPOINT="http://${minio_name}:9000" \
      --env STORAGE_FORCE_PATH_STYLE=true \
      --env STORAGE_BUCKET="$bucket" \
      --env STORAGE_REGION=us-east-1 \
      --env STORAGE_ACCESS_KEY_ID="$minio_access" \
      --env STORAGE_SECRET_ACCESS_KEY="$minio_secret" \
      --volume "$verify_root/bundle/apps/api/dist:/app/apps/api/dist:ro" \
      --volume "$verify_root/bundle/apps/api/tests/object-storage.integration.test.cjs:/app/apps/api/tests/object-storage.integration.test.cjs:ro" \
      --entrypoint node \
      "$api_image" --test apps/api/tests/object-storage.integration.test.cjs
  }

  printf 'stage=object_deletion_unversioned\n'
  run_object_test unversioned mungsil-unversioned
  printf 'stage=object_deletion_versioned\n'
  run_object_test versioned mungsil-versioned
  docker stats --no-stream --format 'storage_container={{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}}' "$minio_name"

  remove_if_present container "$minio_name"
  remove_if_present volume "$minio_volume"
  remove_if_present network "$network_name"
  check_production
  awk '/MemAvailable:/ { printf "mem_available_after_kib=%s\n", $2 }' /proc/meminfo
  df -Pk / | awk 'NR == 2 { printf "disk_available_after_kib=%s\n", $4 }'
  printf 'verification_completed_at=%s\n' "$(date -u +%FT%TZ)"
} 2>&1 | tee "$artifact_path"

printf 'verification_log=%s\n' "$artifact_path"
