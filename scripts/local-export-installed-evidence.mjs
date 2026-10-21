import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { replaceExactlyAndProveInverse } from './reading-mode-installed-evidence.mjs'
import { SHORTCUT_INSTALLATION_GATE, prepareShortcutManagementVerifierSources,
  validateShortcutManagementInstallerPin, validateInstalledShortcutManagement } from './shortcut-management-installed-evidence.mjs'
import { LOCAL_EXPORT_VERSION, LOCAL_EXPORT_REPORT, LOCAL_EXPORT_SOURCES, validateLocalExportDesktopReport,
  verifyLocalExportDesktopReport } from './local-export-desktop-evidence.mjs'

export const LOCAL_EXPORT_INSTALLATION_GATE = 'installed-app-local-export-workflow'
export const LOCAL_EXPORT_INSTALLATION_SOURCES = Object.freeze({
  'check-local-export-desktop.mjs': 'localExportDriverBlob',
  'run-local-export-desktop.mjs': 'localExportRunnerBlob',
  'local-export-desktop-evidence.mjs': 'localExportEvidenceBlob',
  'local-export-desktop-values.mjs': 'localExportValuesBlob',
  'local-export-desktop-fixture.jsx': 'localExportFixtureBlob',
  'build-local-export-fixture.mjs': 'localExportBuilderBlob',
  'local-export-directory-session.mjs': 'localExportDirectorySessionBlob',
  'local-export-directory-worker.ps1': 'localExportDirectoryWorkerBlob',
  'desktop-window-session.mjs': 'readingWindowSessionBlob',
  'desktop-window-target.mjs': 'readingWindowTargetBlob',
  'desktop-window-worker.ps1': 'readingWindowWorkerBlob',
})
assert.deepEqual(Object.keys(LOCAL_EXPORT_INSTALLATION_SOURCES), LOCAL_EXPORT_SOURCES)
const blob = value => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0').update(value).digest('hex')
const sha = value => createHash('sha256').update(value).digest('hex')
const sourcesFor = pin => Object.fromEntries(Object.entries(LOCAL_EXPORT_INSTALLATION_SOURCES).map(([file, key]) => [file, pin[key]]))

export function validateLocalExportInstallerPin(pin) {
  validateShortcutManagementInstallerPin(pin); assert.equal(pin.current.version, LOCAL_EXPORT_VERSION)
  for (const key of Object.values(LOCAL_EXPORT_INSTALLATION_SOURCES)) assert.match(pin[key] || '', /^[a-f0-9]{40}$/, 'Unresolved export source pin: ' + key)
  return true
}
export function validateLocalExportVerifierSources(pin, readSource) {
  validateLocalExportInstallerPin(pin)
  for (const [file, key] of Object.entries(LOCAL_EXPORT_INSTALLATION_SOURCES)) {
    const value = readSource(file); assert.equal(typeof value, 'string', 'Export source is missing: ' + file)
    assert.equal(blob(value.replace(/\r\n/g, '\n')), pin[key], 'Export source differs from product pin: ' + file)
  }
  return true
}

