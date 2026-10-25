import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { IMPORT_PIN_BLOBS } from './local-import-installed-evidence.mjs'
import { validateReadingModeDesktopReport, verifyReadingModeDesktopReport } from './reading-mode-desktop-evidence.mjs'
export { READING_CHECKS } from './reading-mode-desktop-evidence.mjs'

export const ACCEPTED_READING_SEED = Object.freeze({ version: '4.232.0', bytes: 104335117,
  sha256: 'd3a152a1e4c36eba88513cc8748cee81eb68178470cf209bb21aa98de6fd7754' })
export const ACCEPTED_READING_SEED_SOURCE = Object.freeze({ run: 40184977753, artifact: 12596021406,
  name: 'local-notepad-historical-4.232.0-seed', productSourceCommit: '1a8e17ba775312c359f4ac23851c8c365b57a9cb' })
export const READING_SOURCE_KEYS = Object.freeze([...IMPORT_PIN_BLOBS,
  'readingDriverBlob', 'readingFixtureBlob', 'readingEvidenceBlob', 'readingBuilderBlob', 'readingInputBlob',
  'readingWindowSessionBlob', 'readingWindowTargetBlob', 'readingWindowWorkerBlob', 'historyDriverBlob'])
const gitBlob = source => createHash('sha1').update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex')

export function validateReadingModePin(pin) {
  assert.ok(pin && typeof pin === 'object', 'Reading-mode installer pin is missing')
  for (const key of ['product', ...READING_SOURCE_KEYS]) assert.match(pin[key] || '', /^[a-f0-9]{40}$/, 'Unresolved or invalid pin: ' + key)
  assert.deepEqual(pin.previous, ACCEPTED_READING_SEED)
  assert.deepEqual(pin.previousSource, ACCEPTED_READING_SEED_SOURCE)
  assert.equal(pin.current?.version, '4.235.0')
  assert.ok(Number.isSafeInteger(pin.current.bytes) && pin.current.bytes > 0, 'Current installer bytes are unresolved')
  assert.match(pin.current.sha256 || '', /^[a-f0-9]{64}$/, 'Current installer digest is unresolved')
  for (const key of ['run', 'artifact']) assert.ok(Number.isSafeInteger(pin.currentSource?.[key]) && pin.currentSource[key] > 0, 'Current artifact identity is unresolved: ' + key)
  assert.equal(pin.currentSource.name, 'local-notepad-windows-' + pin.product)
  return true
}

export function validateReadingModeHistorySource(pin, readSource) {
  validateReadingModePin(pin)
  const source = readSource('check-version-history-desktop.mjs')
  assert.equal(typeof source, 'string', 'Current history driver source is missing')
  assert.equal(gitBlob(source.replace(/\r\n/g, '\n')), pin.historyDriverBlob,
    'Current history driver source differs from product pin')
  return true
}

export function replaceExactlyAndProveInverse(original, changes) {
  let pinned = original
  for (const [before, after] of changes) {
    assert.notEqual(before, after)
    assert.equal(pinned.split(before).length, 2, 'Original verifier anchor missing or ambiguous: ' + before)
    pinned = pinned.replace(before, after)
  }
  let inverse = pinned
  for (const [before, after] of [...changes].reverse()) {
    assert.equal(inverse.split(after).length, 2, 'Generated verifier anchor missing or ambiguous: ' + after)
    inverse = inverse.replace(after, before)
  }
  assert.equal(inverse, original, 'Original verifier policy was changed')
  return pinned
}

