param(
  [Parameter(Mandatory = $true)][string]$TargetDirectory
)

$resolvedTarget = [System.IO.Path]::GetFullPath($TargetDirectory)
New-Item -ItemType Directory -Path $resolvedTarget -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$output = Join-Path $resolvedTarget "mungsil-$stamp.sql.gz"
docker compose -f "$PSScriptRoot/docker-compose.yml" exec -T postgres pg_dump -U mungsil mungsil | gzip > $output
Get-ChildItem -LiteralPath $resolvedTarget -Filter "mungsil-*.sql.gz" | Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) | Remove-Item
Write-Output $output
