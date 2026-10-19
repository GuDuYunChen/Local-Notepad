import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ACCEPTED_READING_SEED, ACCEPTED_READING_SEED_SOURCE, READING_SOURCE_KEYS,
  validateReadingModePin, prepareReadingModeVerifierSources, extendReadingModeInstallation,
  replaceExactlyAndProveInverse, validateInstalledReadingMode, validateGeneratedReadingModeSources } from './reading-mode-installed-evidence.mjs'
import { readingEvidenceFixture } from './reading-mode-test-fixture.mjs'
import { REQUIRED_CHECKS, LEGACY_DEFECT } from './installer-lifecycle-core.mjs'
import { validateReadingArtifact } from './pin-reading-mode-installer.mjs'

const verifier = 'b'.repeat(40)
function fixture() {
  const pin = { product: 'a'.repeat(40), previous: { ...ACCEPTED_READING_SEED }, previousSource: { ...ACCEPTED_READING_SEED_SOURCE },
    current: { version: '4.233.1', bytes: 1001, sha256: createHash('sha256').update('synthetic-reading-mode-contract-input').digest('hex') }, currentSource: { run: 100, artifact: 200, name: 'local-notepad-windows-' + 'a'.repeat(40) } }
  for (const key of READING_SOURCE_KEYS) pin[key] = 'd'.repeat(40)
  Object.assign(pin, { importBlob: '834a0f899611f84c64dcee0caa74863ea906362e',
    importEvidenceBlob: '212d90b2b23e40f272b3ee73f0f0c128f9fd9359',
    importEvidenceTestsBlob: '591673bb0dbac36c38515cb8ff9ab64d71b7bb1b' })
  const report = { productCommit: pin.product, verifierCommit: verifier, complete: true, cleanupComplete: true,
    syntheticData: true, usedDefaultDataPath: true, forceTerminated: false, platform: 'win32', runnerEnvironment: 'github-hosted',
    installers: { current: { ...pin.current }, previous: { ...pin.previous } },
    readingModeSource: { productCommit: pin.product, driver: pin.readingDriverBlob, fixture: pin.readingFixtureBlob,
      validator: pin.readingEvidenceBlob, builder: pin.readingBuilderBlob, nativeInput: pin.readingInputBlob },
    checks: ['installed-app-wiki-navigation-workflow', 'installed-app-local-import-workflow', 'installed-app-reading-mode-workflow'],
    appExits: Array.from({ length: 6 }, (_, i) => ({ pid: i + 100, code: 0, signal: null, nativeClose: true })),
    dataComparisons: Array.from({ length: 6 }, () => ({ equal: true, files: 4, digest: 'e'.repeat(64) })),
  }
  return { pin, report, reading: readingEvidenceFixture() }
}
test('installation binds accepted 4.232.0 seed and new reading report to the actual fifth native process', () => {
  const f = fixture(); assert.equal(validateReadingModePin(f.pin), true)
  assert.equal(validateInstalledReadingMode(f.report, f.reading, f.pin, verifier), true)
})
test('artifact identity requires the exact remote ID, name, run, product head and availability', () => {
  const { pin } = fixture()
  for (const which of ['previous', 'current']) {
    const expected = pin[which + 'Source']
    const artifact = { id: expected.artifact, name: expected.name, expired: false, size_in_bytes: 100,
      workflow_run: { id: expected.run, head_sha: expected.name.slice(-40) } }
    assert.equal(validateReadingArtifact(pin, which, artifact), true)
    for (const mutate of [a => a.id++, a => a.name += '-other', a => a.expired = true,
      a => a.workflow_run.id++, a => a.workflow_run.head_sha = 'e'.repeat(40), a => a.size_in_bytes = 0]) {
      const changed = structuredClone(artifact); mutate(changed)
      assert.throws(() => validateReadingArtifact(pin, which, changed))
    }
  }
})
for (const [name, mutate] of [
  ['unresolved target', f => f.pin.product = null], ['old version', f => f.pin.current.version = '4.233.0'],
  ['unresolved bytes', f => f.pin.current.bytes = null], ['unresolved digest', f => f.pin.current.sha256 = null],
  ['wrong upgrade version', f => f.pin.previous.version = '4.231.2'], ['wrong upgrade hash', f => f.pin.previous.sha256 = '0'.repeat(64)],
  ['wrong upgrade artifact', f => f.pin.previousSource.artifact++], ['wrong upgrade run', f => f.pin.previousSource.run++],
  ['unresolved target run', f => f.pin.currentSource.run = null], ['unresolved target artifact', f => f.pin.currentSource.artifact = null],
  ['wrong artifact commit', f => f.pin.currentSource.name = 'local-notepad-windows-' + verifier],
  ...READING_SOURCE_KEYS.map(key => ['missing source ' + key, f => delete f.pin[key]]),
  ['missing reading gate', f => f.report.checks.pop()], ['duplicate reading gate', f => f.report.checks.push('installed-app-reading-mode-workflow')],
  ['missing old import gate', f => f.report.checks.splice(1, 1)], ['missing old Wiki gate', f => f.report.checks.shift()],
  ['wrong product', f => f.report.productCommit = verifier], ['wrong verifier', f => f.report.verifierCommit = f.pin.product],
  ['wrong driver', f => f.report.readingModeSource.driver = verifier], ['wrong serializer', f => f.report.readingModeSource.fixture = verifier],
  ['wrong evidence code', f => f.report.readingModeSource.validator = verifier], ['wrong builder', f => f.report.readingModeSource.builder = verifier],
  ['wrong native input source', f => f.report.readingModeSource.nativeInput = verifier],
  ['incomplete lifecycle', f => f.report.complete = false], ['incomplete cleanup', f => f.report.cleanupComplete = false],
  ['self-hosted runner', f => f.report.runnerEnvironment = 'self-hosted'], ['forced app', f => f.report.forceTerminated = true],
  ['missing exit', f => f.report.appExits.pop()], ['forced exit', f => f.report.appExits[4].nativeClose = false],
  ['exit failure', f => f.report.appExits[4].code = 1], ['exit signal', f => f.report.appExits[4].signal = 'SIGTERM'],
  ['missing retained comparison', f => f.report.dataComparisons.pop()], ['changed retained bytes', f => f.report.dataComparisons[0].equal = false],
  ['wrong native process', f => f.reading.processID = 999], ['missing independent reading check', f => delete f.reading.attempts.caption],
]) test('refuses installed reading ' + name, () => {
  const f = fixture(); mutate(f); assert.throws(() => validateInstalledReadingMode(f.report, f.reading, f.pin, verifier))
})

