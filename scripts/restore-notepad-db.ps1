[CmdletBinding()]
param(
  [string]$BackupName = ''
)

$ErrorActionPreference = 'Stop'

$root = 'C:\Users\g1001\AppData\Roaming\Notepad'
$backupDir = Join-Path $root 'backups'
$db = Join-Path $root 'data.db'
$wal = Join-Path $root 'data.db-wal'
$shm = Join-Path $root 'data.db-shm'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (!(Test-Path $backupDir)) {
  throw "Backup directory not found: $backupDir"
}

$backup = $null

if ($BackupName) {
  $backup = Get-Item (Join-Path $backupDir $BackupName) -ErrorAction Stop
} else {
  $backup = Get-ChildItem $backupDir -Filter 'backup-*.db' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

if ($null -eq $backup) {
  throw "No backup file found in: $backupDir"
}

Write-Host 'Stopping Notepad related processes...'
Get-Process | Where-Object { $_.ProcessName -match 'Notepad|notepad-server|electron|node' } |
  Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host 'Backing up broken database...'
if (Test-Path $db) {
  Move-Item $db (Join-Path $root "data.db.bad-$stamp") -Force
}

Write-Host 'Removing WAL/SHM files...'
if (Test-Path $wal) {
  Remove-Item $wal -Force
}
if (Test-Path $shm) {
  Remove-Item $shm -Force
}

Write-Host 'Restoring latest backup...'
Copy-Item $backup.FullName $db -Force

Write-Host 'Done. Current database file:'
Get-Item $db | Select-Object FullName, Length, LastWriteTime | Format-List

Write-Host "Restored from: $($backup.Name)"

Write-Host ''
Write-Host 'Next step: reopen Notepad and verify save/switch works.'
