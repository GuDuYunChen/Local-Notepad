import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { SHORTCUT_MANAGEMENT_VERSION, SHORTCUT_MANAGEMENT_REPORT, SHORTCUT_MANAGEMENT_STORAGE_KEY,
  SHORTCUT_MANAGEMENT_BINDINGS, SHORTCUT_MANAGEMENT_SOURCES, SHORTCUT_MANAGEMENT_CHECKS,
  SHORTCUT_MANAGEMENT_IMAGES, assertShortcutManagementConfiguration,
  validateShortcutManagementNativeAction, validateShortcutManagementDesktopReport,
  verifyShortcutManagementDesktopReport } from './shortcut-management-desktop-evidence.mjs'
import { shortcutManagementNote } from './shortcut-management-desktop-fixture.mjs'

const HEAD = '1'.repeat(40), sha = value => createHash('sha256').update(value).digest('hex')
const configuration = focusMode => JSON.stringify({ schemaVersion: 1, bindings: { ...SHORTCUT_MANAGEMENT_BINDINGS, focusMode } })
const body = saved => { const content = shortcutManagementNote(saved); return { content, sha256: sha(content) } }
const action = (label, key, modifiers, beforeFocus, afterFocus, processID = 1001, recorder = false) => ({
  label, key, modifiers, beforeFocus, afterFocus, processID, explicitNativeInputs: 1,
  events: ['keydown', 'keyup'].map((type, index) => ({ type, key, isTrusted: true, repeat: false,
    isComposing: false, ctrlKey: Boolean(modifiers & 2), altKey: Boolean(modifiers & 1),
    shiftKey: Boolean(modifiers & 8), metaKey: Boolean(modifiers & 4), at: index + 1, recorder })),
})

