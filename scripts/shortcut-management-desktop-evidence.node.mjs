import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { Script } from 'node:vm'
import { parse } from 'acorn'
import { SHORTCUT_MANAGEMENT_VERSION, SHORTCUT_MANAGEMENT_REPORT, SHORTCUT_MANAGEMENT_STORAGE_KEY,
  SHORTCUT_MANAGEMENT_BINDINGS, SHORTCUT_MANAGEMENT_SOURCES, SHORTCUT_MANAGEMENT_CHECKS,
  SHORTCUT_MANAGEMENT_IMAGES, assertShortcutManagementConfiguration,
  validateShortcutManagementNativeAction, validateShortcutManagementDesktopReport,
  verifyShortcutManagementDesktopReport } from './shortcut-management-desktop-evidence.mjs'
import { SHORTCUT_FIXTURE, shortcutManagementNote } from './shortcut-management-desktop-fixture.mjs'

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
      if (image.filename === 'shortcut-management-conflict.png') Object.assign(report.refusals.conflictScreenshot, image)
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

// Parse the actual arguments passed to the runner's evaluate boundary. Merely
// parsing these .mjs files does not parse the JavaScript inside their strings.
// These are local code-generation contracts, never native application evidence.
function rendererExpressions(filename, bindings = {}) {
  const source = readFileSync(new URL('./' + filename, import.meta.url), 'utf8')
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const sites = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'evaluate') {
      assert.equal(node.arguments.length, 1, 'Every renderer call must have one auditable expression')
      const argument = node.arguments[0]
      assert.ok(['Literal', 'TemplateLiteral'].includes(argument.type), 'Audit a new renderer expression construction explicitly')
      const generated = new Script(source.slice(argument.start, argument.end)).runInNewContext({
        q: JSON.stringify, panel: '[data-shortcut-settings="true"]',
        recorder: '[data-shortcut-recorder="true"]', row: '[data-shortcut-command="focusMode"]',
        SHORTCUT_MANAGEMENT_STORAGE_KEY, SHORTCUT_FIXTURE,
        report: { editor: { noteID: 'synthetic-shortcut-101' } }, cursor: 3,
        selector: '[data-shortcut-search="true"]', value: '专注',
        requested: { selector: '[data-shortcut-settings="true"] button', text: '取消录入' },
        ...bindings,
      })
      assert.equal(typeof generated, 'string')
      sites.push({ line: node.loc.start.line, generated })
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(ast)
  return sites
}

const expressionFiles = [
  ['check-shortcut-management-desktop.mjs', 29],
  ['run-shortcut-management-desktop.mjs', 6],
]
const expressionEdgeText = ['quotes\'"', 'slash\\', 'line\r\n', '\u2028\u2029', '` ${globalThis.unexpectedNativeMutation = true}'].join(' ')
for (const [name, bindings] of [
  ['normal inputs', {}],
  ['quoted and multiline inputs', { value: expressionEdgeText, requested: {
    selector: '[data-shortcut-settings="true"] button', text: expressionEdgeText,
  } }],
]) for (const [filename, expected] of expressionFiles) test('renderer expressions compile at every ' + filename + ' call site with ' + name, () => {
  const expressions = rendererExpressions(filename, bindings)
  assert.equal(expressions.length, expected, 'Keep the complete evaluate call-site inventory')
  for (const { line, generated } of expressions) {
    assert.doesNotThrow(() => new Script(generated), filename + ':' + line)
  }
})

test('native alert expression reads all refusal text separated by a real newline', () => {
  const expressions = rendererExpressions('check-shortcut-management-desktop.mjs')
  const alerts = expressions.filter(item => item.generated.includes('.map(n=>n.textContent).join('))
  assert.equal(alerts.length, 1, 'The same alert reader must cover reserved and conflicting keys')
  const values = ['该快捷键用于保存笔记', '该快捷键用于快速切换笔记', expressionEdgeText]
  const result = new Script(alerts[0].generated).runInNewContext({ document: {
    querySelectorAll: selector => {
      assert.equal(selector, '[data-shortcut-settings="true"] [role="alert"]')
      return values.map(textContent => ({ textContent }))
    },
  } })
  assert.equal(result, values.join('\n'))
})

