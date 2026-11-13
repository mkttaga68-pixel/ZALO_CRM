param([Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$')][string]$Model)
$ErrorActionPreference='Stop'
$secretRoot=Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'native-ai-qc-secrets'
$secure=$null;$ptr=[IntPtr]::Zero;$plain=$null
try {
  New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null
  $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($sid)
  foreach($principal in @($sid,[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $secretRoot -AclObject $acl
  Write-Host 'AI QC sandbox only. Enter a NEW OpenAI key. It is hidden and never printed.'
  $secure=Read-Host 'OpenAI API key' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if(-not $plain.StartsWith('sk-') -or $plain.Length -lt 20 -or $plain -match '\s'){throw 'Invalid key format'}
  $cipher=ConvertFrom-SecureString -SecureString $secure
  [IO.File]::WriteAllText((Join-Path $secretRoot 'openai.dpapi'),$cipher)
  @{model=$Model;scope='SYNTHETIC_ONLY';responses=$true;structuredOutputs=$true;createdAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $secretRoot 'openai-config.json') -Encoding UTF8
  Write-Host 'Encrypted key saved for this Windows user. No API request has been made.'
} catch { Write-Error 'Key setup did not complete. No key value is printed.';exit 1 }
finally {if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)};$plain=$null;if($secure){$secure.Dispose()}}
