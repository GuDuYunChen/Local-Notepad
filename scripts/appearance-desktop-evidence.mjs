import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
export const APPEARANCE_REPORT = 'appearance-desktop.json'
export const appearanceHash = value => createHash('sha256').update(value).digest('hex')
export const appearanceBlob = value => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0').update(value).digest('hex')
export const APPEARANCE_SOURCES = Object.freeze([
  'src/services/localAppearance.js', 'src/components/AppearanceCenter.jsx', 'src/components/AppearanceCenter.css',
  'src/components/SettingsPanel.jsx', 'src/components/ThemeToggle.jsx', 'src/services/themePreference.js', 'src/main.jsx',
  'scripts/appearance-desktop-driver.mjs', 'scripts/appearance-desktop-evidence.mjs',
  'scripts/prepare-appearance-verifier.mjs', 'scripts/run-appearance-desktop-generated.mjs',
  'scripts/appearance-installer-core.mjs', 'scripts/desktop-window-session.mjs', 'scripts/desktop-window-worker.ps1',
  'scripts/desktop-window-target.mjs', 'scripts/local-export-directory-session.mjs', 'scripts/local-export-directory-worker.ps1',
])
export const APPEARANCE_CHECKS = Object.freeze([
  'settings-entry-and-more-preserve-mode', 'invalid-color-refused', 'preview-cancel-does-not-save',
  'dirty-close-confirmation', 'apply-and-readback', 'original-dark-toggle', 'actual-file-export',
  'invalid-file-refused', 'actual-file-import-is-pending', 'delete-cancel-and-apply', 'reset-cancel-and-apply',
  'real-quota-failure-and-retry', 'external-context-invalidates-preview', 'corrupt-storage-explicit-repair',
  'minimum-native-window', 'normal-restart-restores', 'installation-retains-appearance', 'note-body-unchanged',
])
export const APPEARANCE_FEEDBACK = Object.freeze(['invalidColor','saved','importError','quotaError','externalChange','corruptStorage','minimumWindowStatus'])
export const APPEARANCE_IMAGES = Object.freeze(['appearance105-light-preview.png', 'appearance105-dark.png',
  'appearance105-quota-error.png', 'appearance105-external-change.png', 'appearance105-small.png', 'appearance105-reinstalled.png'])
