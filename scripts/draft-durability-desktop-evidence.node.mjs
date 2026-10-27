import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DRAFT_CASES, DRAFT_SOURCES, DRAFT_REPORT, draftHash, validateDraftDurabilityReport, verifyDraftDurabilityReport } from './draft-durability-desktop-evidence.mjs'
import { draftStorageSnapshot } from './run-draft-durability-desktop.mjs'
import { draftMirrorExpression } from './draft-durability-desktop-driver.mjs'

// Synthetic refusal contracts ONLY. This fixture is not native execution evidence.
function fixture() {
  const sources = Object.fromEntries(DRAFT_SOURCES.map(file => [file, 'c'.repeat(40)]))
  const expected = { product: 'a'.repeat(40), verifier: 'b'.repeat(40), sources }
  const filenames = ['draft104-normal.png', 'draft104-local-storage-quota.png', 'draft104-large-draft.png', 'draft104-storage-warning.png', 'draft104-storage-denial-retry.png']
  const report = { schemaVersion: 1, module: '2F.104', version: '4.237.0', productCommit: expected.product, verifierCommit: expected.verifier,
    complete: true, cleanupComplete: true, syntheticData: true, realBackend: true, bridgeOverridden: false, timerAccelerated: false,
    forcedFailureCleanup: false, sourceFiles: sources,
    cases: DRAFT_CASES.map((name, index) => ({ name, noteId: 'synthetic-' + index, databaseBefore: '1'.repeat(64), draft: '2'.repeat(64), databaseBeforeSave: '1'.repeat(64), databaseAfterSave: '2'.repeat(64),
      committedMirrorObserved: true, restoredDOMEqual: true, restoredMirrorEqual: true, mirrorRemovedAfterSave: true, bodyWritesBeforeExplicitSave: 0, trustedInput: true,
      crashedPid: index ? 101 + index : 100, restartedPid: index ? 102 + index : 101, localHasNewDraft: false, draftLength: 1049000 })),
    launches: Array.from({ length: 6 }, (_, index) => ({ pid: 100 + index })),
    crashes: Array.from({ length: 5 }, (_, index) => ({ pid: 100 + index, code: 1, signal: null, expected: true, exited: true, identityVerified: true, method: 'owned-taskkill-tree' })),
    savedDraftDoesNotResurrect: true, exit: { pid: 105, normal: true, code: 0, signal: null }, backendStopped: true,
    platform: 'win32', runnerEnvironment: 'github-hosted', scope: 'installed-default-profile', defaultProfile: true, profileBasename: 'notepad-desktop',
    nativeAcceptance: true, app: { packaged: true, version: '4.237.0' }, executableSHA256: '3'.repeat(64), asarSHA256: '4'.repeat(64), backendSHA256: '5'.repeat(64),
    retention: ['same-version-install', 'uninstall', 'reinstall'].map(operation => ({ operation, equal: true, files: 12, digest: '6'.repeat(64) })),
    installationCommands: ['initial-install', 'same-version-install', 'uninstall', 'reinstall', 'final-uninstall'].map(operation => ({ operation, code: 0, signal: null, timedOut: false })),
    storageDirectoriesRemoved: true, screenshots: filenames.map(filename => ({ filename, bytes: 128, sha256: '7'.repeat(64) })),
  }
  report.cases[1].quota = { error: 'QuotaExceededError', keys: 8 }
  report.cases[3].denial = { storageBoundaryFaultInjection: true, realOSFailure: false, warningSeen: true, deniedRetryObserved: true, restoredRetryObserved: true }
  return { report, expected }
}
test('accepts the complete synthetic shape without claiming execution', () => {
  const { report, expected } = fixture(); assert.equal(validateDraftDurabilityReport(report, expected), true)
})
const mutations = {
  incomplete: r => { r.complete = false }, cleanup: r => { r.cleanupComplete = false }, error: r => { r.error = {} },
  product: r => { r.productCommit = '0'.repeat(40) }, source: r => { r.sourceFiles = {} },
  untrusted: r => { r.cases[0].trustedInput = false }, 'already-saved': r => { r.cases[0].databaseBefore = r.cases[0].draft },
  'automatic-save': r => { r.cases[0].bodyWritesBeforeExplicitSave = 1 }, 'database-changed-during-recovery': r => { r.cases[0].databaseBeforeSave = r.cases[0].draft },
  'wrong-saved-body': r => { r.cases[0].databaseAfterSave = '0'.repeat(64) },
  'missing-transaction': r => { r.cases[0].committedMirrorObserved = false }, 'wrong-DOM': r => { r.cases[0].restoredDOMEqual = false },
  'wrong-mirror': r => { r.cases[0].restoredMirrorEqual = false }, 'saved-mirror-remains': r => { r.cases[0].mirrorRemovedAfterSave = false },
  'reused-process': r => { r.launches[1].pid = r.launches[0].pid }, 'no-crash': r => { r.crashes.pop() },
  'unowned-crash': r => { r.crashes[0].identityVerified = false }, 'wrong-crash-method': r => { r.crashes[0].method = 'kill-all' },
  'unexpected-force': r => { r.forcedFailureCleanup = true }, 'saved-resurrection': r => { r.savedDraftDoesNotResurrect = false },
  'fake-quota': r => { r.cases[1].quota.error = 'UnknownError' }, 'empty-quota': r => { r.cases[1].quota.keys = 0 },
  'local-only-quota': r => { r.cases[1].localHasNewDraft = true }, 'small-draft': r => { r.cases[2].draftLength = 1048576 },
  'hidden-injection': r => { r.cases[3].denial.realOSFailure = true }, 'no-retry': r => { r.cases[3].denial.restoredRetryObserved = false },
  linux: r => { r.platform = 'linux' }, unpackaged: r => { r.app.packaged = false }, 'wrong-version': r => { r.app.version = '4.236.0' },
  'custom-profile': r => { r.defaultProfile = false }, 'backend-alive': r => { r.backendStopped = false },
  'failed-exit': r => { r.exit.code = 1 }, 'missing-retention': r => { r.retention.pop() }, 'changed-retention': r => { r.retention[0].equal = false },
  'empty-retention': r => { r.retention[0].files = 0 }, 'uninstall-failed': r => { r.installationCommands[2].code = 1 },
  'installer-timeout': r => { r.installationCommands[2].timedOut = true }, 'left-storage': r => { r.storageDirectoriesRemoved = false },
  'screenshot-path-traversal': r => { r.screenshots[0].filename = '../outside.png' }, 'duplicate-screenshot': r => { r.screenshots[1] = r.screenshots[0] },
  'missing-case': r => { r.cases.pop() }, 'reordered-cases': r => { r.cases.reverse() }, 'fake-native': r => { r.nativeAcceptance = false },
}
for (const [name, mutate] of Object.entries(mutations)) test('refuses ' + name, () => {
  const { report, expected } = fixture(); const copy = structuredClone(report); mutate(copy)
  assert.throws(() => validateDraftDurabilityReport(copy, expected))
})
test('a development observation cannot be relabeled native', () => {
  const { report, expected } = fixture()
  Object.assign(report, { platform: 'linux', scope: 'browser-development-only', nativeAcceptance: false })
  for (const crash of report.crashes) crash.method = 'development-browser-process-group'
  assert.equal(validateDraftDurabilityReport(report, { ...expected, native: false }), true)
  assert.throws(() => validateDraftDurabilityReport(report, expected))
})
test('requires external exact identities and the full source roster', () => {
  const { report, expected } = fixture()
  assert.throws(() => validateDraftDurabilityReport(report, {}))
  assert.throws(() => validateDraftDurabilityReport({ ...report, sourceFiles: {} }, { ...expected, sources: {} }))
})
test('re-reads screenshot bytes and refuses a truncated or substituted file', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'draft104-contract-'))
  try {
    const { report, expected } = fixture(), bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(120)])
    for (const screenshot of report.screenshots) { screenshot.sha256 = draftHash(bytes); writeFileSync(path.join(directory, screenshot.filename), bytes) }
    writeFileSync(path.join(directory, DRAFT_REPORT), JSON.stringify(report))
    assert.equal(verifyDraftDurabilityReport(directory, expected).complete, true)
    writeFileSync(path.join(directory, report.screenshots[0].filename), 'not screenshot')
    assert.throws(() => verifyDraftDurabilityReport(directory, expected))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('storage snapshot detects byte changes and refuses links', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'draft104-contract-'))
  try {
    const store = path.join(directory, 'store'); mkdirSync(store); writeFileSync(path.join(store, 'record'), 'draft')
    const before = draftStorageSnapshot({ store }); writeFileSync(path.join(store, 'record'), 'other')
    assert.notDeepEqual(draftStorageSnapshot({ store }), before)
    // Windows junction creation does not require developer mode or admin rights.
    const outside = path.join(directory, 'outside'); mkdirSync(outside); writeFileSync(path.join(outside, 'other'), 'unrelated')
    symlinkSync(outside, path.join(store, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => draftStorageSnapshot({ store }), /link refused/)
    assert.equal(readFileSync(path.join(outside, 'other'), 'utf8'), 'unrelated')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('the mirror observer is read-only and settles after the transaction commits', () => {
  const source = draftMirrorExpression('synthetic')
  assert.match(source, /indexedDB\.databases/); assert.match(source, /'readonly'/)
  assert.match(source, /tx\.oncomplete/); assert.match(source, /onupgradeneeded=.*abort/)
  assert.doesNotMatch(source, /\.put\(|\.delete\(|createObjectStore|MEMORY_CACHE/)
})
test('native execution refuses user computers and uses only the owned process tree', () => {
  const source = readFileSync(new URL('./run-draft-durability-desktop.mjs', import.meta.url), 'utf8')
  assert.match(source, /assertHostedWindows\(process\.env, process\.platform\)/)
  assert.match(source, /Refusing preexisting user storage/)
  assert.match(source, /await windowIdentity\(\)\s+await runCommand\('taskkill\.exe', \['\/PID', String\(pid\), '\/T', '\/F'\]/)
  assert.doesNotMatch(source, /taskkill[^\n]*\/IM|env\.GITHUB_REF\s*=|setPath\(['"]userData/)
  assert.match(source, /verifyInstaller\(readFileSync\(installer\), pin\.current\)/)
})