// Deliberately synthetic validator input. It is never a Windows report or
// emitted to the product artifact directories; mutations prove refusals only.
function fixture() {
  const app = { executable: 'D:\\owned\\记事本.exe', executableSHA256: 'a'.repeat(64), asarSHA256: 'b'.repeat(64), backendSHA256: 'c'.repeat(64) }
  const profile = 'D:\\owned\\profile'
  const launches = [1001, 1002].map((pid, index) => ({ pid, profile, executable: app.executable,
    diagnostics: { packaged: true, version: SHORTCUT_MANAGEMENT_VERSION }, timeOrigin: index + 100 }))
  const exits = launches.map((launch, index) => ({ pid: launch.pid, code: 0, signal: null, nativeClose: true,
    backendStopped: true, window: { pid: launch.pid, handle: index + 10, cls: 'Chrome_WidgetWin_1',
      visible: true, childText: ['Chrome Legacy Window'], image: app.executable },
    closeRequest: { type: 'close', completed: true, pid: launch.pid, id: index + 1, elapsedMs: 10 } }))
  const actions = [
    action('cancel-original-on', 'F11', 0, false, true), action('cancel-original-off', 'F11', 0, true, false),
    action('applied-old-inactive', 'F11', 0, false, false), action('applied-new-on', 'j', 3, false, true),
    action('applied-new-off', 'j', 3, true, false),
    action('restart-new-on', 'j', 3, false, true, 1002), action('restart-new-off', 'j', 3, true, false, 1002),
    action('reset-cancel-new-on', 'j', 3, false, true, 1002), action('reset-cancel-new-off', 'j', 3, true, false, 1002),
    action('default-original-on', 'F11', 0, false, true, 1002), action('default-original-off', 'F11', 0, true, false, 1002),
    action('default-old-custom-inactive', 'j', 3, false, false, 1002),
    action('record-reserved-save', 's', 2, false, false, 1001, true),
    action('record-conflict', 'k', 2, false, false, 1001, true),
    action('record-cancel', 'j', 3, false, false, 1001, true), action('record-apply', 'j', 3, false, false, 1001, true),
    action('isolated-alt-save', 's', 3, false, false), action('actual-fixed-save', 's', 2, false, false),
  ]
  return { schemaVersion: 1, module: '2F.101', version: SHORTCUT_MANAGEMENT_VERSION,
    commit: HEAD, productCommit: HEAD, scope: 'packaged', platform: 'win32', runnerEnvironment: 'github-hosted',
    complete: true, syntheticData: true, cleanupComplete: true, sameProfile: true,
    bridgeOverridden: false, timerAccelerated: false, forceTerminated: false,
    startedAt: '2026-10-20T12:00:00Z', finishedAt: '2026-10-20T12:01:00Z',
    checks: [...SHORTCUT_MANAGEMENT_CHECKS], profile, app,
    sourceFiles: Object.fromEntries(SHORTCUT_MANAGEMENT_SOURCES.map(name => [name, 'd'.repeat(40)])),
    launches, exits, windowHelper: { stoppedCleanly: true,
      events: [{ type: 'ready' }, ...exits.map(exit => exit.closeRequest)] },
    storage: { key: SHORTCUT_MANAGEMENT_STORAGE_KEY, initial: null, afterCancel: null,
      applied: configuration('Mod+Alt+J'), beforeRestart: configuration('Mod+Alt+J'),
      afterRestart: configuration('Mod+Alt+J'), afterResetCancel: configuration('Mod+Alt+J'), defaults: configuration('F11') },
    entries: ['more', 'settings', 'help'], search: { initialCount: 15, filteredCount: 1, filteredCommand: 'focusMode', restoredCount: 15 },
    refusals: { reservedText: '该快捷键用于保存笔记', conflictText: '该快捷键用于快速切换笔记', storageUnchanged: true },
    recording: { backgroundFocusUnchanged: true, backgroundNoteCountUnchanged: true, bodyUnchanged: true, writeRequests: 0 },
    actions, editor: { noteID: 'synthetic-shortcut-101', before: body(false), afterAltSave: body(false),
      shortDirtyRound: { via: 'settings-return', editorRemountedAt: 100000, savedAt: 101000 },
      afterSave: body(true), afterRestart: body(true), final: body(true), altSaveWriteRequests: 0,
      fixedSaveRequests: [{ method: 'PUT', path: '/api/files/synthetic-shortcut-101',
        status: 200, postData: JSON.stringify({ content: body(true).content }) }] },
    screenshots: SHORTCUT_MANAGEMENT_IMAGES.map(filename => ({ filename, bytes: 100, sha256: 'e'.repeat(64) })),
  }
}

test('complete synthetic shortcut evidence satisfies the structural oracle only', () => {
  assert.equal(validateShortcutManagementDesktopReport(fixture(), HEAD), true)
})

