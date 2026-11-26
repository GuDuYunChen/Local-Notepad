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
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { AttachmentNode } from '../nodes/AttachmentNode'
import { ImageNode } from '../nodes/ImageNode'
import { $createCodeBlockNode, CodeBlockNode } from '../nodes/CodeBlockNode'
import SlashMenuPlugin from './SlashMenuPlugin'
import TableSelectionPlugin from './TableSelectionPlugin'

const mocks = vi.hoisted(() => ({ uploadFile: vi.fn() }))
vi.mock('../utils/fileUpload', async original => ({ ...await original(), uploadFile: mocks.uploadFile }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, reactRoot, editor, errors, finishUpload, documentId
const rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const snapshot = () => editor.getEditorState().toJSON()
const cells = () => [...host.querySelectorAll('td')]
const allNodes = node => [node, ...(node.children || []).flatMap(allNodes)]
function Capture() {
  const [value] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = value }, [value])
  return null
}
function Harness({ noteId }) {
  return <LexicalComposer initialConfig={{ namespace: 'table-slash-owner', nodes: [TableNode, TableRowNode, TableCellNode, AttachmentNode, ImageNode, CodeBlockNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (const values of [['OLD-CELL', 'other'], ['selected-C', 'selected-D']]) table.append($createTableRowNode().append(...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    $getRoot().append(table, $createParagraphNode().append($createTextNode('/')))
  } }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin /><HistoryPlugin /><Capture /><SlashMenuPlugin documentId={noteId} /><TableSelectionPlugin documentId={noteId} />
    </div>
  </LexicalComposer>
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; errors = []; documentId = 'slash-note'
  mocks.uploadFile.mockReset().mockImplementation(() => new Promise(resolve => { finishUpload = resolve }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(100, 180, 60, 24) })
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  await act(async () => reactRoot.render(<Harness noteId={documentId} />)); await settle()
  const text = editor.getRootElement().lastElementChild.querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 1, text, 1)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(editor.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === 'text'
  })).toBe(true)
  expect(errors).toEqual([])
})
afterEach(async () => {
  await act(async () => reactRoot.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeGeometry)
  else delete Range.prototype.getBoundingClientRect
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function query(value) {
  // Prepare the typed trigger; menu execution below uses actual mounted UI.
  // jsdom does not perform Chromium's default text insertion for beforeinput.
  await act(async () => editor.update(() => {
    const text = $getRoot().getLastChild().getFirstChild()
    text.setTextContent('/' + value); text.selectEnd()
  }, { discrete: true }))
  await settle()
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toContain('/' + value)
}
const option = label => [...host.querySelectorAll('.slash-menu [role="option"]')].find(node => node.querySelector('.slash-menu-label')?.textContent === label)
async function choose(label) { const target = option(label); expect(target).toBeTruthy(); await act(async () => target.click()); await settle() }

test('the actual text caret opens the existing slash Table command and inserts its default 3 by 3 table', async () => {
  await query('table'); const before = snapshot().root.children[0]
  await choose('表格')
  const tables = allNodes(snapshot().root).filter(node => node.type === 'table')
  expect(tables).toHaveLength(2)
  expect(tables[0]).toEqual(before)
  expect(tables[1].children).toHaveLength(3)
  expect(tables[1].children.every(row => row.children.length === 3)).toBe(true)
  expect(JSON.stringify(snapshot())).not.toContain('/table')
  expect(host.querySelector('.slash-menu')).toBeNull()
  expect(errors).toEqual([])
})
test('Escape cancels an opened slash Table menu without changing the existing document', async () => {
  await query('table'); expect(option('表格')).toBeTruthy(); const before = snapshot()
  await act(async () => editor.getRootElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); await settle()
  expect(host.querySelector('.slash-menu')).toBeNull()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

async function bulk(exit = false) {
  await act(async () => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true, bubbles: true }))); await settle()
  await act(async () => {
    cells()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    cells()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 }))
    cells()[3].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  }); await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  if (exit) {
    const finish = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '完成')
    await act(async () => finish.click()); await settle()
  }
}
function filePicker() {
  const inputs = [], original = HTMLInputElement.prototype.click
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () {
    if (this.type === 'file') inputs.push(this)
    else original.call(this)
  })
  return inputs
}
async function startUpload(kind) {
  const inputs = filePicker()
  await query(kind); await choose(kind === 'image' ? '图片' : '附件')
  expect(inputs).toHaveLength(1)
  const image = kind === 'image'
  Object.defineProperty(inputs[0], 'files', { configurable: true, value: [new File(['owned'], image ? 'owned.png' : 'owned.txt', { type: image ? 'image/png' : 'text/plain' })] })
  await act(async () => inputs[0].dispatchEvent(new Event('change', { bubbles: true })))
  expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
}
test.each(['attachment', 'image'])('ordinary slash %s upload inserts through the actual content command', async kind => {
  await startUpload(kind)
  await act(async () => finishUpload({ url: '/api/assets/owned' })); await settle()
  expect(allNodes(snapshot().root).some(node => node.type === kind)).toBe(true)
  expect(errors).toEqual([])
})
test.each([false, true])('a slash Table menu cannot write after selection ownership changes (exit=%s)', async exit => {
  await query('table'); expect(option('表格')).toBeTruthy()
  await bulk(exit); const before = snapshot()
  const stale = option('表格')
  if (stale) { await act(async () => stale.click()); await settle() }
  expect(snapshot()).toEqual(before)
  expect(allNodes(snapshot().root).filter(node => node.type === 'table')).toHaveLength(1)
  expect(errors).toEqual([])
})
test.each(['attachment', 'image'])('bulk ownership rejects a slash %s picker without removing its old trigger', async kind => {
  const inputs = filePicker()
  await query(kind); const label = kind === 'image' ? '图片' : '附件'
  expect(option(label)).toBeTruthy(); await bulk(); const before = snapshot()
  const stale = option(label)
  if (stale) { await act(async () => stale.click()); await settle() }
  expect(inputs).toEqual([])
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test.each([['attachment', false], ['attachment', true], ['image', false], ['image', true]])('pending slash %s upload cannot revive across bulk selection (exit=%s)', async (kind, exit) => {
  await startUpload(kind); await bulk(exit); const before = snapshot()
  await act(async () => finishUpload({ url: '/api/assets/stale' })); await settle()
  expect(snapshot()).toEqual(before)
  expect(allNodes(snapshot().root).some(node => node.type === kind)).toBe(false)
  expect(errors).toEqual([])
})
test('pending slash attachment remains invalid after switching the note', async () => {
  await startUpload('attachment')
  await act(async () => reactRoot.render(<Harness noteId="another-note" />)); await settle()
  const before = snapshot()
  await act(async () => finishUpload({ url: '/api/assets/stale' })); await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test('pending slash image remains invalid after a reading-mode round trip', async () => {
  await startUpload('image')
  await act(async () => { editor.setEditable(false); editor.setEditable(true) }); await settle()
  const before = snapshot()
  await act(async () => finishUpload({ url: '/api/assets/stale' })); await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test('a newly opened slash command works after finishing bulk selection', async () => {
  await query('table'); await bulk(true)
  const stale = option('表格')
  if (stale) { await act(async () => stale.click()); await settle() }
  await query('table'); await choose('表格')
  expect(allNodes(snapshot().root).filter(node => node.type === 'table')).toHaveLength(2)
  expect(errors).toEqual([])
})
test('slash Table insertion retains the formatted text before and after its trigger', async () => {
  await act(async () => editor.update(() => {
    const paragraph = $getRoot().getLastChild().clear()
    const middle = $createTextNode(' /table ')
    paragraph.append($createTextNode('PREFIX').toggleFormat('bold'), middle, $createTextNode('SUFFIX').toggleFormat('italic'))
    middle.select(7, 7)
  }, { discrete: true })); await settle()
  expect(option('表格')).toBeTruthy()
  await choose('表格')
  const nodes = allNodes(snapshot().root)
  expect(nodes.filter(node => node.type === 'table')).toHaveLength(2)
  expect(nodes.find(node => node.type === 'text' && node.text === 'PREFIX')?.format).toBe(1)
  expect(nodes.find(node => node.type === 'text' && node.text === 'SUFFIX')?.format).toBe(2)
  expect(JSON.stringify(snapshot())).not.toContain('/table')
  expect(errors).toEqual([])
})
test('one normal Undo restores the complete slash trigger and the original table', async () => {
  await query('table'); const before = snapshot()
  await choose('表格')
  expect(allNodes(snapshot().root).filter(node => node.type === 'table')).toHaveLength(2)
  await act(async () => editor.getRootElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true }))); await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test('a formatting boundary does not turn a slash inside a word into a Table command', async () => {
  await act(async () => editor.update(() => {
    const paragraph = $getRoot().getLastChild().clear(), trigger = $createTextNode('/table')
    paragraph.append($createTextNode('word').toggleFormat('bold'), trigger); trigger.selectEnd()
  }, { discrete: true })); await settle()
  expect(host.querySelector('.slash-menu')).toBeNull()
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toContain('word/table')
  expect(errors).toEqual([])
})
test('a queued slash command stays bound to the trigger which the user chose', async () => {
  await query('table')
  await act(async () => editor.update(() => {
    const chosen = $getRoot().getLastChild().getFirstChild()
    $getRoot().append($createParagraphNode().append($createTextNode('/table')))
    chosen.selectEnd()
  }, { discrete: true })); await settle()
  const control = option('表格'), before = snapshot()
  expect(control).toBeTruthy()
  await act(async () => editor.update(() => {
    control.click()
    // A different matching trigger must not receive the pending command.
    $getRoot().getLastChild().getFirstChild().selectEnd()
  }, { discrete: true })); await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test.each(['Enter', 'Tab'])('a slash menu does not steal %s from the actual code decorator textarea', async key => {
  await act(async () => editor.update(() => {
    $getRoot().getLastChild().insertBefore($createCodeBlockNode('const value = 1'))
  }, { discrete: true })); await settle()
  await query('table'); expect(option('表格')).toBeTruthy()
  const textarea = host.querySelector('textarea.code-textarea')
  expect(textarea).toBeTruthy()
  await act(async () => textarea.focus()); await settle()
  const before = snapshot()
  await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode: key === 'Enter' ? 13 : 9, bubbles: true, cancelable: true }))); await settle()
  expect(allNodes(snapshot().root).filter(node => node.type === 'table')).toHaveLength(1)
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toContain('/table')
  // Tab may edit code through its own existing control; it cannot insert a
  // table or alter any cell through the unrelated visible completion menu.
  expect(snapshot().root.children[0]).toEqual(before.root.children[0])
  expect(errors).toEqual([])
})
test('refusing a nested slash Table leaves every cell and its trigger unchanged', async () => {
  await act(async () => editor.update(() => {
    const text = $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild().getFirstChild()
    text.setTextContent('keep /table tail'); text.select(11, 11)
  }, { discrete: true })); await settle()
  expect(option('表格')).toBeTruthy(); const before = snapshot()
  await choose('表格')
  expect(snapshot()).toEqual(before)
  expect(allNodes(snapshot().root).filter(node => node.type === 'table')).toHaveLength(1)
  expect(errors).toEqual([])
})
