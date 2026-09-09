#!/usr/bin/env bash
set -euo pipefail

project_name="${COMPOSE_PROJECT_NAME:-mungsil-dg-verify-20260909}"
expected_project=mungsil-dg-verify-20260909
if [[ "$project_name" != "$expected_project" ]]; then
  printf 'refusing unexpected compose project: %s\n' "$project_name" >&2
  exit 2
fi

compose_file=infra/verification/data-governance/docker-compose.yml
artifact_dir=infra/verification/data-governance/artifacts
mkdir -p "$artifact_dir"
artifact_path="$artifact_dir/verification-$(date -u +%Y%m%d-%H%M%S).log"

cleanup() {
  docker compose --project-name "$expected_project" -f "$compose_file" down --volumes --remove-orphans
}
trap cleanup EXIT

docker compose --project-name "$expected_project" -f "$compose_file" up --detach --build postgres minio minio-init
docker compose --project-name "$expected_project" -f "$compose_file" build runner
docker compose --project-name "$expected_project" -f "$compose_file" run --rm runner 2>&1 | tee "$artifact_path"
printf 'verification log: %s\n' "$artifact_path"
