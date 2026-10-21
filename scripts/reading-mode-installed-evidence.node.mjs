import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ACCEPTED_READING_SEED, ACCEPTED_READING_SEED_SOURCE, READING_SOURCE_KEYS,
  validateReadingModePin, validateReadingModeHistorySource, prepareReadingModeVerifierSources, extendReadingModeInstallation,
  replaceExactlyAndProveInverse, validateInstalledReadingMode, validateGeneratedReadingModeSources } from './reading-mode-installed-evidence.mjs'
import { readingEvidenceFixture } from './reading-mode-test-fixture.mjs'
import { REQUIRED_CHECKS, LEGACY_DEFECT } from './installer-lifecycle-core.mjs'
import { validateReadingArtifact } from './pin-reading-mode-installer.mjs'

const source = name => readFileSync(new URL('./' + name, import.meta.url), 'utf8')
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex')
const verifier = 'b'.repeat(40)
function fixture() {
  const reading = readingEvidenceFixture()
  const pin = { product: 'a'.repeat(40), previous: { ...ACCEPTED_READING_SEED }, previousSource: { ...ACCEPTED_READING_SEED_SOURCE },
    current: { version: '4.235.0', bytes: 1001, sha256: createHash('sha256').update('synthetic-reading-mode-contract-input').digest('hex') }, currentSource: { run: 100, artifact: 200, name: 'local-notepad-windows-' + 'a'.repeat(40) } }
  for (const key of READING_SOURCE_KEYS) pin[key] = 'd'.repeat(40)
  Object.assign(pin, { importBlob: 'f7001589494d6ae81b51275512ed406f6892974c',
    importEvidenceBlob: '6984a22dba599d4026769de34a76c0aa8e01229f',
    importEvidenceTestsBlob: '12ceb52310ca16bb964661f7894d76c920a47779',
    historyDriverBlob: blob(source('check-version-history-desktop.mjs').replace(/\r\n/g, '\n')) })
  const report = { productCommit: pin.product, verifierCommit: verifier, complete: true, cleanupComplete: true,
    syntheticData: true, usedDefaultDataPath: true, forceTerminated: false, platform: 'win32', runnerEnvironment: 'github-hosted',
    installers: { current: { ...pin.current }, previous: { ...pin.previous } },
    moduleSources: { history: pin.historyDriverBlob },
    readingModeSource: { productCommit: pin.product, driver: pin.readingDriverBlob, fixture: pin.readingFixtureBlob,
      validator: pin.readingEvidenceBlob, builder: pin.readingBuilderBlob, nativeInput: pin.readingInputBlob,
      windowSession: pin.readingWindowSessionBlob, windowTarget: pin.readingWindowTargetBlob, windowWorker: pin.readingWindowWorkerBlob },
    checks: ['installed-app-wiki-navigation-workflow', 'installed-app-local-import-workflow', 'installed-app-reading-mode-workflow'],
    appExits: Array.from({ length: 6 }, (_, i) => ({ pid: i + 100, code: 0, signal: null, nativeClose: true })),
    dataComparisons: Array.from({ length: 6 }, () => ({ equal: true, files: 4, digest: 'e'.repeat(64) })),
    shortcutLaunch: { target: reading.pendingDrafts.quit.executablePath },
  }
  return { pin, report, reading }
}
test('installation binds accepted 4.232.0 seed and new reading report to the actual fifth native process', () => {
  const f = fixture(); assert.equal(validateReadingModePin(f.pin), true)
  assert.equal(READING_SOURCE_KEYS.length, 23)
  assert.equal(new Set(READING_SOURCE_KEYS).size, 23)
  assert.equal(READING_SOURCE_KEYS.at(-1), 'historyDriverBlob')
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
  ['previous reading fix version', f => f.pin.current.version = '4.233.1'],
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
  ['wrong native window session source', f => f.report.readingModeSource.windowSession = verifier],
  ['wrong native window selector source', f => f.report.readingModeSource.windowTarget = verifier],
  ['wrong native window worker source', f => f.report.readingModeSource.windowWorker = verifier],
  ['wrong installed history source', f => f.report.moduleSources.history = verifier],
  ['missing installed history source', f => delete f.report.moduleSources],
  ['incomplete lifecycle', f => f.report.complete = false], ['incomplete cleanup', f => f.report.cleanupComplete = false],
  ['self-hosted runner', f => f.report.runnerEnvironment = 'self-hosted'], ['forced app', f => f.report.forceTerminated = true],
  ['missing exit', f => f.report.appExits.pop()], ['forced exit', f => f.report.appExits[4].nativeClose = false],
  ['exit failure', f => f.report.appExits[4].code = 1], ['exit signal', f => f.report.appExits[4].signal = 'SIGTERM'],
  ['missing retained comparison', f => f.report.dataComparisons.pop()], ['changed retained bytes', f => f.report.dataComparisons[0].equal = false],
  ['wrong native process', f => f.reading = readingEvidenceFixture({ processID: 999 })], ['missing independent reading check', f => delete f.reading.attempts.caption],
  ['missing installed image', f => delete f.report.shortcutLaunch],
  ['another installed image', f => f.report.shortcutLaunch.target = 'C:\\unrelated\\Other.exe'],
]) test('refuses installed reading ' + name, () => {
  const f = fixture(); mutate(f); assert.throws(() => validateInstalledReadingMode(f.report, f.reading, f.pin, verifier))
})

