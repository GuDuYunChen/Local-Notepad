import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { TABLE_OPERATIONS_BUDGET_MS, TABLE_OPERATIONS_CHECKS, tableFromContent, tableOperationSeed } from './table-operations-desktop-driver.mjs'
import { TABLE_OPERATIONS_VERSION, TABLE_OPERATIONS_SOURCES, TABLE_OPERATIONS_SCREENSHOTS,
  tableOperationsHash, validateTableOperationsReport } from './table-operations-evidence.mjs'
import { tableOperationsUntil } from './run-table-operations-desktop.mjs'

// Synthetic reports test refusal rules only. They never constitute a native
// application, installation, screenshot, or persistence acceptance receipt.
function syntheticReport() {
  const clone = value => structuredClone(value)
  const rowValues = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, col) => `R${row + 1}C${col + 1}`))
  const cell = (value, width = 120) => ({ type: 'tablecell', version: 1, colSpan: 1, rowSpan: 1, headerState: 0, backgroundColor: null, width,
    children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text: value }] }] })
  const table = { type: 'table', version: 1, colWidths: [120, 160, 200], rowStriping: false, frozenRowCount: 0, frozenColumnCount: 0,
    children: rowValues.map(values => ({ type: 'tablerow', version: 1, children: values.map((value, col) => cell(value, [120, 160, 200][col])) })) }
  const doc = table => JSON.stringify({ root: { type: 'root', version: 1, children: [clone(table)] } })
  const view = table => ({ tables: 1, editable: 'true', rootFocused: true, modebarFocused: false, selection: '', rows: table.children.map(row => row.children.map(cell => ({
    text: cell.children.map(paragraph => paragraph.children.map(text => text.text).join('')).join(''), background: 'rgb(207, 244, 252)',
  }))) })
  const sources = Object.fromEntries(TABLE_OPERATIONS_SOURCES.map(name => [name, 'b'.repeat(40)]))
  const report = {
    schemaVersion: 1, module: 'notepad-table', version: TABLE_OPERATIONS_VERSION, productCommit: 'a'.repeat(40), verifierCommit: 'a'.repeat(40),
    platform: 'win32', runnerEnvironment: 'github-hosted', scope: 'packaged', app: { packaged: true, version: TABLE_OPERATIONS_VERSION },
    complete: true, cleanupComplete: true, realBackend: true, realPreload: true, syntheticData: true, backendStopped: true,
    bridgeOverridden: false, timerAccelerated: false, forceTerminated: false, businessBudgetMs: TABLE_OPERATIONS_BUDGET_MS, businessElapsedMs: 70000,
    pid: 500, executable: 'C:\\synthetic\\Local-Notepad.exe', executableSHA256: 'c'.repeat(64), asarSHA256: 'd'.repeat(64), backendSHA256: 'e'.repeat(64),
    exit: { pid: 500, code: 0, signal: null, normalClose: true }, sourceFiles: sources, checks: [...TABLE_OPERATIONS_CHECKS],
    fixture: { mainID: 'main', destinationID: 'destination', largeID: 'large' }, snapshots: {},
    nativeInputs: Array.from({ length: 101 }, (_, index) => ({ sequence: index + 1, method: 'Input.dispatchMouseEvent', type: 'mouseMoved', x: 30, y: 60 })),
    requests: [
      { path: '/api/files/main', method: 'PUT', status: 200, postData: 'initial' },
      { path: '/api/files/main', method: 'PUT', status: null, postData: '-offline-retry', failure: { errorText: 'net::ERR_BLOCKED_BY_CLIENT' } },
      { path: '/api/files/main', method: 'PUT', status: 200, postData: '-offline-retry' },
    ],
    screenshots: TABLE_OPERATIONS_SCREENSHOTS.map(filename => ({ filename, bytes: 12000, sha256: 'f'.repeat(64) })),
  }
  const set = (name, table) => { const content = doc(table); report.snapshots[name] = { content, sha256: tableOperationsHash(content), ui: view(table) } }
  set('initial', table)
  const addedRow = clone(table); addedRow.children.splice(1, 0, { type: 'tablerow', children: [cell(''), cell(''), cell('')] })
  set('insert-row', addedRow); set('delete-row', table)
  const addedColumn = clone(table); addedColumn.children.forEach(row => row.children.splice(1, 0, cell('')))
  set('insert-column', addedColumn); set('delete-column', table)
  const rowMoved = clone(table); rowMoved.children.splice(1, 0, rowMoved.children.shift())
  set('menu-row-move', rowMoved); set('menu-row-undo', table)
  const columnMoved = clone(table); columnMoved.children.forEach(row => row.children.splice(1, 0, row.children.shift()))
  set('menu-column-move', columnMoved); set('menu-column-undo', table)
  const putInputs = (start, inputs) => inputs.forEach((input, offset) => {
    report.nativeInputs[start + offset] = { sequence: start + offset + 1, ...input }
  })
  const keyInputs = (key, windowsVirtualKeyCode, modifiers = 0) => ['rawKeyDown', 'keyUp'].map(type => ({
    method: 'Input.dispatchKeyEvent', type, key, windowsVirtualKeyCode, modifiers,
  }))
  const beforeIME = clone(table); beforeIME.children[2].children[2].children[0].children[0].text = ''
  report.imeControl = { text: 'R3C3', snapshot: 'initial', before: view(beforeIME), composing: view(table), committed: view(table),
    compositionInputStart: 4, compositionInputEnd: 5, commitInputStart: 5, commitInputEnd: 6, saveInputStart: 6, saveInputEnd: 8 }
  putInputs(4, [
    { method: 'Input.imeSetComposition', text: 'R3C3', selectionStart: 4, selectionEnd: 4 },
    { method: 'Input.insertText', text: 'R3C3' }, ...keyInputs('s', 83, 2),
  ])
  const selectedView = { ...view(table), editable: 'true', rootFocused: true, selection: '已选择 2 个单元格',
    selectionOutlineBackgrounds: ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'] }
  const retainedRange = { rootFocused: true, text: 'R1C3', anchor: { row: 0, column: 2, text: 'R1C3' }, focus: { row: 0, column: 2, text: 'R1C3' } }
  report.selectionIsolation = {
    source: { inputStart: 12, inputEnd: 18, ...clone(retainedRange) }, retainedRange: clone(retainedRange),
    rectangle: { inputStart: 22, inputEnd: 26 }, selected: clone(selectedView), operations: [],
    rangeStages: [
      { stage: 'menu-opened', afterInput: 20, ...clone(retainedRange), rootFocused: false },
      { stage: 'mode-entered', afterInput: 22, ...clone(retainedRange) },
      { stage: 'rectangle-started', afterInput: 24, ...clone(retainedRange) },
      { stage: 'rectangle-moved', afterInput: 25, ...clone(retainedRange) },
    ],
  }
  putInputs(12, [
    ...['mousePressed', 'mouseReleased'].map(type => ({ method: 'Input.dispatchMouseEvent', type, x: 270, y: 60 })),
    ...keyInputs('Home', 36), ...keyInputs('End', 35, 8),
  ])
  putInputs(22, [
    { type: 'mouseMoved', x: 30, buttons: 0 }, { type: 'mousePressed', x: 30, buttons: 1 },
    { type: 'mouseMoved', x: 150, buttons: 1 }, { type: 'mouseReleased', x: 150, buttons: 0 },
  ].map(input => ({ method: 'Input.dispatchMouseEvent', y: 120, button: input.type === 'mouseMoved' && !input.buttons ? 'none' : 'left', ...input })))
  let inputIndex = 26
  for (const [name, inputs] of [
    ['insert-text', [{ method: 'Input.insertText', text: 'TABLE-SELECTION-INPUT-MUST-NOT-WRITE' }]],
    ['backspace', keyInputs('Backspace', 8)], ['delete', keyInputs('Delete', 46)],
    ['enter', keyInputs('Enter', 13)], ['cut', keyInputs('x', 88, 2)],
  ]) {
    const snapshot = 'selection-input-' + name
    set(snapshot, table); report.snapshots[snapshot].ui = clone(selectedView)
    const operation = { name, snapshot, inputStart: inputIndex, inputEnd: inputIndex + inputs.length,
      before: clone(selectedView), after: clone(selectedView), saveInputStart: inputIndex + inputs.length, saveInputEnd: inputIndex + inputs.length + 2 }
    report.selectionIsolation.operations.push(operation)
    putInputs(inputIndex, inputs); putInputs(operation.saveInputStart, keyInputs('s', 83, 2))
    inputIndex = operation.saveInputEnd
  }
  const imeModebarView = { ...clone(selectedView), rootFocused: false, modebarFocused: true }
  const ime = { before: clone(selectedView), composing: clone(imeModebarView), committed: clone(imeModebarView), snapshot: 'selection-input-ime',
    compositionInputStart: inputIndex, compositionInputEnd: inputIndex + 1, commitInputStart: inputIndex + 1, commitInputEnd: inputIndex + 2,
    saveInputStart: inputIndex + 2, saveInputEnd: inputIndex + 4 }
  report.selectionIsolation.ime = ime
  putInputs(inputIndex, [{ method: 'Input.imeSetComposition', text: '表', selectionStart: 1, selectionEnd: 1 },
    { method: 'Input.insertText', text: '表' }, ...keyInputs('s', 83, 2)])
  set('selection-input-ime', table); report.snapshots['selection-input-ime'].ui = clone(imeModebarView)
  const colored = clone(table); colored.children[1].children.slice(0, 2).forEach(cell => { cell.backgroundColor = '#fff3cd' })
  set('selected-background', colored)
  const merged = clone(colored); merged.children[1].children[0].colSpan = 2
  merged.children[1].children[0].children.push(...merged.children[1].children[1].children); merged.children[1].children.splice(1, 1)
  set('merged', merged)
  const split = clone(merged); split.children[1].children[0].colSpan = 1; split.children[1].children.splice(1, 0, cell(''))
  set('split', split); set('split-undo', merged); set('merge-undo', colored)
  const cleared = clone(colored)
  cleared.children[1].children.slice(0, 2).forEach(cell => { cell.children[0].children = [] })
  set('clipboard-copied', colored); set('clipboard-cleared', cleared); set('clipboard-pasted', colored)
  set('clipboard-paste-undo', cleared); set('clipboard-clear-undo', colored); set('clipboard-clear-redo', cleared); set('clipboard-paste-redo', colored)
  report.clipboard = { method: 'native-copy-and-paste-buttons', selection: '已选择 2 个单元格',
    copy: { label: '复制', feedback: '已复制所选单元格', inputStart: 54, inputEnd: 56 },
    paste: { label: '粘贴', feedback: '已粘贴到所选区域', inputStart: 58, inputEnd: 60 },
  }
  const styled = clone(colored); styled.rowStriping = true; styled.frozenRowCount = 1; styled.frozenColumnCount = 1
  styled.children[0].children[1].backgroundColor = '#cff4fc'
  styled.children.forEach((row, r) => row.children.forEach((cell, c) => { cell.headerState = (r === 0 ? 1 : 0) ^ (c === 0 ? 2 : 0) }))
  set('styled', styled); report.styledView = { ...view(styled), rowStriping: true, frozenRow: 'true', frozenColumn: 'true' }
  const rowDragged = clone(styled); rowDragged.children.push(rowDragged.children.shift())
  set('row-dragged', rowDragged); set('row-drag-undo', styled); set('row-drag-redo', rowDragged); set('row-drag-restored', styled)
  const columnDragged = clone(styled); columnDragged.children.forEach(row => row.children.push(row.children.shift()))
  set('column-dragged', columnDragged); set('column-drag-undo', styled); set('column-drag-redo', columnDragged); set('column-drag-restored', styled)
  set('resize-cancelled', styled)
  const resized = clone(styled); resized.colWidths[0] = 170; resized.children.forEach(row => { row.children[0].width = 170 })
  set('resized', resized); set('resize-undo', styled); set('resize-redo', resized)
  const fitted = clone(resized); fitted.colWidths[0] = 90; fitted.children.forEach(row => { row.children[0].width = 90 })
  set('autofit', fitted); set('autofit-repeat', fitted); set('autofit-undo', resized); set('autofit-redo', fitted)
  const retried = clone(fitted); retried.children[2].children[2].children[0].children[0].text += '-offline-retry'
  report.failedSave = { persisted: doc(fitted), visible: view(retried), duplicateSaveKeys: 2, requestStartIndex: 1, successfulWrites: 1 }; set('retried', retried)
  report.reloaded = { content: doc(retried), sha256: tableOperationsHash(doc(retried)), ui: view(retried), originBefore: 1, originAfter: 2 }
  const large = clone(table)
  large.children = Array.from({ length: 80 }, (_, row) => ({ type: 'tablerow', children: [cell(`LONG-${row + 1}-1-` + 'long'.repeat(36)), cell(`LONG-${row + 1}-2-value`), cell(`LONG-${row + 1}-3-value`)] }))
  report.largeSeed = { content: doc(large), sha256: tableOperationsHash(doc(large)) }
  large.children[79].children[2].children[0].children[0].text += '-tail-saved'; set('large-saved', large)
  large.children[79].children[1].backgroundColor = '#cff4fc'; set('large-dark-saved', large)
  report.smallMenu = { left: 20, right: 258, top: 10, bottom: 380, width: 704, height: 455, overflow: false }
  report.darkMenu = { ...report.smallMenu, theme: 'dark' }; report.minimumWindow = { pid: report.pid, applied: true, width: 720, height: 520 }
  report.darkCell = { text: 'LONG-80-2-value', foreground: 'rgb(0, 0, 0)', background: 'rgb(207, 244, 252)' }
  report.frozenScroll = {
    vertical: { before: { scrollTop: 0, headTop: 100, normalTop: 140 }, after: { scrollTop: 120, headTop: 100, normalTop: 20 } },
    horizontal: { before: { scrollLeft: 0, scrollWidth: 800, clientWidth: 500, headLeft: 100, normalLeft: 340 }, after: { scrollLeft: 120, headLeft: 100, normalLeft: 220 } },
  }
  report.saved = { main: { id: 'main', content: doc(retried) }, large: { id: 'large', content: doc(large) }, destination: { id: 'destination', content: tableOperationSeed('synthetic destination') } }
  report.nativeInputs[1] = { sequence: 2, method: 'Input.dispatchKeyEvent', type: 'rawKeyDown', key: 'Escape' }
  report.nativeDrags = []
  for (const [kind, inputStart, target] of [['row', 70, { x: 30, y: 240 }], ['col', 82, { x: 270, y: 60 }]]) {
    const source = { x: 30, y: 60, width: 26 }, data = { items: [{ mimeType: 'application/x-local-notepad-table-reorder', data: 'real-start-token-placeholder-' + kind }], dragOperationsMask: 16 }
    report.nativeDrags.push({ kind, inputStart, inputEnd: inputStart + 8, source, target, completed: true,
      intercepted: [{ afterInputSequence: inputStart + 4, data: clone(data) }] })
    putInputs(inputStart, [
      { method: 'Input.dispatchMouseEvent', type: 'mouseMoved', x: 90, y: 50, buttons: 0, button: 'none' },
      { method: 'Input.dispatchMouseEvent', type: 'mouseMoved', ...source, buttons: 0, button: 'none' },
      { method: 'Input.dispatchMouseEvent', type: 'mousePressed', ...source, buttons: 1, button: 'left', clickCount: 1 },
      { method: 'Input.dispatchMouseEvent', type: 'mouseMoved', x: source.x + 9, y: source.y + 9, buttons: 1, button: 'left' },
      ...['dragEnter', 'dragOver', 'drop'].map(type => ({ method: 'Input.dispatchDragEvent', type, ...target, data: clone(data) })),
      { method: 'Input.dispatchMouseEvent', type: 'mouseReleased', ...target, buttons: 0, button: 'left', clickCount: 1 },
    ])
  }
  for (const start of [report.clipboard.copy.inputStart, report.clipboard.paste.inputStart]) for (const [offset, type] of ['mousePressed', 'mouseReleased'].entries()) {
    report.nativeInputs[start + offset] = { sequence: start + offset + 1, method: 'Input.dispatchMouseEvent', type, x: 30, y: 60 }
  }
  return { report, expected: { commit: 'a'.repeat(40), sources } }
}

