import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { replaceExactlyAndProveInverse, ACCEPTED_READING_SEED, ACCEPTED_READING_SEED_SOURCE } from './reading-mode-installed-evidence.mjs'
import { SHORTCUT_INSTALLATION_GATE, SHORTCUT_INSTALLATION_SOURCES, prepareShortcutManagementVerifierSources,
  extendShortcutManagementInstallation } from './shortcut-management-installed-evidence.mjs'
import { LOCAL_EXPORT_INSTALLATION_GATE, LOCAL_EXPORT_INSTALLATION_SOURCES, validateLocalExportInstallerPin,
  validateLocalExportVerifierSources, prepareLocalExportVerifierSources, validateGeneratedLocalExportSources,
  extendLocalExportInstallation, validateInstalledLocalExport, verifyLocalExportInstalledReport } from './local-export-installed-evidence.mjs'
import { LOCAL_EXPORT_VERSION, LOCAL_EXPORT_REPORT } from './local-export-desktop-evidence.mjs'
import { validateReadingArtifact } from './pin-reading-mode-installer.mjs'
import { localExportEvidenceFixture } from './local-export-installed-test-fixture.mjs'
import { shortcutManagementEvidenceFixture } from './shortcut-management-installed-test-fixture.mjs'

const verifier = 'b'.repeat(40), product = 'a'.repeat(40)
const source = file => readFileSync(new URL('./' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function pinFixture() {
  // Controlled source contract only: these binary fields never authorize a
  // download and are never copied into the actual installer pin JSON.
  const pin = JSON.parse(source('reading-mode-installer-pin.json'))
  Object.assign(pin, { product, previous: { ...ACCEPTED_READING_SEED }, previousSource: { ...ACCEPTED_READING_SEED_SOURCE },
    current: { version: LOCAL_EXPORT_VERSION, bytes: 1001, sha256: sha('synthetic export installer source contract') },
    currentSource: { run: 100, artifact: 200, name: 'local-notepad-windows-' + product,
      headSha: 'c'.repeat(40), branch: 'feature/local-export-2f102-closure', repositoryId: 1105107817,
      archiveBytes: 5000, archiveSha256: sha('synthetic archive') },
    importBlob: '461928325398d912f7b2cd2e64d0250a1a6114e2',
    importEvidenceBlob: '05de50269885f2c922017e99b9b124090ff65221',
    importEvidenceTestsBlob: 'f42da881e1ca094455440a3b35c24f75ad3ffbd1',
    historyDriverBlob: blob(source('check-version-history-desktop.mjs')), readingEvidenceBlob: blob(source('reading-mode-desktop-evidence.mjs')) })
  for (const [file, key] of Object.entries({ ...SHORTCUT_INSTALLATION_SOURCES, ...LOCAL_EXPORT_INSTALLATION_SOURCES })) pin[key] = blob(source(file))
  return pin
}
function fixture() {
  const pin = pinFixture(), shortcut = shortcutManagementEvidenceFixture(), exported = localExportEvidenceFixture()
  Object.assign(shortcut, { commit: verifier, productCommit: product, scope: 'installed',
    sourceFiles: Object.fromEntries(Object.entries(SHORTCUT_INSTALLATION_SOURCES).map(([file, key]) => [file, pin[key]])) })
  Object.assign(exported, { commit: verifier, productCommit: product, scope: 'installed', app: { ...shortcut.app },
    sourceFiles: Object.fromEntries(Object.entries(LOCAL_EXPORT_INSTALLATION_SOURCES).map(([file, key]) => [file, pin[key]])) })
  exported.launch.executable = exported.app.executable; exported.exit.window.image = exported.app.executable
  for (const action of exported.directoryActions) { action.binding.executable = exported.app.executable; action.result.dialog.image = exported.app.executable }
  const report = { productCommit: product, verifierCommit: verifier, complete: true, cleanupComplete: true, syntheticData: true,
    usedDefaultDataPath: true, forceTerminated: false, platform: 'win32', runnerEnvironment: 'github-hosted',
    installers: { current: pin.current, previous: pin.previous },
    shortcutManagementSource: { productCommit: product, sources: { ...shortcut.sourceFiles } },
    shortcutManagementRun: { report: 'shortcut-management-desktop.json', sha256: 'd'.repeat(64), application: { ...shortcut.app }, processIDs: shortcut.launches.map(item => item.pid) },
    localExportSource: { productCommit: product, sources: { ...exported.sourceFiles } },
    localExportRun: { report: LOCAL_EXPORT_REPORT, sha256: 'd'.repeat(64), application: { ...exported.app }, processID: exported.launch.pid },
    checks: ['installed-app-local-import-workflow', 'installed-app-reading-mode-workflow', 'reinstall-recovers-retained-data',
      SHORTCUT_INSTALLATION_GATE, LOCAL_EXPORT_INSTALLATION_GATE, 'final-uninstall-preserves-data'],
    appExits: Array.from({ length: 6 }, (_, i) => ({ pid: i + 2001, code: 0, signal: null, nativeClose: true })),
    dataComparisons: Array.from({ length: 6 }, () => ({ equal: true, files: 4, digest: 'e'.repeat(64) })),
    shortcutLaunch: { target: shortcut.app.executable }, snapshots: [{ phase: 'installed-' + pin.current.version,
      executableSHA256: shortcut.app.executableSHA256, asarSHA256: shortcut.app.asarSHA256, backendSHA256: shortcut.app.backendSHA256 }] }
  return { pin, report, shortcut, exported }
}
test('PR merge artifact binds product identity separately from the branch head', () => {
  const f = fixture(), source = f.pin.currentSource
  const artifact = { id: source.artifact, name: source.name, expired: false, size_in_bytes: source.archiveBytes,
    digest: 'sha256:' + source.archiveSha256,
    workflow_run: { id: source.run, repository_id: source.repositoryId, head_repository_id: source.repositoryId,
      head_branch: source.branch, head_sha: source.headSha } }
  assert.equal(validateReadingArtifact(f.pin, 'current', artifact), true)
  const previous = f.pin.previousSource, previousMetadata = f.pin.previousArtifactMetadata
  assert.equal(validateReadingArtifact(f.pin, 'previous', { id: previous.artifact, name: previous.name, expired: false,
    size_in_bytes: previousMetadata.archiveBytes, digest: 'sha256:' + previousMetadata.archiveSha256,
    workflow_run: { id: previous.run, repository_id: previousMetadata.repositoryId, head_repository_id: previousMetadata.repositoryId,
      head_branch: previousMetadata.branch, head_sha: previousMetadata.headSha } }), true)
  for (const [field, value] of [
    ['head_sha', 'd'.repeat(40)], ['head_branch', 'master'], ['repository_id', 999],
    ['head_repository_id', 999], ['id', source.artifact + 1], ['name', source.name + '-wrong'],
    ['size_in_bytes', source.archiveBytes + 1], ['digest', 'sha256:' + 'f'.repeat(64)],
  ]) {
    const changed = structuredClone(artifact)
    if (field === 'id' || field === 'name' || field === 'size_in_bytes' || field === 'digest') changed[field] = value
    else changed.workflow_run[field] = value
    assert.throws(() => validateReadingArtifact(f.pin, 'current', changed), field)
  }
})
test('installed export binds the same installed bytes and a ninth independent native process', () => {
  const f = fixture(); assert.equal(validateInstalledLocalExport(f.report, f.exported, f.shortcut, f.pin, verifier), true)
  assert.equal(Object.keys(LOCAL_EXPORT_INSTALLATION_SOURCES).length, 11)
})
for (const [name, mutate] of [
  ['old version', f => { f.pin.current.version = '4.234.0' }], ['unresolved binary', f => { f.pin.current.sha256 = null }],
  ['missing original close', f => f.report.appExits.pop()], ['reused original process', f => { f.report.appExits[0].pid = f.exported.launch.pid }],
  ['reused shortcut process', f => { f.shortcut.launches[0].pid = f.exported.launch.pid }], ['missing old data comparison', f => f.report.dataComparisons.pop()],
  ['changed retained data', f => { f.report.dataComparisons[0].equal = false }], ['missing shortcut gate', f => { f.report.checks.splice(3, 1) }],
  ['missing export gate', f => { f.report.checks.splice(4, 1) }], ['duplicated export gate', f => f.report.checks.push(LOCAL_EXPORT_INSTALLATION_GATE)],
  ['export after final uninstall', f => { f.report.checks.splice(4, 1); f.report.checks.push(LOCAL_EXPORT_INSTALLATION_GATE) }],
  ['export before shortcut restart', f => { f.report.checks.splice(4, 1); f.report.checks.unshift(LOCAL_EXPORT_INSTALLATION_GATE) }],
  ['different EXE', f => { f.exported.app.executableSHA256 = '3'.repeat(64) }], ['different backend', f => { f.exported.app.backendSHA256 = '3'.repeat(64) }],
  ['missing raw receipt', f => { f.report.localExportRun.sha256 = null }], ['wrong linked process', f => f.report.localExportRun.processID++],
  ['changed source pin', f => { f.report.localExportSource.sources['run-local-export-desktop.mjs'] = verifier }],
  ['packaged evidence substituted', f => { f.exported.scope = 'packaged' }], ['hidden minimum-window feedback', f => { f.exported.visibility.cancelled.feedback.rendered = false }],
]) test('installed export refuses ' + name, () => { const f = fixture(); mutate(f); assert.throws(() => validateInstalledLocalExport(f.report, f.exported, f.shortcut, f.pin, verifier)) })

test('every actual export source is pinned and cannot disappear or change before generation', () => {
  const pin = pinFixture(); assert.equal(validateLocalExportVerifierSources(pin, source), true)
  for (const [file, key] of Object.entries(LOCAL_EXPORT_INSTALLATION_SOURCES)) {
    assert.throws(() => validateLocalExportInstallerPin({ ...pin, [key]: null }))
    assert.throws(() => prepareLocalExportVerifierSources(pin, name => name === file ? undefined : source(name)), /Export source is missing/)
    assert.throws(() => prepareLocalExportVerifierSources(pin, name => source(name) + (name === file ? '\n// changed native driver' : '')), /Export source differs/)
  }
})
test('export generation preserves all six inherited source pins and full inverse proofs', () => {
  const pin = pinFixture(), previous = prepareShortcutManagementVerifierSources(pin, source), generated = prepareLocalExportVerifierSources(pin, source)
  assert.equal(generated.length, 6)
  for (const [i, item] of generated.entries()) {
    assert.equal(item.hash, previous[i].hash); assert.equal(item.original, previous[i].original)
    assert.equal(replaceExactlyAndProveInverse(item.pinned, [...item.changes].reverse().map(([a, b]) => [b, a])), item.original)
    if (item.output !== 'run-reading-import-generated.mjs') assert.equal(item.pinned, previous[i].pinned)
  }
  const read = name => generated.find(item => item.output === name)?.pinned ?? source(name)
  assert.equal(validateGeneratedLocalExportSources(pin, read), true)
  for (const item of generated) {
    assert.throws(() => validateGeneratedLocalExportSources(pin, name => name === item.output ? undefined : read(name)), /Prepared export verifier is missing/)
    assert.throws(() => validateGeneratedLocalExportSources(pin, name => read(name) + (name === item.output ? '\n// changed preserved gate' : '')), /Prepared export verifier was changed/)
  }
  const runner = generated.find(item => item.output === 'run-reading-import-generated.mjs').pinned
  for (const gate of ['validateLifecycleReport(report)', 'validateShortcutCompletion(report)', 'validateInstalledTemplates(', 'validateInstalledQuick(',
    'validateInstalledNoteTags(', 'validateInstalledBacklinks(', 'validateInstalledGraph(', 'validateInstalledPins(', 'validateInstalledRecent(',
    'validateInstalledWiki(', 'validateInstalledLocalImport(', 'validateInstalledReadingMode(', 'verifyShortcutManagementInstalledReport(',
    'await verifyLocalExportInstalledReport(']) assert.ok(runner.includes(gate), gate)
})

for (const ending of ['LF', 'CRLF']) test('complete ' + ending + ' preparation preserves 27 gates and appends export before final uninstall', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'export102-install-contract-'))
  try {
    const scripts = path.join(directory, 'scripts'); cpSync(fileURLToPath(new URL('.', import.meta.url)), scripts, { recursive: true })
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(directory, 'node_modules'), 'junction')
    const checkout = folder => { for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const filename = path.join(folder, entry.name)
      if (entry.isDirectory()) checkout(filename)
      else if (/\.(?:mjs|cjs|js|jsx|ps1)$/.test(entry.name)) { const value = readFileSync(filename, 'utf8').replace(/\r\n/g, '\n'); writeFileSync(filename, ending === 'CRLF' ? value.replace(/\n/g, '\r\n') : value) }
    } }; checkout(scripts)
    const read = name => readFileSync(path.join(scripts, name), 'utf8').replace(/\r\n/g, '\n')
    const pin = pinFixture(), generated = prepareLocalExportVerifierSources(pin, read)
    for (const item of generated) writeFileSync(path.join(scripts, item.output), item.pinned)
    const module = name => import(pathToFileURL(path.join(scripts, name)).href)
    const { prepareLocalImportValidatorPin } = await module('pin-reading-import-generated.mjs')
    const inheritedPins = prepareLocalImportValidatorPin(pin, read); writeFileSync(path.join(scripts, 'template-installed-evidence.mjs'), inheritedPins.after)
    for (const item of inheritedPins.generated) writeFileSync(path.join(scripts, item.output), item.pinned)
    const { prepareOutlineInstallation } = await module('document-outline-installed-evidence.mjs')
    const { extendGraphInstallation } = await module('import-graph-validator.mjs')
    const { extendPinsInstallation } = await module('import-pins-validator.mjs')
    const { extendRecentInstallation } = await module('import-recent-validator.mjs')
    const { prepareInstallerHistoryReadiness } = await module('installer-history-readiness.mjs')
    const { extendWikiInstallation } = await module('import-wiki-validator.mjs')
    const { extendLocalImportInstallation } = await module('reading-import-validator.mjs')
    const { extendReadingModeInstallation } = await module('reading-mode-installed-evidence.mjs')
    const old = prepareOutlineInstallation(read('installer-lifecycle-core.mjs'), read('check-windows-installer-lifecycle.mjs'), pin)
    const reading = extendReadingModeInstallation(extendLocalImportInstallation(extendWikiInstallation(prepareInstallerHistoryReadiness(extendRecentInstallation(extendPinsInstallation(extendGraphInstallation(old, pin), pin), pin)), pin), pin), pin)
    const shortcut = extendShortcutManagementInstallation(reading, pin), final = extendLocalExportInstallation(shortcut, pin)
    writeFileSync(path.join(scripts, 'shortcut-core-contract.mjs'), shortcut.core); writeFileSync(path.join(scripts, 'export-core-contract.mjs'), final.core)
    const previousCore = await module('shortcut-core-contract.mjs'), core = await module('export-core-contract.mjs')
    assert.equal(previousCore.REQUIRED_CHECKS.length, 27); assert.equal(core.REQUIRED_CHECKS.length, 28)
    assert.deepEqual(core.REQUIRED_CHECKS.filter(check => check !== LOCAL_EXPORT_INSTALLATION_GATE), previousCore.REQUIRED_CHECKS)
    assert.deepEqual(core.RELEASES, { previous: pin.previous, current: pin.current }); assert.equal(core.PRODUCT_COMMIT, pin.product)
    const call = "await runLocalExportLifecycle({executablePath:appExe,out,productCommit:PRODUCT_COMMIT,version:RELEASES.current.version,scope:'installed',ownedRoot:scratch})"
    assert.equal(final.script.split(call).length, 2); assert.ok(final.script.indexOf(call) > final.script.indexOf("mark('" + SHORTCUT_INSTALLATION_GATE + "')"))
    assert.ok(final.script.indexOf(call) < final.script.indexOf('const finalData=snapshotData()'))
    assert.equal(final.script.split('await runShortcutManagementLifecycle(').length, 2)
    assert.equal(final.script.split('await verifyReadingModeDesktop(').length, 2); assert.equal(final.script.split('await verifyLocalImportRestart(').length, 2)
    assert.ok(final.script.includes("assert.equal(observedDirectory,legacyTarget.split(' ')[0],'Old directory truncation was not reproduced')"))
    assert.ok(final.core.includes(previousCore.LEGACY_DEFECT.sha256))
    assert.throws(() => extendLocalExportInstallation(final, pin))
    assert.throws(() => extendLocalExportInstallation({ ...shortcut, script: shortcut.script.replace('await runShortcutManagementLifecycle(', 'await removedShortcut(') }, pin))
    assert.throws(() => extendLocalExportInstallation({ ...shortcut, core: shortcut.core.replace("'" + SHORTCUT_INSTALLATION_GATE + "'", "'removed-shortcut'") }, pin))
    const target = path.join(scripts, 'check-windows-installer-lifecycle.reading-mode.mjs'); writeFileSync(target, final.script)
    const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT
    for (const filename of [target, path.join(scripts, 'run-reading-import-generated.mjs')]) {
      const checked = spawnSync(process.execPath, ['--check', filename], { cwd: directory, env: environment, encoding: 'utf8', timeout: 10000 })
      assert.ifError(checked.error); assert.equal(checked.signal, null); assert.equal(checked.status, 0, checked.stdout + checked.stderr)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('installed export must bind exact retained raw report bytes before interpreting a summary', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'export102-report-contract-')); t.after(() => rmSync(directory, { recursive: true, force: true }))
  const f = fixture(), raw = '{}'; f.report.localExportRun.sha256 = sha(raw)
  writeFileSync(path.join(directory, LOCAL_EXPORT_REPORT), raw + '\n')
  await assert.rejects(verifyLocalExportInstalledReport(directory, f.report, f.shortcut, f.pin, verifier), /exact export report bytes/)
})
test('workflow adds export contracts without changing original preparation roster or time budget', () => {
  const normalized = readFileSync(new URL('../.github/workflows/local-installation-2f86.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  for (const raw of [normalized, normalized.replace(/\n/g, '\r\n')]) {
    const text = raw.replace(/\r\n/g, '\n')
    assert.deepEqual(text.split('\n').filter(line => /^\s*timeout-minutes:/.test(line)), ['    timeout-minutes: 20'])
    const old = text.match(/preparation-contracts\.tap (scripts\/reading-mode[^\n]+)/)?.[1]
    assert.equal(old.split(/\s+/).length, 6)
    const next = text.match(/local-export-preparation-contracts\.tap ([^\n]+)/)?.[1]
    assert.deepEqual(next.split(/\s+/), ['scripts/local-export-desktop-evidence.node.mjs', 'scripts/local-export-installed-evidence.node.mjs'])
    assert.ok(text.indexOf('run: node scripts/build-local-export-fixture.mjs') < text.indexOf('local-export-preparation-contracts.tap'))
    assert.ok(text.includes('run: node scripts/run-reading-mode-installer.mjs run')); assert.ok(text.includes('retention-days: 14'))
  }
})
