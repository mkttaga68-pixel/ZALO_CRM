param([Parameter(Mandatory=$true)][string]$RuntimeRoot,[Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference='Stop';$ptr=[IntPtr]::Zero;$secure=$null;$plain=$null
try {
  $repo=Split-Path $PSScriptRoot -Parent;$workspace=Split-Path $repo -Parent
  $allowedRoot=[IO.Path]::GetFullPath((Join-Path $workspace 'native-ai-qc-runtime'))+[IO.Path]::DirectorySeparatorChar
  $resolved=[IO.Path]::GetFullPath($RuntimeRoot)
  if(-not $resolved.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase) -or $env:AI_QC_REAL_DATA_ENABLED -ne 'false' -or $env:AI_QC_REAL_DATA_OUTBOUND_APPROVED -ne 'false' -or $env:AI_QC_REAL_API_ENABLED -ne 'true' -or $env:AI_QC_OUTBOUND_TEST_APPROVED -ne 'true'){throw 'Invalid sandbox context'}
  $secretFile=Join-Path (Join-Path $workspace 'native-ai-qc-secrets') 'openai.dpapi'
  $secure=ConvertTo-SecureString ([IO.File]::ReadAllText($secretFile))
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if(-not $plain.StartsWith('sk-') -or $plain.Length -lt 20){throw 'Invalid key format'}
  $env:OPENAI_API_KEY=$plain;$env:AI_QC_CREDENTIAL_SOURCE='WINDOWS_DPAPI'
  # Node owns detached child file handles, so PowerShell cannot retain a stdout
  # pipe for the entire server lifetime. Only the numeric PID returns to caller.
  & $NodePath (Join-Path $PSScriptRoot 'spawn-native-ai-qc-openai-backend.cjs')
  if($LASTEXITCODE -ne 0){throw 'Private backend spawn failed'}
} catch { Write-Error 'OpenAI sandbox backend could not start. Key is not printed.';exit 1 }
finally {Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue;$plain=$null;if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)};if($secure){$secure.Dispose()}}
