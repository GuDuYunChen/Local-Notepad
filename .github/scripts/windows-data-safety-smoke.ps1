param(
  [Parameter(Mandatory = $true)][string]$BackendPath,
  [Parameter(Mandatory = $true)][string]$DataDir,
  [Parameter(Mandatory = $true)][string]$Label
)
$ErrorActionPreference = 'Stop'
# Called only with the disposable RUNNER_TEMP fixture used by the package smoke.
# The HTTP server stays running while its WAL database is snapshotted by the CLI.
$created = (& $BackendPath --data-safety create | Out-String | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $created.success -ne $true) {
  throw "$Label manual snapshot failed: $($created | ConvertTo-Json -Depth 6)"
}
$name = $created.backup.name
if ($name -notmatch '^backup-manual-[0-9]{8}-[0-9]{6}-[a-f0-9]{12}\.db$') {
  throw "$Label returned an invalid snapshot name."
}
$copy = Join-Path (Join-Path $DataDir 'backups') $name
$actual = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $created.backup.sha256 -or $created.backup.schemaVersion -ne 9 -or $created.backup.files -lt 1) {
  throw "$Label snapshot receipt differs from the actual file."
}
$checked = (& $BackendPath --data-safety inspect $name | Out-String | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $checked.success -ne $true -or $checked.backup.sha256 -ne $actual) {
  throw "$Label read-only integrity inspection failed."
}
$second = (& $BackendPath --data-safety create | Out-String | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $second.success -ne $true -or $second.backup.name -eq $name) {
  throw "$Label repeated snapshot failed or reused a filename."
}
$bad = Join-Path (Join-Path $DataDir 'backups') 'backup-fixture-invalid.db'
[IO.File]::WriteAllText($bad, 'synthetic corrupt test fixture')
try {
  $refused = (& $BackendPath --data-safety inspect 'backup-fixture-invalid.db' | Out-String | ConvertFrom-Json)
  if ($refused.success -ne $false) { throw "$Label accepted a corrupt snapshot." }
  $pathRefused = (& $BackendPath --data-safety inspect '../data.db' | Out-String | ConvertFrom-Json)
  if ($pathRefused.success -ne $false) { throw "$Label accepted an arbitrary path." }
} finally {
  Remove-Item -LiteralPath $bad -ErrorAction SilentlyContinue
}
Write-Host "$Label packaged data-safety CLI passed: create, repeat, inspect, actual SHA-256, corrupt/path rejection."
