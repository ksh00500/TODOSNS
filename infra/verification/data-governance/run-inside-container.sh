#!/usr/bin/env bash
set -euo pipefail

repo_root=/workspace
postgres_base="postgresql://verify_owner:${VERIFY_POSTGRES_PASSWORD}@postgres:5432"
fresh_url="${postgres_base}/mungsil_fresh?schema=public"
upgrade_url="${postgres_base}/mungsil_upgrade?schema=public"
psql_owner=(psql "${postgres_base}/postgres" -v ON_ERROR_STOP=1)

"${psql_owner[@]}" -c 'CREATE DATABASE mungsil_fresh'
"${psql_owner[@]}" -c 'CREATE DATABASE mungsil_upgrade'

DATABASE_URL="$fresh_url" npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
psql "${postgres_base}/mungsil_fresh" -v ON_ERROR_STOP=1 -f infra/database/roles.sql
psql "${postgres_base}/mungsil_fresh" -v ON_ERROR_STOP=1 -f infra/database/verify-role-boundaries.sql
psql "${postgres_base}/mungsil_fresh" -v ON_ERROR_STOP=1 -f infra/verification/data-governance/verify-schema.sql

baseline_root=/tmp/mungsil-baseline-prisma
mkdir -p "$baseline_root/migrations"
cp apps/api/prisma/schema.prisma "$baseline_root/schema.prisma"
cp apps/api/prisma/migrations/migration_lock.toml "$baseline_root/migrations/migration_lock.toml"
for migration in apps/api/prisma/migrations/*; do
  migration_name="$(basename "$migration")"
  case "$migration_name" in
    migration_lock.toml|20260908120000_data_governance_expand|20260908130000_post_snapshot_expand) continue ;;
  esac
  cp -R "$migration" "$baseline_root/migrations/"
done

DATABASE_URL="$upgrade_url" npx prisma migrate deploy --schema "$baseline_root/schema.prisma"
psql "${postgres_base}/mungsil_upgrade" -v ON_ERROR_STOP=1 -f infra/verification/data-governance/synthetic-pre-upgrade.sql
DATABASE_URL="$upgrade_url" npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
psql "${postgres_base}/mungsil_upgrade" -v ON_ERROR_STOP=1 -f infra/database/backfill-post-snapshots.sql
psql "${postgres_base}/mungsil_upgrade" -v ON_ERROR_STOP=1 -f infra/database/roles.sql
psql "${postgres_base}/mungsil_upgrade" -v ON_ERROR_STOP=1 -f infra/database/verify-role-boundaries.sql
psql "${postgres_base}/mungsil_upgrade" -v ON_ERROR_STOP=1 -f infra/verification/data-governance/verify-schema.sql
psql "${postgres_base}/mungsil_upgrade" -v ON_ERROR_STOP=1 -f infra/verification/data-governance/verify-upgrade-and-triggers.sql

RUN_OBJECT_STORAGE_E2E=1 \
OBJECT_STORAGE_VERSIONED=0 \
STORAGE_ENDPOINT=http://minio:9000 \
STORAGE_FORCE_PATH_STYLE=true \
STORAGE_BUCKET=mungsil-unversioned \
STORAGE_REGION=us-east-1 \
STORAGE_ACCESS_KEY_ID="$VERIFY_MINIO_ACCESS_KEY" \
STORAGE_SECRET_ACCESS_KEY="$VERIFY_MINIO_SECRET_KEY" \
node --test apps/api/tests/object-storage.integration.test.cjs

RUN_OBJECT_STORAGE_E2E=1 \
OBJECT_STORAGE_VERSIONED=1 \
STORAGE_ENDPOINT=http://minio:9000 \
STORAGE_FORCE_PATH_STYLE=true \
STORAGE_BUCKET=mungsil-versioned \
STORAGE_REGION=us-east-1 \
STORAGE_ACCESS_KEY_ID="$VERIFY_MINIO_ACCESS_KEY" \
STORAGE_SECRET_ACCESS_KEY="$VERIFY_MINIO_SECRET_KEY" \
node --test apps/api/tests/object-storage.integration.test.cjs

if [[ -n "${VERIFY_AWS_S3_BUCKET:-}" ]]; then
  RUN_OBJECT_STORAGE_E2E=1 \
  OBJECT_STORAGE_VERSIONED=1 \
  STORAGE_ENDPOINT= \
  STORAGE_FORCE_PATH_STYLE=false \
  STORAGE_BUCKET="$VERIFY_AWS_S3_BUCKET" \
  STORAGE_REGION="${VERIFY_AWS_REGION:-ap-southeast-2}" \
  STORAGE_ACCESS_KEY_ID= \
  STORAGE_SECRET_ACCESS_KEY= \
  node --test apps/api/tests/object-storage.integration.test.cjs
fi

printf 'data-governance verification completed\n'
