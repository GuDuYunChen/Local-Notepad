import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SHORTCUT_MANAGEMENT_VERSION = '4.238.0'
export const SHORTCUT_MANAGEMENT_STORAGE_KEY = 'local-notepad.shortcuts.v1'
export const SHORTCUT_MANAGEMENT_REPORT = 'shortcut-management-desktop.json'
export const SHORTCUT_MANAGEMENT_BINDINGS = Object.freeze({
  quickSwitch: 'Mod+K', globalSearch: 'Mod+Shift+K', shortcuts: 'Mod+/',
  focusMode: 'F11', newNote: 'Mod+N', newFolder: 'Mod+Shift+N',
  find: 'Mod+F', replace: 'Mod+H', commandPalette: 'Mod+Shift+P', outline: 'Mod+Shift+O',
  formula: 'Mod+Alt+E', checklist: 'Mod+Alt+T', copyReference: 'Mod+Alt+R',
  mergeCells: 'Mod+Alt+M', splitCell: 'Mod+Alt+S',
})
export const SHORTCUT_MANAGEMENT_SOURCES = Object.freeze([
  'check-shortcut-management-desktop.mjs', 'run-shortcut-management-desktop.mjs',
  'shortcut-management-desktop-evidence.mjs', 'shortcut-management-desktop-fixture.mjs',
  'desktop-save-fixture.mjs', 'desktop-window-session.mjs',
  'desktop-window-target.mjs', 'desktop-window-worker.ps1',
])
export const SHORTCUT_MANAGEMENT_CHECKS = Object.freeze([
  'actual-app-and-synthetic-document', 'existing-panel-entries-and-search',
  'reserved-and-conflicting-keys-refused', 'recording-isolates-background-commands',
  'cancel-does-not-apply', 'custom-binding-applied-and-persisted',
  'old-binding-inactive-new-binding-once', 'editor-and-fixed-save-preserved',
  'first-native-close', 'same-profile-new-native-process',
  'persisted-binding-restored-and-executed', 'cancelled-reset-keeps-custom-binding',
  'default-binding-restored-and-executed', 'second-native-close', 'owned-resources-cleaned',
])
export const SHORTCUT_MANAGEMENT_IMAGES = Object.freeze([
  'shortcut-management-entry.png', 'shortcut-management-conflict.png',
  'shortcut-management-applied.png', 'shortcut-management-restarted.png',
  'shortcut-management-defaults.png',
])
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sha256 = value => assert.match(value || '', /^[a-f0-9]{64}$/)
const sha1 = value => assert.match(value || '', /^[a-f0-9]{40}$/)
const object = value => assert.ok(value && typeof value === 'object' && !Array.isArray(value))
const integer = value => assert.ok(Number.isSafeInteger(value) && value > 0)

export function assertShortcutManagementConfiguration(raw, focusBinding) {
  assert.equal(typeof raw, 'string')
  assert.ok(Buffer.byteLength(raw) > 0 && Buffer.byteLength(raw) <= 16384)
  const decoded = JSON.parse(raw)
  assert.deepEqual(Object.keys(decoded).sort(), ['bindings', 'schemaVersion'])
  assert.equal(decoded.schemaVersion, 1)
  assert.deepEqual(decoded.bindings, { ...SHORTCUT_MANAGEMENT_BINDINGS, focusMode: focusBinding })
  return decoded
}

