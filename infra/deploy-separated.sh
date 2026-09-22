#!/usr/bin/env sh
set -eu

compose_file="${1:-infra/docker-compose.yml}"
env_file="${2:-.env}"

test -f "$compose_file"
test -f "$env_file"

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

printf '%s\n' 'Validating deployment configuration without printing resolved secrets.'
compose config --quiet

printf '%s\n' 'Starting database and Redis before building application images.'
compose up -d --no-build --wait --wait-timeout 120 postgres redis

if compose config --services | grep -qx minio; then
  printf '%s\n' 'Starting isolated object storage required by this Compose file.'
  compose up -d --no-build --wait --wait-timeout 120 minio minio-init
fi

printf '%s\n' 'Building API and web images sequentially.'
compose build api
compose build web

printf '%s\n' 'Running the one-time migrator job. Existing API remains unchanged on failure.'
compose --profile migration run --rm --no-deps migrate

printf '%s\n' 'Starting the runtime-only API after migration success.'
compose up -d --no-deps --no-build --wait --wait-timeout 180 api

printf '%s\n' 'Starting web, then reconciling the proxy.'
compose up -d --no-deps --no-build --wait --wait-timeout 120 web
compose up -d --no-deps --no-build caddy

printf '%s\n' 'Deployment sequence completed. Run the documented external smoke tests.'
