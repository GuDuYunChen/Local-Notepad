$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$releaseDir = Join-Path $root 'release'
$unpackedDir = Join-Path $releaseDir 'win-unpacked'
$resourcesDir = Join-Path $unpackedDir 'resources'
$backend = Join-Path $resourcesDir 'bin\notepad-server.exe'
$appAsar = Join-Path $resourcesDir 'app.asar'

function Invoke-NsisSilentInstall {
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$InstallDirBase,
    [int]$MaxAttempts = 2
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $targetDir = if ($attempt -eq 1) { $InstallDirBase } else { "$InstallDirBase-$attempt" }

    if (Test-Path $targetDir) {
      Remove-Item -Path $targetDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Installing NSIS package (attempt $attempt/$MaxAttempts) to: $targetDir"

    $process = Start-Process `
      -FilePath $InstallerPath `
      -ArgumentList @('/S', "/D=$targetDir") `
      -PassThru `
      -Wait

    if ($process.ExitCode -eq 0) {
      return $targetDir
    }

    Write-Warning "NSIS installer attempt $attempt exited with code $($process.ExitCode)."

    if (Test-Path $targetDir) {
      Remove-Item -Path $targetDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    if ($attempt -lt $MaxAttempts) {
      Start-Sleep -Seconds 2
    }
  }

  throw "NSIS installer failed after $MaxAttempts attempts."
}

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

$installDirBase = Join-Path $env:RUNNER_TEMP 'local-notepad-installed'
$installDir = Invoke-NsisSilentInstall `
  -InstallerPath $installer.FullName `
  -InstallDirBase $installDirBase `
  -MaxAttempts 2

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

$uninstallDeadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $uninstallDeadline) {
  $appStillExists = Test-Path $installedApp.FullName
  $backendStillExists = Test-Path $installedBackend

  if (-not $appStillExists -and -not $backendStillExists) {
    break
  }

  Start-Sleep -Milliseconds 250
}

if (Test-Path $installedApp.FullName) {
  throw "Installed application remained after silent uninstall timeout: $($installedApp.FullName)"
}
if (Test-Path $installedBackend) {
  throw "Installed backend remained after silent uninstall timeout: $installedBackend"
}

Write-Host 'NSIS silent install and uninstall smoke passed.'