test('synthetic complete reports exercise the Table acceptance validator without claiming native execution', () => {
  const { report, expected } = syntheticReport()
  assert.equal(validateTableOperationsReport(report, expected), true)
})

const refusals = [
  ['missing Table check', report => report.checks.pop()],
  ['old version', report => { report.version = '4.249.1' }],
  ['Linux substituted for Windows', report => { report.platform = 'linux' }],
  ['fixture substituted for packaged app', report => { report.app.packaged = false }],
  ['mocked backend', report => { report.realBackend = false }],
  ['bridge replacement', report => { report.bridgeOverridden = true }],
  ['accelerated timer', report => { report.timerAccelerated = true }],
  ['force terminated app', report => { report.forceTerminated = true }],
  ['unconfirmed cleanup', report => { report.cleanupComplete = false }],
  ['relaxed business budget', report => { report.businessBudgetMs += 1000 }],
  ['exceeded business budget', report => { report.businessElapsedMs = TABLE_OPERATIONS_BUDGET_MS }],
  ['missing exact persisted snapshot', report => { delete report.snapshots['resize-undo'] }],
  ['unhashed persisted JSON', report => { report.snapshots.initial.content += ' ' }],
  ['fake successful failed save', report => { report.failedSave.persisted = report.snapshots.retried.content }],
  ['wrong row restored by undo', report => { report.snapshots['row-drag-undo'] = report.snapshots['row-dragged'] }],
  ['missing native selection isolation workflow', report => { delete report.selectionIsolation }],
  ['missing native selection handoff observations', report => { delete report.selectionIsolation.rangeStages }],
  ['range observations skip the native pointer movement', report => { report.selectionIsolation.rangeStages.pop() }],
  ['range observation is attributed to a later native input', report => { report.selectionIsolation.rangeStages[2].afterInput += 1 }],
  ['range observation omits native focus ownership', report => { delete report.selectionIsolation.rangeStages[1].rootFocused }],
  ['missing actual native selection outlines', report => { report.selectionIsolation.selected.selectionOutlineBackgrounds = [] }],
  ['opaque selection overlay covers text despite intact cell data', report => { report.selectionIsolation.selected.selectionOutlineBackgrounds[0] = 'rgb(233, 223, 209)' }],
  ['collapsed old source range', report => { report.selectionIsolation.source.text = '' }],
  ['old source range points at a bulk-selected cell', report => { report.selectionIsolation.retainedRange.anchor.row = 1 }],
  ['bulk selection without a native drag', report => { report.nativeInputs[report.selectionIsolation.rectangle.inputStart + 2].buttons = 0 }],
  ['selection input bypassed editor-root focus', report => { report.selectionIsolation.operations[0].before.rootFocused = false }],
  ['selection input lost the two selected cells', report => { report.selectionIsolation.operations[0].after.selection = '已选择 1 个单元格' }],
  ['missing destructive native key case', report => { report.selectionIsolation.operations.pop() }],
  ['text input was never actually sent', report => { report.nativeInputs[report.selectionIsolation.operations[0].inputStart].text = '' }],
  ['cut key omitted the Control modifier', report => { report.nativeInputs[report.selectionIsolation.operations[4].inputStart].modifiers = 0 }],
  ['selected cell changed after blocked native input', report => { report.selectionIsolation.operations[1].after.rows[1][0].text = '' }],
  ['unselected cell changed after blocked native input', report => { report.selectionIsolation.operations[2].after.rows[0][2].text = '' }],
  ['selection input was not followed by native Save', report => { report.nativeInputs[report.selectionIsolation.operations[3].saveInputStart].key = 'Escape' }],
  ['blocked native cut changed persisted JSON despite a valid checksum', report => {
    const snapshot = report.snapshots['selection-input-cut'], value = JSON.parse(snapshot.content)
    value.root.children[0].children[0].children[2].children[0].children[0].text = ''
    snapshot.content = JSON.stringify(value); snapshot.sha256 = tableOperationsHash(snapshot.content)
  }],
  ['missing native IME positive control', report => { delete report.imeControl }],
  ['ordinary IME did not actually insert candidate text', report => { report.imeControl.composing.rows[2][2].text = '' }],
  ['ordinary IME commit duplicated candidate text', report => { report.imeControl.committed.rows[2][2].text = 'R3C3R3C3' }],
  ['missing bulk IME isolation', report => { delete report.selectionIsolation.ime }],
  ['IME candidate has incorrect protocol selection range', report => { report.nativeInputs[report.selectionIsolation.ime.compositionInputStart].selectionEnd = 0 }],
  ['IME retained editor focus during bulk selection', report => { report.selectionIsolation.ime.composing.rootFocused = true }],
  ['IME moved focus outside bulk controls', report => { report.selectionIsolation.ime.composing.modebarFocused = false }],
  ['IME composition erased the old unselected text range', report => { report.selectionIsolation.ime.composing.rows[0][2].text = '\u200b' }],
  ['IME commit wrote into a selected cell', report => { report.selectionIsolation.ime.committed.rows[1][0].text += '表' }],
  ['IME changed persisted JSON despite a valid checksum', report => {
    const snapshot = report.snapshots['selection-input-ime'], value = JSON.parse(snapshot.content)
    value.root.children[0].children[0].children[2].children[0].children[0].text = '\u200b'
    snapshot.content = JSON.stringify(value); snapshot.sha256 = tableOperationsHash(snapshot.content)
  }],
  ['missing native clipboard workflow', report => { report.checks = report.checks.filter(check => check !== 'native-clipboard-copy-clear-paste-and-history') }],
  ['copy without a native click receipt', report => { report.clipboard.copy.inputEnd = report.clipboard.copy.inputStart }],
  ['paste without real success feedback', report => { report.clipboard.paste.feedback = '' }],
  ['clipboard clear did not remove selected content', report => { report.snapshots['clipboard-cleared'] = report.snapshots['clipboard-copied'] }],
  ['paste restored the wrong cells', report => { report.snapshots['clipboard-pasted'] = report.snapshots['clipboard-cleared'] }],
  ['clipboard undo lost the cleared state', report => { report.snapshots['clipboard-paste-undo'] = report.snapshots['clipboard-pasted'] }],
  ['clipboard redo lost copied content', report => { report.snapshots['clipboard-paste-redo'] = report.snapshots['clipboard-cleared'] }],
  ['lost final large row', report => {
    const value = JSON.parse(report.snapshots['large-saved'].content); value.root.children[0].children.pop()
    report.snapshots['large-saved'].content = JSON.stringify(value); report.snapshots['large-saved'].sha256 = tableOperationsHash(report.snapshots['large-saved'].content)
  }],
  ['stale current sources', report => { report.sourceFiles[TABLE_OPERATIONS_SOURCES[0]] = '0'.repeat(40) }],
  ['missing floating toolbar source pin', report => { delete report.sourceFiles['src/components/Editor/plugins/FloatingTextToolbarPlugin.jsx'] }],
  ['stale floating toolbar source pin', report => { report.sourceFiles['src/components/Editor/plugins/FloatingTextToolbarPlugin.jsx'] = '0'.repeat(40) }],
  ['missing editor shortcut source pin', report => { delete report.sourceFiles['src/components/Editor/plugins/EditorShortcutPlugin.jsx'] }],
  ['stale editor shortcut source pin', report => { report.sourceFiles['src/components/Editor/plugins/EditorShortcutPlugin.jsx'] = '0'.repeat(40) }],
  ['missing image paste source pin', report => { delete report.sourceFiles['src/components/Editor/plugins/PasteImagePlugin.jsx'] }],
  ['stale image paste source pin', report => { report.sourceFiles['src/components/Editor/plugins/PasteImagePlugin.jsx'] = '0'.repeat(40) }],
  ['missing shared image ownership source pin', report => { delete report.sourceFiles['src/components/Editor/hooks/useImageUploadSession.js'] }],
  ['stale shared image ownership source pin', report => { report.sourceFiles['src/components/Editor/hooks/useImageUploadSession.js'] = '0'.repeat(40) }],
  ['missing native input', report => { report.nativeInputs = [] }],
  ['invented drag data', report => { report.nativeInputs[report.nativeDrags[0].inputStart + 6].data.items = [] }],
  ['old native drag movement omitted its left button', report => { delete report.nativeInputs[report.nativeDrags[0].inputStart + 3].button }],
  ['missing actual native drag interception', report => { report.nativeDrags[0].intercepted = [] }],
  ['native drag interception predates the movement', report => { report.nativeDrags[0].intercepted[0].afterInputSequence -= 1 }],
  ['drop data differs from the native interception', report => { report.nativeInputs[report.nativeDrags[1].inputStart + 6].data.items[0].data = 'invented-token' }],
  ['drag receipt falsely claims a missing release', report => { report.nativeDrags[0].inputEnd -= 1 }],
  ['no actual failed request', report => { report.requests = report.requests.filter(request => !request.failure) }],
  ['duplicate successful retry writes', report => { report.requests.push({ ...report.requests[2] }) }],
  ['unowned note write', report => { report.requests.push({ path: '/api/files/user-note', method: 'PUT', status: 200 }) }],
  ['menu below native viewport', report => { report.smallMenu.bottom = 600 }],
  ['horizontal document overflow', report => { report.smallMenu.overflow = true }],
  ['frozen header moves with scrolling', report => { report.frozenScroll.vertical.after.headTop -= 120 }],
  ['frozen column moves with scrolling', report => { report.frozenScroll.horizontal.after.headLeft -= 120 }],
  ['no real horizontal overflow', report => { report.frozenScroll.horizontal.before.scrollWidth = 500 }],
  ['light text on a light custom background in dark mode', report => { report.darkCell.foreground = 'rgb(240, 238, 243)' }],
  ['missing screenshot', report => { report.screenshots.pop() }],
]
for (const [label, mutate] of refusals) test('rejects ' + label, () => {
  const { report, expected } = syntheticReport()
  expected.sources = structuredClone(expected.sources)
  mutate(report)
  assert.throws(() => validateTableOperationsReport(report, expected))
})