const source = name => readFileSync(new URL('./' + name, import.meta.url), 'utf8')
test('all generated import copies retain exact inverse source identity', () => {
  const { pin } = fixture(), generated = prepareReadingModeVerifierSources(pin, source)
  assert.equal(generated.length, 6)
  assert.ok(generated.find(item => item.output === 'run-reading-import-generated.mjs').pinned.includes("['./reading-mode-native-input.mjs',pin.readingInputBlob]"), 'Native input helper must remain source-bound in the actual installer runner')
  for (const item of generated) assert.equal(replaceExactlyAndProveInverse(item.pinned, [...item.changes].reverse().map(([before, after]) => [after, before])), item.original)
  for (const item of generated) assert.throws(() => prepareReadingModeVerifierSources(pin, name => source(name) + (name === item.source ? '\n// changed policy' : '')))
  assert.throws(() => replaceExactlyAndProveInverse('same same', [['same', 'other']]))
  const readGenerated = name => generated.find(item => item.output === name)?.pinned ?? source(name)
  assert.equal(validateGeneratedReadingModeSources(pin, readGenerated), true)
  assert.throws(() => validateGeneratedReadingModeSources(pin, name => readGenerated(name) + (name === 'run-reading-import-generated.mjs' ? '\n// changed gate' : '')))
})
for (const key of ['importBlob', 'importEvidenceBlob', 'importEvidenceTestsBlob']) test('refuses a version-pinned copy that differs from target product ' + key, () => {
  const { pin } = fixture(); pin[key] = 'd'.repeat(40)
  assert.throws(() => prepareReadingModeVerifierSources(pin, source))
})