export function assertShortcutManagementRefusalVisibility(observation, kind) {
  object(observation); assert.ok(['reserved', 'conflict'].includes(kind))
  const bounds = value => {
    object(value)
    for (const key of ['left', 'top', 'right', 'bottom']) assert.ok(Number.isFinite(value[key]))
    assert.ok(value.right > value.left && value.bottom > value.top)
    return value
  }
  const within = (inner, outer) => {
    bounds(inner); bounds(outer)
    assert.ok(inner.left >= outer.left && inner.top >= outer.top &&
      inner.right <= outer.right && inner.bottom <= outer.bottom, 'Refusal content is clipped by its viewport')
  }
  const outsideFooter = rect => assert.ok(rect.right <= observation.footer.left || rect.left >= observation.footer.right ||
    rect.bottom <= observation.footer.top || rect.top >= observation.footer.bottom, 'Footer obscures refusal content')
  object(observation.viewport)
  for (const key of ['width', 'height', 'devicePixelRatio']) assert.ok(Number.isFinite(observation.viewport[key]) && observation.viewport[key] > 0)
  const viewport = { left: 0, top: 0, right: observation.viewport.width, bottom: observation.viewport.height }
  within(observation.dialog, viewport); within(observation.footer, observation.dialog)
  object(observation.scroll)
  within(observation.scroll.viewport, observation.dialog)
  const scroll = observation.scroll
  for (const key of ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight']) integer(scroll[key])
  assert.equal(scroll.viewport.right - scroll.viewport.left, scroll.clientWidth)
  assert.equal(scroll.viewport.bottom - scroll.viewport.top, scroll.clientHeight)
  for (const key of ['scrollLeft', 'scrollTop']) assert.ok(Number.isFinite(scroll[key]) && scroll[key] >= 0)
  assert.ok(scroll.scrollHeight > scroll.clientHeight, 'The actual full command list must overflow its viewport')
  assert.ok(scroll.scrollWidth >= scroll.clientWidth)
  assert.equal(observation.command, 'focusMode'); assert.equal(observation.commandCount, 15)
  assert.equal(observation.focused, true)
  within(observation.recordingPanel, scroll.viewport); outsideFooter(observation.recordingPanel)
  object(observation.nodes)
  assert.deepEqual(Object.keys(observation.nodes).sort(), ['accept', 'cancel', 'feedback', 'recorder'])
  const points = [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]]
  for (const node of Object.values(observation.nodes)) {
    object(node); assert.equal(typeof node.text, 'string'); assert.equal(typeof node.disabled, 'boolean')
    assert.equal(node.rendered, true); within(node.rect, observation.recordingPanel); outsideFooter(node.rect)
    assert.ok(Array.isArray(node.hitPoints)); assert.equal(node.hitPoints.length, points.length)
    for (const [index, [fx, fy]] of points.entries()) {
      const point = node.hitPoints[index]
      assert.equal(point.x, node.rect.left + (node.rect.right - node.rect.left) * fx)
      assert.equal(point.y, node.rect.top + (node.rect.bottom - node.rect.top) * fy)
      assert.equal(point.matched, true, 'Refusal content is occluded at an actual hit-test point')
    }
  }
  assert.ok(observation.nodes.feedback.text.includes(kind === 'reserved' ? '保存' : '快速切换笔记'))
  assert.equal(observation.nodes.cancel.text, '取消录入'); assert.equal(observation.nodes.cancel.disabled, false)
  assert.equal(observation.nodes.accept.text, kind === 'reserved' ? '使用此快捷键' : '替换冲突快捷键')
  assert.equal(observation.nodes.accept.disabled, kind === 'reserved')
  return true
}

export function validateShortcutManagementNativeAction(action, expected) {
  object(action); object(expected)
  assert.equal(action.label, expected.label)
  assert.equal(action.key.toLowerCase(), expected.key.toLowerCase())
  assert.equal(action.modifiers, expected.modifiers)
  integer(action.processID)
  assert.equal(action.beforeFocus, expected.before)
  assert.equal(action.afterFocus, expected.after)
  assert.equal(action.events.length, 2, 'A native key action must contain exactly one down/up pair')
  for (const [index, event] of action.events.entries()) {
    assert.equal(event.type, index ? 'keyup' : 'keydown')
    assert.equal(event.isTrusted, true, 'Synthetic DOM key events are not accepted')
    assert.equal(event.repeat, false)
    assert.equal(event.isComposing, false)
    assert.equal(event.key.toLowerCase(), expected.key.toLowerCase())
    assert.equal(event.ctrlKey, Boolean(expected.modifiers & 2))
    assert.equal(event.altKey, Boolean(expected.modifiers & 1))
    assert.equal(event.shiftKey, Boolean(expected.modifiers & 8))
    assert.equal(event.metaKey, Boolean(expected.modifiers & 4))
    assert.ok(Number.isFinite(event.at) && event.at >= 0)
  }
  assert.ok(action.events[1].at >= action.events[0].at)
  assert.equal(action.explicitNativeInputs, 1)
  assert.equal(action.error, undefined)
  return true
}