test('Table native wait propagates an uncertain action immediately without replaying it', async () => {
  let attempts = 0
  await assert.rejects(tableOperationsUntil(() => { attempts++; throw new Error('native action uncertain') }, 'must not retry', 1000), /native action uncertain/)
  assert.equal(attempts, 1)
})

test('new Table gate uses trusted native input and preserves existing native control matrix and budget', () => {
  const driver = readFileSync(new URL('./table-operations-desktop-driver.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(driver, /new\s+(?:MouseEvent|DragEvent|KeyboardEvent)|\.setEditorState\(|\.dispatchCommand\(|Object\.defineProperty|Emulation\.setDeviceMetricsOverride/)
  assert.match(driver, /Input\.dragIntercepted/); assert.match(driver, /Input\.dispatchMouseEvent/)
  assert.match(driver, /Network\.setBlockedURLs/); assert.match(driver, /Page\.reload/)
  const original = readFileSync(new URL('./check-ui-control-render.cjs', import.meta.url), 'utf8')
  assert.match(original, /\[\[704, 455\], \[1280, 800\], \[1920, 1080\]\]/)
  assert.match(original, /BUDGET_MS\s*=\s*90000/)
  const snapshot = syntheticReport().report.snapshots.initial.content
  assert.equal(tableFromContent(snapshot).children.length, 3)
})
