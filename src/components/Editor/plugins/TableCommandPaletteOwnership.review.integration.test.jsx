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
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { ListItemNode, ListNode } from '@lexical/list'
import { FormulaNode } from '../nodes/FormulaNode'
import { AttachmentNode } from '../nodes/AttachmentNode'
import { ImageNode } from '../nodes/ImageNode'
import { reloadShortcutPreferences, SHORTCUT_STORAGE_KEY } from '~/services/localShortcuts'
import TableSelectionPlugin from './TableSelectionPlugin'
import CommandPalettePlugin from './CommandPalettePlugin'

const mocks = vi.hoisted(() => ({ uploadFile: vi.fn(), warning: vi.fn() }))
vi.mock('../utils/fileUpload', async original => ({ ...await original(), uploadFile: mocks.uploadFile }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: mocks.warning, error: vi.fn() } }))

let host, reactRoot, editor, errors, pickers, finishUpload
const rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const snapshot = () => editor.getEditorState().toJSON()
const cells = () => [...host.querySelectorAll('td')]
const allNodes = node => [node, ...(node.children || []).flatMap(allNodes)]
const captureWindowError = event => errors.push(event.error || new Error(event.message))
function Capture() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}
function Harness({ documentId = 'palette-note' } = {}) {
  return <LexicalComposer initialConfig={{ namespace: 'table-palette-owner', nodes: [TableNode, TableRowNode, TableCellNode, ListNode, ListItemNode, FormulaNode, AttachmentNode, ImageNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (const row of [['OLD-CELL', 'other'], ['selected-C', 'selected-D']]) table.append($createTableRowNode().append(...row.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    $getRoot().append(table)
  } }}>
    <div className="editor-shell">
      <CommandPalettePlugin documentId={documentId} />
      <div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <TablePlugin /><ListPlugin /><CheckListPlugin /><Capture />
        <TableSelectionPlugin documentId={documentId} />
      </div>
    </div>
  </LexicalComposer>
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []; pickers = []; mocks.warning.mockClear()
  localStorage.removeItem(SHORTCUT_STORAGE_KEY); reloadShortcutPreferences()
  window.addEventListener('error', captureWindowError)
  if (!rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  mocks.uploadFile.mockReset().mockImplementation(() => new Promise(resolve => { finishUpload = resolve }))
  const nativeClick = HTMLInputElement.prototype.click
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () {
    // jsdom cannot display an operating-system picker. Retain the actual file
    // input created by blockRegistry and later deliver its real change event.
    if (this.type === 'file') { pickers.push(this); return }
    return nativeClick.call(this)
  })
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  await act(async () => reactRoot.render(<Harness />)); await settle()
  const text = cells()[0].querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, 3)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(editor.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) ? selection.getTextContent() : null
  })).toBe('OLD')
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  host.remove(); window.removeEventListener('error', captureWindowError)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
  if (!rangeGeometry) delete Range.prototype.getBoundingClientRect
  localStorage.removeItem(SHORTCUT_STORAGE_KEY); reloadShortcutPreferences()
})
async function selectOtherCells() {
  await act(async () => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true, bubbles: true }))); await settle()
  await act(async () => {
    cells()[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }))
    cells()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
    cells()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
    cells()[3].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 }))
    cells()[3].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  }); await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
}
async function exitSelection() {
  const finish = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '完成')
  await act(async () => finish.click()); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
}
async function openPalette() {
  await act(async () => {
    // A real keyboard opening starts in the editor, including after sidebar
    // navigation removed the previous panel and its focused search input.
    editor.getRootElement().focus()
  })
  await settle()
  await act(async () => editor.getRootElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })))
  await act(async () => new Promise(resolve => requestAnimationFrame(resolve))); await settle()
  expect(host.querySelector('[aria-label="编辑器命令"][role="dialog"]')).toBeTruthy()
}
function paletteCommand(label) {
  const command = [...host.querySelectorAll('.editor-command-item')].find(button => button.querySelector('strong').textContent === label)
  expect(command).toBeTruthy()
  return command
}
async function chooseCommand(label) {
  await openPalette()
  const command = paletteCommand(label)
  await act(async () => command.click()); await settle()
}
const contentCommands = [['数学公式', 'formula'], ['待办清单', 'list']]
test.each(contentCommands)('ordinary palette command %s still inserts its actual content', async (label, type) => {
  const before = snapshot(); await chooseCommand(label)
  expect(allNodes(snapshot().root).some(node => node.type === type)).toBe(true)
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  expect(errors).toEqual([])
})
test.each(contentCommands)('bulk selection prevents palette command %s from editing the old range', async label => {
  await selectOtherCells(); const before = snapshot(); await chooseCommand(label)
  expect(snapshot()).toEqual(before)
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  expect(errors).toEqual([])
})
test.each(contentCommands)('finishing bulk selection restores the ordinary palette command %s', async (label, type) => {
  await selectOtherCells(); await exitSelection(); await chooseCommand(label)
  expect(allNodes(snapshot().root).some(node => node.type === type)).toBe(true)
  expect(errors).toEqual([])
})
test.each([
  ['文内查找与替换', 'editor:open-search'],
  ['文档目录', 'editor:toggle-outline'],
  ['长篇结构管理', 'editor:open-structure-manager'],
  ['复制当前章节引用', 'editor:copy-current-reference'],
])('bulk selection keeps the read/view palette command %s available', async (label, eventName) => {
  await selectOtherCells(); const before = snapshot(), receive = vi.fn()
  window.addEventListener(eventName, receive)
  try { await chooseCommand(label) } finally { window.removeEventListener(eventName, receive) }
  expect(receive).toHaveBeenCalledTimes(1)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test('the existing palette entry still enables table selection without changing the document', async () => {
  const before = snapshot(); await chooseCommand('表格多选模式')
  expect(host.querySelector('.table-selection-modebar')).toBeTruthy()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
async function startUpload(label) {
  await chooseCommand(label); expect(pickers).toHaveLength(1)
  const file = new File(['owned'], label === '图片' ? 'owned.png' : 'owned.txt', { type: label === '图片' ? 'image/png' : 'text/plain' })
  Object.defineProperty(pickers[0], 'files', { configurable: true, value: [file] })
  await act(async () => pickers[0].dispatchEvent(new Event('change', { bubbles: true }))); await settle()
  expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
}
async function completeUpload(label) {
  await act(async () => { finishUpload({ url: label === '图片' ? '/api/assets/owned.png' : '/api/assets/owned.txt' }); await Promise.resolve() }); await settle()
}
test.each([['图片', 'image'], ['附件', 'attachment']])('ordinary palette %s upload keeps its completion path working', async (label, type) => {
  await startUpload(label); await completeUpload(label)
  expect(allNodes(snapshot().root).some(node => node.type === type)).toBe(true)
  expect(errors).toEqual([])
})
test.each(['图片', '附件'])('bulk selection refuses a new %s picker before any upload starts', async label => {
  await selectOtherCells(); const before = snapshot(); await chooseCommand(label)
  expect(pickers).toHaveLength(0)
  expect(mocks.uploadFile).not.toHaveBeenCalled()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
for (const exit of [false, true]) test.each(['图片', '附件'])(`pending palette %s cannot revive after bulk ownership changes (exit=${exit})`, async label => {
  await startUpload(label); await selectOtherCells()
  if (exit) await exitSelection()
  const before = snapshot(); await completeUpload(label)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test('switching documents closes the old palette instead of inserting into the newly loaded body', async () => {
  await openPalette()
  const oldCommand = paletteCommand('数学公式')
  // The editor shell is retained across sidebar navigation; the document prop
  // and serialized content change, just as they do in the mounted Editor.
  await act(async () => reactRoot.render(<Harness documentId="palette-note-B" />)); await settle()
  const nextDocument = JSON.parse(JSON.stringify(snapshot()).replace('OLD-CELL', 'NEW-CELL'))
  await act(async () => editor.setEditorState(editor.parseEditorState(nextDocument))); await settle()
  const before = snapshot(), focus = vi.spyOn(editor, 'focus')
  await act(async () => oldCommand.click()); await settle()
  expect(snapshot()).toEqual(before)
  expect(host.querySelector('.editor-command-palette')).toBeNull()
  expect(focus).not.toHaveBeenCalled()
  expect(errors).toEqual([])
})
test('a new palette opened after document navigation still runs content commands', async () => {
  await openPalette()
  await act(async () => reactRoot.render(<Harness documentId="palette-note-B" />)); await settle()
  await chooseCommand('数学公式')
  expect(allNodes(snapshot().root).some(node => node.type === 'formula')).toBe(true)
  expect(errors).toEqual([])
})
test.each(['图片', '附件'])('a pending palette %s upload stays invalid after switching documents and returning', async label => {
  await startUpload(label)
  await act(async () => reactRoot.render(<Harness documentId="palette-note-B" />)); await settle()
  await act(async () => reactRoot.render(<Harness />)); await settle()
  const before = snapshot(); await completeUpload(label)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