const focusActions = [
  ['cancel-original-on', 'F11', 0, false, true],
  ['cancel-original-off', 'F11', 0, true, false],
  ['applied-old-inactive', 'F11', 0, false, false],
  ['applied-new-on', 'j', 3, false, true],
  ['applied-new-off', 'j', 3, true, false],
  ['restart-new-on', 'j', 3, false, true],
  ['restart-new-off', 'j', 3, true, false],
  ['reset-cancel-new-on', 'j', 3, false, true],
  ['reset-cancel-new-off', 'j', 3, true, false],
  ['default-original-on', 'F11', 0, false, true],
  ['default-original-off', 'F11', 0, true, false],
  ['default-old-custom-inactive', 'j', 3, false, false],
]

export function validateShortcutManagementDesktopReport(report, commit, productCommit = commit, scope = 'packaged') {
  sha1(commit); sha1(productCommit)
  assert.equal(report.schemaVersion, 1); assert.equal(report.module, '2F.101')
  assert.equal(report.version, SHORTCUT_MANAGEMENT_VERSION)
  assert.equal(report.commit, commit); assert.equal(report.productCommit, productCommit)
  assert.equal(report.scope, scope); assert.ok(['packaged', 'installed'].includes(scope))
  assert.equal(report.platform, 'win32'); assert.equal(report.runnerEnvironment, 'github-hosted')
  for (const key of ['complete', 'syntheticData', 'cleanupComplete', 'sameProfile']) assert.equal(report[key], true, key)
  for (const key of ['bridgeOverridden', 'timerAccelerated', 'forceTerminated']) assert.equal(report[key], false, key)
  assert.equal(report.error, undefined)
  assert.deepEqual(report.checks, SHORTCUT_MANAGEMENT_CHECKS)
  assert.ok(Number.isFinite(Date.parse(report.startedAt)) && Number.isFinite(Date.parse(report.finishedAt)))
  assert.ok(Date.parse(report.finishedAt) >= Date.parse(report.startedAt))
  assert.ok(path.win32.isAbsolute(report.app?.executable || ''))
  for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) sha256(report.app[key])
  assert.deepEqual(Object.keys(report.sourceFiles).sort(), [...SHORTCUT_MANAGEMENT_SOURCES].sort())
  for (const value of Object.values(report.sourceFiles)) sha1(value)
  assert.equal(report.launches.length, 2); assert.equal(report.exits.length, 2)
  assert.notEqual(report.launches[0].pid, report.launches[1].pid, 'Reloading one renderer is not an application restart')
  const pids = report.launches.map(item => item.pid)
  assert.ok(path.win32.isAbsolute(report.profile || ''))
  for (const [index, launch] of report.launches.entries()) {
    integer(launch.pid); assert.equal(launch.profile, report.profile)
    assert.equal(launch.diagnostics.packaged, true)
    assert.equal(launch.diagnostics.version, report.version)
    assert.equal(launch.executable, report.app.executable)
    assert.ok(Number.isFinite(launch.timeOrigin) && launch.timeOrigin > 0)
    const exit = report.exits[index]
    assert.equal(exit.pid, launch.pid); assert.equal(exit.code, 0); assert.equal(exit.signal, null)
    assert.equal(exit.nativeClose, true); assert.equal(exit.backendStopped, true)
    assert.equal(exit.window.pid, launch.pid); integer(exit.window.handle)
    assert.equal(exit.window.cls, 'Chrome_WidgetWin_1'); assert.equal(exit.window.visible, true)
    assert.ok(exit.window.childText.includes('Chrome Legacy Window'))
    assert.equal(path.win32.normalize(exit.window.image).toLowerCase(), path.win32.normalize(report.app.executable).toLowerCase())
    assert.equal(exit.closeRequest.type, 'close'); assert.equal(exit.closeRequest.completed, true)
    assert.equal(exit.closeRequest.pid, launch.pid); integer(exit.closeRequest.id)
    assert.ok(Number.isFinite(exit.closeRequest.elapsedMs) && exit.closeRequest.elapsedMs >= 0)
  }
  assert.notEqual(report.launches[0].timeOrigin, report.launches[1].timeOrigin)
  assert.equal(report.windowHelper.stoppedCleanly, true)
  assert.equal(report.windowHelper.events.filter(item => item.type === 'ready').length, 1)
  assert.equal(report.windowHelper.events.filter(item => item.type === 'close' && item.completed).length, 2)
  assert.equal(report.windowHelper.events.some(item => item.type === 'failed'), false)
  assert.equal(report.storage.key, SHORTCUT_MANAGEMENT_STORAGE_KEY)
  assert.equal(report.storage.initial, null)
  assert.equal(report.storage.afterCancel, report.storage.initial)
  assertShortcutManagementConfiguration(report.storage.applied, 'Mod+Alt+J')
  assert.equal(report.storage.beforeRestart, report.storage.applied)
  assert.equal(report.storage.afterRestart, report.storage.applied)
  assert.equal(report.storage.afterResetCancel, report.storage.applied)
  assertShortcutManagementConfiguration(report.storage.defaults, 'F11')
  assert.deepEqual(report.entries, ['more', 'settings', 'help'])
  assert.equal(report.search.initialCount, 15); assert.equal(report.search.filteredCount, 1)
  assert.equal(report.search.filteredCommand, 'focusMode'); assert.equal(report.search.restoredCount, 15)
  assert.ok(report.refusals.reservedText.includes('保存'))
  assert.ok(report.refusals.conflictText.includes('快速切换笔记'))
  assert.equal(report.refusals.storageUnchanged, true)
  for (const kind of ['reserved', 'conflict']) {
    assertShortcutManagementRefusalVisibility(report.refusals[kind + 'Visibility'], kind)
    assert.equal(report.refusals[kind + 'Visibility'].nodes.feedback.text, report.refusals[kind + 'Text'].trim())
  }
  const conflictScreenshot = report.refusals.conflictScreenshot
  object(conflictScreenshot)
  assert.equal(conflictScreenshot.filename, 'shortcut-management-conflict.png')
  const conflictImage = report.screenshots.find(item => item.filename === conflictScreenshot.filename)
  object(conflictImage)
  assert.equal(conflictScreenshot.bytes, conflictImage.bytes)
  assert.equal(conflictScreenshot.sha256, conflictImage.sha256)
  assertShortcutManagementRefusalVisibility(conflictScreenshot.before, 'conflict')
  assertShortcutManagementRefusalVisibility(conflictScreenshot.after, 'conflict')
  assert.deepEqual(conflictScreenshot.before, report.refusals.conflictVisibility)
  assert.deepEqual(conflictScreenshot.after, conflictScreenshot.before)
  assert.equal(report.recording.backgroundFocusUnchanged, true)
  assert.equal(report.recording.backgroundNoteCountUnchanged, true)
  assert.equal(report.recording.bodyUnchanged, true)
  assert.equal(report.recording.writeRequests, 0)
  const labels = report.actions.map(action => action.label)
  assert.equal(new Set(labels).size, labels.length)
  for (const [label, key, modifiers, before, after] of focusActions) {
    const action = report.actions.find(item => item.label === label)
    validateShortcutManagementNativeAction(action, { label, key, modifiers, before, after })
    const restart = label.startsWith('restart-') || label.startsWith('reset-') || label.startsWith('default-')
    assert.equal(action.processID, pids[restart ? 1 : 0])
  }
  for (const [label, key, modifiers, recorder] of [
    ['record-reserved-save', 's', 2, true], ['record-conflict', 'k', 2, true],
    ['record-cancel', 'j', 3, true], ['record-apply', 'j', 3, true],
    ['isolated-alt-save', 's', 3, false], ['actual-fixed-save', 's', 2, false],
  ]) {
    const action = report.actions.find(item => item.label === label)
    validateShortcutManagementNativeAction(action, { label, key, modifiers, before: false, after: false })
    assert.equal(action.processID, pids[0])
    for (const event of action.events) assert.equal(event.recorder, recorder)
  }
  const body = report.editor
  assert.match(body.noteID || '', /^[a-zA-Z0-9-]+$/)
  assert.equal(body.shortDirtyRound?.via, 'settings-return')
  const dirtyRound = body.shortDirtyRound.savedAt - body.shortDirtyRound.editorRemountedAt
  integer(body.shortDirtyRound.editorRemountedAt); integer(body.shortDirtyRound.savedAt)
  assert.ok(dirtyRound >= 0 && dirtyRound < 30000, 'Save attribution must fit within the unchanged autosave interval')
  for (const key of ['before', 'afterAltSave', 'afterSave', 'afterRestart', 'final']) {
    assert.equal(typeof body[key]?.content, 'string'); sha256(body[key].sha256)
    assert.equal(sha(body[key].content), body[key].sha256)
    assert.ok(JSON.parse(body[key].content).root)
  }
  assert.equal(body.before.content, body.afterAltSave.content)
  assert.equal(body.altSaveWriteRequests, 0)
  assert.notEqual(body.afterSave.content, body.before.content)
  assert.ok(body.afterSave.content.includes('SHORTCUT101 real fixed save'))
  assert.equal(body.afterRestart.content, body.afterSave.content)
  assert.equal(body.final.content, body.afterSave.content)
  assert.equal(body.fixedSaveRequests.length, 1)
  const write = body.fixedSaveRequests[0]
  assert.equal(write.method, 'PUT'); assert.equal(write.status, 200)
  assert.equal(write.path, '/api/files/' + body.noteID)
  assert.equal(JSON.parse(write.postData).content, body.afterSave.content)
  assert.deepEqual(report.screenshots.map(item => item.filename), SHORTCUT_MANAGEMENT_IMAGES)
  for (const image of report.screenshots) { integer(image.bytes); sha256(image.sha256) }
  return true
}

