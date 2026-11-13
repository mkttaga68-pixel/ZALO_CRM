<#
AIQC Nightly Learning — pre-deployment backup (OPERATOR RUNS THIS; read-only on the database).

Default = DRY RUN: prints what would be done. Add -Execute to actually create the backup.
Creates, in a NEW timestamped folder:
  1. pg_dump (custom format) of table native_ai_qc_workspace from the zalo-crm-db container
     (holds Learning Drafts, Verified Learning Cases, jobs, audits — all inside the JSON payload)
  2. a copy of the learning outbox folder (if it exists)
  3. the current app image tag + compose file list (for rollback)
  4. SHA-256 manifest
Never drops, truncates, restores or modifies anything. Credentials are read inside the container
from its own POSTGRES_USER / POSTGRES_DB variables and never printed.
#>
param(
    [switch]$Execute,
    [string]$OutRoot = 'C:\Zalo CRM\aiqc-learning-backups',
    [string]$DbContainer = 'zalo-crm-db',
    [string]$AppContainer = 'zalo-crm-app',
    [string]$OutboxDir = 'C:\ProgramData\ZaloCRM\AIQC\learning-outbox'
)
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $OutRoot "aiqc-learning-backup-$stamp"
$inner = "/tmp/aiqc-learning-$stamp.dump"
Write-Host "Target folder: $dest"
Write-Host "1) docker exec $DbContainer pg_dump -Fc -t native_ai_qc_workspace -> $inner ; docker cp -> $dest\native_ai_qc_workspace.dump"
Write-Host "2) copy outbox $OutboxDir -> $dest\learning-outbox (if present)"
Write-Host "3) record image tag + compose files of $AppContainer"
if (-not $Execute) { Write-Host 'DRY RUN only. Re-run with -Execute to create the backup.'; exit 0 }
if (Test-Path $dest) { throw "Backup folder already exists: $dest" }
New-Item -ItemType Directory -Path $dest | Out-Null
docker exec $DbContainer sh -c "pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -Fc -t native_ai_qc_workspace -f $inner"
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
docker cp "${DbContainer}:$inner" (Join-Path $dest 'native_ai_qc_workspace.dump')
if ($LASTEXITCODE -ne 0) { throw 'docker cp failed' }
docker exec $DbContainer rm -f $inner | Out-Null
if (Test-Path $OutboxDir) { Copy-Item -Recurse -Path $OutboxDir -Destination (Join-Path $dest 'learning-outbox') }
$image = docker inspect $AppContainer --format '{{.Config.Image}}'
# Windows PowerShell 5.1 strips inner quotes from native arguments, so read the labels as JSON instead of using `index`.
$labels = (docker inspect $AppContainer --format '{{json .Config.Labels}}') | ConvertFrom-Json
$files = $labels.'com.docker.compose.project.config_files'
@{ createdAt = (Get-Date).ToString('o'); appImage = $image; composeFiles = $files; table = 'native_ai_qc_workspace' } | ConvertTo-Json | Out-File -Encoding utf8 (Join-Path $dest 'rollback-pointer.json')
# Hash first, then write the manifest (never hash the manifest while it is being written).
$sums = @(Get-ChildItem -Recurse -File $dest | ForEach-Object { "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 $_.FullName).Hash, $_.FullName.Substring($dest.Length + 1) })
$sums | Out-File -Encoding utf8 (Join-Path $dest 'SHA256SUMS.txt')
Write-Host "Backup complete: $dest"
