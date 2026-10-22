import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACCEPTED_IMPORT_SEED, IMPORT_PIN_BLOBS, validateLocalImportPin,
  extendLocalImportInstallation, validateLocalImportInstallationEnvelope, validateInstalledLocalImport } from './local-import-installed-evidence.mjs'

const verifier = 'b'.repeat(40)
// Installation-envelope and extension unit fixtures only; never native proof.
function fixture() {
  const pin = { product: 'a'.repeat(40), previous: { ...ACCEPTED_IMPORT_SEED }, current: { version: '4.232.0', bytes: 100, sha256: 'c'.repeat(64) } }
  for (const key of IMPORT_PIN_BLOBS) pin[key] = 'd'.repeat(40)
  const report = { productCommit: pin.product, verifierCommit: verifier, complete: true, cleanupComplete: true,
    syntheticData: true, usedDefaultDataPath: true, forceTerminated: false, platform: 'win32', runnerEnvironment: 'github-hosted',
    installers: { current: { ...pin.current }, previous: { ...pin.previous } },
    localImportSource: { productCommit: pin.product, sha: pin.importBlob, fixture: pin.importFixtureBlob, validator: pin.importEvidenceBlob },
    checks: ['installed-app-wiki-navigation-workflow', 'installed-app-local-import-workflow'],
    appExits: Array.from({ length: 6 }, (_, i) => ({ pid: i + 100, code: 0, signal: null, nativeClose: true })),
    dataComparisons: Array.from({ length: 6 }, () => ({ equal: true, files: 4, digest: 'e'.repeat(64) })),
  }
  return { pin, report }
}
test('current import envelope binds the exact accepted previous installer', () => {
  const { pin, report } = fixture()
  assert.equal(validateLocalImportPin(pin), true)
  assert.equal(validateLocalImportInstallationEnvelope(report, pin, verifier), true)
  assert.throws(() => validateInstalledLocalImport(report, {}, pin, verifier))
})
for (const [name, mutate] of [
  ['old current', f => f.pin.current.version = '4.231.2'], ['wrong previous', f => f.pin.previous.version = '4.230.1'],
  ['seed bytes', f => f.pin.previous.bytes++], ['seed digest', f => f.pin.previous.sha256 = '0'.repeat(64)],
  ['current bytes absent', f => f.pin.current.bytes = 0], ['fractional current', f => f.pin.current.bytes = 1.5],
  ['current digest', f => f.pin.current.sha256 = 'bad'], ['product identity', f => f.pin.product = 'PENDING_PRODUCT_HEAD'],
  ...IMPORT_PIN_BLOBS.map(key => ['missing source ' + key, f => delete f.pin[key]]),
  ['foreign product', f => f.report.productCommit = verifier], ['foreign verifier', f => f.report.verifierCommit = f.pin.product],
  ['unbound native driver', f => f.report.localImportSource.sha = 'f'.repeat(40)],
  ['unbound native inputs', f => f.report.localImportSource.fixture = 'f'.repeat(40)],
  ['unbound native validator', f => f.report.localImportSource.validator = 'f'.repeat(40)],
  ...['complete', 'cleanupComplete', 'syntheticData', 'usedDefaultDataPath'].map(key => ['missing ' + key, f => f.report[key] = false]),
  ['forced application exit', f => f.report.forceTerminated = true], ['original failure', f => f.report.error = 'failed'],
  ['not Windows', f => f.report.platform = 'linux'], ['user computer', f => f.report.runnerEnvironment = 'self-hosted'],
  ['different current package', f => f.report.installers.current.bytes++], ['different upgrade seed', f => f.report.installers.previous.sha256 = '0'.repeat(64)],
  ['missing original Wiki hook', f => f.report.checks.shift()], ['missing new import hook', f => f.report.checks.pop()],
  ['duplicate import hook', f => f.report.checks.push('installed-app-local-import-workflow')],
  ['lost original native exit', f => f.report.appExits.pop()], ['forced native exit', f => f.report.appExits[3].nativeClose = false],
  ['nonzero exit', f => f.report.appExits[4].code = 1], ['signal termination', f => f.report.appExits[4].signal = 'SIGTERM'],
  ['lost data comparison', f => f.report.dataComparisons.pop()], ['modified retained data', f => f.report.dataComparisons[0].equal = false],
  ['no retained files', f => f.report.dataComparisons[0].files = 0], ['invalid retained digest', f => f.report.dataComparisons[0].digest = 'bad'],
]) test('rejects installed import ' + name, () => {
  const f = fixture(); mutate(f)
  assert.throws(() => validateLocalImportInstallationEnvelope(f.report, f.pin, verifier))
})

