import assert from 'node:assert/strict'
import { validateLocalImportDesktopReport } from './local-import-desktop-evidence.mjs'

export const ACCEPTED_IMPORT_SEED = Object.freeze({ version: '4.231.2', bytes: 104320482,
  sha256: '5327515821f06c1d471ed038a32e14d02a178e9eebdff7899f94f437512f8c71' })
export const IMPORT_PIN_BLOBS = Object.freeze(['quickBlob', 'tagsBlob', 'templateBlob', 'backlinksBlob',
  'searchBlob', 'outlineBlob', 'graphBlob', 'pinsBlob', 'recentBlob', 'wikiBlob',
  'importBlob', 'importFixtureBlob', 'importEvidenceBlob', 'importEvidenceTestsBlob'])
export function validateLocalImportPin(pin) {
  for (const key of ['product', ...IMPORT_PIN_BLOBS]) assert.match(pin[key], /^[a-f0-9]{40}$/)
  assert.deepEqual(pin.previous, ACCEPTED_IMPORT_SEED)
  assert.equal(pin.current.version, '4.232.0')
  assert.ok(Number.isSafeInteger(pin.current.bytes) && pin.current.bytes > 0)
  assert.match(pin.current.sha256, /^[a-f0-9]{64}$/)
  return true
}

const once = (text, before, after) => {
  assert.equal(text.split(before).length, 2, 'Original installation anchor missing or ambiguous')
  return text.replace(before, after)
}
export function extendLocalImportInstallation(prepared, pin) {
  validateLocalImportPin(pin)
  assert.doesNotMatch(prepared.script, /verifyLocalImportDesktop|verifyLocalImportRestart|localImportSource|installed-app-local-import-workflow/)
  assert.doesNotMatch(prepared.core, /installed-app-local-import-workflow/)
  assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
  assert.ok(prepared.script.includes('verifyWikiNavigationDesktop'))
  assert.ok(prepared.core.includes("'installed-app-wiki-navigation-workflow'"))
  const prefix = "import {verifyLocalImportDesktop,verifyLocalImportRestart} from './check-local-import-desktop.mjs'\n"
  const upgrade = "  await openNote(oldNote.id,'old-version-persisted-body');await editAndSave(oldNote.id);await capture('installed-upgrade-saved.png');const updated=(await api('/api/files/'+oldNote.id)).content"
  const withImport = upgrade + "\n  const localImport=await verifyLocalImportDesktop({evaluate,click,cdp,until,api,out,noteIDs:[oldNote.id],processID:appChild.pid})\n  await openNote(oldNote.id,'upgraded-native-save')"
  const restart = "  await launch(RELEASES.current.version);assert.equal((await api('/api/files/'+oldNote.id)).content,updated);await openNote(oldNote.id,'upgraded-native-save');await closeApp();mark('same-version-reinstall-preserves-data')"
  const withRestart = "  await launch(RELEASES.current.version);assert.equal((await api('/api/files/'+oldNote.id)).content,updated)\n  await verifyLocalImportRestart({evaluate,click,cdp,until,api,out,processID:appChild.pid},localImport)\n  await openNote(oldNote.id,'upgraded-native-save');await closeApp();mark('same-version-reinstall-preserves-data')" +
    `\n  report.localImportSource={productCommit:PRODUCT_COMMIT,sha:'${pin.importBlob}',fixture:'${pin.importFixtureBlob}',validator:'${pin.importEvidenceBlob}'};save();mark('installed-app-local-import-workflow')`
  const check = "'same-version-reinstall-preserves-data',"
  const extendedCheck = check + " 'installed-app-local-import-workflow',"
  const script = prefix + once(once(prepared.script, upgrade, withImport), restart, withRestart)
  const core = once(prepared.core, check, extendedCheck)
  assert.equal(once(once(script.slice(prefix.length), withRestart, restart), withImport, upgrade), prepared.script)
  assert.equal(once(core, extendedCheck, check), prepared.core)
  return { core, script }
}

export function validateLocalImportInstallationEnvelope(report, pin, verifier) {
  validateLocalImportPin(pin); assert.match(verifier, /^[a-f0-9]{40}$/)
  assert.equal(report.productCommit, pin.product); assert.equal(report.verifierCommit, verifier)
  for (const key of ['complete', 'cleanupComplete', 'syntheticData', 'usedDefaultDataPath']) assert.equal(report[key], true)
  assert.equal(report.forceTerminated, false); assert.equal(report.error, undefined)
  assert.equal(report.platform, 'win32'); assert.equal(report.runnerEnvironment, 'github-hosted')
  assert.deepEqual(report.installers, { current: pin.current, previous: pin.previous })
  assert.deepEqual(report.localImportSource, { productCommit: pin.product, sha: pin.importBlob, fixture: pin.importFixtureBlob, validator: pin.importEvidenceBlob })
  assert.equal(report.checks.filter(value => value === 'installed-app-local-import-workflow').length, 1)
  assert.equal(report.checks.filter(value => value === 'installed-app-wiki-navigation-workflow').length, 1)
  assert.equal(report.appExits.length, 6)
  for (const exit of report.appExits) { assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(exit.nativeClose, true); assert.ok(exit.pid > 0) }
  assert.equal(report.dataComparisons.length, 6)
  for (const comparison of report.dataComparisons) { assert.equal(comparison.equal, true); assert.ok(comparison.files > 0); assert.match(comparison.digest, /^[a-f0-9]{64}$/) }
  return true
}
export function validateInstalledLocalImport(report, imported, pin, verifier) {
  validateLocalImportInstallationEnvelope(report, pin, verifier)
  validateLocalImportDesktopReport(imported, verifier)
  assert.equal(imported.restart.firstPID, report.appExits[3].pid)
  assert.equal(imported.restart.secondPID, report.appExits[4].pid)
  return true
}
