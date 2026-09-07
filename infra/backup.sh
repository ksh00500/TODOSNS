#!/usr/bin/env sh
set -eu
set -o pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: infra/backup.sh /absolute/backup/directory [compose-file]" >&2
  exit 2
fi

target="$1"
compose_file="${2:-infra/docker-compose.staging.yml}"
case "$target" in
  /*) ;;
  *) echo "backup directory must be an absolute path" >&2; exit 2 ;;
esac

mkdir -p "$target"
stamp="$(date -u +%Y%m%d-%H%M%S)"
database="$target/mungsil-$stamp.sql.gz"
media="$target/mungsil-media-$stamp.tar.gz"
database_tmp="$database.partial"
media_tmp="$media.partial"
trap 'rm -f "$database_tmp" "$media_tmp"' EXIT HUP INT TERM

docker compose -f "$compose_file" exec -T postgres pg_dump -U mungsil mungsil | gzip -9 > "$database_tmp"
gzip -t "$database_tmp"
test "$(gzip -dc "$database_tmp" | wc -c)" -gt 0
mv "$database_tmp" "$database"

if docker compose -f "$compose_file" config --services | grep -qx minio; then
  docker compose -f "$compose_file" exec -T minio tar -czf - -C /data . > "$media_tmp"
  tar -tzf "$media_tmp" >/dev/null
  mv "$media_tmp" "$media"
fi
trap - EXIT HUP INT TERM

find "$target" -type f \( -name 'mungsil-*.sql.gz' -o -name 'mungsil-media-*.tar.gz' \) -mtime +14 -delete
printf '%s\n' "$database"
test ! -f "$media" || printf '%s\n' "$media"
