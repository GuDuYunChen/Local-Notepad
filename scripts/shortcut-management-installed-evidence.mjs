import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { prepareReadingModeVerifierSources, replaceExactlyAndProveInverse, validateReadingModePin } from './reading-mode-installed-evidence.mjs'
import { SHORTCUT_MANAGEMENT_VERSION, SHORTCUT_MANAGEMENT_REPORT, SHORTCUT_MANAGEMENT_SOURCES,
  validateShortcutManagementDesktopReport, verifyShortcutManagementDesktopReport } from './shortcut-management-desktop-evidence.mjs'

export const SHORTCUT_INSTALLATION_GATE = 'installed-app-shortcut-management-workflow'
export const SHORTCUT_INSTALLATION_SOURCES = Object.freeze({
  'check-shortcut-management-desktop.mjs': 'shortcutManagementDriverBlob',
  'run-shortcut-management-desktop.mjs': 'shortcutManagementRunnerBlob',
  'shortcut-management-desktop-evidence.mjs': 'shortcutManagementEvidenceBlob',
  'shortcut-management-desktop-fixture.mjs': 'shortcutManagementFixtureBlob',
  'desktop-save-fixture.mjs': 'shortcutManagementCanonicalFixtureBlob',
  'desktop-window-session.mjs': 'readingWindowSessionBlob',
  'desktop-window-target.mjs': 'readingWindowTargetBlob',
  'desktop-window-worker.ps1': 'readingWindowWorkerBlob',
})
assert.deepEqual(Object.keys(SHORTCUT_INSTALLATION_SOURCES), SHORTCUT_MANAGEMENT_SOURCES)
const blob = value => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0').update(value).digest('hex')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sourcesFor = pin => Object.fromEntries(Object.entries(SHORTCUT_INSTALLATION_SOURCES).map(([file, key]) => [file, pin[key]]))

export function validateShortcutManagementInstallerPin(pin) {
  validateReadingModePin(pin)
  assert.equal(pin.current.version, '4.243.0')
  for (const key of Object.values(SHORTCUT_INSTALLATION_SOURCES)) {
    assert.match(pin[key] || '', /^[a-f0-9]{40}$/, 'Unresolved shortcut source pin: ' + key)
  }
  return true
}

export function validateShortcutManagementVerifierSources(pin, readSource) {
  validateShortcutManagementInstallerPin(pin)
  for (const [file, key] of Object.entries(SHORTCUT_INSTALLATION_SOURCES)) {
    const source = readSource(file)
    assert.equal(typeof source, 'string', 'Shortcut source is missing: ' + file)
    assert.equal(blob(source.replace(/\r\n/g, '\n')), pin[key], 'Shortcut source differs from product pin: ' + file)
  }
  return true
}

