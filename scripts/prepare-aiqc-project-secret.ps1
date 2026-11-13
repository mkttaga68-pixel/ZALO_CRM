param([ValidateSet('Store','InjectAfterMaintenance')][string]$Action='Store')
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$workspace=Split-Path $repo -Parent
$secretRoot=Join-Path $workspace 'aiqc-project-secrets'
$project='proj_6yDB6qP8X45ofaQO99BW2Bqy'
$secure=$null;$pointer=[IntPtr]::Zero;$bytes=$null;$plain=$null
try {
 if($Action -eq 'Store'){
  New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false)
  foreach($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
  try{Set-Acl -LiteralPath $secretRoot -AclObject $acl}catch{ } # Verify the resulting DACL instead of trusting a partial platform error.
  $actualAcl=Get-Acl -LiteralPath $secretRoot
  $actualRules=@($actualAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  $allowed=@($sid.Value,'S-1-5-18')
  if(-not $actualAcl.AreAccessRulesProtected -or $actualRules.Count -ne 2){throw 'SECRET_DIRECTORY_ACL_INVALID'}
  foreach($rule in $actualRules){if($rule.IdentityReference.Value -notin $allowed -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl'){throw 'SECRET_DIRECTORY_ACL_INVALID'}}
  if(Test-Path -LiteralPath (Join-Path $secretRoot 'openai.dpapi')){throw 'Existing secret retained; separate rotation procedure required'}
  Write-Host ('Store only for OpenAI project '+$project+'. No container operation or API request.')
  $secure=Read-Host 'OpenAI project key (hidden)' -AsSecureString
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if($plain -notmatch '^sk-[A-Za-z0-9_-]{17,}$'){throw 'KEY_FORMAT_INVALID'}
  [IO.File]::WriteAllText((Join-Path $secretRoot 'openai.dpapi'),(ConvertFrom-SecureString -SecureString $secure))
  [IO.File]::WriteAllText((Join-Path $secretRoot 'project.json'),(@{project=$project;model='gpt-6-luna';scope='synthetic-only';apiAccessVerified=$false}|ConvertTo-Json))
  Write-Host 'Encrypted credential saved. Project/model access has NOT been tested.'
 } else {
  # Deliberately refuses the old production image. This operation is NOT run by Store.
  $candidateFile=Join-Path $workspace 'aiqc-manual-real-test-20261102/candidate-image.json'
  if(-not (Test-Path -LiteralPath $candidateFile)){$candidateFile=Join-Path $workspace 'aiqc-readiness-closure-20261102/candidate-image.json'}
  $candidate=Get-Content -LiteralPath $candidateFile -Raw | ConvertFrom-Json
  $app=(& docker inspect zalo-crm-app | Out-String | ConvertFrom-Json)[0]
  if($LASTEXITCODE -ne 0 -or $app.Image -ne $candidate.imageId -or $app.Config.Labels.'com.docker.compose.project' -ne 'zl-crm'){throw 'CANDIDATE_NOT_DEPLOYED'}
  $vars=@{};foreach($pair in $app.Config.Env){$pieces=$pair -split '=',2;$vars[$pieces[0]]=$pieces[1]}
  $manual=$vars.AI_QC_MANUAL_REAL_TEST_ENABLED -eq 'true'
  $expectedReal=if($manual){'true'}else{'false'}
  if($vars.OPENAI_PROJECT_ID -ne $project -or $vars.OPENAI_API_KEY_FILE -ne '/run/secrets/zlcrm_openai_key' -or $vars.AI_QC_REAL_DATA_ENABLED -ne $expectedReal -or $vars.AI_QC_REAL_DATA_OUTBOUND_APPROVED -ne $expectedReal -or $manual -and $vars.AI_QC_MANUAL_RETENTION_ENABLED -ne 'true' -or $vars.AI_QC_AUTO_MONITOR_ENABLED -eq 'true'){throw 'RUNTIME_SCOPE_MISMATCH'}
  $secure=Get-Content -LiteralPath (Join-Path $secretRoot 'openai.dpapi') -Raw | ConvertTo-SecureString
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes($plain)
  $code="const fs=require('fs');if(Number(fs.statfsSync('/run/secrets').type)!==0x01021994)process.exit(2);const p='/run/secrets/zlcrm_openai_key';if(fs.existsSync(p))process.exit(3);const b=fs.readFileSync(0);if(b.length>1024||!/^sk-[A-Za-z0-9_-]{17,}$/.test(b.toString()))process.exit(4);fs.writeFileSync(p,b,{flag:'wx',mode:0o400});b.fill(0);"
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName='docker.exe';$info.Arguments='exec -i zalo-crm-app node -e "'+$code+'"'
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $proc=[Diagnostics.Process]::new();$proc.StartInfo=$info
  if(-not $proc.Start()){throw 'INJECTION_START_FAILED'}
  $proc.StandardInput.BaseStream.Write($bytes,0,$bytes.Length);$proc.StandardInput.BaseStream.Flush();$proc.StandardInput.BaseStream.Close()
  $out=$proc.StandardOutput.ReadToEndAsync();$err=$proc.StandardError.ReadToEndAsync()
  if(-not $proc.WaitForExit(10000)){$proc.Kill();throw 'INJECTION_TIMEOUT'}
  $null=$out.GetAwaiter().GetResult();$null=$err.GetAwaiter().GetResult()
  if($proc.ExitCode -ne 0){throw 'INJECTION_FAILED'}
  Write-Host 'Injected into container tmpfs only. No API request or feature flag change. Re-injection is required after container recreation.'
 }
} catch { Write-Host 'SECRET_OPERATION_FAILED. No credential or provider error body is printed.';exit 1 }
finally {if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)};if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};$plain=$null;if($secure){$secure.Dispose()}}
