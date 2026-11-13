$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$workspace=Split-Path $repo -Parent
$pointer=[IntPtr]::Zero;$secure=$null;$plain=$null;$bytes=$null;$stage='ACL'
try{
 $secretRoot=Join-Path $workspace 'aiqc-project-secrets'
 $acl=Get-Acl -LiteralPath $secretRoot
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if(-not $acl.AreAccessRulesProtected -or $rules.Count -ne 2){throw 'SECRET_ACL_INVALID'}
 foreach($r in $rules){if($r.IdentityReference.Value -notin @($sid,'S-1-5-18') -or $r.AccessControlType -ne 'Allow'){throw 'SECRET_ACL_INVALID'}}
 $file=Join-Path $secretRoot 'openai.dpapi'
 if((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'SECRET_LINK_DENIED'}
 $stage='DPAPI';$secure=ConvertTo-SecureString ([IO.File]::ReadAllText($file))
 $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
 $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes($plain)
 $stage='PROCESS_CONFIGURATION';$info=[Diagnostics.ProcessStartInfo]::new()
 $info.FileName=(Get-Command node.exe).Source
 $loaderUri=[Uri]::new((Join-Path $repo 'backend/node_modules/tsx/dist/loader.mjs')).AbsoluteUri
 $info.Arguments='--import "'+$loaderUri+'" "'+(Join-Path $PSScriptRoot 'test-aiqc-openai-bounded-session.mjs')+'" --execute'
 $info.WorkingDirectory=$repo;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $info.EnvironmentVariables.Clear()
 foreach($name in @('SystemRoot','WINDIR','ComSpec','PATH','Path','PATHEXT')){if(Test-Path "Env:$name"){$info.EnvironmentVariables[$name]=[Environment]::GetEnvironmentVariable($name)}}
 $info.EnvironmentVariables['NODE_ENV']='test';$info.EnvironmentVariables['AI_QC_CREDENTIAL_SOURCE']='WINDOWS_DPAPI_STDIN'
 $process=[Diagnostics.Process]::new();$process.StartInfo=$info
 $stage='PROCESS_START';if(-not $process.Start()){throw 'TEST_START_FAILED'}
 $out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync()
 $process.StandardInput.BaseStream.Write($bytes,0,$bytes.Length);$process.StandardInput.BaseStream.Close()
 if(-not $process.WaitForExit(180000)){$process.Kill();throw 'SESSION_TIMEOUT'}
 $safeOut=$out.GetAwaiter().GetResult();$safeErr=$err.GetAwaiter().GetResult()
 $stage='PROCESS_EXIT'
 if($safeErr -match 'ERR_SYSTEM_ERROR'){$stage='CHILD_WINDOWS_USER_INFO_DENIED'}
 if($safeErr -match 'ERR_MODULE_NOT_FOUND'){$stage='CHILD_MODULE_UNAVAILABLE'}
 if($process.ExitCode -ne 0){throw 'TEST_PROCESS_FAILED'}
 Write-Output $safeOut
}catch{Write-Output ('BOUNDED_TEST_FAILED_NO_SECRET_OUTPUT stage='+$stage);exit 1}
finally{if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)};if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};$plain=$null;if($secure){$secure.Dispose()}}