// Extend the already proven reading generator. The six historical source
// hashes and every earlier inverse transformation remain strict prerequisites.
// The extra native run is appended to the real installed lifecycle; it does
// not replace any of its original six fresh-profile launches or comparisons.
export function prepareShortcutManagementVerifierSources(pin, readSource) {
  validateShortcutManagementVerifierSources(pin, readSource)
  const originals = prepareReadingModeVerifierSources(pin, readSource)
  return originals.map(item => {
    if (item.output !== 'run-reading-import-generated.mjs') return item
    const additions = [
      ["from './reading-mode-installed-evidence.mjs'", "from './reading-mode-installed-evidence.mjs'\nimport {extendShortcutManagementInstallation,verifyShortcutManagementInstalledReport,validateGeneratedShortcutManagementSources} from './shortcut-management-installed-evidence.mjs'"],
      ['validateGeneratedReadingModeSources(pin,name=>read(\'./\'+name))', 'validateGeneratedShortcutManagementSources(pin,name=>read(\'./\'+name))'],
      ['prepared=extendReadingModeInstallation(importPrepared,pin);', 'readingPrepared=extendReadingModeInstallation(importPrepared,pin),prepared=extendShortcutManagementInstallation(readingPrepared,pin);'],
      ["['./desktop-window-worker.ps1',pin.readingWindowWorkerBlob]", "['./desktop-window-worker.ps1',pin.readingWindowWorkerBlob],['./check-shortcut-management-desktop.mjs',pin.shortcutManagementDriverBlob],['./run-shortcut-management-desktop.mjs',pin.shortcutManagementRunnerBlob],['./shortcut-management-desktop-evidence.mjs',pin.shortcutManagementEvidenceBlob],['./shortcut-management-desktop-fixture.mjs',pin.shortcutManagementFixtureBlob],['./desktop-save-fixture.mjs',pin.shortcutManagementCanonicalFixtureBlob]"],
      ['reading=verifyReadingModeInstalledReport(out,pin,process.env.GITHUB_SHA)', 'reading=verifyReadingModeInstalledReport(out,pin,process.env.GITHUB_SHA),shortcutManagement=verifyShortcutManagementInstalledReport(out,report,pin,process.env.GITHUB_SHA)'],
      ['...imported.screenshots,...reading.screenshots]', '...imported.screenshots,...reading.screenshots,...shortcutManagement.screenshots]'],
      ['readingModeChecks:reading.checks,', 'shortcutManagementChecks:shortcutManagement.checks,readingModeChecks:reading.checks,'],
      ["scope:'hosted Windows current-user silent NSIS'},null,2))", "scope:'hosted Windows current-user silent NSIS'},null,2))\n  writeFileSync(path.join(out,'shortcut-management-installation-accepted.json'),JSON.stringify({complete:true,productCommit:PRODUCT,verifierCommit:process.env.GITHUB_SHA,installer:report.installers.current,originalLifecycleChecks:report.checks,originalNativeProcesses:report.appExits.map(item=>item.pid),shortcutManagementChecks:shortcutManagement.checks,shortcutNativeProcesses:shortcutManagement.launches.map(item=>item.pid),sameInstalledApplicationBytes:true,sourceFiles:shortcutManagement.sourceFiles,screenshotsVerified:true},null,2),{flag:'wx'})"],
    ]
    const pinned = replaceExactlyAndProveInverse(item.pinned, additions)
    const changes = [...item.changes, ...additions]
    assert.equal(replaceExactlyAndProveInverse(pinned, [...changes].reverse().map(([before, after]) => [after, before])), item.original)
    return { ...item, changes, pinned, readingPinned: item.pinned }
  })
}

export function validateGeneratedShortcutManagementSources(pin, readSource) {
  for (const item of prepareShortcutManagementVerifierSources(pin, readSource)) {
    const generated = readSource(item.output)
    assert.equal(typeof generated, 'string', 'Prepared shortcut verifier is missing: ' + item.output)
    assert.equal(generated.replace(/\r\n/g, '\n'), item.pinned, 'Prepared shortcut verifier was changed after source proof: ' + item.output)
  }
  return true
}

export function extendShortcutManagementInstallation(prepared, pin) {
  validateShortcutManagementInstallerPin(pin)
  assert.doesNotMatch(prepared.script, /runShortcutManagementLifecycle|shortcutManagementSource|installed-app-shortcut-management-workflow/)
  assert.doesNotMatch(prepared.core, /installed-app-shortcut-management-workflow/)
  assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
  assert.ok(prepared.core.includes("'installed-app-reading-mode-workflow'"))
  assert.equal(prepared.script.split('await verifyReadingModeDesktop(').length, 2)
  const marker = "mark('reinstall-recovers-retained-data')"
  const anchor = "  const finalData=snapshotData();await uninstall('final-uninstall');unchanged(finalData,'final-uninstall');mark('final-uninstall-preserves-data')"
  assert.equal(prepared.script.split(marker).length, 2)
  assert.ok(prepared.script.indexOf(marker) < prepared.script.indexOf(anchor), 'Shortcut run must follow the original sixth close and precede final retention snapshot')
  const originalPayload = "asarSHA256:sha(readFileSync(path.join(installDir,'resources','app.asar')))"
  const completePayload = originalPayload + ",executableSHA256:sha(readFileSync(appExe)),backendSHA256:sha(readFileSync(path.join(installDir,'resources','bin','notepad-server.exe')))"
  const addition = `  assert.equal(report.appExits.length,6,'Original six native exits must finish before shortcut restart checks')\n  const shortcutManagement=await runShortcutManagementLifecycle({executablePath:appExe,out,productCommit:PRODUCT_COMMIT,version:RELEASES.current.version,scope:'installed',ownedRoot:scratch})\n  assert.equal(report.appExits.length,6);for(const launch of shortcutManagement.launches)assert.equal(report.appExits.some(exit=>exit.pid===launch.pid),false)\n  report.shortcutManagementSource={productCommit:PRODUCT_COMMIT,sources:${JSON.stringify(sourcesFor(pin))}}\n  report.shortcutManagementRun={report:'${SHORTCUT_MANAGEMENT_REPORT}',sha256:sha(readFileSync(path.join(out,'${SHORTCUT_MANAGEMENT_REPORT}'))),application:shortcutManagement.app,processIDs:shortcutManagement.launches.map(launch=>launch.pid)};save();mark('${SHORTCUT_INSTALLATION_GATE}')\n`
  const script = "import {runShortcutManagementLifecycle} from './run-shortcut-management-desktop.mjs'\n" +
    replaceExactlyAndProveInverse(prepared.script, [[originalPayload, completePayload], [anchor, addition + anchor]])
  const check = "'reinstall-recovers-retained-data',"
  const core = replaceExactlyAndProveInverse(prepared.core, [[check, check + ` '${SHORTCUT_INSTALLATION_GATE}',`]])
  return { core, script }
}

