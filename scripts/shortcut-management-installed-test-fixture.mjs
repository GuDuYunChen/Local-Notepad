import { createHash } from 'node:crypto'
import { SHORTCUT_MANAGEMENT_VERSION, SHORTCUT_MANAGEMENT_STORAGE_KEY, SHORTCUT_MANAGEMENT_BINDINGS, SHORTCUT_MANAGEMENT_SOURCES, SHORTCUT_MANAGEMENT_CHECKS, SHORTCUT_MANAGEMENT_IMAGES } from './shortcut-management-desktop-evidence.mjs'
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
export function shortcutManagementEvidenceFixture() {
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
    refusals: { reservedText: '该快捷键用于保存笔记', conflictText: '该快捷键用于快速切换笔记', storageUnchanged: true,
      reservedVisibility: refusalObservation('reserved'), conflictVisibility: refusalObservation('conflict'),
      conflictScreenshot: { filename: 'shortcut-management-conflict.png', bytes: 100, sha256: 'e'.repeat(64),
        before: refusalObservation('conflict'), after: refusalObservation('conflict') } },
    recording: { backgroundFocusUnchanged: true, backgroundNoteCountUnchanged: true, bodyUnchanged: true, writeRequests: 0 },
    actions, editor: { noteID: 'synthetic-shortcut-101', before: body(false), afterAltSave: body(false),
      shortDirtyRound: { via: 'settings-return', editorRemountedAt: 100000, savedAt: 101000 },
      afterSave: body(true), afterRestart: body(true), final: body(true), altSaveWriteRequests: 0,
      fixedSaveRequests: [{ method: 'PUT', path: '/api/files/synthetic-shortcut-101',
        status: 200, postData: JSON.stringify({ content: body(true).content }) }] },
    screenshots: SHORTCUT_MANAGEMENT_IMAGES.map(filename => ({ filename, bytes: 100, sha256: 'e'.repeat(64) })),
  }
}


// Controlled geometry inputs for pure validators only; never native UI evidence.
function refusalObservation(kind) {
  const visibilityPoints = [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]]
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom })
  const node = (text, bounds, disabled = false) => ({ text, rect: bounds, disabled, rendered: true,
    hitPoints: visibilityPoints.map(([x, y]) => ({ x: bounds.left + (bounds.right - bounds.left) * x,
      y: bounds.top + (bounds.bottom - bounds.top) * y, matched: true })) })
  return {
    viewport: { width: 1008, height: 656, devicePixelRatio: 1 },
    command: 'focusMode', commandCount: 15, focused: true,
    dialog: rect(84, 24, 924, 632), footer: rect(84, 538, 924, 632),
    scroll: { viewport: rect(108, 196, 900, 538), clientWidth: 792, clientHeight: 342,
      scrollWidth: 792, scrollHeight: 1530, scrollLeft: 0, scrollTop: 270 },
    recordingPanel: rect(120, 236, 880, 524),
    nodes: {
      recorder: node(kind === 'reserved' ? '请按下组合键' : 'Ctrl + K', rect(134, 274, 866, 322)),
      feedback: node(kind === 'reserved' ? '该快捷键用于保存笔记' : '该快捷键用于快速切换笔记', rect(134, 362, 866, 398)),
      cancel: node('取消录入', rect(602, 470, 704, 504)),
      accept: node(kind === 'reserved' ? '使用此快捷键' : '替换冲突快捷键', rect(716, 470, 866, 504), kind === 'reserved'),
    },
  }
}
