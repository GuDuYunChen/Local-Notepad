// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import BlockHandlePlugin, { getInternalBlockClipboard, setInternalBlockClipboard } from './BlockHandlePlugin'
import DragDropPlugin from './DragDropPlugin'
import TableSelectionPlugin from './TableSelectionPlugin'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, reactRoot, editor, errors, props
const rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const rect = (left, top, width, height) => new DOMRect(left, top, width, height)
const port = rect(180, 100, 700, 500)
const snapshot = () => editor.getEditorState().toJSON()
const cells = () => [...host.querySelectorAll('td')]
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const windowError = event => errors.push(event.error || new Error(event.message))
const menuItem = (label) => [...host.querySelectorAll('.block-menu [role="menuitem"]')].find(item => item.textContent.includes(label))
const labels = ['上方插入空白块', '下方插入空白块', '粘贴复制块到下方', '重复当前块', '一级标题', '删除当前块']

function Capture() {
  const [value] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = value }, [value])
  return null
}
function Harness({ documentId = 'table-block-a', editing = true }) {
  return <LexicalComposer initialConfig={{ namespace: 'table-block-owner', nodes: [TableNode, TableRowNode, TableCellNode, HeadingNode, QuoteNode, ListNode, ListItemNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (const values of [['OLD-CELL', 'other'], ['selected-C', 'selected-D']]) table.append($createTableRowNode().append(...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    $getRoot().append(table, $createParagraphNode().append($createTextNode('Outside A')), $createParagraphNode().append($createTextNode('Outside B')))
  } }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin /><Capture />
      {editing && <><BlockHandlePlugin documentId={documentId} /><DragDropPlugin documentId={documentId} /><TableSelectionPlugin documentId={documentId} /></>}
    </div>
  </LexicalComposer>
}
async function render(next = {}) {
  props = { ...props, ...next }
  await act(async () => reactRoot.render(<Harness {...props} />)); await settle()
}
async function selectText(element, text = 'OLD') {
  const node = element.querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    for (const [type, buttons] of [['pointerdown', 1], ['pointerup', 0]]) element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons }))
    document.getSelection().setBaseAndExtent(node, 0, node, text.length)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(editor.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) ? selection.getTextContent() : null
  })).toBe(text)
}
async function exposeHandle() {
  await act(async () => host.querySelector('.editor-container').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: port.left + 10, clientY: port.top + 50 })))
  const handle = host.querySelector('.block-handle')
  expect(handle).toBeTruthy()
  return handle
}
async function openMenu() {
  const handle = await exposeHandle()
  if (!host.querySelector('.block-menu')) await act(async () => handle.click())
  expect(host.querySelector('.block-menu')).toBeTruthy()
}
async function prepareAction(label) {
  if (label === '粘贴复制块到下方') {
    await openMenu(); await act(async () => menuItem('复制当前块').click()); await settle()
    expect(getInternalBlockClipboard().nodes).toHaveLength(1)
  }
  await openMenu()
  const control = menuItem(label)
  expect(control).toBeTruthy()
  return control
}
function mode(active) { editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: active })) }
async function selectOtherCells() {
  await act(async () => mode(true)); await settle()
  await act(async () => {
    cells()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    cells()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 }))
    cells()[3].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  }); await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
}
async function finishSelection() {
  const finish = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '完成')
  expect(finish).toBeTruthy()
  await act(async () => finish.click()); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
}
function dragEvent(target, type, dataTransfer, clientY = 370) {
  // jsdom has no native DragEvent/DataTransfer implementation. Supply only
  // their public payload; the real container capture handlers and Lexical run.
  const event = new DragEvent(type, { bubbles: true, cancelable: true, clientY, dataTransfer })
  target.dispatchEvent(event)
  return event
}
function transfer() {
  const data = new Map()
  return { effectAllowed: '', dropEffect: '', files: [], types: [], setData: (type, value) => data.set(type, value), getData: type => data.get(type) || '' }
}
async function startDrag() {
  await selectText(editor.getRootElement().children[1], 'Outside A')
  const handle = await exposeHandle(), dataTransfer = transfer()
  await act(async () => dragEvent(handle, 'dragstart', dataTransfer))
  return { handle, dataTransfer, target: editor.getRootElement().lastElementChild }
}
async function drop(drag) {
  await act(async () => {
    dragEvent(drag.target, 'dragover', drag.dataTransfer)
    dragEvent(drag.target, 'drop', drag.dataTransfer)
  }); await settle()
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []; props = {}; setInternalBlockClipboard(null)
  window.addEventListener('error', windowError)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('DragEvent', class extends MouseEvent {
    constructor(type, options) { super(type, options); this.dataTransfer = options.dataTransfer }
  })
  vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 800)
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(256, 160, 60, 24) })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('editor-container')) return port
    if (this.matches('.editor-input > table')) return rect(256, 150, 400, 120)
    if (this.matches('.editor-input > p')) return rect(256, this.textContent === 'Outside A' ? 300 : 340, 400, 24)
    if (this.matches('td, th')) return rect(256, 160, 200, 40)
    return rect(256, 150, 200, 24)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () { return this.classList.contains('block-menu') ? 210 : 24 })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () { return this.classList.contains('block-menu') ? 320 : 24 })
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  await render()
  Object.defineProperties(host.querySelector('.editor-container'), { clientWidth: { configurable: true, value: port.width }, clientHeight: { configurable: true, value: port.height } })
  await selectText(cells()[0])
  expect(errors).toEqual([])
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  host.remove(); window.removeEventListener('error', windowError)
  if (rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeGeometry)
  else delete Range.prototype.getBoundingClientRect
  vi.restoreAllMocks(); vi.unstubAllGlobals(); setInternalBlockClipboard(null); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test.each(labels)('ordinary block menu %s still writes the explicitly selected outside paragraph', async label => {
  await selectText(editor.getRootElement().children[1], 'Outside A')
  const control = await prepareAction(label), before = snapshot()
  await act(async () => control.click()); await settle()
  expect(snapshot()).not.toEqual(before)
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  expect(snapshot().root.children[0]).toEqual(before.root.children[0])
  expect(errors).toEqual([])
})
test.each(labels)('bulk selection blocks actual block menu %s from changing the old cell', async label => {
  if (label === '粘贴复制块到下方') { await prepareAction(label); await act(async () => host.querySelector('.block-handle').click()) }
  await selectOtherCells()
  const control = await prepareAction(label), before = snapshot()
  await act(async () => control.click()); await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test.each(['一级标题', '重复当前块'])('an open %s menu cannot revive after Table selection begins and ends', async label => {
  const control = await prepareAction(label), before = snapshot()
  await act(async () => { mode(true); mode(false); control.click() }); await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test.each([false, true])('a queued block duplicate cannot cross Table ownership (exit=%s)', async exit => {
  const control = await prepareAction('重复当前块'), pending = [], apply = editor.update.bind(editor)
  const intercept = vi.spyOn(editor, 'update').mockImplementation((callback, options) => pending.push({ callback, options }))
  try { await act(async () => control.click()); expect(pending).toHaveLength(1) } finally { intercept.mockRestore() }
  await selectOtherCells(); if (exit) await finishSelection()
  const before = snapshot()
  await act(async () => apply(pending[0].callback, { ...pending[0].options, discrete: true })); await settle()
  expect(snapshot()).toEqual(before); expect(errors).toEqual([])
})
test('finishing bulk selection and reopening the block menu restores ordinary writes', async () => {
  await selectOtherCells(); await finishSelection()
  const control = await prepareAction('重复当前块'), before = snapshot()
  await act(async () => control.click()); await settle()
  expect(snapshot()).not.toEqual(before); expect(errors).toEqual([])
})
test('explicit copy-current-block remains read-only and usable during Table selection', async () => {
  await selectOtherCells(); const before = snapshot()
  const control = await prepareAction('复制当前块')
  await act(async () => control.click()); await settle()
  expect(getInternalBlockClipboard().nodes).toEqual([before.root.children[0]])
  expect(snapshot()).toEqual(before); expect(errors).toEqual([])
})
test.each(['reading', 'document', 'unmount'])('a queued block write is cancelled by %s lifecycle changes', async change => {
  const control = await prepareAction('重复当前块'), pending = [], apply = editor.update.bind(editor)
  const intercept = vi.spyOn(editor, 'update').mockImplementation((callback, options) => pending.push({ callback, options }))
  try { await act(async () => control.click()); expect(pending).toHaveLength(1) } finally { intercept.mockRestore() }
  if (change === 'reading') await act(async () => editor.setEditable(false))
  if (change === 'document') await render({ documentId: 'table-block-b' })
  if (change === 'unmount') await render({ editing: false })
  const before = snapshot()
  await act(async () => apply(pending[0].callback, { ...pending[0].options, discrete: true })); await settle()
  expect(snapshot()).toEqual(before); expect(errors).toEqual([])
})
test('ordinary block dragging reorders the real outside paragraph', async () => {
  const drag = await startDrag(), table = snapshot().root.children[0]
  await drop(drag)
  expect(snapshot().root.children.slice(1).map(node => node.children[0].text)).toEqual(['Outside B', 'Outside A'])
  expect(snapshot().root.children[0]).toEqual(table); expect(errors).toEqual([])
})
test('bulk selection refuses starting a stale outside block drag', async () => {
  await selectText(editor.getRootElement().children[1], 'Outside A')
  await selectOtherCells()
  const handle = await exposeHandle(), dataTransfer = transfer(), target = editor.getRootElement().lastElementChild, before = snapshot()
  let start
  await act(async () => { start = dragEvent(handle, 'dragstart', dataTransfer) })
  await drop({ target, dataTransfer })
  expect(start.defaultPrevented).toBe(true)
  expect(snapshot()).toEqual(before); expect(errors).toEqual([])
})
test.each([false, true])('a started block drag cannot cross Table ownership (exit=%s)', async exit => {
  const drag = await startDrag()
  await selectOtherCells(); if (exit) await finishSelection()
  const before = snapshot()
  await drop(drag)
  expect(snapshot()).toEqual(before)
  expect(host.querySelector('.block-being-dragged, .block-drop-before, .block-drop-after')).toBeNull()
  expect(errors).toEqual([])
})
test.each([false, true])('a queued block drop cannot cross Table ownership (exit=%s)', async exit => {
  const drag = await startDrag(), pending = [], apply = editor.update.bind(editor)
  const intercept = vi.spyOn(editor, 'update').mockImplementation((callback, options) => pending.push({ callback, options }))
  try { await drop(drag); expect(pending).toHaveLength(1) } finally { intercept.mockRestore() }
  await selectOtherCells(); if (exit) await finishSelection()
  const before = snapshot()
  await act(async () => apply(pending[0].callback, { ...pending[0].options, discrete: true })); await settle()
  expect(snapshot()).toEqual(before); expect(errors).toEqual([])
})
test('a new block drag after ending Table selection retains ordinary reorder behavior', async () => {
  await selectOtherCells(); await finishSelection()
  await drop(await startDrag())
  expect(snapshot().root.children.slice(1).map(node => node.children[0].text)).toEqual(['Outside B', 'Outside A'])
  expect(errors).toEqual([])
})
test.each(['reading', 'document', 'unmount'])('a started block drag is cancelled by %s lifecycle changes', async change => {
  const drag = await startDrag()
  if (change === 'reading') await act(async () => editor.setEditable(false))
  if (change === 'document') await render({ documentId: 'table-block-b' })
  if (change === 'unmount') await render({ editing: false })
  const before = snapshot()
  await drop(drag)
  expect(snapshot()).toEqual(before); expect(errors).toEqual([])
})

test('the handle displayed alongside a Table moves that whole Table after the outside paragraphs', async () => {
  const original = snapshot().root.children, handle = await exposeHandle(), dataTransfer = transfer()
  const tableKey = editor.getEditorState().read(() => $getRoot().getFirstChild().getKey())
  await act(async () => dragEvent(handle, 'dragstart', dataTransfer))
  await drop({ target: editor.getRootElement().lastElementChild, dataTransfer })
  expect(snapshot().root.children).toEqual([original[1], original[2], original[0]])
  expect(handle.dataset.blockKey).toBe(tableKey)
  expect(errors).toEqual([])
})
test('copy-current-block on the displayed Table handle copies the complete Table without writing', async () => {
  const control = await prepareAction('复制当前块'), before = snapshot()
  await act(async () => control.click()); await settle()
  expect(getInternalBlockClipboard().nodes).toEqual([before.root.children[0]])
  expect(snapshot()).toEqual(before); expect(errors).toEqual([])
})
test.each(labels)('the displayed Table block menu %s targets the whole Table and preserves outside siblings', async label => {
  const control = await prepareAction(label), before = snapshot().root.children
  const tableText = editor.getEditorState().read(() => $getRoot().getFirstChild().getTextContent())
  await act(async () => control.click()); await settle()
  const children = snapshot().root.children
  if (label === '删除当前块') expect(children).toEqual(before.slice(1))
  else if (label === '一级标题') {
    expect(children[0].type).toBe('heading'); expect(children[0].tag).toBe('h1')
    expect(editor.getEditorState().read(() => $getRoot().getFirstChild().getTextContent())).toBe(tableText)
    expect(children.slice(1)).toEqual(before.slice(1))
  } else {
    expect(children).toHaveLength(4)
    expect(children.slice(2)).toEqual(before.slice(1))
    if (label === '上方插入空白块') {
      expect(children[0].type).toBe('paragraph'); expect(children[0].children).toEqual([])
      expect(children[1]).toEqual(before[0])
    } else if (label === '下方插入空白块') {
      expect(children[0]).toEqual(before[0])
      expect(children[1].type).toBe('paragraph'); expect(children[1].children).toEqual([])
    } else expect(children.slice(0, 2)).toEqual([before[0], before[0]])
  }
  expect(errors).toEqual([])
})
