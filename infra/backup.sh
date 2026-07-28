#!/usr/bin/env sh
set -eu

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

docker compose -f "$compose_file" exec -T postgres pg_dump -U mungsil mungsil | gzip -9 > "$database"
docker compose -f "$compose_file" exec -T minio tar -czf - -C /data . > "$media"
gzip -t "$database"
tar -tzf "$media" >/dev/null

find "$target" -type f \( -name 'mungsil-*.sql.gz' -o -name 'mungsil-media-*.tar.gz' \) -mtime +14 -delete
printf '%s\n%s\n' "$database" "$media"
