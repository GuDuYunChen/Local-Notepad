import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { TABLE_OPERATIONS_BUDGET_MS, TABLE_OPERATIONS_CHECKS, nativeTableContrast, tableFromContent, tableTextRows } from './table-operations-desktop-driver.mjs'

export const TABLE_OPERATIONS_VERSION = '4.249.2'
export const TABLE_OPERATIONS_REPORT = 'table-operations.json'
export const TABLE_OPERATIONS_SOURCES = Object.freeze([
  'scripts/table-operations-desktop-driver.mjs', 'scripts/run-table-operations-desktop.mjs', 'scripts/table-operations-evidence.mjs',
  'scripts/desktop-window-session.mjs', 'scripts/desktop-window-target.mjs', 'scripts/desktop-window-worker.ps1',
  'scripts/local-export-directory-session.mjs', 'scripts/local-export-directory-worker.ps1',
  'src/components/Editor/Editor.jsx', 'src/components/Editor/Editor.css',
  'src/components/Editor/plugins/TableMenu.jsx', 'src/components/Editor/plugins/TableActionMenuPlugin.jsx',
  'src/components/Editor/plugins/TableSelectionPlugin.jsx', 'src/components/Editor/plugins/TableColumnResizePlugin.jsx',
  'src/components/Editor/plugins/TableReorderPlugin.jsx', 'src/components/Editor/plugins/ToolbarPlugin.jsx',
  'src/components/Editor/plugins/TablePresentationPlugin.jsx', 'src/components/Editor/plugins/DocumentSessionPlugin.jsx',
  'src/components/Editor/plugins/CommandPalettePlugin.jsx',
  'src/components/Editor/utils/tableModel.js', 'src/components/Editor/utils/tableEvents.js', 'src/components/Editor/hooks/useEditorWriteScope.js',
  'src/components/Editor/utils/excelTable.js', 'src/services/tableImportLimits.js', 'src/services/importContent.js',
  'src/components/TextEditor.jsx', 'src/services/editorDraftCache.js', 'src/styles/editor-document.css', 'src/services/localAppearance.js',
])
export const TABLE_OPERATIONS_SCREENSHOTS = Object.freeze([
  'table-native-inserted.png', 'table-native-merged.png', 'table-native-clipboard-restored.png', 'table-native-styled.png',
  'table-native-failed-save.png', 'table-native-reloaded.png', 'table-native-long.png',
  'table-native-small.png', 'table-native-dark.png',
])
export const tableOperationsHash = bytes => createHash('sha256').update(bytes).digest('hex')
export const tableOperationsBlob = source => createHash('sha1').update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex')
const originalRows = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, col) => `R${row + 1}C${col + 1}`))
const sameJSON = (a, b) => assert.deepEqual(JSON.parse(a), JSON.parse(b))

