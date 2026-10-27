import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const DRAFT_CASES = Object.freeze(['normal', 'local-storage-quota', 'large-draft', 'storage-denial-retry'])
export const DRAFT_REPORT = 'draft-durability.json'
export const DRAFT_SOURCES = Object.freeze([
  'src/services/editorDraftCache.js', 'src/services/editorDraftRecovery.mjs',
  'src/services/editorSaveTransaction.mjs', 'src/services/editorQuit.mjs',
  'src/components/TextEditor.jsx', 'scripts/draft-durability-desktop-driver.mjs',
  'scripts/run-draft-durability-desktop.mjs', 'scripts/draft-durability-desktop-evidence.mjs',
])
export const draftHash = value => createHash('sha256').update(value).digest('hex')
export const draftBlob = value => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0').update(value).digest('hex')
export function validateDraftDurabilityReport(report, { product, verifier, sources, native = true } = {}) {
  assert.equal(report.schemaVersion, 1); assert.equal(report.module, '2F.104'); assert.equal(report.version, '4.237.0')
  assert.match(product || '', /^[a-f0-9]{40}$/); assert.match(verifier || '', /^[a-f0-9]{40}$/)
  assert.deepEqual(Object.keys(sources || {}).sort(), [...DRAFT_SOURCES].sort())
  for (const value of Object.values(sources)) assert.match(value, /^[a-f0-9]{40}$/)
  assert.equal(report.productCommit, product); assert.equal(report.verifierCommit, verifier)
  assert.equal(report.complete, true); assert.equal(report.cleanupComplete, true); assert.equal(report.error, undefined)
  assert.equal(report.syntheticData, true); assert.equal(report.realBackend, true)
  assert.equal(report.bridgeOverridden, false); assert.equal(report.timerAccelerated, false)
  assert.equal(report.forcedFailureCleanup, false)
  assert.deepEqual(report.sourceFiles, sources)
  assert.deepEqual(report.cases.map(item => item.name), DRAFT_CASES)
  assert.equal(report.crashes.length, 5); assert.equal(report.launches.length, 6)
  assert.equal(new Set(report.launches.map(item => item.pid)).size, 6)
  for (const launch of report.launches) assert.ok(Number.isInteger(launch.pid) && launch.pid > 0)
  for (const [index, crash] of report.crashes.entries()) {
    assert.equal(crash.expected, true); assert.equal(crash.pid, report.launches[index].pid)
    assert.equal(crash.exited, true); assert.equal(crash.identityVerified, true)
    assert.equal(crash.method, native ? 'owned-taskkill-tree' : 'development-browser-process-group')
  }
  for (const item of report.cases) {
    assert.ok(typeof item.noteId === 'string' && item.noteId.length > 0)
    for (const key of ['databaseBefore', 'draft', 'databaseBeforeSave', 'databaseAfterSave']) assert.match(item[key] || '', /^[a-f0-9]{64}$/)
    assert.notEqual(item.databaseBefore, item.draft)
    assert.equal(item.databaseBeforeSave, item.databaseBefore)
    assert.equal(item.databaseAfterSave, item.draft)
    for (const key of ['committedMirrorObserved', 'restoredDOMEqual', 'restoredMirrorEqual', 'mirrorRemovedAfterSave']) assert.equal(item[key], true)
    assert.equal(item.bodyWritesBeforeExplicitSave, 0); assert.equal(item.trustedInput, true)
    assert.ok(item.restartedPid !== item.crashedPid)
    assert.equal(report.crashes.some(crash => crash.pid === item.crashedPid), true)
    assert.equal(report.launches.some(launch => launch.pid === item.restartedPid), true)
  }
  const quota = report.cases[1], large = report.cases[2], retry = report.cases[3]
  assert.equal(quota.quota.error, 'QuotaExceededError'); assert.ok(quota.quota.keys > 0)
  assert.equal(quota.localHasNewDraft, false)
  assert.ok(large.draftLength > 1024 * 1024); assert.equal(large.localHasNewDraft, false)
  assert.deepEqual(retry.denial, { storageBoundaryFaultInjection: true, realOSFailure: false,
    warningSeen: true, deniedRetryObserved: true, restoredRetryObserved: true })
  assert.equal(report.savedDraftDoesNotResurrect, true)
  assert.equal(report.exit.normal, true); assert.equal(report.exit.pid, report.launches.at(-1).pid)
  assert.equal(report.backendStopped, true)
  if (native) {
    assert.equal(report.platform, 'win32'); assert.equal(report.runnerEnvironment, 'github-hosted')
    assert.equal(report.scope, 'installed-default-profile'); assert.equal(report.defaultProfile, true)
    assert.equal(report.nativeAcceptance, true)
    assert.ok(['notepad-desktop', '记事本', 'Notepad'].includes(report.profileBasename))
    assert.equal(report.app.packaged, true); assert.equal(report.app.version, report.version)
    for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) assert.match(report[key] || '', /^[a-f0-9]{64}$/)
    assert.equal(report.exit.code, 0); assert.equal(report.exit.signal, null)
    assert.deepEqual(report.retention.map(item => item.operation), ['same-version-install', 'uninstall', 'reinstall'])
    for (const item of report.retention) { assert.equal(item.equal, true); assert.ok(item.files > 0); assert.match(item.digest, /^[a-f0-9]{64}$/) }
    assert.deepEqual(report.installationCommands.map(item => item.operation), ['initial-install', 'same-version-install', 'uninstall', 'reinstall', 'final-uninstall'])
    for (const command of report.installationCommands) { assert.equal(command.code, 0); assert.equal(command.signal, null); assert.equal(command.timedOut, false) }
    assert.equal(report.storageDirectoriesRemoved, true)
  } else {
    assert.equal(report.platform, 'linux'); assert.equal(report.scope, 'browser-development-only')
    assert.equal(report.nativeAcceptance, false)
  }
  assert.equal(report.screenshots.length, 5)
  assert.deepEqual(report.screenshots.map(item => item.filename).sort(), ['draft104-normal.png', 'draft104-local-storage-quota.png', 'draft104-large-draft.png', 'draft104-storage-warning.png', 'draft104-storage-denial-retry.png'].sort())
  for (const item of report.screenshots) { assert.match(item.filename, /^[a-z0-9-]+\.png$/); assert.ok(item.bytes > 100); assert.match(item.sha256, /^[a-f0-9]{64}$/) }
  return true
}
export function verifyDraftDurabilityReport(directory, expected) {
  const report = JSON.parse(readFileSync(path.join(directory, DRAFT_REPORT), 'utf8'))
  validateDraftDurabilityReport(report, expected)
  for (const item of report.screenshots) {
    const bytes = readFileSync(path.join(directory, item.filename))
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Not a PNG screenshot')
    assert.equal(bytes.length, item.bytes); assert.equal(draftHash(bytes), item.sha256)
  }
  return report
}