for (const lineEnding of ['LF', 'CRLF']) test('offline complete ' + lineEnding + ' prepare chain preserves original lifecycle and adds reading after actual import restart', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'reading100-prepare-contract-'))
  try {
    const scripts = path.join(directory, 'scripts')
    cpSync(fileURLToPath(new URL('.', import.meta.url)), scripts, { recursive: true })
    // Exercise both actual checkout forms, including on a Linux host. Only
    // newline bytes change in these isolated code copies; binary fixtures stay
    // intact. The real installer runner already normalizes CRLF before hashing.
    const checkout = folder => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) checkout(file)
        else if (/\.(?:mjs|cjs|js|jsx|ps1)$/.test(entry.name)) {
          const normalized = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
          writeFileSync(file, lineEnding === 'CRLF' ? normalized.replace(/\n/g, '\r\n') : normalized)
          assert.equal(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), normalized)
        }
      }
    }
    checkout(scripts)
    const raw = name => readFileSync(path.join(scripts, name), 'utf8')
    const read = name => raw(name).replace(/\r\n/g, '\n')
    const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex')
    const originalCore = raw('installer-lifecycle-core.mjs')
    assert.equal(blob(originalCore), lineEnding === 'CRLF' ? 'e83e76da3a4679682a731cb1cabdbf4e705182f9' : 'e9c64b370582da9b21a8ea299ef40db01eb96b0a')
    assert.equal(blob(read('installer-lifecycle-core.mjs')), 'e9c64b370582da9b21a8ea299ef40db01eb96b0a')
    const { pin } = fixture(), generated = prepareReadingModeVerifierSources(pin, read)
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
    if (lineEnding === 'CRLF') assert.throws(() => prepareOutlineInstallation(originalCore, read('check-windows-installer-lifecycle.mjs'), pin), {
      code: 'ERR_ASSERTION', actual: 'e83e76da3a4679682a731cb1cabdbf4e705182f9', expected: 'e9c64b370582da9b21a8ea299ef40db01eb96b0a',
    }, 'Unnormalized CRLF must still fail the original fixed source identity gate')
    const inherited = prepareOutlineInstallation(read('installer-lifecycle-core.mjs'), read('check-windows-installer-lifecycle.mjs'), pin)
    const prepared = extendLocalImportInstallation(extendWikiInstallation(prepareInstallerHistoryReadiness(extendRecentInstallation(extendPinsInstallation(extendGraphInstallation(inherited, pin), pin), pin)), pin), pin)
    const final = extendReadingModeInstallation(prepared, pin)
    assert.equal(final.script.match(/await verifyReadingModeDesktop\(/g).length, 1)
    assert.equal(final.script.match(/await verifyLocalImportRestart\(/g).length, 1)
    assert.ok(final.script.indexOf('await verifyReadingModeDesktop(') > final.script.indexOf('await verifyLocalImportRestart('))
    assert.equal(final.core.match(/'installed-app-reading-mode-workflow'/g).length, 1)
    assert.ok(final.core.includes('4.233.1')); assert.ok(final.core.includes('4.232.0'))
    for (const marker of REQUIRED_CHECKS) assert.ok(final.core.includes(marker), marker)
    assert.ok(final.core.includes(LEGACY_DEFECT.sha256))
    assert.ok(final.script.includes("assert.equal(observedDirectory,legacyTarget.split(' ')[0],'Old directory truncation was not reproduced')"))
    assert.throws(() => extendReadingModeInstallation(final, pin))
    assert.throws(() => extendReadingModeInstallation({ ...prepared, script: prepared.script.replace('await verifyLocalImportRestart(', 'await missingRestart(') }, pin))
    writeFileSync(path.join(scripts, 'installer-lifecycle-core.mjs'), final.core)
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(directory, 'node_modules'), 'junction')
    const workflow = readFileSync(new URL('../.github/workflows/local-installation-2f86.yml', import.meta.url), 'utf8')
    const refusalLine = workflow.split('\n').find(line => line.includes('run: node --test scripts/installer-lifecycle-core.node.mjs'))
    const refusalScripts = refusalLine.trim().split(/\s+/).slice(3)
    assert.equal(refusalScripts.length, 17)
    // Start an independent test runner: inheriting Node's child-test transport
    // marker can make a nested --test invocation skip the requested test files.
    const testEnvironment = { ...process.env }; delete testEnvironment.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...refusalScripts, 'scripts/reading-import-desktop-validator.node.mjs'], { cwd: directory, env: testEnvironment, encoding: 'utf8' })
    assert.ifError(child.error); assert.equal(child.signal, null)
    assert.equal(child.status, 0, 'Prepared original refusal suite failed:\n' + child.stdout.slice(-10000) + child.stderr)
    assert.match(child.stdout, /^# tests 848$/m, 'The isolated original tests did not all execute')
    assert.match(child.stdout, /^# pass 848$/m)
    t.diagnostic(lineEnding + ': prepared original 17 refusal files and generated import refusal file all passed (848 assertions). Synthetic contract inputs only; no native installation executed.')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
