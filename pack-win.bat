@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-win.ps1" %*
set "pack_exit=%ERRORLEVEL%"
echo.
if not "%pack_exit%"=="0" echo Packaging failed. See the error and test-results\local-package logs.
pause
exit /b %pack_exit%