test('native input and click expressions preserve quoted data without executing it', () => {
  const driver = rendererExpressions('check-shortcut-management-desktop.mjs', { value: expressionEdgeText })
  const text = driver.filter(item => item.generated.includes('?.value==='))
  assert.equal(text.length, 1)
  const fieldContext = { document: { querySelector: selector => {
    assert.equal(selector, '[data-shortcut-search="true"]')
    return { value: expressionEdgeText }
  } } }
  assert.equal(new Script(text[0].generated).runInNewContext(fieldContext), true)
  assert.equal(fieldContext.unexpectedNativeMutation, undefined)
  const runner = rendererExpressions('run-shortcut-management-desktop.mjs', { requested: {
    selector: '[data-shortcut-settings="true"] button', text: expressionEdgeText,
  } })
  const clicks = runner.filter(item => item.generated.includes('const request='))
  assert.equal(clicks.length, 1)
  const node = { disabled: false, textContent: expressionEdgeText,
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 100, height: 40 }),
    scrollIntoView: options => assert.equal(options.block, 'center') }
  const clickContext = { document: {
    querySelectorAll: selector => { assert.equal(selector, '[data-shortcut-settings="true"] button'); return [node] },
    elementFromPoint: (x, y) => { assert.equal(x, 60); assert.equal(y, 40); return node },
  } }
  const point = new Script(clicks[0].generated).runInNewContext(clickContext)
  assert.deepEqual({ x: point.x, y: point.y }, { x: 60, y: 40 })
  assert.equal(clickContext.unexpectedNativeMutation, undefined)
})

// These geometry records are controlled validator fixtures, not screenshots or
// observations from Windows. The observer tests below run the actual generated
// renderer expression against a small DOM-shaped geometry contract.
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

for (const [name, mutate] of [
  ['text without a visibility observation', r => { delete r.refusals.reservedVisibility }],
  ['feedback clipped by its scroll viewport', r => { r.refusals.conflictVisibility.nodes.feedback.rect.bottom = 550 }],
  ['footer covering the recording card', r => { r.refusals.conflictVisibility.footer.top = 480 }],
  ['feedback hidden by an ancestor', r => { r.refusals.conflictVisibility.nodes.feedback.rendered = false }],
  ['feedback hit testing to an occluding element', r => { r.refusals.conflictVisibility.nodes.feedback.hitPoints[0].matched = false }],
  ['cancel control outside the viewport', r => { r.refusals.conflictVisibility.nodes.cancel.rect.bottom = 552 }],
  ['reserved key leaving its accept control enabled', r => { r.refusals.reservedVisibility.nodes.accept.disabled = false }],
  ['short list masquerading as the full scrolling list', r => { r.refusals.conflictVisibility.scroll.scrollHeight = 342 }],
  ['conflict screenshot without its observed state', r => { delete r.refusals.conflictScreenshot }],
  ['conflict screenshot with a different PNG digest', r => { r.refusals.conflictScreenshot.sha256 = 'f'.repeat(64) }],
  ['conflict state changing while its screenshot is captured', r => { r.refusals.conflictScreenshot.after.nodes.feedback.text = '另一条提示' }],
]) test('shortcut visibility evidence refuses ' + name, () => {
  const report = fixture(); mutate(report)
  assert.throws(() => validateShortcutManagementDesktopReport(report, HEAD))
})

