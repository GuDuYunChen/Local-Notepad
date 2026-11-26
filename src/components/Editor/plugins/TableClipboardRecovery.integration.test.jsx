import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TableSelectionPlugin from './TableSelectionPlugin'
import { dispatchTableEvent } from '../utils/tableEvents'
import { toast } from '~/services/toast'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, root, editor, errors, clipboard
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const snapshot = () => editor.getEditorState().toJSON()
const texts = () => editor.getEditorState().read(() => $getRoot().getFirstChild().getChildren().map(row => row.getChildren().map(cell => cell.getTextContent())))

function Capture() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}
function Harness() {
  return <LexicalComposer initialConfig={{
    namespace: 'table-clipboard-recovery', nodes: [TableNode, TableRowNode, TableCellNode],
    onError: error => errors.push(error),
    editorState: () => {
      const table = $createTableNode()
      for (const values of [['A', 'B', 'C'], ['D', 'E', 'F']]) table.append($createTableRowNode().append(
        ...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value)))),
      ))
      $getRoot().append(table)
    },
  }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin /><Capture /><TableSelectionPlugin documentId="clipboard-note" />
    </div>
  </LexicalComposer>
}
const button = label => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === label)
async function click(label) {
  await act(async () => button(label).click())
  await settle()
}
async function select(r1, c1, r2 = r1, c2 = c1) {
  if (!host.querySelector('.table-selection-modebar')) {
    await act(async () => dispatchTableEvent(editor, 'tableSelection:mode', true))
    await settle()
  }
  const rows = host.querySelector('table').rows, first = rows[r1].cells[c1], last = rows[r2].cells[c2]
  await act(async () => {
    first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    last.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1 }))
    last.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
  })
  await settle()
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []; vi.clearAllMocks()
  clipboard = { readText: vi.fn().mockResolvedValue('pasted'), writeText: vi.fn().mockResolvedValue(undefined) }
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(clipboard)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<Harness />))
  await settle()
})
afterEach(async () => {
  expect(errors).toEqual([])
  await act(async () => root.unmount())
  host.remove(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('a denied clipboard read preserves the document, releases the busy state and permits retry', async () => {
  await select(0, 1)
  const before = snapshot()
  clipboard.readText.mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce('retried')
  await click('粘贴')
  expect(snapshot()).toEqual(before)
  expect(toast.error).toHaveBeenCalledTimes(1)
  expect(toast.success).not.toHaveBeenCalled()
  expect(button('粘贴').disabled).toBe(false)
  await click('粘贴')
  expect(clipboard.readText).toHaveBeenCalledTimes(2)
  expect(texts()).toEqual([['A', 'retried', 'C'], ['D', 'E', 'F']])
  expect(toast.success).toHaveBeenCalledTimes(1)
})

test('a denied clipboard write does not claim success and can be retried without editing data', async () => {
  await select(0, 0, 1, 1)
  const before = snapshot()
  clipboard.writeText.mockRejectedValueOnce(new Error('write denied')).mockResolvedValueOnce(undefined)
  await click('复制')
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledTimes(1)
  expect(button('复制').disabled).toBe(false)
  await click('复制')
  expect(clipboard.writeText).toHaveBeenLastCalledWith('A\tB\nD\tE')
  expect(toast.success).toHaveBeenCalledTimes(1)
  expect(snapshot()).toEqual(before)
})

test.each(['first\tsecond', 'first\nsecond'])('out-of-bounds clipboard %j is refused before any target cell changes', async text => {
  await select(1, 2)
  const before = snapshot()
  clipboard.readText.mockResolvedValueOnce(text)
  await click('粘贴')
  expect(snapshot()).toEqual(before)
  expect(toast.warning).toHaveBeenCalledWith('粘贴内容超出表格范围，请先增加行或列')
  expect(toast.success).not.toHaveBeenCalled()
  expect(button('粘贴').disabled).toBe(false)
})

test('clipboard cells that alias a merged target are refused atomically', async () => {
  await select(0, 0, 0, 1)
  await click('合并')
  expect(texts()[0]).toEqual(['A\n\nB', 'C'])
  await select(0, 0)
  const before = snapshot()
  clipboard.readText.mockResolvedValueOnce('left\tright')
  await click('粘贴')
  expect(snapshot()).toEqual(before)
  expect(toast.warning).toHaveBeenCalledWith('粘贴区域包含合并单元格，请先拆分后粘贴')
  expect(toast.success).not.toHaveBeenCalled()
})

test('copy preserves logical columns around a merged cell without duplicating its text', async () => {
  await select(0, 0, 0, 1)
  await click('合并')
  await select(0, 0, 1, 2)
  const before = snapshot()
  await click('复制')
  expect(clipboard.writeText).toHaveBeenCalledWith('A B\t\tC\nD\tE\tF')
  expect(snapshot()).toEqual(before)
})

test('spreadsheet trailing newlines and empty cells paste without inventing an extra row', async () => {
  await select(0, 0)
  clipboard.readText.mockResolvedValueOnce('left\t\nright\t\n')
  await click('粘贴')
  expect(texts()).toEqual([['left', '', 'C'], ['right', '', 'F']])
  expect(toast.success).toHaveBeenCalledTimes(1)
  expect(toast.warning).not.toHaveBeenCalled()
})

test('changing the selection while clipboard permission is pending cannot retarget the result', async () => {
  let finish
  clipboard.readText.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await select(0, 0)
  await click('粘贴')
  expect(button('粘贴').disabled).toBe(true)
  await select(1, 1)
  const before = snapshot()
  await act(async () => finish('late clipboard'))
  await settle()
  expect(snapshot()).toEqual(before)
  expect(toast.success).not.toHaveBeenCalled()
  expect(button('粘贴').disabled).toBe(false)
})

test('editing and reverting a target table does not revive an older clipboard request', async () => {
  let finish
  clipboard.readText.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await select(0, 0)
  const before = snapshot()
  await click('粘贴')
  await act(async () => editor.update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild().getFirstChild().setTextContent('temporary edit'), { discrete: true }))
  await act(async () => editor.update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild().getFirstChild().setTextContent('A'), { discrete: true }))
  expect(snapshot()).toEqual(before)
  await act(async () => finish('stale clipboard'))
  await settle()
  expect(snapshot()).toEqual(before)
  expect(toast.success).not.toHaveBeenCalled()
})

test('editing another document block does not cancel a valid paste into an unchanged table', async () => {
  await act(async () => editor.update(() => $getRoot().append($createParagraphNode().append($createTextNode('outside'))), { discrete: true }))
  let finish
  clipboard.readText.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await select(0, 0)
  await click('粘贴')
  await act(async () => editor.update(() => $getRoot().getLastChild().getFirstChild().setTextContent('new outside text'), { discrete: true }))
  await act(async () => finish('current clipboard'))
  await settle()
  expect(texts()).toEqual([['current clipboard', 'B', 'C'], ['D', 'E', 'F']])
  expect(snapshot().root.children[1].children[0].text).toBe('new outside text')
  expect(toast.success).toHaveBeenCalledTimes(1)
})

test('a same-note content reload closes selection and invalidates a pending paste', async () => {
  let finish
  clipboard.readText.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await select(0, 0)
  await click('粘贴')
  const before = snapshot()
  await act(async () => editor.setEditorState(editor.parseEditorState(JSON.stringify(before)), { tag: 'local-notepad:content-load' }))
  await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  await act(async () => finish('pre-reload clipboard'))
  await settle()
  expect(snapshot()).toEqual(before)
  expect(toast.success).not.toHaveBeenCalled()
})
