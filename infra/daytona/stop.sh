#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
for name in proxy web api; do
  pid_file=".daytona-private/${name}.pid"
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      case "$(tr '\0' ' ' < "/proc/${pid}/cmdline")" in
        *infra/daytona/dev-proxy.cjs*|*node_modules/next/dist/bin/next*|*apps/api/scripts/start-runtime.cjs*) kill "$pid" ;;
        *) echo "Refusing to stop unrelated process ${pid}" >&2; exit 1 ;;
      esac
    fi
    rm -f "$pid_file"
  fi
done
docker compose --env-file .env -f infra/daytona/compose.yml stop
echo 'Project services stopped; volumes and source are preserved. Use Daytona Stop to stop sandbox compute billing.'
