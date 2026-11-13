$taskRoot = 'C:\Zalo CRM\ZL-CRM\evidence\ollama-semantic-v3-20261102'
$taskSamples = @()
for ($sampleIndex = 0; $sampleIndex -lt 300; $sampleIndex++) {
    $taskProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(ollama|llama-server)$' } | Select-Object ProcessName,Id,CPU,WorkingSet64)
    $taskOs = Get-CimInstance Win32_OperatingSystem
    $taskGpu = @(& nvidia-smi.exe --query-gpu=name,memory.used,memory.free,utilization.gpu --format=csv,noheader,nounits)
    $taskSamples += [pscustomobject]@{at=(Get-Date).ToUniversalTime().ToString('o');processes=$taskProcesses;freeRamKiB=$taskOs.FreePhysicalMemory;gpu=$taskGpu}
    $taskSamples | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $taskRoot 'resources.json')
    Start-Sleep -Seconds 3
}
