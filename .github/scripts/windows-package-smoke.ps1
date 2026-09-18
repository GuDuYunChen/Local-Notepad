$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$releaseDir = Join-Path $root 'release'
$unpackedDir = Join-Path $releaseDir 'win-unpacked'
$resourcesDir = Join-Path $unpackedDir 'resources'
$backend = Join-Path $resourcesDir 'bin\notepad-server.exe'
$appAsar = Join-Path $resourcesDir 'app.asar'

$installer = Get-ChildItem -Path $releaseDir -Filter 'Notepad-*-Setup.exe' -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw 'NSIS installer was not produced.'
}
if (-not (Test-Path $unpackedDir)) {
  throw "win-unpacked directory missing: $unpackedDir"
}
if (-not (Test-Path $backend)) {
  throw "Packaged backend missing: $backend"
}
if (-not (Test-Path $appAsar)) {
  throw "Packaged app.asar missing: $appAsar"
}

$appExe = Get-ChildItem -Path $unpackedDir -Filter '*.exe' -File |
  Where-Object { $_.FullName -ne $backend } |
  Select-Object -First 1
if (-not $appExe) {
  throw 'Packaged Electron application executable was not found.'
}

$installerHash = (Get-FileHash -Algorithm SHA256 $installer.FullName).Hash
$backendHash = (Get-FileHash -Algorithm SHA256 $backend).Hash

Write-Host "Installer: $($installer.Name)"
Write-Host "Installer size: $($installer.Length)"
Write-Host "Installer SHA256: $installerHash"
Write-Host "Application exe: $($appExe.Name)"
Write-Host "Backend SHA256: $backendHash"

$dataDir = Join-Path $env:RUNNER_TEMP 'local-notepad-package-data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

$oldData = $env:NOTEPAD_DATA
$oldPort = $env:PORT
$env:NOTEPAD_DATA = $dataDir
$env:PORT = '27139'

$process = Start-Process -FilePath $backend -PassThru -WindowStyle Hidden

try {
  $healthy = $false
  for ($i = 0; $i -lt 80; $i++) {
    try {
      $response = Invoke-RestMethod -Uri 'http://127.0.0.1:27139/api/health' -TimeoutSec 2
      if ($response.code -eq 0) {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 150
    }
  }

  if (-not $healthy) {
    throw 'Packaged backend failed its health check.'
  }

  $diagnostics = Invoke-RestMethod -Uri 'http://127.0.0.1:27139/api/diagnostics' -TimeoutSec 3
  if ($diagnostics.code -ne 0 -or $diagnostics.data.integrity -ne 'ok') {
    throw "Packaged diagnostics check failed: $($diagnostics | ConvertTo-Json -Depth 6)"
  }

  Write-Host 'Packaged Windows backend health check passed.'
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  $env:NOTEPAD_DATA = $oldData
  $env:PORT = $oldPort
}