export function validateTableOperationsReport(report, { commit, verifier = commit, scope = 'packaged', sources } = {}) {
  for (const value of [commit, verifier]) assert.match(value || '', /^[a-f0-9]{40}$/)
  assert.equal(report.schemaVersion, 1); assert.equal(report.module, 'notepad-table'); assert.equal(report.version, TABLE_OPERATIONS_VERSION)
  assert.equal(report.productCommit, commit); assert.equal(report.verifierCommit, verifier); assert.equal(report.scope, scope)
  assert.equal(report.platform, 'win32'); assert.equal(report.runnerEnvironment, 'github-hosted')
  for (const field of ['complete', 'cleanupComplete', 'realBackend', 'realPreload', 'syntheticData', 'backendStopped']) assert.equal(report[field], true, field)
  for (const field of ['bridgeOverridden', 'timerAccelerated', 'forceTerminated']) assert.equal(report[field], false, field)
  assert.equal(report.error, undefined); assert.equal(report.cleanupError, undefined)
  assert.equal(report.app.packaged, true); assert.equal(report.app.version, TABLE_OPERATIONS_VERSION)
  assert.deepEqual(report.checks, TABLE_OPERATIONS_CHECKS)
  assert.equal(report.businessBudgetMs, TABLE_OPERATIONS_BUDGET_MS)
  assert.ok(report.businessElapsedMs > 0 && report.businessElapsedMs < TABLE_OPERATIONS_BUDGET_MS)
  assert.ok(Number.isSafeInteger(report.pid) && report.pid > 0)
  assert.ok(path.win32.isAbsolute(report.executable || ''))
  for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) assert.match(report[key] || '', /^[a-f0-9]{64}$/)
  assert.deepEqual(report.exit, { pid: report.pid, code: 0, signal: null, normalClose: true })
  assert.deepEqual(Object.keys(report.sourceFiles).sort(), [...TABLE_OPERATIONS_SOURCES].sort())
  assert.deepEqual(report.sourceFiles, sources, 'Table acceptance must match independently supplied source pins')
  for (const value of Object.values(report.sourceFiles)) assert.match(value || '', /^[a-f0-9]{40}$/)
  assert.equal(new Set([report.fixture.mainID, report.fixture.destinationID, report.fixture.largeID]).size, 3)
  for (const id of [report.fixture.mainID, report.fixture.destinationID, report.fixture.largeID]) assert.match(id || '', /^[a-zA-Z0-9-]+$/)

  const expectedSnapshots = [
    'initial', 'insert-row', 'delete-row', 'insert-column', 'delete-column', 'menu-row-move', 'menu-row-undo',
    'menu-column-move', 'menu-column-undo',
    'selection-input-insert-text', 'selection-input-backspace', 'selection-input-delete', 'selection-input-enter', 'selection-input-cut', 'selection-input-ime',
    'selected-background', 'merged', 'split', 'split-undo', 'merge-undo',
    'clipboard-copied', 'clipboard-cleared', 'clipboard-pasted', 'clipboard-paste-undo', 'clipboard-clear-undo', 'clipboard-clear-redo', 'clipboard-paste-redo',
    'styled', 'row-dragged', 'row-drag-undo', 'row-drag-redo', 'row-drag-restored',
    'column-dragged', 'column-drag-undo', 'column-drag-redo', 'column-drag-restored',
    'resize-cancelled', 'resized', 'resize-undo', 'resize-redo', 'autofit', 'autofit-repeat', 'autofit-undo', 'autofit-redo', 'retried', 'large-saved', 'large-dark-saved',
  ]
  assert.deepEqual(Object.keys(report.snapshots), expectedSnapshots)
  for (const snapshot of Object.values(report.snapshots)) {
    assert.equal(snapshot.sha256, tableOperationsHash(snapshot.content))
    assert.equal(snapshot.ui.tables, 1)
  }
  const content = name => report.snapshots[name].content
  assert.deepEqual(tableTextRows(content('initial')), originalRows)
  assert.deepEqual(tableTextRows(content('insert-row')), [originalRows[0], ['', '', ''], originalRows[1], originalRows[2]])
  assert.deepEqual(tableTextRows(content('insert-column')), originalRows.map(row => [row[0], '', row[1], row[2]]))
  for (const name of ['delete-row', 'delete-column', 'menu-row-undo', 'menu-column-undo']) sameJSON(content(name), content('initial'))
  assert.deepEqual(tableTextRows(content('menu-row-move')), [originalRows[1], originalRows[0], originalRows[2]])
  assert.deepEqual(tableTextRows(content('menu-column-move')), originalRows.map(row => [row[1], row[0], row[2]]))
  const inputRange = (record, prefix = 'input') => {
    const start = record[prefix + 'Start'], end = record[prefix + 'End']
    assert.ok(Number.isSafeInteger(start) && start >= 0)
    assert.ok(Number.isSafeInteger(end) && end > start && end <= report.nativeInputs.length)
    return report.nativeInputs.slice(start, end)
  }
  const keyInputs = (inputs, key, windowsVirtualKeyCode, modifiers = 0) => assert.deepEqual(
    inputs.map(input => ({ method: input.method, type: input.type, key: input.key, windowsVirtualKeyCode: input.windowsVirtualKeyCode, modifiers: input.modifiers })),
    ['rawKeyDown', 'keyUp'].map(type => ({ method: 'Input.dispatchKeyEvent', type, key, windowsVirtualKeyCode, modifiers })),
  )
  const compositionInput = (inputs, text, offset) => {
    assert.equal(inputs.length, 1)
    assert.deepEqual({ method: inputs[0].method, text: inputs[0].text, selectionStart: inputs[0].selectionStart, selectionEnd: inputs[0].selectionEnd },
      { method: 'Input.imeSetComposition', text, selectionStart: offset, selectionEnd: offset })
    assert.equal(inputs[0].replacementStart, undefined); assert.equal(inputs[0].replacementEnd, undefined)
  }
  const textInput = (inputs, text) => {
    assert.equal(inputs.length, 1); assert.equal(inputs[0].method, 'Input.insertText'); assert.equal(inputs[0].text, text)
  }
  const imeControl = report.imeControl
  assert.equal(imeControl.text, 'R3C3'); assert.equal(imeControl.snapshot, 'initial')
  const beforeIME = originalRows.map(row => [...row]); beforeIME[2][2] = ''
  assert.deepEqual(imeControl.before.rows.map(row => row.map(cell => cell.text)), beforeIME)
  for (const view of [imeControl.before, imeControl.composing, imeControl.committed]) {
    assert.equal(view.rootFocused, true); assert.equal(view.modebarFocused, false); assert.equal(view.editable, 'true'); assert.equal(view.tables, 1)
  }
  const composingRows = imeControl.composing.rows.map(row => row.map(cell => cell.text))
  assert.match(composingRows[2][2], /^R3C3\\u200b?$/)
  composingRows[2][2] = 'R3C3' // only the in-flight Chromium composition sentinel is ignored
  assert.deepEqual(composingRows, originalRows)
  assert.deepEqual(imeControl.committed.rows.map(row => row.map(cell => cell.text)), originalRows)
  compositionInput(inputRange(imeControl, 'compositionInput'), 'R3C3', 4)
  assert.equal(imeControl.commitInputStart, imeControl.compositionInputEnd)
  textInput(inputRange(imeControl, 'commitInput'), 'R3C3')
  assert.equal(imeControl.saveInputStart, imeControl.commitInputEnd)
  keyInputs(inputRange(imeControl, 'saveInput'), 's', 83, 2)
  const selectedView = (view, rootFocused = true) => {
    assert.equal(view.rootFocused, rootFocused, 'Selection isolation requires the expected native focus owner')
    assert.equal(view.modebarFocused, !rootFocused)
    assert.equal(view.editable, 'true'); assert.equal(view.tables, 1)
    assert.match(view.selection, /已选择 2 个单元格/)
    assert.deepEqual(view.rows.map(row => row.map(cell => cell.text)), originalRows, 'Selection input changed a selected or unselected cell')
  }
  const isolation = report.selectionIsolation
  for (const range of [isolation.source, isolation.retainedRange]) {
    assert.equal(range.rootFocused, true); assert.equal(range.text, 'R1C3')
    for (const endpoint of [range.anchor, range.focus]) assert.deepEqual(endpoint, { row: 0, column: 2, text: 'R1C3' })
  }
  const sourceInputs = inputRange(isolation.source)
  assert.equal(sourceInputs.length, 6)
  assert.deepEqual(sourceInputs.slice(0, 2).map(input => [input.method, input.type]), [
    ['Input.dispatchMouseEvent', 'mousePressed'], ['Input.dispatchMouseEvent', 'mouseReleased'],
  ])
  keyInputs(sourceInputs.slice(2, 4), 'Home', 36); keyInputs(sourceInputs.slice(4), 'End', 35, 8)
  const rectangleInputs = inputRange(isolation.rectangle)
  assert.ok(isolation.rectangle.inputStart > isolation.source.inputEnd)
  assert.deepEqual(rectangleInputs.map(input => [input.method, input.type, input.buttons, input.button]), [
    ['Input.dispatchMouseEvent', 'mouseMoved', 0, 'none'], ['Input.dispatchMouseEvent', 'mousePressed', 1, 'left'],
    ['Input.dispatchMouseEvent', 'mouseMoved', 1, 'left'], ['Input.dispatchMouseEvent', 'mouseReleased', 0, 'left'],
  ])
  assert.ok(rectangleInputs[2].x > rectangleInputs[0].x)
  assert.equal(rectangleInputs[0].x, rectangleInputs[1].x); assert.equal(rectangleInputs[2].x, rectangleInputs[3].x)
  assert.ok(rectangleInputs.every(input => Number.isFinite(input.x) && Number.isFinite(input.y) && Math.abs(input.y - rectangleInputs[0].y) <= 1))
  selectedView(isolation.selected)
  const isolationCases = [['insert-text'], ['backspace', 'Backspace', 8], ['delete', 'Delete', 46], ['enter', 'Enter', 13], ['cut', 'x', 88, 2]]
  assert.deepEqual(isolation.operations.map(operation => operation.name), isolationCases.map(([name]) => name))
  let priorInputEnd = isolation.rectangle.inputEnd
  for (let index = 0; index < isolationCases.length; index++) {
    const [name, key, code, modifiers] = isolationCases[index], operation = isolation.operations[index]
    assert.equal(operation.inputStart, priorInputEnd, 'Each isolation action requires its own next native input receipt')
    const inputs = inputRange(operation)
    if (name === 'insert-text') {
      assert.equal(inputs.length, 1); assert.equal(inputs[0].method, 'Input.insertText')
      assert.equal(inputs[0].text, 'TABLE-SELECTION-INPUT-MUST-NOT-WRITE')
    } else keyInputs(inputs, key, code, modifiers)
    selectedView(operation.before); selectedView(operation.after)
    assert.equal(operation.snapshot, 'selection-input-' + name)
    assert.equal(operation.saveInputStart, operation.inputEnd)
    keyInputs(inputRange(operation, 'saveInput'), 's', 83, 2)
    sameJSON(content(operation.snapshot), content('initial')); selectedView(report.snapshots[operation.snapshot].ui)
    priorInputEnd = operation.saveInputEnd
  }
  const ime = isolation.ime
  assert.equal(ime.compositionInputStart, priorInputEnd)
  selectedView(ime.before)
  compositionInput(inputRange(ime, 'compositionInput'), '表', 1)
  selectedView(ime.composing, false)
  assert.equal(ime.commitInputStart, ime.compositionInputEnd)
  textInput(inputRange(ime, 'commitInput'), '表'); selectedView(ime.committed, false)
  assert.equal(ime.saveInputStart, ime.commitInputEnd)
  keyInputs(inputRange(ime, 'saveInput'), 's', 83, 2)
  assert.equal(ime.snapshot, 'selection-input-ime')
  sameJSON(content(ime.snapshot), content('initial')); selectedView(report.snapshots[ime.snapshot].ui, false)
  const colored = tableFromContent(content('selected-background'))
  assert.ok(colored.children[1].children.slice(0, 2).every(cell => cell.backgroundColor === '#fff3cd'))
  assert.equal(tableFromContent(content('merged')).children[1].children[0].colSpan, 2)
  assert.deepEqual(tableTextRows(content('merged'))[1], ['R2C1R2C2', 'R2C3'])
  assert.deepEqual(tableTextRows(content('split'))[1], ['R2C1R2C2', '', 'R2C3'])
  sameJSON(content('split-undo'), content('merged')); sameJSON(content('merge-undo'), content('selected-background'))
  assert.equal(report.clipboard.method, 'native-copy-and-paste-buttons')
  assert.match(report.clipboard.selection, /已选择 2 个单元格/)
  for (const [operation, label, feedback] of [['copy', '复制', '已复制所选单元格'], ['paste', '粘贴', '已粘贴到所选区域']]) {
    const record = report.clipboard[operation]
    assert.equal(record.label, label); assert.equal(record.feedback, feedback)
    assert.ok(Number.isSafeInteger(record.inputStart) && record.inputStart >= 0)
    assert.equal(record.inputEnd - record.inputStart, 2)
    const input = report.nativeInputs.slice(record.inputStart, record.inputEnd)
    assert.deepEqual(input.map(item => item.method), ['Input.dispatchMouseEvent', 'Input.dispatchMouseEvent'])
    assert.deepEqual(input.map(item => item.type), ['mousePressed', 'mouseReleased'])
    assert.equal(input[0].x, input[1].x); assert.equal(input[0].y, input[1].y)
  }
  assert.ok(report.clipboard.paste.inputStart > report.clipboard.copy.inputEnd)
  const clearedRows = originalRows.map(row => [...row]); clearedRows[1][0] = ''; clearedRows[1][1] = ''
  assert.deepEqual(tableTextRows(content('clipboard-cleared')), clearedRows)
  assert.ok(tableFromContent(content('clipboard-cleared')).children[1].children.slice(0, 2).every(cell => cell.backgroundColor === '#fff3cd'))
  for (const name of ['clipboard-copied', 'clipboard-pasted', 'clipboard-clear-undo', 'clipboard-paste-redo']) sameJSON(content(name), content('selected-background'))
  for (const name of ['clipboard-paste-undo', 'clipboard-clear-redo']) sameJSON(content(name), content('clipboard-cleared'))
  const styled = tableFromContent(content('styled'))
  assert.equal(styled.rowStriping, true); assert.equal(styled.frozenRowCount, 1); assert.equal(styled.frozenColumnCount, 1)
  assert.equal(styled.children[0].children[1].backgroundColor, '#cff4fc')
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    assert.equal(styled.children[row].children[col].headerState, colored.children[row].children[col].headerState ^ (row === 0 ? 1 : 0) ^ (col === 0 ? 2 : 0))
  }
  assert.equal(report.styledView.rows[0][1].background, 'rgb(207, 244, 252)')
  assert.equal(report.styledView.rowStriping, true); assert.equal(report.styledView.frozenRow, 'true'); assert.equal(report.styledView.frozenColumn, 'true')
  assert.deepEqual(tableTextRows(content('row-dragged')), [originalRows[1], originalRows[2], originalRows[0]])
  assert.deepEqual(tableTextRows(content('column-dragged')), originalRows.map(row => [row[1], row[2], row[0]]))
  for (const name of ['row-drag-undo', 'row-drag-restored', 'column-drag-undo', 'column-drag-restored', 'resize-cancelled', 'resize-undo']) sameJSON(content(name), content('styled'))
  sameJSON(content('row-drag-redo'), content('row-dragged')); sameJSON(content('column-drag-redo'), content('column-dragged'))
  sameJSON(content('resize-redo'), content('resized'))
  const resized = tableFromContent(content('resized')), width = resized.colWidths[0]
  assert.ok(width >= 70 && width <= 600); assert.ok(resized.children.every(row => row.children[0].width === width))
  assert.notDeepEqual(resized, styled)
  sameJSON(content('autofit-repeat'), content('autofit')); sameJSON(content('autofit-undo'), content('resized')); sameJSON(content('autofit-redo'), content('autofit'))
  const fittedWidth = tableFromContent(content('autofit')).colWidths[0]
  assert.ok(fittedWidth >= 70 && fittedWidth < width)
  sameJSON(report.failedSave.persisted, content('autofit-redo'))
  assert.equal(report.failedSave.duplicateSaveKeys, 2)
  assert.ok(Number.isSafeInteger(report.failedSave.requestStartIndex) && report.failedSave.requestStartIndex >= 0)
  const successfulRetries = report.requests.slice(report.failedSave.requestStartIndex).filter(request =>
    request.path === '/api/files/' + report.fixture.mainID && request.method === 'PUT' && request.status === 200 && request.postData.includes('-offline-retry'))
  assert.equal(successfulRetries.length, 1); assert.equal(report.failedSave.successfulWrites, successfulRetries.length)
  assert.equal(report.failedSave.visible.rows[2][2].text, 'R3C3-offline-retry')
  const retried = originalRows.map(row => [...row]); retried[2][2] += '-offline-retry'
  assert.deepEqual(tableTextRows(content('retried')), retried)
  sameJSON(report.reloaded.content, content('retried')); assert.equal(report.reloaded.sha256, tableOperationsHash(report.reloaded.content))
  assert.notEqual(report.reloaded.originAfter, report.reloaded.originBefore)
  assert.deepEqual(report.reloaded.ui.rows.map(row => row.map(cell => cell.text)), retried)
  assert.equal(report.largeSeed.sha256, tableOperationsHash(report.largeSeed.content))
  const largeExpected = tableTextRows(report.largeSeed.content)
  assert.equal(largeExpected.length, 80); assert.ok(largeExpected.every(row => row.length === 3)); assert.ok(largeExpected.slice(1).every(row => row[0].length > 100))
  largeExpected[79][2] += '-tail-saved'
  assert.deepEqual(tableTextRows(content('large-saved')), largeExpected)
  assert.deepEqual(tableTextRows(content('large-dark-saved')), largeExpected)
  assert.equal(tableFromContent(content('large-dark-saved')).children[79].children[1].backgroundColor, '#cff4fc')
  for (const view of [report.smallMenu, report.darkMenu]) {
    assert.ok(view.width >= 640 && view.width <= 720 && view.height >= 400)
    assert.ok(view.left >= 0 && view.right <= view.width + 1 && view.top >= 0 && view.bottom <= view.height + 1)
    assert.equal(view.overflow, false)
  }
  assert.equal(report.darkMenu.theme, 'dark')
  assert.ok(report.darkCell.text.includes('LONG-80-2-'))
  assert.ok(nativeTableContrast(report.darkCell.foreground, report.darkCell.background) >= 4.5)
  const { vertical, horizontal } = report.frozenScroll
  assert.ok(vertical.after.scrollTop - vertical.before.scrollTop > 20)
  assert.ok(Math.abs(vertical.after.headTop - vertical.before.headTop) <= 1)
  assert.ok(vertical.before.normalTop - vertical.after.normalTop > 20)
  assert.ok(horizontal.before.scrollWidth - horizontal.before.clientWidth > 40)
  assert.ok(horizontal.after.scrollLeft - horizontal.before.scrollLeft > 20)
  assert.ok(Math.abs(horizontal.after.headLeft - horizontal.before.headLeft) <= 1)
  assert.ok(horizontal.before.normalLeft - horizontal.after.normalLeft > 20)
  assert.equal(report.minimumWindow.pid, report.pid); assert.equal(report.minimumWindow.applied, true)
  assert.equal(report.minimumWindow.width, 720); assert.equal(report.minimumWindow.height, 520)
  sameJSON(report.saved.main.content, content('retried')); sameJSON(report.saved.large.content, content('large-dark-saved'))
  assert.equal(report.saved.main.id, report.fixture.mainID); assert.equal(report.saved.large.id, report.fixture.largeID); assert.equal(report.saved.destination.id, report.fixture.destinationID)
  assert.ok(report.nativeInputs.length > 100)
  report.nativeInputs.forEach((input, index) => {
    assert.equal(input.sequence, index + 1)
    assert.ok(['Input.dispatchKeyEvent', 'Input.insertText', 'Input.imeSetComposition', 'Input.dispatchMouseEvent', 'Input.dispatchDragEvent'].includes(input.method))
    if (input.method === 'Input.dispatchMouseEvent' && input.type === 'mouseMoved' && input.buttons & 1) {
      assert.equal(input.button, 'left', 'Chromium drag movement requires button:left in addition to buttons:1')
    }
  })
  assert.deepEqual(report.nativeDrags.map(drag => drag.kind), ['row', 'col'])
  for (const drag of report.nativeDrags) {
    assert.equal(drag.completed, true)
    const inputs = inputRange(drag)
    assert.deepEqual(inputs.map(input => [input.method, input.type]), [
      ['Input.dispatchMouseEvent', 'mouseMoved'], ['Input.dispatchMouseEvent', 'mouseMoved'],
      ['Input.dispatchMouseEvent', 'mousePressed'], ['Input.dispatchMouseEvent', 'mouseMoved'],
      ['Input.dispatchDragEvent', 'dragEnter'], ['Input.dispatchDragEvent', 'dragOver'], ['Input.dispatchDragEvent', 'drop'],
      ['Input.dispatchMouseEvent', 'mouseReleased'],
    ])
    assert.deepEqual(inputs.slice(0, 4).map(input => [input.buttons, input.button]), [[0, 'none'], [0, 'none'], [1, 'left'], [1, 'left']])
    assert.equal(inputs[1].x, drag.source.x); assert.equal(inputs[1].y, drag.source.y)
    assert.equal(inputs[2].x, drag.source.x); assert.equal(inputs[2].y, drag.source.y)
    assert.equal(inputs[3].x, drag.source.x + 9); assert.equal(inputs[3].y, drag.source.y + 9)
    assert.equal(drag.intercepted.length, 1)
    const intercepted = drag.intercepted[0]
    assert.equal(intercepted.afterInputSequence, inputs[3].sequence)
    assert.ok(intercepted.data.dragOperationsMask & 16, 'Native Table drag must allow a move')
    assert.ok(intercepted.data.items.some(item => item.mimeType === 'application/x-local-notepad-table-reorder' && item.data))
    for (const input of inputs.slice(4, 7)) assert.deepEqual(input.data, intercepted.data, 'Drop data must come from this native drag interception')
    for (const input of inputs.slice(4)) { assert.equal(input.x, drag.target.x); assert.equal(input.y, drag.target.y) }
    assert.equal(inputs[7].buttons, 0); assert.equal(inputs[7].button, 'left')
  }
  const drops = report.nativeInputs.filter(input => input.method === 'Input.dispatchDragEvent' && input.type === 'drop')
  assert.equal(drops.length, 2)
  for (const drop of drops) assert.ok(drop.data.items.some(item => item.mimeType === 'application/x-local-notepad-table-reorder' && item.data))
  assert.ok(report.nativeInputs.some(input => input.method === 'Input.dispatchKeyEvent' && input.key === 'Escape'))
  assert.ok(report.requests.some(request => request.path === '/api/files/' + report.fixture.mainID && request.method === 'PUT' && request.status === 200))
  assert.ok(report.requests.some(request => request.path === '/api/files/' + report.fixture.mainID && request.method === 'PUT' && request.failure))
  for (const request of report.requests.filter(item => item.path.startsWith('/api/files/'))) {
    assert.ok([report.fixture.mainID, report.fixture.largeID, report.fixture.destinationID].some(id => request.path === '/api/files/' + id), 'Table test wrote an unowned note')
  }
  assert.deepEqual(report.screenshots.map(item => item.filename), TABLE_OPERATIONS_SCREENSHOTS)
  for (const screenshot of report.screenshots) {
    assert.equal(path.basename(screenshot.filename), screenshot.filename)
    assert.ok(screenshot.bytes > 1000); assert.match(screenshot.sha256, /^[a-f0-9]{64}$/)
  }
  return true
}

export function verifyTableOperationsReport(directory, expected) {
  const reportPath = path.join(directory, TABLE_OPERATIONS_REPORT)
  assert.equal(lstatSync(reportPath).isSymbolicLink(), false)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  validateTableOperationsReport(report, expected)
  for (const image of report.screenshots) {
    const location = path.join(directory, image.filename)
    assert.equal(lstatSync(location).isSymbolicLink(), false)
    const bytes = readFileSync(location)
    assert.equal(bytes.length, image.bytes); assert.equal(tableOperationsHash(bytes), image.sha256)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.ok(bytes.readUInt32BE(16) >= 640 && bytes.readUInt32BE(20) >= 400)
  }
  return report
}
