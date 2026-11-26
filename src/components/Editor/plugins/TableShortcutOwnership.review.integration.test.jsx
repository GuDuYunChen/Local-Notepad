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
import { applyShortcutBindings, getDefaultShortcutBindings, getShortcutSnapshot, reloadShortcutPreferences, SHORTCUT_STORAGE_KEY } from '~/services/localShortcuts'
import TableSelectionPlugin from './TableSelectionPlugin'
import EditorShortcutPlugin from './EditorShortcutPlugin'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, reactRoot, editor, errors
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
function Harness() {
  return <LexicalComposer initialConfig={{ namespace: 'table-shortcut-owner', nodes: [TableNode, TableRowNode, TableCellNode, ListNode, ListItemNode, FormulaNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (const values of [['OLD-CELL', 'other'], ['selected-C', 'selected-D']]) {
      table.append($createTableRowNode().append(...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    }
    $getRoot().append(table)
  } }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin /><ListPlugin /><CheckListPlugin /><Capture />
      <EditorShortcutPlugin documentId="shortcut-note" /><TableSelectionPlugin documentId="shortcut-note" />
    </div>
  </LexicalComposer>
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  localStorage.removeItem(SHORTCUT_STORAGE_KEY); reloadShortcutPreferences()
  if (!rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  // jsdom has no layout observer; the real Formula control still mounts.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
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
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
  if (!rangeGeometry) delete Range.prototype.getBoundingClientRect
  localStorage.removeItem(SHORTCUT_STORAGE_KEY); reloadShortcutPreferences()
})
async function key(value, options = {}) {
  const event = new KeyboardEvent('keydown', { key: value, ctrlKey: true, altKey: true, bubbles: true, cancelable: true, ...options })
  await act(async () => editor.getRootElement().dispatchEvent(event)); await settle()
  return event
}
async function selectOtherCells() {
  await act(async () => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true, bubbles: true }))); await settle()
  await act(async () => {
    cells()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    cells()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
    cells()[3].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  }); await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
}
const actions = [{ key: 'e', type: 'formula' }, { key: 't', type: 'list' }]
test.each(actions)('ordinary Mod+Alt+$key still inserts the actual $type content', async ({ key: value, type }) => {
  const before = snapshot()
  expect((await key(value)).defaultPrevented).toBe(true)
  expect(allNodes(snapshot().root).some(node => node.type === type)).toBe(true)
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  expect(errors).toEqual([])
})
test.each(actions)('bulk selection owns Mod+Alt+$key without rewriting the old text selection', async ({ key: value }) => {
  await selectOtherCells(); const before = snapshot()
  expect((await key(value)).defaultPrevented).toBe(true)
  expect(snapshot()).toEqual(before)
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  expect(errors).toEqual([])
})
test.each(actions)('finishing bulk selection restores ordinary Mod+Alt+$key insertion', async ({ key: value, type }) => {
  await selectOtherCells()
  const finish = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '完成')
  await act(async () => finish.click()); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  expect((await key(value)).defaultPrevented).toBe(true)
  expect(allNodes(snapshot().root).some(node => node.type === type)).toBe(true)
  expect(errors).toEqual([])
})
test('bulk ownership leaves the existing copy-reference shortcut available', async () => {
  await selectOtherCells(); const before = snapshot(), receive = vi.fn()
  window.addEventListener('editor:copy-current-reference', receive)
  try { expect((await key('r')).defaultPrevented).toBe(true) }
  finally { window.removeEventListener('editor:copy-current-reference', receive) }
  expect(receive).toHaveBeenCalledTimes(1)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test.each(actions)('configured Mod+Shift+$key cannot bypass bulk ownership', async ({ key: value, type }) => {
  const id = type === 'formula' ? 'formula' : 'checklist'
  await act(async () => {
    const result = applyShortcutBindings({ ...getDefaultShortcutBindings(), [id]: 'Mod+Shift+' + value.toUpperCase() }, { expectedRevision: getShortcutSnapshot().revision })
    expect(result.ok).toBe(true)
  }); await settle()
  await selectOtherCells(); const before = snapshot()
  expect((await key(value, { altKey: false, shiftKey: true })).defaultPrevented).toBe(true)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test.each([false, true])('a queued formula cannot revive after bulk ownership changes (exit=%s)', async exit => {
  const apply = editor.update.bind(editor), pending = []
  const intercept = vi.spyOn(editor, 'update').mockImplementation((callback, options) => pending.push({ callback, options }))
  try { await key('e'); expect(pending).toHaveLength(1) }
  finally { intercept.mockRestore() }
  await selectOtherCells()
  if (exit) {
    const finish = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '完成')
    await act(async () => finish.click()); await settle()
  }
  const before = snapshot()
  await act(async () => apply(pending[0].callback, { ...pending[0].options, discrete: true })); await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