function safeRead(directory, filename, maximum) {
  assert.equal(path.basename(filename), filename)
  const root = realpathSync(directory), file = path.join(root, filename), stat = lstatSync(file)
  assert.equal(stat.isFile(), true); assert.equal(stat.isSymbolicLink(), false)
  assert.equal(path.dirname(realpathSync(file)), root)
  assert.ok(stat.size > 0 && stat.size <= maximum)
  const bytes = readFileSync(file); assert.equal(bytes.length, stat.size)
  return bytes
}

export function verifyShortcutManagementDesktopReport(directory, commit, productCommit = commit, scope = 'packaged') {
  const report = JSON.parse(safeRead(directory, SHORTCUT_MANAGEMENT_REPORT, 4 * 1024 * 1024))
  validateShortcutManagementDesktopReport(report, commit, productCommit, scope)
  for (const image of report.screenshots) {
    const bytes = safeRead(directory, image.filename, 20 * 1024 * 1024)
    assert.equal(bytes.length, image.bytes); assert.equal(sha(bytes), image.sha256)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(bytes.subarray(12, 16).toString(), 'IHDR')
    assert.ok(bytes.readUInt32BE(16) >= 600 && bytes.readUInt32BE(20) >= 400)
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = verifyShortcutManagementDesktopReport(path.resolve('test-results/desktop-save'), process.env.GITHUB_SHA)
  console.log(JSON.stringify({ complete: report.complete, productCommit: report.productCommit,
    shortcutManagementChecks: report.checks.length, nativeProcessIDs: report.launches.map(item => item.pid),
    screenshotsVerified: report.screenshots.length }))
}
