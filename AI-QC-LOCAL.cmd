@echo off
setlocal
cd /d "%~dp0"
node scripts\aiqc-local.cjs %*
set "AIQC_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %AIQC_EXIT%