test('all generated import copies retain exact inverse source identity', () => {
  const { pin } = fixture(), generated = prepareReadingModeVerifierSources(pin, source)
  assert.equal(generated.length, 6)
  for (const [file, key] of [
    ['check-reading-mode-desktop.mjs', 'readingDriverBlob'], ['reading-mode-desktop-fixture.jsx', 'readingFixtureBlob'],
    ['reading-mode-desktop-evidence.mjs', 'readingEvidenceBlob'], ['build-reading-mode-fixture.mjs', 'readingBuilderBlob'],
    ['reading-mode-native-input.mjs', 'readingInputBlob'], ['desktop-window-session.mjs', 'readingWindowSessionBlob'],
    ['desktop-window-target.mjs', 'readingWindowTargetBlob'], ['desktop-window-worker.ps1', 'readingWindowWorkerBlob'],
    ['check-version-history-desktop.mjs', 'historyDriverBlob'],
  ]) assert.ok(generated.find(item => item.output === 'run-reading-import-generated.mjs').pinned.includes("['./" + file + "',pin." + key + "]"),
    'Native reading and owned-window dependencies must remain source-bound in the actual installer runner: ' + file)
  for (const item of generated) assert.equal(replaceExactlyAndProveInverse(item.pinned, [...item.changes].reverse().map(([before, after]) => [after, before])), item.original)
  for (const item of generated) assert.throws(() => prepareReadingModeVerifierSources(pin, name => source(name) + (name === item.source ? '\n// changed policy' : '')))
  assert.throws(() => replaceExactlyAndProveInverse('same same', [['same', 'other']]))
  const readGenerated = name => generated.find(item => item.output === name)?.pinned ?? source(name)
  assert.equal(validateGeneratedReadingModeSources(pin, readGenerated), true)
  assert.throws(() => validateGeneratedReadingModeSources(pin, name => readGenerated(name) + (name === 'run-reading-import-generated.mjs' ? '\n// changed gate' : '')))
})
const importCheckoutSources = [
  { source: 'local-import-desktop-evidence.mjs', pin: 'importEvidenceBlob', hash: '6fc3c3d069384fc2bd7c671987ace423d004ddf8',
    old: "assert.equal(report.appVersion, '4.232.0')", current: "assert.equal(report.appVersion, '4.235.0')" },
  { source: 'check-local-import-desktop.mjs', pin: 'importBlob', hash: '6f0bfd54c7b7e1ea673e80b55a91be82244dfcef',
    old: "assert.equal(diagnostics.version, '4.232.0')", current: "assert.equal(diagnostics.version, '4.235.0')" },
  { source: 'local-import-desktop-evidence.node.mjs', pin: 'importEvidenceTestsBlob', hash: '12cc53ff2ff11d2aa8d6508feadd2a4734077bb3',
    old: "appVersion: '4.232.0'", current: "appVersion: '4.235.0'" },
]
for (const lineEnding of ['LF', 'CRLF']) {
  const checkout = text => lineEnding === 'CRLF' ? text.replace(/\n/g, '\r\n') : text
  const current = name => source(name).replace(/\r\n/g, '\n')
  const historical = name => {
    const spec = importCheckoutSources.find(item => item.source === name), text = current(name)
    if (!spec) return text
    assert.equal(text.split(spec.current).length, 2)
    const legacy = text.replace(spec.current, spec.old)
    assert.equal(blob(legacy), spec.hash, 'Historical test input must retain the original complete source')
    return legacy
  }
  test(lineEnding + ' historical and product import checkouts preserve identical validator policy and bind their actual sources', () => {
    const { pin } = fixture()
    const legacy = prepareReadingModeVerifierSources(pin, name => checkout(historical(name)))
    const product = prepareReadingModeVerifierSources(pin, name => checkout(current(name)))
    for (const item of product) {
      const original = legacy.find(previous => previous.source === item.source)
      assert.equal(item.original, original.original)
      if (item.output !== 'run-reading-import-generated.mjs') assert.equal(item.pinned, original.pinned)
    }
    for (const spec of importCheckoutSources) {
      const historicalRunner = legacy.find(item => item.output === 'run-reading-import-generated.mjs').pinned
      const productRunner = product.find(item => item.output === 'run-reading-import-generated.mjs').pinned
      assert.ok(historicalRunner.includes("['./" + spec.source + "','" + spec.hash + "']"))
      assert.ok(productRunner.includes("['./" + spec.source + "','" + pin[spec.pin] + "']"))
      assert.equal(blob(current(spec.source)), pin[spec.pin])
      assert.notEqual(pin[spec.pin], spec.hash)
    }
    const generated = name => product.find(item => item.output === name)?.pinned ?? current(name)
    assert.equal(validateGeneratedReadingModeSources(pin, name => checkout(generated(name))), true)
  })
  for (const spec of importCheckoutSources) {
    test(lineEnding + ' refuses altered product import policy even with a matching replacement pin: ' + spec.source, () => {
      const { pin } = fixture(), changed = current(spec.source) + '\n// changed import policy\n'
      pin[spec.pin] = blob(changed)
      assert.throws(() => prepareReadingModeVerifierSources(pin, name => checkout(name === spec.source ? changed : current(name))),
        error => error.code === 'ERR_ASSERTION' && error.message.startsWith('Original verifier source identity changed: ' + spec.source))
    })
    test(lineEnding + ' refuses unsupported product import version even with a matching replacement pin: ' + spec.source, () => {
      const { pin } = fixture(), changed = current(spec.source).replace(spec.current, spec.current.replace('4.235.0', '4.234.0'))
      pin[spec.pin] = blob(changed)
      assert.throws(() => prepareReadingModeVerifierSources(pin, name => checkout(name === spec.source ? changed : current(name))),
        /Original verifier anchor missing or ambiguous/)
    })
  }
}
for (const spec of importCheckoutSources) test('refuses raw CRLF blob identity as a normalized product pin: ' + spec.source, () => {
  const { pin } = fixture(), current = source(spec.source).replace(/\r\n/g, '\n'), crlf = current.replace(/\n/g, '\r\n')
  pin[spec.pin] = blob(crlf)
  assert.notEqual(pin[spec.pin], blob(current))
  assert.throws(() => prepareReadingModeVerifierSources(pin, name => name === spec.source ? crlf : source(name)),
    /Current import source differs from product pin/)
})
test('refuses a well-formed history pin that differs from the actual driver source', () => {
  const { pin } = fixture(); pin.historyDriverBlob = 'e'.repeat(40)
  assert.equal(validateReadingModePin(pin), true)
  assert.throws(() => prepareReadingModeVerifierSources(pin, source), /Current history driver source differs from product pin/)
})
test('refuses changed history driver bytes under the same product pin', () => {
  const { pin } = fixture()
  assert.equal(validateReadingModeHistorySource(pin, source), true)
  assert.throws(() => prepareReadingModeVerifierSources(pin, name => source(name) +
    (name === 'check-version-history-desktop.mjs' ? '\n// altered driver source' : '')),
  /Current history driver source differs from product pin/)
})
test('refuses missing actual history driver source before verifier generation', () => {
  const { pin } = fixture()
  assert.throws(() => prepareReadingModeVerifierSources(pin,
    name => name === 'check-version-history-desktop.mjs' ? undefined : source(name)), /Current history driver source is missing/)
})
for (const output of ['pin-reading-import-generated.mjs', 'run-reading-import-generated.mjs']) test('refuses missing generated source proof ' + output, () => {
  const { pin } = fixture(), generated = prepareReadingModeVerifierSources(pin, source)
  const read = name => generated.find(item => item.output === name)?.pinned ?? source(name)
  assert.throws(() => validateGeneratedReadingModeSources(pin, name => name === output ? undefined : read(name)),
    error => error.code === 'ERR_ASSERTION' && error.message.startsWith('Prepared verifier source is missing: ' + output))
})
for (const [name, output, anchor] of [
  ['history source verification', 'pin-reading-import-generated.mjs', 'validateReadingModeHistorySource(pin,readSource)'],
  ['history template binding', 'pin-reading-import-generated.mjs', " [\"export const HISTORY_BLOB='c9800f23c9f924d31edb1c7f7c7c4e1a1cf851a6'\",`export const HISTORY_BLOB='${pin.historyDriverBlob}'`],\n"],
  ['history runner binding', 'run-reading-import-generated.mjs', 'assert.equal(HISTORY_BLOB,pin.historyDriverBlob)'],
]) test('refuses generated verifier without ' + name, () => {
  const { pin } = fixture(), generated = prepareReadingModeVerifierSources(pin, source)
  const read = file => generated.find(item => item.output === file)?.pinned ?? source(file)
  assert.equal(read(output).split(anchor).length, 2)
  assert.throws(() => validateGeneratedReadingModeSources(pin, file => file === output ? read(file).replace(anchor, '') : read(file)),
    error => error.code === 'ERR_ASSERTION' && error.message.startsWith('Prepared verifier was changed after source proof: ' + output))
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
    // Give the isolated driver distinct source bytes so this contract proves a
    // new history binding, even while the real candidate driver is still held.
    const historySource = read('check-version-history-desktop.mjs') + '\n// Synthetic history source-pin contract input.\n'
    writeFileSync(path.join(scripts, 'check-version-history-desktop.mjs'), lineEnding === 'CRLF' ? historySource.replace(/\n/g, '\r\n') : historySource)
    const { pin } = fixture(); pin.historyDriverBlob = blob(historySource)
    const generated = prepareReadingModeVerifierSources(pin, read)
    for (const item of generated) writeFileSync(path.join(scripts, item.output), item.pinned)
    const module = name => import(pathToFileURL(path.join(scripts, name)).href)
    const { prepareLocalImportValidatorPin } = await module('pin-reading-import-generated.mjs')
    const inheritedPins = prepareLocalImportValidatorPin(pin, read)
    assert.equal(blob(inheritedPins.before), '5c676571f38982d2df6053dc8ca735f474684e9e')
    assert.notEqual(pin.historyDriverBlob, 'c9800f23c9f924d31edb1c7f7c7c4e1a1cf851a6')
    const historyAnchor = "export const HISTORY_BLOB='c9800f23c9f924d31edb1c7f7c7c4e1a1cf851a6'"
    const pinnedHistory = `export const HISTORY_BLOB='${pin.historyDriverBlob}'`
    assert.equal(inheritedPins.after.split(pinnedHistory).length, 2)
    assert.equal(replaceExactlyAndProveInverse(inheritedPins.after, [
      [pinnedHistory, historyAnchor],
      [`export const PRODUCT='${pin.product}'`, "export const PRODUCT='29c140a989984e981d6e99a6078145f1d05323dc'"],
      [`export const CURRENT=Object.freeze(${JSON.stringify(pin.current)})`, "export const CURRENT=Object.freeze({version:'4.222.2',bytes:104244051,sha256:'7d8b4d6196c90a3346b64e0c4124a4b92f80e0c46aa4e4bb347e3e04aaa373b2'})"],
      [`export const PREVIOUS=Object.freeze(${JSON.stringify(pin.previous)})`, "export const PREVIOUS=Object.freeze({version:'4.221.1',bytes:104218653,sha256:'de069090d8013bbbcc8aa076d610909b99703f1372fce22ed713cad0bfeeab6a'})"],
      [`export const TEMPLATE_BLOB='${pin.templateBlob}'`, "export const TEMPLATE_BLOB='c440d9bf107fe6f1d4bef1f06f845139b57fe9ef'"],
    ]), inheritedPins.before, 'Every generated template byte must restore the original historical validator')
    assert.throws(() => prepareLocalImportValidatorPin({ ...pin, historyDriverBlob: 'e'.repeat(40) }, read),
      /Current history driver source differs from product pin/)
    assert.throws(() => prepareLocalImportValidatorPin(pin, name => name === 'check-version-history-desktop.mjs' ? undefined : read(name)),
      /Current history driver source is missing/)
    assert.throws(() => prepareLocalImportValidatorPin(pin, name => read(name) + (name === 'template-installed-evidence.mjs' ? '\n// changed historical validator' : '')),
      { code: 'ERR_ASSERTION', expected: '5c676571f38982d2df6053dc8ca735f474684e9e' })
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
    assert.equal((await module('template-installed-evidence.mjs')).HISTORY_BLOB, pin.historyDriverBlob)
    assert.equal(final.script.split("history:'" + pin.historyDriverBlob + "'").length, 2)
    assert.equal(final.script.match(/await verifyReadingModeDesktop\(/g).length, 1)
    assert.match(final.script, /await verifyReadingModeDesktop\(\{evaluate,click,cdp,until,api,out,windowSession,executablePath:appExe,processID:appChild.pid,productCommit:PRODUCT_COMMIT,version:RELEASES.current.version\}\)/)
    assert.equal(final.script.match(/await verifyLocalImportRestart\(/g).length, 1)
    assert.ok(final.script.indexOf('await verifyReadingModeDesktop(') > final.script.indexOf('await verifyLocalImportRestart('))
    assert.equal(final.core.match(/'installed-app-reading-mode-workflow'/g).length, 1)
    assert.ok(final.core.includes('4.235.0')); assert.ok(final.core.includes('4.232.0'))
    for (const marker of REQUIRED_CHECKS) assert.ok(final.core.includes(marker), marker)
    assert.ok(final.core.includes(LEGACY_DEFECT.sha256))
    assert.ok(final.script.includes("assert.equal(observedDirectory,legacyTarget.split(' ')[0],'Old directory truncation was not reproduced')"))
    assert.throws(() => extendReadingModeInstallation(final, pin))
    assert.throws(() => extendReadingModeInstallation({ ...prepared, script: prepared.script.replace('await verifyLocalImportRestart(', 'await missingRestart(') }, pin))
    assert.throws(() => extendReadingModeInstallation({ ...prepared, script: prepared.script.replace('windowSession=createDesktopWindowSession();await windowSession.ready', 'windowSession=undefined') }, pin), /prewarmed native window session/)
    assert.throws(() => extendReadingModeInstallation({ ...prepared, script: prepared.script.replace("const appExe = path.join(installDir, '记事本.exe')", "const appExe = 'unowned.exe'") }, pin), /exact installed application image path/)
    writeFileSync(path.join(scripts, 'installer-lifecycle-core.mjs'), final.core)
    const finalCore = await import(pathToFileURL(path.join(scripts, 'installer-lifecycle-core.mjs')).href + '?reading-final')
    assert.equal(finalCore.REQUIRED_CHECKS.length, 26)
    assert.equal(finalCore.PRODUCT_COMMIT, pin.product)
    assert.deepEqual(finalCore.RELEASES, { previous: pin.previous, current: pin.current })
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
