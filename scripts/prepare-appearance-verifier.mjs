import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { appearanceBlob, APPEARANCE_SOURCES } from './appearance-desktop-evidence.mjs'
import { replaceExactlyAndProveInverse } from './reading-mode-installed-evidence.mjs'
export const RETAINED_DRAFT_SOURCES = Object.freeze({
  'run-draft-durability-desktop.mjs': ['ca77b90dca615335559a13c35ee065728f0c8d6d', 1],
  'draft-durability-desktop-evidence.mjs': ['30c05b158fd928fc469b37bda262fd8691f9ba0a', 1],
  'draft-durability-desktop-evidence.node.mjs': ['f2eacedc869bbd1fd9d70b06023cae2fb47613ad', 2],
})
// The original lifecycle prepares its shared core later. Freeze the reviewed
// helper bytes for the independent appearance process, never repin after mutation.
export function copyAppearanceInstallerCore(original) {
  assert.equal(appearanceBlob(original), 'e9c64b370582da9b21a8ea299ef40db01eb96b0a', 'Unreviewed installer helper')
  return original
}
export function adaptDraftVersion(file, original) {
  const spec = RETAINED_DRAFT_SOURCES[file]; assert.ok(spec, 'Unknown retained verifier')
  assert.equal(appearanceBlob(original), spec[0], 'Retained draft verifier identity changed')
  assert.equal(original.split('4.237.0').length - 1, spec[1], 'Version anchors changed')
  assert.equal(original.includes('4.238.0'), false, 'Retained template already modified')
  const next = original.replaceAll('4.237.0', '4.238.0')
  assert.equal(next.replaceAll('4.238.0', '4.237.0'), original, 'Original draft policies changed')
  return next
}
export function buildAppearanceRunner(original) {
  assert.equal(appearanceBlob(original), RETAINED_DRAFT_SOURCES['run-draft-durability-desktop.mjs'][0])
  const changes = [
    ["from './installer-lifecycle-core.mjs'", "from './appearance-installer-core.mjs'"],
    ["from './draft-durability-desktop-evidence.mjs'", "from './appearance-desktop-evidence.mjs'"],
    ['DRAFT_REPORT, DRAFT_SOURCES, draftHash, draftBlob, verifyDraftDurabilityReport', 'APPEARANCE_REPORT as DRAFT_REPORT, APPEARANCE_SOURCES as DRAFT_SOURCES, appearanceHash as draftHash, appearanceBlob as draftBlob, verifyAppearanceNativeReport as verifyDraftDurabilityReport'],
    ["import { verifyDraftDurabilityDesktop } from './draft-durability-desktop-driver.mjs'", "import { verifyAppearanceDesktop as verifyDraftDurabilityDesktop } from './appearance-desktop-driver.mjs'\nimport { createExportDirectorySession } from './local-export-directory-session.mjs'"],
    ["assert.equal(version, '4.237.0')", "assert.equal(version, '4.238.0')"],
    ["'draft104-'", "'appearance105-'"],
    ["'test-results/installer-lifecycle/draft-durability'", "'test-results/installer-lifecycle/appearance'"],
    ["module: '2F.104'", "module: '2F.105'"],
    ['pin.draftSourceFiles', 'pin.appearanceSourceFiles'],
    ['windowSession, storageProfile, installationStarted', 'windowSession, resizeSession, storageProfile, installationStarted'],
    ['  const closeNormally = async () => {', `  const resizeSmall = async () => {
    assert.equal(development, false, 'Native resize requires actual Windows')
    if (!resizeSession) { resizeSession = createExportDirectorySession({ ownedRoot: scratch }); await resizeSession.ready }
    const window = await windowIdentity()
    report.minimumWindow = await resizeSession.minimumWindow({ pid: app.pid, mainHandle: window.handle, executable })
    save()
  }
  const closeNormally = async () => {`],
    ['      start, pid: () => app.pid, crash, reinstallWithRetainedDraft, closeNormally,', '      start, pid: () => app.pid, crash, reinstallWithRetainedDraft, closeNormally, resizeSmall, ownedRoot: scratch, outputDirectory: out,'],
    ["capture('draft104-failure.png')", "capture('appearance105-failure.png')"],
    ['    if (windowSession) await windowSession.dispose()', "    if (resizeSession) await resizeSession.dispose().then(clean => { if (!clean) report.cleanupError = 'Native resize helper did not exit cleanly' }, error => { report.cleanupError = error.message })\n    if (windowSession) await windowSession.dispose()"],
    ['cases: report.cases.length', 'checks: report.checks.length'],
  ]
  return replaceExactlyAndProveInverse(original, changes)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const read = file => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(JSON.parse(read('package.json')).version, '4.238.0')
  assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad')
  assert.equal(process.env.GITHUB_REF, 'refs/heads/ci/local-installation-2f86')
  const pin = JSON.parse(read('scripts/reading-mode-installer-pin.json'))
  assert.equal(pin.currentSource.headSha, '32e3a8aa2212a95c5707797f3d3afb2b3c55b24e')
  const expected = JSON.parse(read('scripts/appearance-product-binding.json'))
  assert.equal(expected.productHead, pin.currentSource.headSha)
  for (const [file, digest] of Object.entries(expected.productionTrees)) {
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD:' + file], { cwd: root, encoding: 'utf8' }).trim(), digest, 'Product code differs: ' + file)
  }
  const out = path.join(root, 'test-results/installer-lifecycle/appearance-preparation'); mkdirSync(out, { recursive: true })
  for (const [file, digest] of Object.entries(pin.draftSourceFiles)) assert.equal(appearanceBlob(read(file)), digest, 'Retained draft source changed before adaptation: ' + file)
  const generated = []
  let template
  for (const file of Object.keys(RETAINED_DRAFT_SOURCES)) {
    const original = read('scripts/' + file), current = adaptDraftVersion(file, original)
    writeFileSync(path.join(out, file + '.before.txt'), original, { flag: 'wx' })
    writeFileSync(path.join(root, 'scripts', file), current)
    generated.push({ file, before: appearanceBlob(original), after: appearanceBlob(current), versionOnly: true, inverseBytesEqual: true })
    if (file === 'run-draft-durability-desktop.mjs') template = original
  }
  const core = copyAppearanceInstallerCore(read('scripts/installer-lifecycle-core.mjs'))
  writeFileSync(path.join(root, 'scripts/appearance-installer-core.mjs'), core, { flag: 'wx' })
  writeFileSync(path.join(out, 'appearance-installer-core.mjs'), core, { flag: 'wx' })
  const runner = buildAppearanceRunner(template)
  writeFileSync(path.join(root, 'scripts/run-appearance-desktop-generated.mjs'), runner, { flag: 'wx' })
  writeFileSync(path.join(out, 'run-appearance-desktop-generated.mjs'), runner, { flag: 'wx' })
  execFileSync(process.execPath, ['--check', path.join(root, 'scripts/run-appearance-desktop-generated.mjs')])
  for (const file of Object.keys(pin.draftSourceFiles)) pin.draftSourceFiles[file] = appearanceBlob(read(file))
  pin.appearanceSourceFiles = Object.fromEntries(APPEARANCE_SOURCES.map(file => [file, appearanceBlob(read(file))]))
  writeFileSync(path.join(root, 'scripts/reading-mode-installer-pin.json'), JSON.stringify(pin, null, 2) + '\n')
  writeFileSync(path.join(out, 'source-preparation.json'), JSON.stringify({ verifierCommit: process.env.GITHUB_SHA, product: pin.product,
    productHead: pin.currentSource.headSha, productTree: expected.productTree, productionChanged: false,
    retainedDraftAssertionsPreserved: true, generated, appearanceSources: pin.appearanceSourceFiles,
    nativeExecutionClaimedByPreparation: false }, null, 2) + '\n', { flag: 'wx' })
}
