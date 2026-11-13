param(
  [string]$OutputFile = 'C:\ProgramData\ZaloCRM\AIQC\runtime\host-resources.json',
  [int]$IntervalSeconds = 2
)
$ErrorActionPreference = 'Stop'
if ($IntervalSeconds -lt 1 -or $IntervalSeconds -gt 10) { throw 'IntervalSeconds must be between 1 and 10.' }
$parent = Split-Path -Parent $OutputFile
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
while ($true) {
  try {
    $cpuValue = [double](Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples[0].CookedValue
    $availableRamMiB = [double](Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
    $gpuRows = @(& nvidia-smi --query-gpu=name,memory.used,memory.free,utilization.gpu --format=csv,noheader,nounits 2>$null)
    if ($LASTEXITCODE -ne 0 -or !$gpuRows.Count) { throw 'GPU telemetry unavailable' }
    $gpus = @($gpuRows | ForEach-Object {
      $parts = $_ -split ',\s*'
      if ($parts.Count -ne 4) { throw 'Malformed GPU telemetry' }
      [ordered]@{ name=$parts[0]; usedMiB=[int]$parts[1]; freeMiB=[int]$parts[2]; utilizationPercent=[int]$parts[3] }
    })
    $freeBytes = [int64]($availableRamMiB * 1MB)
    # Hard floor only. Admission thresholds (3 GiB cold / 1.5 GiB with resident model) are applied by the app,
    # so the model's own memory never makes this flag abort an analysis in progress.
    $blocked = $freeBytes -lt 1GB -or $cpuValue -ge 98 -or @($gpus | Where-Object { $_.freeMiB -lt 1024 }).Count -gt 0
    $sample = [ordered]@{ at=[DateTime]::UtcNow.ToString('o'); cpuPercent=[Math]::Round($cpuValue,1); availableRamBytes=$freeBytes; gpus=$gpus; blocked=$blocked }
  } catch {
    $sample = [ordered]@{ at=[DateTime]::UtcNow.ToString('o'); cpuPercent=100; availableRamBytes=0; gpus=@(); blocked=$true }
  }
  [System.IO.File]::WriteAllText($OutputFile,($sample | ConvertTo-Json -Depth 4 -Compress),$utf8)
  Start-Sleep -Seconds $IntervalSeconds
}
