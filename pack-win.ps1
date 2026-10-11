#requires -Version 5.1
param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$code = 1
try {
  $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
  & $node (Join-Path $PSScriptRoot 'scripts\package-windows.mjs')
  $code = $LASTEXITCODE
  if ($code -eq 0 -and -not $NoOpen) {
    try { Invoke-Item -LiteralPath (Join-Path $PSScriptRoot 'release') }
    catch { Write-Warning 'Package is ready, but Explorer could not open. See the printed package path.' }
  }
} catch {
  Write-Host ('Packaging failed: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Install Node.js 22.12+ (CI uses 24), npm and Go 1.24.11+, then retry.'
  $code = 1
}
exit $code
