// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { HistoryPlugin, createEmptyHistoryState } from '@lexical/react/LexicalHistoryPlugin'
import { $createParagraphNode, $createTextNode, $getRoot, UNDO_COMMAND } from 'lexical'
import { INSERT_TABLE_COMMAND, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import ToolbarPlugin from './ToolbarPlugin'
import TableMenu from './TableMenu'
import { toast } from '~/services/toast'

const mocks = vi.hoisted(() => ({ loadXLSX: vi.fn() }))
vi.mock('../utils/fileUpload', async importOriginal => ({ ...await importOriginal(), loadXLSX: mocks.loadXLSX }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, root, editor, errors, props, readers, history
let rangeGeometry
beforeAll(() => {
  // jsdom keeps selectionchange asynchronous like Chromium; happy-dom fires
  // it during reconciliation and invents table-observer/history races. Supply
  // only the layout API jsdom lacks, as the existing editor focus tests do.
  rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  if (!rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterAll(() => { if (!rangeGeometry) delete Range.prototype.getBoundingClientRect })
const settle = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const snapshot = () => editor.getEditorState().toJSON()
const tables = () => snapshot().root.children.filter(node => node.type === 'table')
const cellTexts = () => tables()[0]?.children.map(row => row.children.map(cell => cell.children.map(p => p.children.map(t => t.text || (t.type === 'linebreak' ? '\n' : '')).join('')).join('\n')))

function Mode({ editable }) {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance; editor.setEditable(editable) }, [instance, editable])
  return null
}
function Harness({ editable, documentId, standalone }) {
  return <LexicalComposer initialConfig={{
    namespace: 'table-insertion', nodes: [TableNode, TableRowNode, TableCellNode],
    editorState: () => { const p = $createParagraphNode().append($createTextNode('original')); $getRoot().append(p); p.selectEnd() },
    onError: error => errors.push(error),
  }}>
    <Mode editable={editable} />
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <HistoryPlugin externalHistoryState={history} />
      <TablePlugin />
      {standalone ? <TableMenu documentId={documentId} /> : <ToolbarPlugin documentId={documentId} />}
    </div>
  </LexicalComposer>
}
async function render(next = {}) {
  props = { ...props, ...next }
  await act(async () => root.render(<Harness {...props} />))
  await settle()
}
async function click(selector) {
  const element = host.querySelector(selector)
  expect(element).toBeTruthy()
  await act(async () => element.click())
  await settle()
  return element
}
async function openGrid() {
  if (!props.standalone) await click('[aria-label="插入内容"]')
  await click('.table-insert-trigger')
}
function excelBytes(values, secondSheet = false) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(values), 'First')
  if (secondSheet) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['not the selected first sheet']]), 'Second')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}
async function startExcel(bytes = excelBytes([['value']])) {
  if (!host.querySelector('.toolbar-insert-menu')) await click('[aria-label="插入内容"]')
  const input = host.querySelector('input[accept=".xlsx,.xls"]')
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([bytes], 'table.xlsx')] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  return { input, reader: readers.at(-1), bytes }
}
async function finishExcel({ reader, bytes }) {
  reader.readyState = 2
  reader.result = bytes
  await act(async () => { await reader.onload?.({ target: reader }) })
  await settle()
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  errors = []; readers = []
  history = createEmptyHistoryState()
  props = { editable: true, documentId: 'note-A', standalone: false }
  vi.clearAllMocks()
  mocks.loadXLSX.mockResolvedValue(XLSX)
  vi.stubGlobal('FileReader', class {
    constructor() { this.readyState = 0; readers.push(this) }
    readAsArrayBuffer(file) { this.file = file; this.readyState = 1 }
    abort() { this.readyState = 2; this.aborted = true; this.onabort?.() }
  })
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await render()
  // Establish the same post-mount history baseline as LoadContentPlugin.
  await act(async () => editor.update(() => {
    const paragraph = $createParagraphNode().append($createTextNode('original'))
    $getRoot().clear().append(paragraph)
    paragraph.selectEnd()
  }, { discrete: true }))
  await settle()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('inserts the selected dimensions and closes both insertion popups, then undoes once', async () => {
  await openGrid()
  await click('[aria-label="2 行 3 列"]')
  expect(tables()).toHaveLength(1)
  expect(tables()[0].children).toHaveLength(2)
  expect(tables()[0].children.every(row => row.children.length === 3)).toBe(true)
  expect(host.querySelector('.toolbar-insert-menu')).toBeNull()
  await act(async () => editor.dispatchCommand(UNDO_COMMAND))
  await settle()
  expect(tables()).toHaveLength(0)
  expect(snapshot().root.children[0].children[0].text).toBe('original')
  expect(errors.map(error => error.stack)).toEqual([])
})

test('a stale grid click cannot insert after the live editor becomes read-only', async () => {
  await render({ standalone: true }); await openGrid()
  const item = host.querySelector('[aria-label="2 行 3 列"]'), before = snapshot()
  await act(async () => { editor.setEditable(false); item.click() })
  await settle()
  expect(snapshot()).toEqual(before)
})

test('a note change cancels an open grid instead of carrying its insertion to the next note', async () => {
  await render({ standalone: true }); await openGrid()
  await render({ documentId: 'note-B' })
  expect(host.querySelector('[aria-label="插入表格"]')).toBeNull()
  expect(tables()).toHaveLength(0)
})

test('keyboard focus updates the dimension preview and Escape closes the grid', async () => {
  await render({ standalone: true }); await openGrid()
  const cell = host.querySelector('[aria-label="2 行 3 列"]')
  await act(async () => cell.focus())
  expect(host.querySelector('.tm-size-preview').textContent).toBe('2 × 3')
  await act(async () => cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('[aria-label="插入表格"]')).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('.table-insert-trigger'))
})