function refusalDOM(kind, change = () => {}) {
  const expected = refusalObservation(kind), nodes = {}
  const element = (bounds, parentElement = null) => ({
    isConnected: true, parentElement, hidden: false, styleHidden: false,
    getBoundingClientRect: () => bounds, getClientRects: () => [bounds],
    getAttribute: name => name === 'data-shortcut-command' ? 'focusMode' : null,
    contains(other) { for (let current = other; current; current = current.parentElement) if (current === this) return true; return false },
    scrollIntoView() { throw Error('A read-only refusal observer must never scroll the product') },
  })
  const dialog = element(expected.dialog), scroll = element(expected.scroll.viewport, dialog)
  Object.assign(scroll, expected.scroll, { clientLeft: 0, clientTop: 0 })
  const card = element(expected.recordingPanel, scroll), footer = element(expected.footer, dialog)
  for (const [name, value] of Object.entries(expected.nodes)) {
    nodes[name] = Object.assign(element(value.rect, card), {
      tagName: name === 'recorder' ? 'INPUT' : name === 'feedback' ? 'P' : 'BUTTON',
      textContent: name === 'recorder' ? '' : value.text, value: name === 'recorder' ? value.text : '', disabled: value.disabled,
    })
  }
  card.closest = selector => { assert.equal(selector, '[data-shortcut-command]'); return card }
  card.querySelector = selector => {
    if (selector === '[data-shortcut-recorder="true"]') return nodes.recorder
    if (selector === '#shortcut-recording-feedback[role="alert"]') return nodes.feedback
    throw Error('Unexpected recording-card selector: ' + selector)
  }
  card.querySelectorAll = selector => {
    assert.equal(selector, '.local-shortcuts-recorder-actions button'); return [nodes.cancel, nodes.accept]
  }
  dialog.querySelector = selector => {
    if (selector === '.local-shortcuts-scroll') return scroll
    if (selector === '.local-shortcuts-footer') return footer
    if (selector === '.local-shortcuts-recorder-panel') return card
    throw Error('Unexpected dialog selector: ' + selector)
  }
  dialog.querySelectorAll = selector => { assert.equal(selector, '[data-shortcut-command]'); return Array.from({ length: 15 }, () => card) }
  const context = {
    window: { innerWidth: 1008, innerHeight: 656, devicePixelRatio: 1 },
    getComputedStyle: node => ({ display: node.styleHidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
    document: {
      activeElement: nodes.recorder,
      querySelector: selector => { assert.equal(selector, '[data-shortcut-settings="true"]'); return dialog },
      elementFromPoint: (x, y) => Object.values(nodes).find(node => {
        const r = node.getBoundingClientRect(); return x > r.left && x < r.right && y > r.top && y < r.bottom
      }) || footer,
    },
  }
  change({ context, nodes, card, scroll, footer })
  return { context, expected }
}

test('native refusal observer records visible feedback and controls for both refusal states without scrolling', async () => {
  const { observeShortcutManagementRefusal } = await import('./check-shortcut-management-desktop.mjs')
  assert.equal(typeof observeShortcutManagementRefusal, 'function')
  for (const kind of ['reserved', 'conflict']) {
    const { context, expected } = refusalDOM(kind)
    const observed = await observeShortcutManagementRefusal(expression => new Script(expression).runInNewContext(context))
    assert.deepEqual(JSON.parse(JSON.stringify(observed)), expected)
  }
})

test('native refusal observer exposes clipping hidden ancestors and hit-test occlusion to the strict oracle', async () => {
  const { observeShortcutManagementRefusal } = await import('./check-shortcut-management-desktop.mjs')
  const { assertShortcutManagementRefusalVisibility } = await import('./shortcut-management-desktop-evidence.mjs')
  assert.equal(typeof observeShortcutManagementRefusal, 'function')
  assert.equal(typeof assertShortcutManagementRefusalVisibility, 'function')
  for (const change of [
    ({ nodes }) => { nodes.feedback.getBoundingClientRect = () => ({ left: 134, top: 525, right: 866, bottom: 560 }) },
    ({ footer }) => { footer.getBoundingClientRect = () => ({ left: 84, top: 480, right: 924, bottom: 632 }) },
    ({ card }) => { card.styleHidden = true },
    ({ context, footer }) => { context.document.elementFromPoint = () => footer },
  ]) {
    const { context } = refusalDOM('conflict', change)
    const observed = await observeShortcutManagementRefusal(expression => new Script(expression).runInNewContext(context))
    assert.throws(() => assertShortcutManagementRefusalVisibility(observed, 'conflict'))
  }
})
