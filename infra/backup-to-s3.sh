#!/usr/bin/env sh
set -eu
set -o pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: infra/backup-to-s3.sh s3-bucket [compose-file]" >&2
  exit 2
fi

bucket="$1"
compose_file="${2:-infra/docker-compose.yml}"
case "$bucket" in
  *[!a-z0-9.-]*|'') echo "invalid S3 bucket name" >&2; exit 2 ;;
esac

stamp="$(date -u +%Y%m%d-%H%M%S)"
key="backups/database/mungsil-$stamp.sql.gz"

docker compose -f "$compose_file" exec -T postgres pg_dump -U mungsil mungsil \
  | gzip -9 \
  | aws s3 cp - "s3://$bucket/$key" --region "${STORAGE_REGION:-ap-southeast-2}" --only-show-errors

size="$(aws s3api head-object \
  --bucket "$bucket" \
  --key "$key" \
  --region "${STORAGE_REGION:-ap-southeast-2}" \
  --query ContentLength \
  --output text)"
test "$size" -gt 0
printf 's3://%s/%s (%s bytes)\n' "$bucket" "$key" "$size"
