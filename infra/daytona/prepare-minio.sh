#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source_image="mungsil-minio:RELEASE.2025-09-07T16-13-09Z-source"
registry_image="quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z"
if docker image inspect "$registry_image" >/dev/null 2>&1; then
  exit 0
fi
if docker image inspect "$source_image" >/dev/null 2>&1; then
  printf 'Reusing the pinned MinIO source build.\n'
  exit 0
fi
if docker pull "$registry_image"; then
  exit 0
fi
printf 'Registry image unavailable; building the same MinIO release from official source.\n'
docker build --progress=plain -f infra/daytona/Dockerfile.minio -t "$source_image" infra/daytona
docker run --rm "$source_image" --version