function inherited(pin) {
  return {
    core: `export const PRODUCT_COMMIT = '${pin.product}'\nconst checks=['installed-app-wiki-navigation-workflow','same-version-reinstall-preserves-data',]`,
    script: [
      "await verifyWikiNavigationDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})",
      "  await openNote(oldNote.id,'old-version-persisted-body');await editAndSave(oldNote.id);await capture('installed-upgrade-saved.png');const updated=(await api('/api/files/'+oldNote.id)).content",
      "  await launch(RELEASES.current.version);assert.equal((await api('/api/files/'+oldNote.id)).content,updated);await openNote(oldNote.id,'upgraded-native-save');await closeApp();mark('same-version-reinstall-preserves-data')",
      '// original module and save/quit instructions remain byte-for-byte',
    ].join('\n'),
  }
}
test('exact extension preserves prior text and places import around actual native restart', () => {
  const { pin } = fixture(), original = inherited(pin), unchanged = structuredClone(original)
  const next = extendLocalImportInstallation(original, pin)
  assert.deepEqual(original, unchanged)
  assert.ok(next.script.includes('// original module and save/quit instructions remain byte-for-byte'))
  assert.equal(next.script.match(/await verifyLocalImportDesktop\(/g).length, 1)
  assert.equal(next.script.match(/await verifyLocalImportRestart\(/g).length, 1)
  assert.equal(next.core.match(/'installed-app-local-import-workflow'/g).length, 1)
  assert.ok(next.script.indexOf('await verifyLocalImportDesktop(') < next.script.indexOf('await launch(RELEASES.current.version)'))
  assert.ok(next.script.indexOf('await launch(RELEASES.current.version)') < next.script.indexOf('await verifyLocalImportRestart('))
})
for (const [name, mutate] of [
  ['duplicate main hook', p => p.script += '\nverifyLocalImportDesktop'],
  ['duplicate restart hook', p => p.script += '\nverifyLocalImportRestart'],
  ['duplicate source record', p => p.script += '\nlocalImportSource'],
  ['duplicate lifecycle hook', p => p.core += "\n'installed-app-local-import-workflow'"],
  ['lost prior Wiki call', p => p.script = p.script.replace('verifyWikiNavigationDesktop', 'other')],
  ['lost prior Wiki check', p => p.core = p.core.replace('installed-app-wiki-navigation-workflow', 'other')],
  ['foreign base product', p => p.core = p.core.replace('a'.repeat(40), 'f'.repeat(40))],
  ['missing upgrade entry', p => p.script = p.script.replace('await editAndSave(oldNote.id)', 'changed')],
  ['missing real restart entry', p => p.script = p.script.replace('await launch(RELEASES.current.version)', 'changed')],
  ['duplicated prior entry', p => p.script += p.script],
  ['missing prior lifecycle check', p => p.core = p.core.replace('same-version-reinstall-preserves-data', 'changed')],
]) test('refuses installation extension ' + name, () => {
  const { pin } = fixture(), original = inherited(pin); mutate(original)
  assert.throws(() => extendLocalImportInstallation(original, pin))
})
