import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDependencyLock } from './verify-dependency-lock.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const INSTALLER = 'Notepad-${version}-Setup.exe'
function parts(version) {
  assert.equal(typeof version, 'string', 'Missing application version')
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Expected a release version, not a stage label')
  const values = version.split('.').map(Number)
  assert.ok(values.every(n => Number.isSafeInteger(n) && n <= 65535), 'Version exceeds Windows numeric fields')
  return values
}

// Build metadata only. No dependency installation, Git/network writes, tags,
// releases, user-data reads or schema changes. package.json is the authority;
// the lock root is a consistency witness, not a second runtime version source.
export function checkAppVersion(manifest, lock, previousVersion = null) {
  const current = parts(manifest?.version)
  verifyDependencyLock(manifest, lock)
  if (previousVersion !== null) {
    const previous = parts(previousVersion)
    const first = current.findIndex((n, i) => n !== previous[i])
    assert.ok(first >= 0 && current[first] > previous[first], 'Application version must increase from the accepted baseline')
  }
  assert.equal(manifest.build?.nsis?.artifactName, INSTALLER, 'NSIS name must derive from the application version')
  assert.equal(manifest.build?.win?.artifactName, INSTALLER, 'Windows name must derive from the application version')
  assert.ok(!manifest.build?.directories?.app || manifest.build.directories.app === '.', 'Review a separate packaged manifest explicitly')
  for (const value of [manifest.build?.extraMetadata?.version, manifest.build?.buildVersion, manifest.build?.win?.buildVersion]) {
    assert.ok(value === undefined || value === manifest.version, 'A build version override differs from package.json')
  }
  return Object.freeze({ version: manifest.version, previousVersion,
    installer: INSTALLER.replace('${version}', manifest.version),
    validation: 'application-version-metadata-only' })
}

export function inspectAppVersion(directory = ROOT, previousVersion = null) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'))
  return checkAppVersion(manifest, lock, previousVersion)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    assert.ok(args.length <= 1 && (!args.length || args[0].startsWith('--previous-version=')), 'Unexpected version-check arguments')
    const previous = args.length ? args[0].slice('--previous-version='.length) : null
    console.log(JSON.stringify(inspectAppVersion(ROOT, previous)))
  } catch {
    console.error('Application version check failed. Increase package.json and both lock-root versions together; keep dependencies and schema unchanged.')
    process.exitCode = 1
  }
}
