import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { ACCEPTED_READING_SEED, ACCEPTED_READING_SEED_SOURCE, prepareReadingModeVerifierSources,
  replaceExactlyAndProveInverse } from './reading-mode-installed-evidence.mjs'
import { SHORTCUT_INSTALLATION_GATE, SHORTCUT_INSTALLATION_SOURCES, validateShortcutManagementInstallerPin,
  validateShortcutManagementVerifierSources, prepareShortcutManagementVerifierSources,
  validateGeneratedShortcutManagementSources, extendShortcutManagementInstallation,
  validateInstalledShortcutManagement, verifyShortcutManagementInstalledReport } from './shortcut-management-installed-evidence.mjs'
import { SHORTCUT_MANAGEMENT_VERSION, SHORTCUT_MANAGEMENT_REPORT } from './shortcut-management-desktop-evidence.mjs'
import { shortcutManagementEvidenceFixture } from './shortcut-management-installed-test-fixture.mjs'

const verifier = 'b'.repeat(40), product = 'a'.repeat(40)
const source = file => readFileSync(new URL('./' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function pinFixture() {
  // Synthetic source/validator contract only. Resolved binary identities here
  // never authorize a download and are never written to the real pin file.
  const pin = JSON.parse(source('reading-mode-installer-pin.json'))
  Object.assign(pin, { product, previous: { ...ACCEPTED_READING_SEED }, previousSource: { ...ACCEPTED_READING_SEED_SOURCE },
    current: { version: SHORTCUT_MANAGEMENT_VERSION, bytes: 1001, sha256: sha('synthetic shortcut installer contract input') },
    currentSource: { run: 100, artifact: 200, name: 'local-notepad-windows-' + product },
    importBlob: 'b3f6a92d5265f7eeddc7bd74561c803444e893d5',
    importEvidenceBlob: '98d008af6cf9ce79a53f5b0d3e29bc98b3e79968',
    importEvidenceTestsBlob: 'f1244283ea6052525056184aa47b30671b7df2f1',
    readingEvidenceBlob: blob(source('reading-mode-desktop-evidence.mjs')),
    historyDriverBlob: blob(source('check-version-history-desktop.mjs')) })
  for (const [file, key] of Object.entries(SHORTCUT_INSTALLATION_SOURCES)) pin[key] = blob(source(file))
  return pin
}
function fixture() {
  const pin = pinFixture(), shortcut = shortcutManagementEvidenceFixture()
  Object.assign(shortcut, { commit: verifier, productCommit: product, scope: 'installed',
    sourceFiles: Object.fromEntries(Object.entries(SHORTCUT_INSTALLATION_SOURCES).map(([file, key]) => [file, pin[key]])) })
  const report = { productCommit: product, verifierCommit: verifier, complete: true, cleanupComplete: true,
    syntheticData: true, usedDefaultDataPath: true, forceTerminated: false, platform: 'win32', runnerEnvironment: 'github-hosted',
    installers: { current: pin.current, previous: pin.previous },
    shortcutManagementSource: { productCommit: product, sources: { ...shortcut.sourceFiles } },
    shortcutManagementRun: { report: SHORTCUT_MANAGEMENT_REPORT, sha256: 'd'.repeat(64),
      application: { ...shortcut.app }, processIDs: shortcut.launches.map(item => item.pid) },
    checks: ['installed-app-local-import-workflow', 'installed-app-reading-mode-workflow',
      'reinstall-recovers-retained-data', SHORTCUT_INSTALLATION_GATE, 'final-uninstall-preserves-data'],
    appExits: Array.from({ length: 6 }, (_, index) => ({ pid: index + 2001, code: 0, signal: null, nativeClose: true })),
    dataComparisons: Array.from({ length: 6 }, () => ({ equal: true, files: 4, digest: 'e'.repeat(64) })),
    shortcutLaunch: { target: shortcut.app.executable },
    snapshots: [{ phase: 'installed-' + pin.previous.version, asarSHA256: 'f'.repeat(64) },
      { phase: 'installed-' + pin.current.version, asarSHA256: shortcut.app.asarSHA256,
        executableSHA256: shortcut.app.executableSHA256, backendSHA256: shortcut.app.backendSHA256 }],
  }
  return { pin, shortcut, report }
}

test('installed shortcut report binds the exact installed image and two additional same-profile native processes', () => {
  const f = fixture()
  assert.equal(validateInstalledShortcutManagement(f.report, f.shortcut, f.pin, verifier), true)
  assert.equal(Object.keys(SHORTCUT_INSTALLATION_SOURCES).length, 8)
  assert.equal(new Set(Object.values(SHORTCUT_INSTALLATION_SOURCES)).size, 8)
})
for (const [name, mutate] of [
  ['old accepted reading version', f => { f.pin.current.version = '4.233.2' }],
  ['wrong accepted upgrade bytes', f => { f.pin.previous.bytes++ }],
  ['missing binary identity', f => { f.pin.current.sha256 = null }],
  ['wrong product', f => { f.report.productCommit = verifier }],
  ['wrong verifier', f => { f.report.verifierCommit = product }],
  ['incomplete original lifecycle', f => { f.report.complete = false }],
  ['forced original lifecycle', f => { f.report.forceTerminated = true }],
  ['changed default data path', f => { f.report.usedDefaultDataPath = false }],
  ['missing original sixth close', f => { f.report.appExits.pop() }],
  ['extra process mixed into original exits', f => { f.report.appExits.push({ ...f.shortcut.exits[0] }) }],
  ['reused original process', f => { f.report.appExits[0].pid = f.shortcut.launches[0].pid }],
  ['forced original native close', f => { f.report.appExits[5].nativeClose = false }],
  ['missing original comparison', f => { f.report.dataComparisons.pop() }],
  ['changed retained data', f => { f.report.dataComparisons[5].equal = false }],
  ['missing reading gate', f => { f.report.checks.splice(1, 1) }],
  ['missing shortcut gate', f => { f.report.checks.splice(3, 1) }],
  ['duplicated shortcut gate', f => { f.report.checks.push(SHORTCUT_INSTALLATION_GATE) }],
  ['shortcut after final uninstall', f => { f.report.checks.splice(3, 1); f.report.checks.push(SHORTCUT_INSTALLATION_GATE) }],
  ['shortcut before sixth original close', f => { f.report.checks.splice(3, 1); f.report.checks.unshift(SHORTCUT_INSTALLATION_GATE) }],
  ['different installed image', f => { f.report.shortcutLaunch.target = 'D:\\other\\记事本.exe' }],
  ['different installed ASAR', f => { f.report.snapshots[1].asarSHA256 = '1'.repeat(64) }],
  ['missing independent installed executable hash', f => { delete f.report.snapshots[1].executableSHA256 }],
  ['changed independent installed executable hash', f => { f.report.snapshots[1].executableSHA256 = '2'.repeat(64) }],
  ['missing independent installed backend hash', f => { delete f.report.snapshots[1].backendSHA256 }],
  ['changed independent installed backend hash', f => { f.report.snapshots[1].backendSHA256 = '3'.repeat(64) }],
  ['missing installed snapshot', f => { f.report.snapshots.pop() }],
  ['wrong linked native processes', f => { f.report.shortcutManagementRun.processIDs.reverse() }],
  ['wrong linked executable bytes', f => { f.report.shortcutManagementRun.application.executableSHA256 = '2'.repeat(64) }],
  ['wrong linked report', f => { f.report.shortcutManagementRun.report = 'another-report.json' }],
  ['missing linked original report digest', f => { f.report.shortcutManagementRun.sha256 = null }],
  ['changed native driver source', f => { f.shortcut.sourceFiles['check-shortcut-management-desktop.mjs'] = verifier }],
  ['changed installation source record', f => { f.report.shortcutManagementSource.sources['run-shortcut-management-desktop.mjs'] = verifier }],
  ['packaged report substituted for installation', f => { f.shortcut.scope = 'packaged' }],
  ['missing installed reserved-key visibility', f => { delete f.shortcut.refusals.reservedVisibility }],
  ['installed conflict cancel control occluded', f => { f.shortcut.refusals.conflictVisibility.nodes.cancel.hitPoints[0].matched = false }],
  ['installed conflict screenshot digest differs', f => { f.shortcut.refusals.conflictScreenshot.sha256 = 'f'.repeat(64) }],
  ['installed conflict state changed during capture', f => { f.shortcut.refusals.conflictScreenshot.after.nodes.feedback.text = 'another state' }],
]) test('installed shortcut evidence refuses ' + name, () => {
  const f = fixture(); mutate(f)
  assert.throws(() => validateInstalledShortcutManagement(f.report, f.shortcut, f.pin, verifier))
})

for (const [file, key] of Object.entries(SHORTCUT_INSTALLATION_SOURCES)) {
  test('source gate binds actual ' + file + ' bytes before verifier preparation', () => {
    const pin = pinFixture()
    assert.equal(validateShortcutManagementVerifierSources(pin, source), true)
    assert.throws(() => validateShortcutManagementInstallerPin({ ...pin, [key]: null }))
    assert.throws(() => prepareShortcutManagementVerifierSources(pin, name => name === file ? undefined : source(name)), /Shortcut source is missing/)
    assert.throws(() => prepareShortcutManagementVerifierSources(pin, name => source(name) + (name === file ? '\n// changed native source' : '')), /Shortcut source differs from product pin/)
  })
}

test('new generator retains every historical fixed source and complete inverse transformations', () => {
  const pin = pinFixture(), previous = prepareReadingModeVerifierSources(pin, source)
  const generated = prepareShortcutManagementVerifierSources(pin, source)
  assert.equal(generated.length, 6)
  for (const [index, item] of generated.entries()) {
    assert.equal(item.hash, previous[index].hash); assert.equal(item.original, previous[index].original)
    assert.equal(replaceExactlyAndProveInverse(item.pinned, [...item.changes].reverse().map(([before, after]) => [after, before])), item.original)
    if (item.output !== 'run-reading-import-generated.mjs') assert.equal(item.pinned, previous[index].pinned)
  }
  const read = name => generated.find(item => item.output === name)?.pinned ?? source(name)
  assert.equal(validateGeneratedShortcutManagementSources(pin, read), true)
  for (const item of generated) {
    assert.throws(() => validateGeneratedShortcutManagementSources(pin, name => name === item.output ? undefined : read(name)), /Prepared shortcut verifier is missing/)
    assert.throws(() => validateGeneratedShortcutManagementSources(pin, name => read(name) + (name === item.output ? '\n// changed inherited acceptance' : '')), /Prepared shortcut verifier was changed/)
  }
  const actualRunner = generated.find(item => item.output === 'run-reading-import-generated.mjs').pinned
  for (const gate of ['validateLifecycleReport(report)', 'validateShortcutCompletion(report)', 'validateInstalledTemplates(',
    'validateInstalledQuick(', 'validateInstalledNoteTags(', 'validateInstalledBacklinks(', 'validateInstalledGraph(',
    'validateInstalledPins(', 'validateInstalledRecent(', 'validateInstalledWiki(', 'validateInstalledLocalImport(',
    'validateInstalledReadingMode(', 'verifyShortcutManagementInstalledReport(out,report,pin,process.env.GITHUB_SHA)']) assert.ok(actualRunner.includes(gate), gate)
  assert.ok(actualRunner.includes("'reading-mode-installation-accepted.json'"))
  assert.ok(actualRunner.includes("'shortcut-management-installation-accepted.json'"))
  assert.ok(actualRunner.includes("['./desktop-save-fixture.mjs',pin.shortcutManagementCanonicalFixtureBlob]"))
})

for (const lineEnding of ['LF', 'CRLF']) test('complete offline ' + lineEnding + ' preparation keeps 26 original gates and appends shortcut restart before final uninstall', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'shortcut101-install-contract-'))
  try {
    const scripts = path.join(directory, 'scripts')
    cpSync(fileURLToPath(new URL('.', import.meta.url)), scripts, { recursive: true })
    const checkout = folder => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) checkout(file)
        else if (/\.(?:mjs|cjs|js|jsx|ps1)$/.test(entry.name)) {
          const normalized = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
          writeFileSync(file, lineEnding === 'CRLF' ? normalized.replace(/\n/g, '\r\n') : normalized)
        }
      }
    }
    checkout(scripts)
    const read = name => readFileSync(path.join(scripts, name), 'utf8').replace(/\r\n/g, '\n')
    const pin = pinFixture(), generated = prepareShortcutManagementVerifierSources(pin, read)
    for (const item of generated) writeFileSync(path.join(scripts, item.output), item.pinned)
    const module = name => import(pathToFileURL(path.join(scripts, name)).href)
    const { prepareLocalImportValidatorPin } = await module('pin-reading-import-generated.mjs')
    const inheritedPins = prepareLocalImportValidatorPin(pin, read)
    writeFileSync(path.join(scripts, 'template-installed-evidence.mjs'), inheritedPins.after)
    for (const item of inheritedPins.generated) writeFileSync(path.join(scripts, item.output), item.pinned)
    const { prepareOutlineInstallation } = await module('document-outline-installed-evidence.mjs')
    const { extendGraphInstallation } = await module('import-graph-validator.mjs')
    const { extendPinsInstallation } = await module('import-pins-validator.mjs')
    const { extendRecentInstallation } = await module('import-recent-validator.mjs')
    const { prepareInstallerHistoryReadiness } = await module('installer-history-readiness.mjs')
    const { extendWikiInstallation } = await module('import-wiki-validator.mjs')
    const { extendLocalImportInstallation } = await module('reading-import-validator.mjs')
    const { extendReadingModeInstallation } = await module('reading-mode-installed-evidence.mjs')
    const inherited = prepareOutlineInstallation(read('installer-lifecycle-core.mjs'), read('check-windows-installer-lifecycle.mjs'), pin)
    const reading = extendReadingModeInstallation(extendLocalImportInstallation(extendWikiInstallation(prepareInstallerHistoryReadiness(extendRecentInstallation(extendPinsInstallation(extendGraphInstallation(inherited, pin), pin), pin)), pin), pin), pin)
    const final = extendShortcutManagementInstallation(reading, pin)
    writeFileSync(path.join(scripts, 'reading-core-contract.mjs'), reading.core)
    writeFileSync(path.join(scripts, 'installer-lifecycle-core.mjs'), final.core)
    const readingCore = await module('reading-core-contract.mjs')
    const finalCore = await import(pathToFileURL(path.join(scripts, 'installer-lifecycle-core.mjs')).href + '?shortcut-final')
    assert.equal(readingCore.REQUIRED_CHECKS.length, 26)
    assert.equal(finalCore.REQUIRED_CHECKS.length, 27)
    assert.deepEqual(finalCore.REQUIRED_CHECKS.filter(check => check !== SHORTCUT_INSTALLATION_GATE), readingCore.REQUIRED_CHECKS)
    assert.deepEqual(finalCore.RELEASES, { previous: pin.previous, current: pin.current })
    assert.equal(finalCore.PRODUCT_COMMIT, pin.product)
    const call = "await runShortcutManagementLifecycle({executablePath:appExe,out,productCommit:PRODUCT_COMMIT,version:RELEASES.current.version,scope:'installed',ownedRoot:scratch})"
    assert.equal(final.script.split(call).length, 2)
    assert.ok(final.script.indexOf(call) > final.script.indexOf("mark('reinstall-recovers-retained-data')"))
    assert.ok(final.script.indexOf(call) < final.script.indexOf('const finalData=snapshotData()'))
    assert.equal(final.script.split('await verifyReadingModeDesktop(').length, 2)
    assert.equal(final.script.split('await verifyLocalImportRestart(').length, 2)
    assert.equal(final.script.split('executableSHA256:sha(readFileSync(appExe))').length, 2)
    assert.equal(final.script.split("backendSHA256:sha(readFileSync(path.join(installDir,'resources','bin','notepad-server.exe')))").length, 2)
    assert.ok(final.script.includes("assert.equal(observedDirectory,legacyTarget.split(' ')[0],'Old directory truncation was not reproduced')"))
    assert.ok(final.core.includes(readingCore.LEGACY_DEFECT.sha256))
    assert.throws(() => extendShortcutManagementInstallation(final, pin))
    assert.throws(() => extendShortcutManagementInstallation({ ...reading, core: reading.core.replace("'installed-app-reading-mode-workflow'", "'reading-gate-removed'") }, pin))
    assert.throws(() => extendShortcutManagementInstallation({ ...reading, script: reading.script.replace('await verifyReadingModeDesktop(', 'await removedReading(') }, pin))
    assert.throws(() => extendShortcutManagementInstallation({ ...reading, script: reading.script.replace("mark('reinstall-recovers-retained-data')", "mark('sixth-close-gate-removed')") }, pin))
    assert.throws(() => extendShortcutManagementInstallation({ ...reading, script: reading.script.replace("asarSHA256:sha(readFileSync(path.join(installDir,'resources','app.asar')))", "asarSHA256:'unverified'") }, pin))
    const target = path.join(scripts, 'check-windows-installer-lifecycle.reading-mode.mjs')
    writeFileSync(target, final.script)
    const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT
    for (const file of [target, path.join(scripts, 'run-reading-import-generated.mjs')]) {
      const checked = spawnSync(process.execPath, ['--check', file], { cwd: directory, env: environment, encoding: 'utf8' })
      assert.ifError(checked.error); assert.equal(checked.signal, null); assert.equal(checked.status, 0, checked.stdout + checked.stderr)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

function pngFixture() {
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0) } return (c ^ 0xffffffff) >>> 0 }
  const chunk = (name, bytes) => { const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(Buffer.concat([type, bytes]))); return Buffer.concat([length, type, bytes, checksum]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(600); header.writeUInt32BE(400, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(400 * (600 * 3 + 1)))), chunk('IEND', Buffer.alloc(0))])
}
test('installation binds the exact raw shortcut report bytes in addition to every original PNG', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'shortcut101-installed-byte-contract-'))
  try {
    const f = fixture(), png = pngFixture()
    for (const image of f.shortcut.screenshots) {
      image.bytes = png.length; image.sha256 = sha(png); writeFileSync(path.join(directory, image.filename), png)
      if (image.filename === 'shortcut-management-conflict.png') Object.assign(f.shortcut.refusals.conflictScreenshot, image)
    }
    const raw = JSON.stringify(f.shortcut, null, 2) + '\n'
    writeFileSync(path.join(directory, SHORTCUT_MANAGEMENT_REPORT), raw)
    f.report.shortcutManagementRun.sha256 = sha(raw)
    assert.equal(verifyShortcutManagementInstalledReport(directory, f.report, f.pin, verifier).complete, true)
    const visibilityChanged = structuredClone(f.shortcut)
    visibilityChanged.refusals.reservedVisibility.viewport.devicePixelRatio = 2
    assert.equal(validateInstalledShortcutManagement(f.report, visibilityChanged, f.pin, verifier), true)
    writeFileSync(path.join(directory, SHORTCUT_MANAGEMENT_REPORT), JSON.stringify(visibilityChanged))
    assert.throws(() => verifyShortcutManagementInstalledReport(directory, f.report, f.pin, verifier), /exact shortcut report bytes/)
    writeFileSync(path.join(directory, SHORTCUT_MANAGEMENT_REPORT), raw + '\n')
    assert.throws(() => verifyShortcutManagementInstalledReport(directory, f.report, f.pin, verifier), /exact shortcut report bytes/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

function assertWorkflowContract(rawWorkflow) {
  const workflow = rawWorkflow.replace(/\r\n/g, '\n')
  assert.match(workflow, /timeout-minutes: 20\n/)
  assert.deepEqual(workflow.split('\n').filter(line => /^[ \t]*timeout-minutes:/.test(line)), ['    timeout-minutes: 20'])
  const preparation = workflow.match(/^          node --test --test-reporter=tap --test-reporter-destination=test-results\/installer-lifecycle\/preparation-contracts\.tap (.+)$/m)
  assert.ok(preparation, 'Keep the complete preparation TAP even when a contract refuses the candidate')
  assert.deepEqual(preparation[1].split(/\s+/), [
    'scripts/reading-mode-desktop-evidence.node.mjs', 'scripts/reading-mode-installed-evidence.node.mjs',
    'scripts/reading-mode-native-input.node.mjs', 'scripts/desktop-window-session.node.mjs',
    'scripts/shortcut-management-desktop-evidence.node.mjs', 'scripts/shortcut-management-installed-evidence.node.mjs',
  ])
  const builder = workflow.indexOf('run: node scripts/build-reading-mode-fixture.mjs')
  assert.ok(builder >= 0 && builder < workflow.indexOf(preparation[0]))
  const context = workflow.indexOf("scope: 'installer-preparation-contracts-only', nativeLifecycleExecuted: false")
  assert.ok(context >= 0 && context < workflow.indexOf(preparation[0]))
  assert.ok(workflow.includes('          if-no-files-found: error'))
  assert.ok(workflow.includes('run: node scripts/prepare-legacy-installer.mjs'))
  const original = workflow.split('\n').find(line => line.includes('run: node --test scripts/installer-lifecycle-core.node.mjs'))
  assert.equal(original.trim().split(/\s+/).slice(3).length, 17)
  assert.ok(workflow.includes('scripts/shortcut-management-installed-evidence.node.mjs'))
  assert.ok(workflow.includes('run: node scripts/run-reading-mode-installer.mjs run'))
  const pin = source('pin-reading-mode-installer.mjs'), runner = source('run-reading-mode-installer.mjs')
  assert.match(pin, /validateShortcutManagementInstallerPin\(pin\)/)
  assert.match(pin, /prepareShortcutManagementVerifierSources\(pin,/)
  assert.match(runner, /validateShortcutManagementInstallerPin\(pin\)/)
  assert.match(runner, /assert\.ifError\(child\.error\)/)
}

test('workflow retains fixed legacy restoration, original 17 refusal files and 20-minute budget', () => {
  assertWorkflowContract(readFileSync(new URL('../.github/workflows/local-installation-2f86.yml', import.meta.url), 'utf8'))
})

test('workflow accepts actual LF and CRLF checkout text with the same strict preparation gates', () => {
  const normalized = readFileSync(new URL('../.github/workflows/local-installation-2f86.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  for (const workflow of [normalized, normalized.replace(/\n/g, '\r\n')]) assertWorkflowContract(workflow)
})

test('workflow refuses missing changed or duplicated installation time budgets in either checkout format', () => {
  const normalized = readFileSync(new URL('../.github/workflows/local-installation-2f86.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  for (const replacement of ['', '    timeout-minutes: 19\n', '    timeout-minutes: 21\n',
    '    timeout-minutes: 200\n', '    timeout-minutes: 20\n    timeout-minutes: 21\n']) {
    const changed = normalized.replace('    timeout-minutes: 20\n', replacement)
    for (const workflow of [changed, changed.replace(/\n/g, '\r\n')]) assert.throws(() => assertWorkflowContract(workflow))
  }
})