// Historical templates retain their exact identities. The three shared import
// sources may also come from the product checkout, but only their pinned version
// change can be reversed to those same templates before generating the copies.
// Generated checks never manufacture successful native reports.
export function prepareReadingModeVerifierSources(pin, readSource) {
  validateReadingModeHistorySource(pin, readSource)
  const sourceHashes = new Map()
  const specs = [
    { source: 'local-import-installed-evidence.mjs', output: 'reading-import-validator.mjs', hash: 'b70f45bceea1b299d18beefd5b985851cf753f9e', changes: [
      ["version: '4.231.2', bytes: 104320482", "version: '4.232.0', bytes: 104335117"],
      ["sha256: '5327515821f06c1d471ed038a32e14d02a178e9eebdff7899f94f437512f8c71'", "sha256: 'd3a152a1e4c36eba88513cc8748cee81eb68178470cf209bb21aa98de6fd7754'"],
      ["assert.equal(pin.current.version, '4.232.0')", "assert.equal(pin.current.version, '4.235.0')"],
      ["from './local-import-desktop-evidence.mjs'", "from './reading-import-desktop-validator.mjs'"],
      ["from './check-local-import-desktop.mjs'", "from './reading-import-desktop-driver.mjs'"],
    ] },
    { source: 'local-import-desktop-evidence.mjs', output: 'reading-import-desktop-validator.mjs', hash: '6fc3c3d069384fc2bd7c671987ace423d004ddf8', productPin: 'importEvidenceBlob', changes: [
      ["assert.equal(report.appVersion, '4.232.0')", "assert.equal(report.appVersion, '4.235.0')"],
    ] },
    { source: 'check-local-import-desktop.mjs', output: 'reading-import-desktop-driver.mjs', hash: '6f0bfd54c7b7e1ea673e80b55a91be82244dfcef', productPin: 'importBlob', changes: [
      ["assert.equal(diagnostics.version, '4.232.0')", "assert.equal(diagnostics.version, '4.235.0')"],
      ["from './local-import-desktop-evidence.mjs'", "from './reading-import-desktop-validator.mjs'"],
    ] },
    { source: 'local-import-desktop-evidence.node.mjs', output: 'reading-import-desktop-validator.node.mjs', hash: '12cc53ff2ff11d2aa8d6508feadd2a4734077bb3', productPin: 'importEvidenceTestsBlob', changes: [
      ["appVersion: '4.232.0'", "appVersion: '4.235.0'"],
      ["from './local-import-desktop-evidence.mjs'", "from './reading-import-desktop-validator.mjs'"],
    ] },
    { source: 'pin-local-import-installer.mjs', output: 'pin-reading-import-generated.mjs', hash: 'ef3ce5e4e2f0b4952107bfae81d556fd0c7fc036', changes: [
      ["from './local-import-installed-evidence.mjs'", "from './reading-import-validator.mjs'\nimport {validateReadingModeHistorySource} from './reading-mode-installed-evidence.mjs'"],
      ["'./local-import-installer-pin.json'", "'./reading-mode-installer-pin.json'"],
      ["export function prepareLocalImportValidatorPin(pin,readSource){\nvalidateLocalImportPin(pin)", "export function prepareLocalImportValidatorPin(pin,readSource){\nvalidateLocalImportPin(pin)\nvalidateReadingModeHistorySource(pin,readSource)"],
      ["const changes=[\n", "const changes=[\n [\"export const HISTORY_BLOB='c9800f23c9f924d31edb1c7f7c7c4e1a1cf851a6'\",`export const HISTORY_BLOB='${pin.historyDriverBlob}'`],\n"],
    ] },
    { source: 'run-local-import-installer.mjs', output: 'run-reading-import-generated.mjs', hash: 'fdc405510b5078ecdfbe47058558b23588b67412', changes: () => [
      ["from './local-import-installed-evidence.mjs'", "from './reading-import-validator.mjs'\nimport {extendReadingModeInstallation,validateInstalledReadingMode,verifyReadingModeInstalledReport,validateGeneratedReadingModeSources} from './reading-mode-installed-evidence.mjs'"],
      ["from './local-import-desktop-evidence.mjs'", "from './reading-import-desktop-validator.mjs'"],
      ["'./local-import-installer-pin.json'", "'./reading-mode-installer-pin.json'"],
      ["'./check-windows-installer-lifecycle.local-import.mjs'", "'./check-windows-installer-lifecycle.reading-mode.mjs'"],
      ['assert.equal(TEMPLATE_BLOB,pin.templateBlob)', 'assert.equal(TEMPLATE_BLOB,pin.templateBlob);assert.equal(HISTORY_BLOB,pin.historyDriverBlob)'],
      ["['./check-version-history-desktop.mjs',HISTORY_BLOB]", "['./check-version-history-desktop.mjs',pin.historyDriverBlob]"],
      ["['./check-local-import-desktop.mjs',pin.importBlob]", `['./check-local-import-desktop.mjs','${sourceHashes.get('check-local-import-desktop.mjs')}']`],
      ["['./local-import-desktop-evidence.mjs',pin.importEvidenceBlob]", `['./local-import-desktop-evidence.mjs','${sourceHashes.get('local-import-desktop-evidence.mjs')}']`],
      ["['./local-import-desktop-evidence.node.mjs',pin.importEvidenceTestsBlob]", `['./local-import-desktop-evidence.node.mjs','${sourceHashes.get('local-import-desktop-evidence.node.mjs')}']`],
      [`['./local-import-desktop-evidence.node.mjs','${sourceHashes.get('local-import-desktop-evidence.node.mjs')}']`, `['./local-import-desktop-evidence.node.mjs','${sourceHashes.get('local-import-desktop-evidence.node.mjs')}'],['./check-reading-mode-desktop.mjs',pin.readingDriverBlob],['./reading-mode-desktop-fixture.jsx',pin.readingFixtureBlob],['./reading-mode-desktop-evidence.mjs',pin.readingEvidenceBlob],['./build-reading-mode-fixture.mjs',pin.readingBuilderBlob],['./reading-mode-native-input.mjs',pin.readingInputBlob],['./desktop-window-session.mjs',pin.readingWindowSessionBlob],['./desktop-window-target.mjs',pin.readingWindowTargetBlob],['./desktop-window-worker.ps1',pin.readingWindowWorkerBlob]`],
      ["const preparedFile=new URL(", "validateGeneratedReadingModeSources(pin,name=>read('./'+name))\nconst preparedFile=new URL("],
      ['prepared=extendLocalImportInstallation(wikiPrepared,pin);', 'importPrepared=extendLocalImportInstallation(wikiPrepared,pin),prepared=extendReadingModeInstallation(importPrepared,pin);'],
      ["imported=verifyLocalImportDesktopReport(out,process.env.GITHUB_SHA)", "imported=verifyLocalImportDesktopReport(out,process.env.GITHUB_SHA),reading=verifyReadingModeInstalledReport(out,pin,process.env.GITHUB_SHA)"],
      ['validateInstalledLocalImport(report,imported,pin,process.env.GITHUB_SHA);', 'validateInstalledLocalImport(report,imported,pin,process.env.GITHUB_SHA);validateInstalledReadingMode(report,reading,pin,process.env.GITHUB_SHA);'],
      ['...wiki.screenshots,...imported.screenshots]', '...wiki.screenshots,...imported.screenshots,...reading.screenshots]'],
      ["'local-import-installation-accepted.json'", "'reading-mode-installation-accepted.json'"],
      ['localImportChecks:imported.checks,', 'readingModeChecks:reading.checks,localImportChecks:imported.checks,'],
    ] },
  ]
  return specs.map(spec => {
    const supplied = readSource(spec.source)
    assert.equal(typeof supplied, 'string', 'Original verifier source is missing: ' + spec.source)
    const normalized = supplied.replace(/\r\n/g, '\n'), sourceHash = gitBlob(normalized)
    const changes = typeof spec.changes === 'function' ? spec.changes() : spec.changes
    let original = normalized
    if (spec.productPin && sourceHash !== spec.hash) {
      assert.equal(sourceHash, pin[spec.productPin], 'Current import source differs from product pin: ' + spec.productPin)
      const [before, after] = changes[0]
      original = replaceExactlyAndProveInverse(normalized, [[after, before]])
    }
    assert.equal(gitBlob(original), spec.hash, 'Original verifier source identity changed: ' + spec.source)
    const productSource = spec.productPin ? replaceExactlyAndProveInverse(original, [changes[0]]) : null
    if (spec.productPin) assert.equal(gitBlob(productSource), pin[spec.productPin], 'Generated version-only copy does not match target product source: ' + spec.productPin)
    sourceHashes.set(spec.source, sourceHash)
    return { ...spec, changes, original, productSource, sourceHash, pinned: replaceExactlyAndProveInverse(original, changes) }
  })
}

