import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateCurrentUpgradeInput, inspectCurrentUpgradeInput } from './current-upgrade-input.mjs'
import { digest } from './windows-package-core.mjs'
import { fixturePE } from './windows-package-cases.mjs'

// These small PE buffers and invented identities are refusal-contract inputs,
// never Windows installers, package receipts, or successful installation runs.
function fixture() {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)))
  manifest.version = lock.version = lock.packages[''].version = '4.249.0'
  const f = { manifestBytes: Buffer.from(JSON.stringify(manifest)), lockBytes: Buffer.from(JSON.stringify(lock)),
    installerBytes: fixturePE([4, 249, 0, 0]),
    source: { commit: 'a'.repeat(40), expectedCommit: 'a'.repeat(40), tree: 'b'.repeat(40), expectedTree: 'b'.repeat(40), clean: true } }
  f.receipt = { format: 'local-notepad-local-package', schemaVersion: 1, complete: true, version: '4.249.0', commit: f.source.commit,
    manifestSHA256: digest(f.manifestBytes), lockSHA256: digest(f.lockBytes), installationTested: false,
    startedAt: '2026-11-09T10:00:00.000Z', finishedAt: '2026-11-09T10:01:00.000Z',
    stages: ['version-check', 'npm-check', 'go-check', 'install-locked-dependencies', 'build'].map(name => ({ name, exitCode: 0 })),
    installer: { filename: 'Notepad-4.249.0-Setup.exe', bytes: f.installerBytes.length, sha256: digest(f.installerBytes), fileVersion: '4.249.0.0', productVersion: '4.249.0.0' } }
  f.inputs = () => ({ ...f, receipts: [{ file: 'test-results/local-package/owned-build/receipt.json', bytes: Buffer.from(JSON.stringify(f.receipt)) }] })
  return f
}

test('candidate input binds exact current checkout, build receipt, lock and actual PE without claiming an installation', () => {
  const f = fixture(), input = f.inputs(), before = JSON.stringify(input), result = validateCurrentUpgradeInput(input)
  assert.equal(result.inputVerified, true)
  assert.equal(result.previousVersion, '4.248.1')
  assert.equal(result.current.version, '4.249.0')
  assert.equal(result.current.sha256, digest(f.installerBytes))
  assert.equal(result.current.bytes, f.installerBytes.length)
  assert.equal(result.source.commit, f.source.commit)
  assert.equal(result.source.tree, f.source.tree)
  assert.equal(result.packagingReceipt.sha256, digest(input.receipts[0].bytes))
  assert.equal(result.installationTested, false)
  assert.equal(result.fullLifecycleTested, false)
  assert.equal(JSON.stringify(input), before)
})

for (const [name, mutate] of [
  ['another checked-out commit', f => { f.source.commit = 'c'.repeat(40) }],
  ['another checked-out tree', f => { f.source.tree = 'c'.repeat(40) }],
  ['missing tree identity', f => { delete f.source.expectedTree }],
  ['modified tracked source', f => { f.source.clean = false }],
  ['old package version', f => { f.receipt.version = '4.248.1' }],
  ['another build commit', f => { f.receipt.commit = 'c'.repeat(40) }],
  ['incomplete build', f => { f.receipt.complete = false }],
  ['another report format', f => { f.receipt.format = 'installation-result' }],
  ['unsupported receipt schema', f => { f.receipt.schemaVersion = 2 }],
  ['success containing an error', f => { f.receipt.error = { stage: 'build', message: 'failed' } }],
  ['unconfirmed packaging cleanup', f => { f.receipt.recoveryRequired = true }],
  ['package receipt claiming installation', f => { f.receipt.installationTested = true }],
  ['missing original locked install stage', f => { f.receipt.stages.splice(3, 1) }],
  ['failed original build stage', f => { f.receipt.stages.at(-1).exitCode = 1 }],
  ['reordered original build stages', f => { f.receipt.stages.reverse() }],
  ['missing completion time', f => { delete f.receipt.finishedAt }],
  ['completion before startup', f => { f.receipt.finishedAt = '2026-11-09T09:59:00.000Z' }],
  ['changed manifest bytes', f => { f.manifestBytes = Buffer.concat([f.manifestBytes, Buffer.from('\n')]) }],
  ['changed lock bytes', f => { f.lockBytes = Buffer.concat([f.lockBytes, Buffer.from('\n')]) }],
  ['wrong installer filename', f => { f.receipt.installer.filename = 'Notepad-4.248.1-Setup.exe' }],
  ['wrong installer length', f => { f.receipt.installer.bytes++ }],
  ['wrong installer digest', f => { f.receipt.installer.sha256 = 'c'.repeat(64) }],
  ['changed actual installer bytes', f => { f.installerBytes[1000] ^= 1 }],
  ['receipt has old file version', f => { f.receipt.installer.fileVersion = '4.248.1.0' }],
  ['receipt has old product version', f => { f.receipt.installer.productVersion = '4.248.1.0' }],
  ['old PE renamed with new receipt digest', f => { f.installerBytes = fixturePE([4, 248, 1, 0]); f.receipt.installer.sha256 = digest(f.installerBytes) }],
  ['malformed PE with matching receipt digest', f => { f.installerBytes[0] = 0; f.receipt.installer.sha256 = digest(f.installerBytes) }],
]) test('candidate input refuses ' + name, () => {
  const f = fixture(); mutate(f); assert.throws(() => validateCurrentUpgradeInput(f.inputs()))
})

