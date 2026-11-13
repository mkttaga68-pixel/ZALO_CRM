$ErrorActionPreference='Stop'
$workspace=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$secretFiles=@((Join-Path $workspace 'aiqc-project-secrets/openai.dpapi'),(Join-Path $workspace 'native-ai-qc-secrets/openai.dpapi'))
$plainValues=[Collections.Generic.List[string]]::new()
$result=@{checkedAt=[DateTime]::UtcNow.ToString('o');apiRequests=0;secrets=@();platformKeyIdentityVerified=$false}
try{
 foreach($file in $secretFiles){
  if(-not (Test-Path -LiteralPath $file)){$result.secrets+=@{source=(Split-Path (Split-Path $file -Parent) -Leaf);present=$false};continue}
  $secure=$null;$pointer=[IntPtr]::Zero
  try{
   $secure=ConvertTo-SecureString ([IO.File]::ReadAllText($file))
   $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
   $plainValues.Add($plain)
   $result.secrets+=@{source=(Split-Path (Split-Path $file -Parent) -Leaf);present=$true;decryptable=$true;validFormat=($plain -cmatch '^sk-[A-Za-z0-9_-]{17,}$');hasWhitespace=($plain -match '\s');hasNonAscii=($plain -match '[^\x00-\x7F]')}
  }finally{if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)};if($secure){$secure.Dispose()};$plain=$null}
 }
 if($plainValues.Count -eq 2){$result.twoLocalStoresMatch=($plainValues[0] -ceq $plainValues[1])}
 $meta=Get-Content -LiteralPath (Join-Path $workspace 'aiqc-project-secrets/project.json') -Raw | ConvertFrom-Json
 $result.metadataProjectMatches=($meta.project -ceq 'proj_6yDB6qP8X45ofaQO99BW2Bqy')
 $result.platformKeyIdentityReason='Local metadata cannot prove which Platform key named ZALO_CRM is stored. No secret or fingerprint exported.'
 $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $workspace 'aiqc-semantic-session-20261102/secret-config-diagnostic.json') -Encoding UTF8
 $result | ConvertTo-Json -Depth 5
}catch{Write-Output 'SECRET_DIAGNOSTIC_FAILED_NO_SECRET_OUTPUT';exit 1}
finally{$plainValues.Clear()}