test('Excel inserts the complete first sheet as a rectangular table with literal text and blank cells', async () => {
  const task = await startExcel(excelBytes([['first', 'line1\nline2'], [0, false], ['tail']], true))
  await finishExcel(task)
  expect(cellTexts()).toEqual([['first', 'line1\nline2'], ['0', 'false'], ['tail', '']])
  expect(tables()).toHaveLength(1)
  expect(host.querySelector('.toolbar-insert-menu')).toBeNull()
  expect(errors.map(error => error.stack)).toEqual([])
})

test('an empty worksheet refuses before any table is inserted', async () => {
  const task = await startExcel(excelBytes([])), before = snapshot()
  await finishExcel(task)
  expect(snapshot()).toEqual(before)
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/空|没有可插入/))
})

test('an inflated worksheet range is rejected before expanding it into rows', async () => {
  const expand = vi.fn(() => [['unwanted partial content']])
  mocks.loadXLSX.mockResolvedValue({ read: () => ({ SheetNames: ['First'], Sheets: { First: { '!ref': 'A1:B2001' } } }), utils: { decode_range: XLSX.utils.decode_range, sheet_to_json: expand } })
  const task = await startExcel(), before = snapshot()
  await finishExcel(task)
  expect(expand).not.toHaveBeenCalled()
  expect(snapshot()).toEqual(before)
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/4000|超过/))
})

test('two immediate Excel submissions share one pending read and insert only once', async () => {
  const task = await startExcel()
  await act(async () => task.input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(readers).toHaveLength(1)
  expect(task.input.disabled).toBe(true)
  await finishExcel(task)
  expect(tables()).toHaveLength(1)
})

test('a failed Excel read leaves the body intact and allows retry', async () => {
  const task = await startExcel(), before = snapshot()
  await act(async () => task.reader.onerror?.())
  expect(snapshot()).toEqual(before)
  expect(toast.error).toHaveBeenCalledWith('读取 Excel 文件失败')
  expect(task.input.disabled).toBe(false)
  const retry = await startExcel()
  await finishExcel(retry)
  expect(tables()).toHaveLength(1)
})

test('Excel retains the insertion point while the user moves the caret during file reading', async () => {
  await act(async () => editor.update(() => {
    const first = $createParagraphNode().append($createTextNode('first'))
    $getRoot().clear().append(first, $createParagraphNode().append($createTextNode('last')))
    first.selectEnd()
  }, { discrete: true }))
  const task = await startExcel()
  await act(async () => editor.update(() => $getRoot().getLastChild().selectEnd(), { discrete: true }))
  await finishExcel(task)
  expect(snapshot().root.children.map(node => node.type === 'table' ? 'table' : node.children.map(child => child.text).join(''))).toEqual(['first', 'table', 'last'])
})

test('Excel refuses an obsolete insertion after the document body changes during reading', async () => {
  const task = await startExcel()
  await act(async () => editor.update(() => $getRoot().getFirstChild().getFirstChild().setTextContent('edited while reading'), { discrete: true }))
  const changed = snapshot()
  await finishExcel(task)
  expect(snapshot()).toEqual(changed)
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/正文已变化/))
})

test('Excel follows the existing no-nested-table insertion rule with an explicit explanation', async () => {
  await openGrid(); await click('[aria-label="1 行 1 列"]')
  await act(async () => editor.update(() => $getRoot().getChildren().find(node => node.getType() === 'table').getFirstChild().getFirstChild().getFirstChild().selectStart(), { discrete: true }))
  const before = snapshot()
  let nativeInserted
  await act(async () => { nativeInserted = editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '1', columns: '1' }) })
  expect(nativeInserted).toBe(false)
  expect(snapshot()).toEqual(before)
  await startExcel()
  expect(readers).toHaveLength(0)
  expect(snapshot()).toEqual(before)
  expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/表格外/))
})

test.each(['reading', 'document'])('a pending Excel read is cancelled at the %s boundary', async boundary => {
  const task = await startExcel(), before = snapshot()
  const lateCompletion = task.reader.onload
  await render(boundary === 'reading' ? { editable: false } : { documentId: 'note-B' })
  expect(task.reader.aborted).toBe(true)
  task.reader.result = task.bytes
  await act(async () => lateCompletion({ target: task.reader }))
  expect(snapshot()).toEqual(before)
  expect(mocks.loadXLSX).not.toHaveBeenCalled()
  expect(host.querySelector('.toolbar-progress')).toBeNull()
})
