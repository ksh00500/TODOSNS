param(
  [Parameter(Mandatory = $true)][string]$TargetDirectory
)

$resolvedTarget = [System.IO.Path]::GetFullPath($TargetDirectory)
New-Item -ItemType Directory -Path $resolvedTarget -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$output = Join-Path $resolvedTarget "mungsil-$stamp.sql.gz"
docker compose -f "$PSScriptRoot/docker-compose.yml" exec -T postgres /bin/sh -eu -c 'export PGPASSWORD="$(cat /run/secrets/database_backup_password)"; exec pg_dump -h 127.0.0.1 -U mungsil_backup -d mungsil' | gzip > $output
Get-ChildItem -LiteralPath $resolvedTarget -Filter "mungsil-*.sql.gz" | Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) | Remove-Item
Write-Output $output