export function validateGeneratedReadingModeSources(pin, readSource) {
  for (const spec of prepareReadingModeVerifierSources(pin, readSource)) {
    const prepared = readSource(spec.output)
    assert.equal(typeof prepared, 'string', 'Prepared verifier source is missing: ' + spec.output)
    assert.equal(prepared.replace(/\r\n/g, '\n'), spec.pinned, 'Prepared verifier was changed after source proof: ' + spec.output)
  }
  return true
}

export function extendReadingModeInstallation(prepared, pin) {
  validateReadingModePin(pin)
  assert.doesNotMatch(prepared.script, /verifyReadingModeDesktop|readingModeSource|installed-app-reading-mode-workflow/)
  assert.doesNotMatch(prepared.core, /installed-app-reading-mode-workflow/)
  assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
  assert.ok(prepared.core.includes("'installed-app-local-import-workflow'"))
  assert.equal(prepared.script.split('windowSession=createDesktopWindowSession();await windowSession.ready').length, 2,
    'Reading quit checks require the existing, prewarmed native window session')
  assert.equal(prepared.script.split("const appExe = path.join(installDir, '记事本.exe')").length, 2,
    'Reading quit checks require the exact installed application image path')
  const anchor = '  await verifyLocalImportRestart({evaluate,click,cdp,until,api,out,processID:appChild.pid},localImport)'
  const addition = anchor + `\n  await verifyReadingModeDesktop({evaluate,click,cdp,until,api,out,windowSession,executablePath:appExe,processID:appChild.pid,productCommit:PRODUCT_COMMIT,version:RELEASES.current.version})\n  report.readingModeSource={productCommit:PRODUCT_COMMIT,driver:'${pin.readingDriverBlob}',fixture:'${pin.readingFixtureBlob}',validator:'${pin.readingEvidenceBlob}',builder:'${pin.readingBuilderBlob}',nativeInput:'${pin.readingInputBlob}',windowSession:'${pin.readingWindowSessionBlob}',windowTarget:'${pin.readingWindowTargetBlob}',windowWorker:'${pin.readingWindowWorkerBlob}'};save()`
  const marker = "mark('installed-app-local-import-workflow')"
  const check = "'installed-app-local-import-workflow',"
  const script = "import {verifyReadingModeDesktop} from './check-reading-mode-desktop.mjs'\n" +
    replaceExactlyAndProveInverse(prepared.script, [[anchor, addition], [marker, marker + ";mark('installed-app-reading-mode-workflow')"]])
  const core = replaceExactlyAndProveInverse(prepared.core, [[check, check + " 'installed-app-reading-mode-workflow',"]])
  return { core, script }
}

