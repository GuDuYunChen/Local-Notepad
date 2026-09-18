$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$releaseDir = Join-Path $root 'release'
$unpackedDir = Join-Path $releaseDir 'win-unpacked'
$resourcesDir = Join-Path $unpackedDir 'resources'
$backend = Join-Path $resourcesDir 'bin\notepad-server.exe'
$appAsar = Join-Path $resourcesDir 'app.asar'

function Test-NotepadBackend {
  param(
    [Parameter(Mandatory = $true)][string]$BackendPath,
    [Parameter(Mandatory = $true)][string]$DataDir,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$Label
  )

  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null

  $oldData = $env:NOTEPAD_DATA
  $oldPort = $env:PORT
  $env:NOTEPAD_DATA = $DataDir
  $env:PORT = [string]$Port

  $process = Start-Process -FilePath $BackendPath -PassThru -WindowStyle Hidden

  try {
    $healthy = $false
    for ($i = 0; $i -lt 80; $i++) {
      try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        if ($response.code -eq 0) {
          $healthy = $true
          break
        }
      } catch {
        Start-Sleep -Milliseconds 150
      }
    }

    if (-not $healthy) {
      throw "$Label backend failed its health check."
    }

    $diagnostics = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/diagnostics" -TimeoutSec 3
    if ($diagnostics.code -ne 0 -or $diagnostics.data.integrity -ne 'ok') {
      throw "$Label diagnostics check failed: $($diagnostics | ConvertTo-Json -Depth 6)"
    }

    Write-Host "$Label backend health check passed."
  } finally {
    if ($process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    $env:NOTEPAD_DATA = $oldData
    $env:PORT = $oldPort
  }
}

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

Test-NotepadBackend `
  -BackendPath $backend `
  -DataDir (Join-Path $env:RUNNER_TEMP 'local-notepad-package-data') `
  -Port 27139 `
  -Label 'win-unpacked'

$installDir = Join-Path $env:RUNNER_TEMP 'local-notepad-installed'
if (Test-Path $installDir) {
  Remove-Item -Path $installDir -Recurse -Force
}

Write-Host "Installing NSIS package to: $installDir"
$installProcess = Start-Process `
  -FilePath $installer.FullName `
  -ArgumentList @('/S', "/D=$installDir") `
  -PassThru `
  -Wait

if ($installProcess.ExitCode -ne 0) {
  throw "NSIS installer exited with code $($installProcess.ExitCode)."
}

$installedResources = Join-Path $installDir 'resources'
$installedBackend = Join-Path $installedResources 'bin\notepad-server.exe'
$installedAsar = Join-Path $installedResources 'app.asar'

if (-not (Test-Path $installedBackend)) {
  throw "Installed backend missing: $installedBackend"
}
if (-not (Test-Path $installedAsar)) {
  throw "Installed app.asar missing: $installedAsar"
}

$installedApp = Get-ChildItem -Path $installDir -Filter '*.exe' -File |
  Where-Object { $_.Name -notlike 'Uninstall*' } |
  Select-Object -First 1
if (-not $installedApp) {
  throw "Installed Electron application executable missing in $installDir"
}

Write-Host "Installed application exe: $($installedApp.Name)"

Test-NotepadBackend `
  -BackendPath $installedBackend `
  -DataDir (Join-Path $env:RUNNER_TEMP 'local-notepad-installed-data') `
  -Port 27140 `
  -Label 'installed'

$uninstaller = Get-ChildItem -Path $installDir -Filter 'Uninstall*.exe' -File |
  Select-Object -First 1
if (-not $uninstaller) {
  throw "NSIS uninstaller missing in $installDir"
}

Write-Host "Uninstaller: $($uninstaller.Name)"
$uninstallProcess = Start-Process `
  -FilePath $uninstaller.FullName `
  -ArgumentList '/S' `
  -PassThru `
  -Wait

if ($uninstallProcess.ExitCode -ne 0) {
  throw "NSIS uninstaller exited with code $($uninstallProcess.ExitCode)."
}

for ($i = 0; $i -lt 30 -and (Test-Path $installedApp.FullName); $i++) {
  Start-Sleep -Milliseconds 200
}

if (Test-Path $installedApp.FullName) {
  throw "Installed application remained after silent uninstall: $($installedApp.FullName)"
}
if (Test-Path $installedBackend) {
  throw "Installed backend remained after silent uninstall: $installedBackend"
}

Write-Host 'NSIS silent install and uninstall smoke passed.'
