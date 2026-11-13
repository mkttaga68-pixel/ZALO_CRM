param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$repo=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$evidence=Join-Path (Split-Path $repo -Parent) 'obsidian-production-preflight-20261102'
$private=Join-Path $evidence ('private-config-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $private | Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner($sid)
foreach($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
}
Set-Acl -LiteralPath $private -AclObject $acl
try {
  $inspectText=(& docker inspect zalo-crm-app | Out-String)
  if($LASTEXITCODE -ne 0){throw 'INSPECT_FAILED'}
  $app=($inspectText | ConvertFrom-Json)[0]
  if($app.Config.Labels.'com.docker.compose.project' -ne 'zl-crm' -or $app.Config.Labels.'com.docker.compose.service' -ne 'app'){throw 'TARGET_MISMATCH'}
  $expected=@('docker-compose.yml','docker-compose.override.yml','docker-compose.ai-qc.yml')
  $files=@($app.Config.Labels.'com.docker.compose.project.config_files' -split ',')
  if($files.Count -ne 3){throw 'CONFIG_FILE_COUNT_MISMATCH'}
  $records=@()
  for($i=0;$i -lt $files.Count;$i++){
    $file=[IO.Path]::GetFullPath($files[$i])
    if($file -ne (Join-Path $repo $expected[$i])){throw 'CONFIG_PATH_MISMATCH'}
    $bytes=[IO.File]::ReadAllBytes($file)
    $records+=@{name=$expected[$i];bytes=[Convert]::ToBase64String($bytes);sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
  }
  $dotenv=Join-Path $repo '.env'
  if(Test-Path -LiteralPath $dotenv){$records+=@{name='.env';bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($dotenv));sha256=(Get-FileHash -LiteralPath $dotenv -Algorithm SHA256).Hash.ToLowerInvariant()}}
  $args=@('compose','-p','zl-crm','--project-directory',$repo)
  foreach($name in $expected){$args+=@('-f',(Join-Path $repo $name))}
  $resolved=(& docker @args config --format json | Out-String)
  if($LASTEXITCODE -ne 0){throw 'COMPOSE_CONFIG_FAILED'}
  $config=$resolved | ConvertFrom-Json
  if($config.services.app.image -ne $app.Config.Image){throw 'RESOLVED_IMAGE_MISMATCH'}
  $snapshot=@{version=1;createdAt=[DateTime]::UtcNow.ToString('o');project='zl-crm';appId=$app.Id;imageId=$app.Image;imageTag=$app.Config.Image;startedAt=$app.State.StartedAt;configFiles=$records;resolvedCompose=$resolved;runtimeEnvironment=$app.Config.Env;runtimeMounts=$app.Mounts}
  $plain=[Text.Encoding]::UTF8.GetBytes(($snapshot | ConvertTo-Json -Depth 18 -Compress))
  $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $backup=Join-Path $private 'deployment.dpapi'
  [IO.File]::WriteAllBytes($backup,$cipher)
  $restored=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($backup),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $sha=[Security.Cryptography.SHA256]::Create()
  if([Convert]::ToBase64String($sha.ComputeHash($plain)) -ne [Convert]::ToBase64String($sha.ComputeHash($restored))){throw 'DPAPI_ROUNDTRIP_FAILED'}
  $decoded=[Text.Encoding]::UTF8.GetString($restored) | ConvertFrom-Json
  foreach($record in $decoded.configFiles){
    $hash=[BitConverter]::ToString($sha.ComputeHash([Convert]::FromBase64String($record.bytes))).Replace('-','').ToLowerInvariant()
    if($hash -ne $record.sha256){throw 'RESTORED_FILE_HASH_MISMATCH'}
  }
  $after=(& docker inspect zalo-crm-app | Out-String | ConvertFrom-Json)[0]
  if($LASTEXITCODE -ne 0 -or $after.Id -ne $app.Id -or $after.State.StartedAt -ne $app.State.StartedAt){throw 'PRODUCTION_CHANGED_DURING_BACKUP'}
  $report=@{checkedAt=[DateTime]::UtcNow.ToString('o');backup=$backup;encryption='Windows CurrentUser DPAPI';aclCurrentUserAndSystemOnly=$true;encryptedRoundtrip='PASS';restoredConfigHashes='PASS';files=@($decoded.configFiles | ForEach-Object {$_.name});resolvedComposeParsed=$true;runtimeEnvironmentCapturedEncryptedOnly=$true;appUnchanged=$true;databaseAccessed=$false;productionFilesWritten=$false;rollbackRuntimeTest='NOT_RUN'}
  $json=$report | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText((Join-Path $evidence 'config-backup-verification.json'),$json,[Text.UTF8Encoding]::new($false))
  Write-Output $json
} catch {
  Write-Error 'CONFIG_BACKUP_FAILED: no config values or secrets are printed.'
  exit 1
} finally {
  if($plain){[Array]::Clear($plain,0,$plain.Length)}
  if($restored){[Array]::Clear($restored,0,$restored.Length)}
  $inspectText=$null;$resolved=$null;$decoded=$null;$snapshot=$null;$app=$null
}