for (const [name, mutate] of [
  ['incomplete workflow', r => { r.complete = false }],
  ['missing workflow gate', r => r.checks.pop()],
  ['reordered workflow gate', r => r.checks.reverse()],
  ['wrong product source', r => { r.productCommit = '2'.repeat(40) }],
  ['wrong verifier source', r => { r.commit = '2'.repeat(40) }],
  ['old application version', r => { r.version = '4.233.2' }],
  ['development renderer', r => { r.launches[0].diagnostics.packaged = false }],
  ['one process reload masquerading as restart', r => { r.launches[1].pid = r.launches[0].pid }],
  ['different restart profile', r => { r.launches[1].profile += '-fresh' }],
  ['missing cleanup', r => { r.cleanupComplete = false }],
  ['forced process close', r => { r.forceTerminated = true }],
  ['missing actual native close', r => { r.exits[0].nativeClose = false }],
  ['close wrong executable', r => { r.exits[0].window.image = 'D:\\another\\记事本.exe' }],
  ['missing close acknowledgement', r => { r.exits[0].closeRequest.completed = false }],
  ['backend not stopped', r => { r.exits[0].backendStopped = false }],
  ['failed helper', r => r.windowHelper.events.push({ type: 'failed' })],
  ['no persistence after restart', r => { r.storage.afterRestart = null }],
  ['cancel persisted candidate', r => { r.storage.afterCancel = r.storage.applied }],
  ['cancel reset applied defaults', r => { r.storage.afterResetCancel = r.storage.defaults }],
  ['reset did not restore default', r => { r.storage.defaults = r.storage.applied }],
  ['omitted command in stored map', r => { const v = JSON.parse(r.storage.applied); delete v.bindings.outline; r.storage.applied = JSON.stringify(v) }],
  ['another command silently changed', r => { const v = JSON.parse(r.storage.applied); v.bindings.formula = null; r.storage.applied = JSON.stringify(v) }],
  ['missing actual new key toggle', r => { r.actions.find(a => a.label === 'applied-new-on').afterFocus = false }],
  ['old binding still active', r => { r.actions.find(a => a.label === 'applied-old-inactive').afterFocus = true }],
  ['native input replayed', r => { r.actions[0].explicitNativeInputs = 2 }],
  ['synthetic key event', r => { r.actions[0].events[0].isTrusted = false }],
  ['extra keydown', r => r.actions[0].events.unshift({ ...r.actions[0].events[0] })],
  ['wrong modifier', r => { r.actions[0].events[0].altKey = true }],
  ['repeated long press', r => { r.actions[0].events[0].repeat = true }],
  ['recording not focused', r => { r.actions.find(a => a.label === 'record-apply').events[0].recorder = false }],
  ['recording changed body', r => { r.recording.bodyUnchanged = false }],
  ['recording sent a write', r => { r.recording.writeRequests = 1 }],
  ['Alt+save collision', r => { r.editor.altSaveWriteRequests = 1 }],
  ['save observation overlaps autosave interval', r => { r.editor.shortDirtyRound.savedAt += 30000 }],
  ['save observation lacks real editor remount', r => { r.editor.shortDirtyRound.via = 'timer-overridden' }],
  ['body not persisted', r => { r.editor.afterSave = r.editor.before }],
  ['stale restart body', r => { r.editor.afterRestart = r.editor.before }],
  ['incorrect save body hash', r => { r.editor.afterSave.sha256 = 'f'.repeat(64) }],
  ['missing real save response', r => { r.editor.fixedSaveRequests[0].status = null }],
  ['duplicate save request', r => r.editor.fixedSaveRequests.push({ ...r.editor.fixedSaveRequests[0] })],
  ['wrong actual submitted body', r => { r.editor.fixedSaveRequests[0].postData = JSON.stringify({ content: r.editor.before.content }) }],
  ['missing source pin', r => { delete r.sourceFiles['run-shortcut-management-desktop.mjs'] }],
  ['missing screenshot', r => r.screenshots.pop()],
]) test('shortcut evidence refuses ' + name, () => {
  const report = fixture(); mutate(report)
  assert.throws(() => validateShortcutManagementDesktopReport(report, HEAD))
})

for (const label of ['record-reserved-save', 'record-conflict', 'record-cancel', 'record-apply', 'isolated-alt-save', 'actual-fixed-save']) {
  test('shortcut evidence binds exact native input for ' + label, () => {
    for (const [name, mutate] of [
      ['missing action', r => { r.actions = r.actions.filter(item => item.label !== label) }],
      ['wrong reported key', a => { a.key = 'q' }],
      ['wrong actual key', a => { a.events[0].key = 'q' }],
      ['wrong reported modifier', a => { a.modifiers ^= 8 }],
      ['wrong actual modifier', a => { a.events[0].shiftKey = !a.events[0].shiftKey }],
      ['wrong native process', a => { a.processID = 1002 }],
      ['reversed down/up', a => { a.events.reverse() }],
      ['long-press repeat', a => { a.events[0].repeat = true }],
      ['IME composition', a => { a.events[0].isComposing = true }],
      ['wrong recorder context', a => { a.events[0].recorder = !a.events[0].recorder }],
      ['native replay', a => { a.explicitNativeInputs = 2 }],
      ['untrusted DOM input', a => { a.events[0].isTrusted = false }],
      ['uncertain input failure', a => { a.error = 'native input command failed' }],
    ]) {
      const report = fixture(), selected = report.actions.find(item => item.label === label)
      mutate(name === 'missing action' ? report : selected)
      assert.throws(() => validateShortcutManagementDesktopReport(report, HEAD), undefined, label + ': ' + name)
    }
  })
}

