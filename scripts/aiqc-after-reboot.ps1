# Restore Zalo CRM + AIQC after a Windows reboot. Idempotent; safe to run repeatedly.
# It never runs `docker compose up`: containers restart by themselves (restart=unless-stopped)
# with the exact image/config they had before the reboot.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Zalo CRM\ZL-CRM\scripts\aiqc-after-reboot.ps1"
$ErrorActionPreference = 'Continue'
$runtime = 'C:\ProgramData\ZaloCRM\AIQC\runtime'
$monitorScript = 'C:\Zalo CRM\ZL-CRM\scripts\aiqc-ollama-resource-monitor.ps1'
$report = [ordered]@{}
function Test-Http($url) { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $url).StatusCode -eq 200 } catch { $false } }

# 1. Docker Desktop
docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Starting Docker Desktop...'
  Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Seconds 5; docker info --format '{{.ServerVersion}}' 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { break } }
}
docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
$report.Docker = if ($LASTEXITCODE -eq 0) { 'OK' } else { 'NOT RUNNING - open Docker Desktop manually' }

# 2. CRM containers (they start automatically once Docker is up)
for ($i = 0; $i -lt 36 -and -not (Test-Http 'http://127.0.0.1:3080/health'); $i++) { Start-Sleep -Seconds 5 }
$report.CRM = if (Test-Http 'http://127.0.0.1:3080/health') { 'OK (http://127.0.0.1:3080)' } else { 'DOWN - run: docker ps -a' }
$report.Containers = (docker ps --format '{{.Names}}={{.Status}}' 2>$null) -join '; '
$report.AppImage = (docker inspect zalo-crm-app --format '{{.Config.Image}}' 2>$null)
$continuous = (docker exec zalo-crm-app printenv AI_QC_CONTINUOUS_LOCAL_ENABLED 2>$null)
$report.AIQuetLienTuc = if ($continuous -eq 'true') { 'BAT (bat cong tac phong ban trong AI Quality Control de quet)' } else { 'TAT' }

# 3. Ollama (local AI model server, loopback only)
if (-not (Test-Http 'http://127.0.0.1:11434/api/version')) {
  $app = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
  if (Test-Path $app) { Write-Host 'Starting Ollama...'; Start-Process $app }
  for ($i = 0; $i -lt 24 -and -not (Test-Http 'http://127.0.0.1:11434/api/version'); $i++) { Start-Sleep -Seconds 5 }
}
$report.Ollama = if (Test-Http 'http://127.0.0.1:11434/api/version') { 'OK' } else { 'DOWN - AI analysis will be refused' }

# 4. Host resource monitor (required: without fresh telemetry the AI refuses to run)
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$alive = $false
if (Test-Path "$runtime\monitor.pid") { $old = (Get-Content "$runtime\monitor.pid" -ErrorAction SilentlyContinue | Select-Object -First 1); if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { $alive = $true } }
if (-not $alive) {
  $args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$monitorScript`" -OutputFile `"$runtime\host-resources.json`" -IntervalSeconds 2"
  $p = Start-Process powershell.exe -ArgumentList $args -WindowStyle Hidden -PassThru
  Set-Content -Path "$runtime\monitor.pid" -Value $p.Id -Encoding ascii
  Start-Sleep -Seconds 6
}
$t = Get-Content "$runtime\host-resources.json" -ErrorAction SilentlyContinue | ConvertFrom-Json
$freeGiB = if ($t) { [Math]::Round($t.availableRamBytes / 1GB, 2) } else { 0 }
$report.ResourceMonitor = if ($t -and ((Get-Date).ToUniversalTime() - [DateTime]::Parse($t.at).ToUniversalTime()).TotalSeconds -lt 15) { "OK (free RAM $freeGiB GiB, blocked=$($t.blocked))" } else { 'NOT UPDATING' }

# 4b. Cloudflare tunnel for the public domain (crm.nguyentragiang.shop -> http://localhost:3080)
$tunnel = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like '*\.cloudflared\config.yml*' }
if (-not $tunnel) { Write-Host 'Starting Cloudflared CRM Tunnel task...'; Start-ScheduledTask -TaskName 'Cloudflared CRM Tunnel' -ErrorAction SilentlyContinue; Start-Sleep -Seconds 15 }
$public = $false
for ($i = 0; $i -lt 6 -and -not $public; $i++) { $public = Test-Http 'https://crm.nguyentragiang.shop/health'; if (-not $public) { Start-Sleep -Seconds 5 } }
$report.PublicDomain = if ($public) { 'OK (https://crm.nguyentragiang.shop)' } else { 'NOT REACHABLE (Cloudflare 1033/530): restart the tunnel - see docs/aiqc-deployment-record-ollama-real-data-20261111.md' }

# 5. Kill switch is the operator's decision: report it, never remove it automatically.
$report.KillSwitch = if (Test-Path "$runtime\STOP") { 'ON (AI stopped) - delete STOP file to resume' } else { 'off' }
$report.Note = 'A NEW analysis needs ~3 GiB free RAM (cold model) or ~1.5 GiB (model already loaded); a running one stops only below 1 GiB.'
$report.GetEnumerator() | ForEach-Object { '{0,-16} {1}' -f $_.Key, $_.Value }