export function validateAppearanceNativeReport(report, { product, verifier, sources, native = true } = {}) {
  assert.equal(native, true, 'This report cannot be accepted as simulated native evidence')
  assert.match(product || '', /^[a-f0-9]{40}$/); assert.match(verifier || '', /^[a-f0-9]{40}$/)
  assert.equal(report.schemaVersion, 1); assert.equal(report.module, '2F.105'); assert.equal(report.version, '4.238.0')
  assert.equal(report.productCommit, product); assert.equal(report.verifierCommit, verifier)
  assert.equal(report.platform, 'win32'); assert.equal(report.runnerEnvironment, 'github-hosted')
  assert.equal(report.scope, 'installed-default-profile'); assert.equal(report.defaultProfile, true)
  assert.equal(report.nativeAcceptance, true); assert.equal(report.syntheticData, true); assert.equal(report.realBackend, true)
  assert.equal(report.bridgeOverridden, false); assert.equal(report.timerAccelerated, false)
  assert.equal(report.complete, true); assert.equal(report.cleanupComplete, true); assert.equal(report.forcedFailureCleanup, false)
  assert.equal(report.error, undefined); assert.equal(report.cleanupError, undefined)
  assert.deepEqual(Object.keys(sources || {}).sort(), [...APPEARANCE_SOURCES].sort())
  for (const value of Object.values(sources)) assert.match(value, /^[a-f0-9]{40}$/)
  assert.deepEqual(report.sourceFiles, sources); assert.deepEqual(report.checks, APPEARANCE_CHECKS)
  assert.equal(report.app.packaged, true); assert.equal(report.app.version, report.version)
  for (const key of ['executableSHA256','asarSHA256','backendSHA256']) assert.match(report[key] || '', /^[a-f0-9]{64}$/)
  assert.equal(report.crashes.length, 0); assert.equal(report.launches.length, 3); assert.equal(report.exits.length, 3)
  assert.equal(new Set(report.launches.map(item => item.pid)).size, 3)
  for (const [index, launch] of report.launches.entries()) {
    assert.ok(Number.isSafeInteger(launch.pid) && launch.pid > 0)
    assert.deepEqual(report.exits[index], { pid: launch.pid, code: 0, signal: null, normal: true })
  }
  assert.deepEqual(report.exit, report.exits.at(-1)); assert.equal(report.backendStopped, true)
  assert.equal(report.storageDirectoriesRemoved, true)
  assert.deepEqual(report.installationCommands.map(item => item.operation), ['initial-install','same-version-install','uninstall','reinstall','final-uninstall'])
  for (const command of report.installationCommands) {
    assert.equal(command.code, 0); assert.equal(command.signal, null); assert.equal(command.timedOut, false)
  }
  assert.deepEqual(report.retention.map(item => item.operation), ['same-version-install','uninstall','reinstall'])
  for (const item of report.retention) { assert.equal(item.equal, true); assert.ok(item.files > 0); assert.match(item.digest, /^[a-f0-9]{64}$/) }
  assert.deepEqual(Object.keys(report.feedback || {}).sort(), [...APPEARANCE_FEEDBACK].sort())
  for (const item of Object.values(report.feedback)) {
    for (const key of ['top','bottom','left','right','areaTop','areaBottom','footerTop','viewportWidth','viewportHeight']) assert.equal(Number.isFinite(item[key]), true)
    assert.equal(item.hit, true); assert.equal(item.outsideScroll, true)
    assert.ok(item.top >= Math.max(0,item.areaTop) && item.bottom > item.top)
    assert.ok(item.bottom <= Math.min(item.viewportHeight,item.areaBottom,item.footerTop))
    assert.ok(item.left >= 0 && item.right > item.left && item.right <= item.viewportWidth)
    assert.ok(typeof item.text === 'string' && item.text.length > 0)
    assert.ok(['status','alert'].includes(item.role))
  }
  assert.equal(report.trustedMouseInput, true); assert.equal(report.trustedKeyboardInput, true)
  assert.equal(report.quota.error, 'QuotaExceededError'); assert.ok(report.quota.keys > 0)
  assert.equal(report.quota.originalConfigurationPreserved, true); assert.equal(report.quota.retryReadBack, true)
  assert.equal(report.externalChange.method, 'same-origin-frame-real-storage-event'); assert.equal(report.externalChange.previewRevoked, true)
  assert.equal(typeof report.externalChange.statusText, 'string'); assert.ok(report.externalChange.statusText.length > 0)
  assert.doesNotMatch(report.externalChange.statusText, /正在预览/)
  assert.equal(report.externalChange.footerText, '仅本机配置'); assert.equal(report.externalChange.cancelPreviewDisabled, true)
  assert.equal(report.corruption.explicitTestDataInjection, true); assert.equal(report.corruption.automaticOverwrite, false)
  assert.equal(report.corruption.explicitRepairReadBack, true)
  assert.equal(report.fileImport.method, 'DOM.setFileInputFiles-real-file'); assert.equal(report.fileImport.noWriteBeforeApply, true)
  assert.equal(report.fileExport.format, 'local-notepad-appearance'); assert.equal(report.fileExport.version, 1)
  assert.ok(report.fileExport.bytes > 0 && report.fileExport.bytes <= 16384); assert.match(report.fileExport.sha256, /^[a-f0-9]{64}$/)
  assert.equal(report.configuration.restartedRawEqual, true); assert.equal(report.configuration.reinstalledRawEqual, true)
  assert.match(report.configuration.sha256, /^[a-f0-9]{64}$/)
  assert.equal(report.note.bodyWrites, 0); assert.equal(report.note.before, report.note.after); assert.match(report.note.before, /^[a-f0-9]{64}$/)
  assert.ok(report.viewport.width > 0 && report.viewport.width <= 720); assert.ok(report.viewport.height > 0 && report.viewport.height <= 520)
  assert.equal(report.viewport.horizontalOverflow, false); assert.equal(report.viewport.footerReachable, true)
  assert.deepEqual(report.screenshots.map(item => item.filename), APPEARANCE_IMAGES)
  for (const image of report.screenshots) { assert.ok(image.bytes > 100); assert.match(image.sha256, /^[a-f0-9]{64}$/) }
  return true
}
export function verifyAppearanceNativeReport(directory, expected) {
  const report = JSON.parse(readFileSync(path.join(directory, APPEARANCE_REPORT), 'utf8'))
  validateAppearanceNativeReport(report, expected)
  for (const image of report.screenshots) {
    const bytes = readFileSync(path.join(directory, image.filename))
    assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(bytes.length, image.bytes); assert.equal(appearanceHash(bytes), image.sha256)
  }
  const exported = readFileSync(path.join(directory, 'exported-theme.json'))
  assert.equal(exported.length, report.fileExport.bytes); assert.equal(appearanceHash(exported), report.fileExport.sha256)
  const value = JSON.parse(exported); assert.equal(value.format, 'local-notepad-appearance'); assert.equal(value.version, 1)
  assert.deepEqual(Object.keys(value.scheme).sort(), ['darkAccent','lightAccent','name'])
  return report
}