test('candidate input refuses same or older actual release even when all receipt values follow it', () => {
  const f = fixture(), manifest = JSON.parse(f.manifestBytes), lock = JSON.parse(f.lockBytes)
  manifest.version = lock.version = lock.packages[''].version = '4.248.1'
  f.manifestBytes = Buffer.from(JSON.stringify(manifest)); f.lockBytes = Buffer.from(JSON.stringify(lock))
  Object.assign(f.receipt, { version: '4.248.1', manifestSHA256: digest(f.manifestBytes), lockSHA256: digest(f.lockBytes) })
  assert.throws(() => validateCurrentUpgradeInput(f.inputs()), /must increase/)
})

test('candidate receipt selection keeps unrelated historical successes but refuses duplicate current successes', () => {
  const f = fixture(), input = f.inputs(), historical = { ...f.receipt, commit: 'd'.repeat(40), version: '4.248.1' }
  input.receipts.push({ file: 'test-results/local-package/historical/receipt.json', bytes: Buffer.from(JSON.stringify(historical)) })
  assert.equal(validateCurrentUpgradeInput(input).current.version, '4.249.0')
  input.receipts.push({ ...input.receipts[0], file: 'test-results/local-package/duplicate/receipt.json' })
  assert.throws(() => validateCurrentUpgradeInput(input), /Exactly one/)
})

test('candidate receipt selection refuses missing, malformed, excessive and escaping inputs', () => {
  const f = fixture()
  for (const receipts of [[], [{ file: 'test-results/local-package/owned/receipt.json', bytes: Buffer.from('{') }],
    Array.from({ length: 65 }, () => f.inputs().receipts[0]),
    [{ ...f.inputs().receipts[0], file: 'test-results/local-package/../receipt.json' }]]) {
    assert.throws(() => validateCurrentUpgradeInput({ ...f.inputs(), receipts }))
  }
})

test('filesystem input inspection chooses exact release and refuses an active or duplicate packaging run', () => {
  const f = fixture(), root = mkdtempSync(path.join(os.tmpdir(), 'notepad-current-upgrade-'))
  try {
    mkdirSync(path.join(root, 'release'))
    const directory = path.join(root, 'test-results', 'local-package', 'owned-build')
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(root, 'package.json'), f.manifestBytes)
    writeFileSync(path.join(root, 'package-lock.json'), f.lockBytes)
    writeFileSync(path.join(root, 'release', f.receipt.installer.filename), f.installerBytes)
    writeFileSync(path.join(root, 'release', 'Notepad-4.248.1-Setup.exe'), fixturePE([4, 248, 1, 0]))
    writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(f.receipt))
    assert.equal(inspectCurrentUpgradeInput(root, f.source).current.version, '4.249.0')
    const running = path.join(root, 'test-results', 'local-package', 'running.lock')
    writeFileSync(running, 'owned packaging run is unfinished')
    assert.throws(() => inspectCurrentUpgradeInput(root, f.source), /Packaging is still running/)
    rmSync(running)
    mkdirSync(path.join(directory, '..', 'duplicate'))
    writeFileSync(path.join(directory, '..', 'duplicate', 'receipt.json'), JSON.stringify(f.receipt))
    assert.throws(() => inspectCurrentUpgradeInput(root, f.source), /Exactly one/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
