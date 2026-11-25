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
  const view = table => ({ tables: 1, rows: table.children.map(row => row.children.map(cell => ({
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
    copy: { label: '复制', feedback: '已复制所选单元格', inputStart: 4, inputEnd: 6 },
    paste: { label: '粘贴', feedback: '已粘贴到所选区域', inputStart: 8, inputEnd: 10 },
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
  for (const index of [2, 3]) report.nativeInputs[index] = { sequence: index + 1, method: 'Input.dispatchDragEvent', type: 'drop', data: { items: [{ mimeType: 'application/x-local-notepad-table-reorder', data: 'real-start-token-placeholder' }] } }
  for (const start of [4, 8]) for (const [offset, type] of ['mousePressed', 'mouseReleased'].entries()) {
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
  ['missing native input', report => { report.nativeInputs = [] }],
  ['invented drag data', report => { report.nativeInputs[2].data.items = [] }],
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