export function validateReadingModeInstalledReport(reading, pin, verifier) {
  validateReadingModePin(pin)
  validateReadingModeDesktopReport(reading, verifier, pin.product)
  assert.equal(reading.version, pin.current.version)
  return true
}

export function validateInstalledReadingMode(report, reading, pin, verifier) {
  validateReadingModeInstalledReport(reading, pin, verifier)
  assert.equal(report.productCommit, pin.product); assert.equal(report.verifierCommit, verifier)
  assert.equal(report.moduleSources?.history, pin.historyDriverBlob, 'Installed history source differs from product pin')
  for (const key of ['complete', 'cleanupComplete', 'syntheticData', 'usedDefaultDataPath']) assert.equal(report[key], true)
  assert.equal(report.forceTerminated, false); assert.equal(report.error, undefined)
  assert.equal(report.platform, 'win32'); assert.equal(report.runnerEnvironment, 'github-hosted')
  assert.deepEqual(report.installers, { current: pin.current, previous: pin.previous })
  assert.deepEqual(report.readingModeSource, { productCommit: pin.product, driver: pin.readingDriverBlob,
    fixture: pin.readingFixtureBlob, validator: pin.readingEvidenceBlob, builder: pin.readingBuilderBlob, nativeInput: pin.readingInputBlob,
    windowSession: pin.readingWindowSessionBlob, windowTarget: pin.readingWindowTargetBlob, windowWorker: pin.readingWindowWorkerBlob })
  for (const name of ['installed-app-reading-mode-workflow', 'installed-app-local-import-workflow', 'installed-app-wiki-navigation-workflow']) assert.equal(report.checks.filter(check => check === name).length, 1)
  assert.equal(report.appExits.length, 6); assert.equal(report.dataComparisons.length, 6)
  for (const exit of report.appExits) { assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(exit.nativeClose, true); assert.ok(exit.pid > 0) }
  for (const comparison of report.dataComparisons) { assert.equal(comparison.equal, true); assert.ok(comparison.files > 0); assert.match(comparison.digest, /^[a-f0-9]{64}$/) }
  assert.equal(reading.processID, report.appExits[4].pid)
  assert.ok(path.win32.isAbsolute(report.shortcutLaunch?.target || ''), 'Installed shortcut image is missing')
  assert.equal(path.win32.normalize(reading.pendingDrafts.quit.executablePath).toLowerCase(),
    path.win32.normalize(report.shortcutLaunch.target).toLowerCase(), 'Reading quit workflow used another installed image')
  return true
}

export function verifyReadingModeInstalledReport(directory, pin, verifier) {
  const reading = verifyReadingModeDesktopReport(directory, verifier, pin.product)
  validateReadingModeInstalledReport(reading, pin, verifier)
  return reading
}