test('installed evidence requires separate verifier and exact product identity', () => {
  const report = fixture(); report.scope = 'installed'; report.productCommit = '3'.repeat(40)
  assert.equal(validateShortcutManagementDesktopReport(report, HEAD, report.productCommit, 'installed'), true)
  assert.throws(() => validateShortcutManagementDesktopReport(report, HEAD))
})

test('saved configuration cannot use another version or extra top-level fields', () => {
  const stored = JSON.parse(configuration('Mod+Alt+J'))
  assert.throws(() => assertShortcutManagementConfiguration(JSON.stringify({ ...stored, schemaVersion: 2 }), 'Mod+Alt+J'))
  assert.throws(() => assertShortcutManagementConfiguration(JSON.stringify({ ...stored, extra: true }), 'Mod+Alt+J'))
})

test('native event validator rejects reversed event order and timestamps', () => {
  const expected = { label: 'toggle', key: 'j', modifiers: 3, before: false, after: true }
  const a = action('toggle', 'j', 3, false, true)
  assert.equal(validateShortcutManagementNativeAction(a, expected), true)
  a.events.reverse(); assert.throws(() => validateShortcutManagementNativeAction(a, expected))
  a.events.reverse(); a.events[1].at = 0; assert.throws(() => validateShortcutManagementNativeAction(a, expected))
})

// A small valid PNG generated only for byte/path verifier tests, not UI evidence.
function testPNG() {
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0) } return (c ^ 0xffffffff) >>> 0 }
  const chunk = (name, bytes) => { const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(Buffer.concat([type, bytes]))); return Buffer.concat([length, type, bytes, checksum]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(600); header.writeUInt32BE(400, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(400 * (600 * 3 + 1)))), chunk('IEND', Buffer.alloc(0))])
}

test('byte verifier binds every original PNG and refuses edited bytes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'shortcut-evidence-contract-'))
  try {
    const report = fixture(), png = testPNG()
    for (const image of report.screenshots) {
      image.bytes = png.length; image.sha256 = sha(png); writeFileSync(path.join(dir, image.filename), png)
    }
    writeFileSync(path.join(dir, SHORTCUT_MANAGEMENT_REPORT), JSON.stringify(report))
    assert.equal(verifyShortcutManagementDesktopReport(dir, HEAD).complete, true)
    writeFileSync(path.join(dir, SHORTCUT_MANAGEMENT_IMAGES[0]), Buffer.concat([png, Buffer.from('changed')]))
    assert.throws(() => verifyShortcutManagementDesktopReport(dir, HEAD))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('source fixture uses canonical Lexical and only the intentional saved marker changes', () => {
  const before = JSON.parse(shortcutManagementNote()), after = JSON.parse(shortcutManagementNote(true))
  assert.equal(before.root.children[0].type, 'heading')
  assert.deepEqual(before.root.children[0], after.root.children[0])
  assert.equal(after.root.children[1].children[0].text, before.root.children[1].children[0].text + ' SHORTCUT101 real fixed save')
})

test('new native runner leaves original desktop lifecycle source and gates as independent prerequisites', () => {
  const runner = readFileSync(new URL('./run-shortcut-management-desktop.mjs', import.meta.url), 'utf8')
  assert.match(runner, /verifyDesktopSaveReadingReport\(out, process\.env\.GITHUB_SHA\)/)
  assert.match(runner, /sameOriginalApplicationBytes: true/)
  assert.match(runner, /original\.desktop\.processIDs\.includes\(item\.pid\)/)
  assert.doesNotMatch(runner, /Page\.reload|localStorage\.setItem|\.dispatchEvent\(new KeyboardEvent/)
  const original = readFileSync(new URL('./check-desktop-save.mjs', import.meta.url), 'utf8')
  assert.match(original, /Use a fresh Chromium profile so a stale draft cache cannot fake persistence/)
  assert.doesNotMatch(original, /runShortcutManagementLifecycle/)
})
