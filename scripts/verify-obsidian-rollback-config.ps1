$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$repo=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$evidence=Join-Path (Split-Path $repo -Parent) 'obsidian-production-preflight-20261102'
$manifest=Get-Content -LiteralPath (Join-Path $evidence 'config-backup-verification.json') -Raw | ConvertFrom-Json
$backup=[IO.Path]::GetFullPath($manifest.backup)
if(-not $backup.StartsWith($evidence+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($backup) -ne 'deployment.dpapi'){throw 'UNEXPECTED_BACKUP_PATH'}
try {
  $stage='decrypt'
  $plain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($backup),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $snapshot=[Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
  $stage='compose-replay'
  $info=[Diagnostics.ProcessStartInfo]::new()
  $info.FileName='docker.exe'
  $info.Arguments='compose -p zl-crm --project-directory "'+$repo+'" -f - config --no-interpolate --format json'
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $process=[Diagnostics.Process]::new();$process.StartInfo=$info
  if(-not $process.Start()){throw 'COMPOSE_REPLAY_START_FAILED'}
  $stdinBytes=[Text.UTF8Encoding]::new($false).GetBytes([string]$snapshot.resolvedCompose)
  $process.StandardInput.BaseStream.Write($stdinBytes,0,$stdinBytes.Length)
  $process.StandardInput.BaseStream.Flush();$process.StandardInput.BaseStream.Close()
  $outputTask=$process.StandardOutput.ReadToEndAsync();$errorTask=$process.StandardError.ReadToEndAsync()
  if(-not $process.WaitForExit(20000)){ $process.Kill();throw 'COMPOSE_REPLAY_TIMEOUT' }
  $output=$outputTask.GetAwaiter().GetResult();$diagnostic=$errorTask.GetAwaiter().GetResult()
  if($process.ExitCode -ne 0){
    $kinds=@('interpolation','invalid character','yaml','must be','not found','not allowed','permission','read','stdin','JSON','UTF','validating','unexpected','unknown','required','unsupported','Additional property')
    $matched=@($kinds | Where-Object {$diagnostic -match [regex]::Escape($_)})
    Write-Output ('COMPOSE_REPLAY_ERROR_CATEGORIES: '+($matched -join ','))
    throw 'COMPOSE_REPLAY_FAILED'
  }
  $stage='compare-config'
  $replay=$output | ConvertFrom-Json
  $original=$snapshot.resolvedCompose | ConvertFrom-Json
  if($replay.services.app.image -ne $snapshot.imageTag){throw 'ROLLBACK_IMAGE_MISMATCH'}
  foreach($p in $original.services.app.environment.PSObject.Properties){
    if($replay.services.app.environment.($p.Name) -cne $p.Value){throw 'COMPOSE_ENV_REPLAY_MISMATCH'}
  }
  if(@($replay.services.app.volumes).Count -ne @($original.services.app.volumes).Count){throw 'VOLUME_REPLAY_MISMATCH'}
  foreach($mount in $original.services.app.volumes){
    $matches=@($replay.services.app.volumes | Where-Object {$_.target -ceq $mount.target})
    if($matches.Count -ne 1 -or $matches[0].type -cne $mount.type -or $matches[0].source -cne $mount.source -or [bool]$matches[0].read_only -ne [bool]$mount.read_only -or [bool]$matches[0].volume.nocopy -ne [bool]$mount.volume.nocopy){throw 'VOLUME_REPLAY_MISMATCH'}
  }
  $stage='image-inspect'
  $imageText=(& docker image inspect $snapshot.imageId --format '{{.Id}}' | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $imageText -ne $snapshot.imageId){throw 'ROLLBACK_IMAGE_NOT_LOCAL'}
  $stage='image-syntax'
  $proofText=(& docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --entrypoint node $snapshot.imageId --check /app/dist/app.js | Out-String)
  if($LASTEXITCODE -ne 0){throw 'ROLLBACK_IMAGE_CODE_CHECK_FAILED'}
  $stage='production-identity'
  $after=(& docker inspect zalo-crm-app | Out-String | ConvertFrom-Json)[0]
  if($LASTEXITCODE -ne 0 -or $after.Id -ne $snapshot.appId -or $after.Image -ne $snapshot.imageId -or $after.State.StartedAt -ne $snapshot.startedAt){throw 'PRODUCTION_IDENTITY_CHANGED'}
  $report=@{checkedAt=[DateTime]::UtcNow.ToString('o');encryptedBackupReplay='PASS';composeEnvironmentReplay='PASS';composeAppVolumesReplay='PASS';rollbackImageLocal=$true;rollbackImageEntrySyntax='PASS';image=$snapshot.imageId;productionUnchanged=$true;network='none for ephemeral image check';databaseAccessed=$false;productionRestart=$false;liveRollback='NOT_RUN';restoredFilesWritten=$false}
  $json=$report | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText((Join-Path $evidence 'rollback-config-verification.json'),$json,[Text.UTF8Encoding]::new($false))
  Write-Output $json
} catch {
  $code='DETAIL_SUPPRESSED'
  if($_.Exception.Message -match '^[A-Z_]+$'){$code=$_.Exception.Message}
  Write-Output ('ROLLBACK_VERIFICATION_FAILED: stage='+$stage+' code='+$code+' type='+$_.Exception.GetType().Name)
  exit 1
} finally {
  if($plain){[Array]::Clear($plain,0,$plain.Length)}
  if($stdinBytes){[Array]::Clear($stdinBytes,0,$stdinBytes.Length)}
  $snapshot=$null;$original=$null;$replay=$null;$output=$null
}