// The previous 27 installation gates and their full reversible source proof
// remain prerequisites. A ninth independent native process is appended after
// the shortcut restart and before the unchanged final retention snapshot.
export function prepareLocalExportVerifierSources(pin, readSource) {
  validateLocalExportVerifierSources(pin, readSource)
  const previous = prepareShortcutManagementVerifierSources(pin, readSource)
  return previous.map(item => {
    if (item.output !== 'run-reading-import-generated.mjs') return item
    const extraSourcePairs = Object.entries(LOCAL_EXPORT_INSTALLATION_SOURCES).filter(([file]) => !file.startsWith('desktop-window-'))
      .map(([file, key]) => "['./" + file + "',pin." + key + ']').join(',')
    const oldAccepted = "  writeFileSync(path.join(out,'shortcut-management-installation-accepted.json'),JSON.stringify({complete:true,productCommit:PRODUCT,verifierCommit:process.env.GITHUB_SHA,installer:report.installers.current,originalLifecycleChecks:report.checks,originalNativeProcesses:report.appExits.map(item=>item.pid),shortcutManagementChecks:shortcutManagement.checks,shortcutNativeProcesses:shortcutManagement.launches.map(item=>item.pid),sameInstalledApplicationBytes:true,sourceFiles:shortcutManagement.sourceFiles,screenshotsVerified:true},null,2),{flag:'wx'})"
    const additions = [
      ["from './shortcut-management-installed-evidence.mjs'", "from './shortcut-management-installed-evidence.mjs'\nimport {extendLocalExportInstallation,verifyLocalExportInstalledReport,validateGeneratedLocalExportSources} from './local-export-installed-evidence.mjs'"],
      ["validateGeneratedShortcutManagementSources(pin,name=>read('./'+name))", "validateGeneratedLocalExportSources(pin,name=>read('./'+name))"],
      ['prepared=extendShortcutManagementInstallation(readingPrepared,pin);', 'shortcutPrepared=extendShortcutManagementInstallation(readingPrepared,pin),prepared=extendLocalExportInstallation(shortcutPrepared,pin);'],
      ["['./desktop-save-fixture.mjs',pin.shortcutManagementCanonicalFixtureBlob]", "['./desktop-save-fixture.mjs',pin.shortcutManagementCanonicalFixtureBlob]," + extraSourcePairs],
      ['shortcutManagement=verifyShortcutManagementInstalledReport(out,report,pin,process.env.GITHUB_SHA)', 'shortcutManagement=verifyShortcutManagementInstalledReport(out,report,pin,process.env.GITHUB_SHA),localExport=await verifyLocalExportInstalledReport(out,report,shortcutManagement,pin,process.env.GITHUB_SHA)'],
      ['...shortcutManagement.screenshots]', '...shortcutManagement.screenshots,...localExport.screenshots]'],
      ['shortcutManagementChecks:shortcutManagement.checks,readingModeChecks:reading.checks,', 'localExportChecks:localExport.checks,shortcutManagementChecks:shortcutManagement.checks,readingModeChecks:reading.checks,'],
      [oldAccepted, oldAccepted + "\n  writeFileSync(path.join(out,'local-export-installation-accepted.json'),JSON.stringify({complete:true,productCommit:PRODUCT,verifierCommit:process.env.GITHUB_SHA,installer:report.installers.current,originalLifecycleChecks:report.checks,originalNativeProcesses:report.appExits.map(item=>item.pid),shortcutNativeProcesses:shortcutManagement.launches.map(item=>item.pid),localExportChecks:localExport.checks,exportNativeProcess:localExport.launch.pid,sameInstalledApplicationBytes:true,sourceFiles:localExport.sourceFiles,rawReportSHA256:report.localExportRun.sha256,filesVerified:localExport.files.length,screenshotsVerified:true},null,2),{flag:'wx'})"],
    ]
    const pinned = replaceExactlyAndProveInverse(item.pinned, additions), changes = [...item.changes, ...additions]
    assert.equal(replaceExactlyAndProveInverse(pinned, [...changes].reverse().map(([before, after]) => [after, before])), item.original)
    return { ...item, changes, pinned, shortcutPinned: item.pinned }
  })
}
export function validateGeneratedLocalExportSources(pin, readSource) {
  for (const item of prepareLocalExportVerifierSources(pin, readSource)) {
    const value = readSource(item.output); assert.equal(typeof value, 'string', 'Prepared export verifier is missing: ' + item.output)
    assert.equal(value.replace(/\r\n/g, '\n'), item.pinned, 'Prepared export verifier was changed after source proof: ' + item.output)
  }
  return true
}
export function extendLocalExportInstallation(prepared, pin) {
  validateLocalExportInstallerPin(pin)
  assert.doesNotMatch(prepared.script, /runLocalExportLifecycle|localExportSource|installed-app-local-export-workflow/)
  assert.doesNotMatch(prepared.core, /installed-app-local-export-workflow/)
  assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
  assert.ok(prepared.core.includes("'" + SHORTCUT_INSTALLATION_GATE + "'"))
  assert.equal(prepared.script.split('await runShortcutManagementLifecycle(').length, 2)
  const marker = "mark('" + SHORTCUT_INSTALLATION_GATE + "')"
  const anchor = "  const finalData=snapshotData();await uninstall('final-uninstall');unchanged(finalData,'final-uninstall');mark('final-uninstall-preserves-data')"
  assert.equal(prepared.script.split(marker).length, 2)
  assert.ok(prepared.script.indexOf(marker) < prepared.script.indexOf(anchor))
  const addition = `  assert.equal(report.appExits.length,6);assert.equal(report.shortcutManagementRun.processIDs.length,2)\n  const localExport=await runLocalExportLifecycle({executablePath:appExe,out,productCommit:PRODUCT_COMMIT,version:RELEASES.current.version,scope:'installed',ownedRoot:scratch})\n  assert.equal(report.appExits.length,6);assert.equal(report.appExits.some(exit=>exit.pid===localExport.launch.pid),false);assert.equal(report.shortcutManagementRun.processIDs.includes(localExport.launch.pid),false)\n  for(const key of ['executableSHA256','asarSHA256','backendSHA256'])assert.equal(localExport.app[key],report.shortcutManagementRun.application[key])\n  report.localExportSource={productCommit:PRODUCT_COMMIT,sources:${JSON.stringify(sourcesFor(pin))}}\n  report.localExportRun={report:'${LOCAL_EXPORT_REPORT}',sha256:sha(readFileSync(path.join(out,'${LOCAL_EXPORT_REPORT}'))),application:localExport.app,processID:localExport.launch.pid};save();mark('${LOCAL_EXPORT_INSTALLATION_GATE}')\n`
  const script = "import {runLocalExportLifecycle} from './run-local-export-desktop.mjs'\n" + replaceExactlyAndProveInverse(prepared.script, [[anchor, addition + anchor]])
  const check = "'" + SHORTCUT_INSTALLATION_GATE + "',"
  const core = replaceExactlyAndProveInverse(prepared.core, [[check, check + " '" + LOCAL_EXPORT_INSTALLATION_GATE + "',"]])
  return { core, script }
}
export function validateInstalledLocalExport(report, exported, shortcut, pin, verifier) {
  validateLocalExportInstallerPin(pin)
  validateInstalledShortcutManagement(report, shortcut, pin, verifier)
  validateLocalExportDesktopReport(exported, verifier, pin.product, 'installed')
  assert.deepEqual(exported.sourceFiles, sourcesFor(pin))
  assert.deepEqual(report.localExportSource, { productCommit: pin.product, sources: sourcesFor(pin) })
  assert.equal(report.localExportRun.report, LOCAL_EXPORT_REPORT); assert.match(report.localExportRun.sha256, /^[a-f0-9]{64}$/)
  assert.equal(report.localExportRun.processID, exported.launch.pid); assert.deepEqual(report.localExportRun.application, exported.app)
  assert.equal(report.appExits.some(exit => exit.pid === exported.launch.pid), false)
  assert.equal(shortcut.launches.some(launch => launch.pid === exported.launch.pid), false)
  for (const key of ['executable', 'executableSHA256', 'asarSHA256', 'backendSHA256']) assert.equal(exported.app[key], shortcut.app[key])
  assert.equal(report.checks.filter(check => check === LOCAL_EXPORT_INSTALLATION_GATE).length, 1)
  assert.ok(report.checks.indexOf(LOCAL_EXPORT_INSTALLATION_GATE) > report.checks.indexOf(SHORTCUT_INSTALLATION_GATE))
  assert.ok(report.checks.indexOf(LOCAL_EXPORT_INSTALLATION_GATE) < report.checks.indexOf('final-uninstall-preserves-data'))
  return true
}
export async function verifyLocalExportInstalledReport(directory, installation, shortcut, pin, verifier) {
  assert.equal(sha(readFileSync(path.join(directory, LOCAL_EXPORT_REPORT))), installation.localExportRun.sha256,
    'Original installation report did not bind these exact export report bytes')
  const exported = await verifyLocalExportDesktopReport(directory, verifier, pin.product, 'installed', sourcesFor(pin))
  validateInstalledLocalExport(installation, exported, shortcut, pin, verifier)
  return exported
}
