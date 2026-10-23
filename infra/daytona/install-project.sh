#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p outputs/daytona
if [ ! -f .env ]; then node infra/daytona/setup-environment.cjs; fi
set -a
. ./.env
set +a
bash infra/daytona/prepare-minio.sh
if ! docker image inspect quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z >/dev/null 2>&1; then
  export MINIO_IMAGE=mungsil-minio:RELEASE.2025-09-07T16-13-09Z-source
  if ! grep -q '^MINIO_IMAGE=' .env; then printf 'MINIO_IMAGE=%s\n' "$MINIO_IMAGE" >> .env; fi
fi
docker compose --env-file .env -f infra/daytona/compose.yml config --quiet
docker compose --env-file .env -f infra/daytona/compose.yml up -d --wait --wait-timeout 120
npm ci
npm run db:generate
bootstrap_url="postgresql://mungsil:${DEV_POSTGRES_PASSWORD}@127.0.0.1:5432/mungsil_dev?schema=public"
DATABASE_URL="$bootstrap_url" npm run prisma:deploy -w @mungsil/api
postgres_id="$(docker compose --env-file .env -f infra/daytona/compose.yml ps -q postgres)"
docker exec -i --env-file .daytona-private/database.env "$postgres_id" psql -U mungsil -d mungsil_dev -v ON_ERROR_STOP=1 < infra/database/bootstrap-login-roles.sql
docker compose --env-file .env -f infra/daytona/compose.yml exec -T postgres psql -U mungsil -d mungsil_dev -v ON_ERROR_STOP=1 < infra/database/roles.sql
docker compose --env-file .env -f infra/daytona/compose.yml exec -T postgres psql -U mungsil -d mungsil_dev -v ON_ERROR_STOP=1 -v database_name=mungsil_dev -v legacy_owner=mungsil < infra/database/apply-runtime-grants.sql
docker compose --env-file .env -f infra/daytona/compose.yml exec -T postgres psql -U mungsil -d mungsil_dev -v ON_ERROR_STOP=1 < infra/database/verify-role-boundaries.sql
npm run build -w @mungsil/contracts
npm run build -w @mungsil/api
node --input-type=commonjs -e 'require("dotenv").config({quiet:true}); const {S3Client,CreateBucketCommand,PutBucketVersioningCommand}=require("@aws-sdk/client-s3"); const client=new S3Client({endpoint:process.env.MINIO_ENDPOINT,region:"us-east-1",forcePathStyle:true,credentials:{accessKeyId:process.env.MINIO_ACCESS_KEY,secretAccessKey:process.env.MINIO_SECRET_KEY}}); (async()=>{try{await client.send(new CreateBucketCommand({Bucket:process.env.MINIO_BUCKET}));}catch(error){if(!["BucketAlreadyOwnedByYou","BucketAlreadyExists"].includes(error.name))throw error;} await client.send(new PutBucketVersioningCommand({Bucket:process.env.MINIO_BUCKET,VersioningConfiguration:{Status:"Enabled"}}));client.destroy();})().catch(error=>{console.error(error.message);process.exitCode=1;});'
NODE_ENV=production npm run build -w @mungsil/web
df -h /