export function validateInstalledShortcutManagement(report, shortcut, pin, verifier) {
  validateShortcutManagementInstallerPin(pin)
  validateShortcutManagementDesktopReport(shortcut, verifier, pin.product, 'installed')
  assert.equal(report.productCommit, pin.product); assert.equal(report.verifierCommit, verifier)
  for (const key of ['complete', 'cleanupComplete', 'syntheticData', 'usedDefaultDataPath']) assert.equal(report[key], true)
  assert.equal(report.forceTerminated, false); assert.equal(report.error, undefined)
  assert.equal(report.platform, 'win32'); assert.equal(report.runnerEnvironment, 'github-hosted')
  assert.deepEqual(report.installers, { current: pin.current, previous: pin.previous })
  assert.deepEqual(shortcut.sourceFiles, sourcesFor(pin))
  assert.deepEqual(report.shortcutManagementSource, { productCommit: pin.product, sources: sourcesFor(pin) })
  assert.equal(report.shortcutManagementRun.report, SHORTCUT_MANAGEMENT_REPORT)
  assert.match(report.shortcutManagementRun.sha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(report.shortcutManagementRun.application, shortcut.app)
  assert.deepEqual(report.shortcutManagementRun.processIDs, shortcut.launches.map(item => item.pid))
  assert.equal(report.appExits.length, 6); assert.equal(report.dataComparisons.length, 6)
  for (const exit of report.appExits) {
    assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(exit.nativeClose, true)
    assert.ok(Number.isSafeInteger(exit.pid) && exit.pid > 0)
    assert.equal(shortcut.launches.some(item => item.pid === exit.pid), false, 'Shortcut restart cannot reuse an original lifecycle process')
  }
  for (const comparison of report.dataComparisons) {
    assert.equal(comparison.equal, true); assert.ok(comparison.files > 0); assert.match(comparison.digest, /^[a-f0-9]{64}$/)
  }
  for (const gate of ['installed-app-reading-mode-workflow', 'installed-app-local-import-workflow',
    'reinstall-recovers-retained-data', SHORTCUT_INSTALLATION_GATE, 'final-uninstall-preserves-data']) {
    assert.equal(report.checks.filter(item => item === gate).length, 1)
  }
  assert.ok(report.checks.indexOf(SHORTCUT_INSTALLATION_GATE) > report.checks.indexOf('reinstall-recovers-retained-data'))
  assert.ok(report.checks.indexOf(SHORTCUT_INSTALLATION_GATE) < report.checks.indexOf('final-uninstall-preserves-data'))
  assert.ok(path.win32.isAbsolute(report.shortcutLaunch?.target || ''))
  assert.equal(path.win32.normalize(shortcut.app.executable).toLowerCase(), path.win32.normalize(report.shortcutLaunch.target).toLowerCase())
  const currentSnapshots = report.snapshots.filter(item => item.phase === 'installed-' + pin.current.version)
  assert.ok(currentSnapshots.length > 0, 'Actual installed current application snapshot is missing')
  for (const snapshot of currentSnapshots) {
    for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) assert.equal(snapshot[key], shortcut.app[key], 'Installed application bytes differ: ' + key)
  }
  return true
}

export function verifyShortcutManagementInstalledReport(directory, installation, pin, verifier) {
  const shortcut = verifyShortcutManagementDesktopReport(directory, verifier, pin.product, 'installed')
  validateInstalledShortcutManagement(installation, shortcut, pin, verifier)
  assert.equal(sha(readFileSync(path.join(directory, SHORTCUT_MANAGEMENT_REPORT))), installation.shortcutManagementRun.sha256,
    'Original installation report did not bind these exact shortcut report bytes')
  return shortcut
}
