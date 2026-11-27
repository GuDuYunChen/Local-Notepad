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
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import SlashMenuPlugin from './SlashMenuPlugin'
import TableSelectionPlugin from './TableSelectionPlugin'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, reactRoot, editor, errors
const rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const snapshot = () => editor.getEditorState().toJSON()
const tables = () => snapshot().root.children.filter(node => node.type === 'table')
const option = () => [...host.querySelectorAll('.slash-menu [role="option"]')].find(node => node.querySelector('.slash-menu-label')?.textContent === '表格')
const mode = active => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { detail: active, bubbles: true }))
const windowError = event => errors.push(event.error || new Error(event.message))
function Capture() {
  const [value] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = value }, [value])
  return null
}
function Harness() {
  return <LexicalComposer initialConfig={{ namespace: 'table-slash-scheduling', nodes: [TableNode, TableRowNode, TableCellNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (const values of [['OLD-CELL', 'other'], ['selected-C', 'selected-D']]) table.append($createTableRowNode().append(...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    $getRoot().append(table, $createParagraphNode().append($createTextNode('/table')))
  } }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin /><TabIndentationPlugin maxIndent={8} /><Capture />
      <SlashMenuPlugin documentId="slash-scheduling" /><TableSelectionPlugin documentId="slash-scheduling" />
    </div>
  </LexicalComposer>
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; errors = []
  window.addEventListener('error', windowError)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(100, 180, 60, 24) })
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  await act(async () => reactRoot.render(<Harness />)); await settle()
  const text = editor.getRootElement().lastElementChild.querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 6, text, 6)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(editor.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === 'text'
  })).toBe(true)
  expect(option()).toBeTruthy(); expect(errors).toEqual([])
})
afterEach(async () => {
  await act(async () => reactRoot.unmount()); host.remove(); window.removeEventListener('error', windowError)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeGeometry)
  else delete Range.prototype.getBoundingClientRect
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function key(value) {
  const event = new KeyboardEvent('keydown', { key: value, code: value, keyCode: value === 'Enter' ? 13 : 9, bubbles: true, cancelable: true })
  await act(async () => editor.getRootElement().dispatchEvent(event)); await settle()
  return event
}
function expectInsertion(original) {
  expect(tables()).toHaveLength(2)
  expect(tables()[0]).toEqual(original)
  expect(tables()[1].children).toHaveLength(3)
  expect(tables()[1].children.every(row => row.children.length === 3)).toBe(true)
  expect(JSON.stringify(snapshot())).not.toContain('/table')
  expect(host.querySelector('.slash-menu')).toBeNull()
  expect(errors).toEqual([])
}

test('a real Lexical queued slash Table update still runs its insertion after consuming the trigger', async () => {
  const control = option(), original = tables()[0]
  // Nested editor.update callbacks are queued by Lexical itself. No mocked
  // update scheduler, direct mutation command, or private editor field is used.
  await act(async () => editor.update(() => control.click(), { discrete: true })); await settle()
  expectInsertion(original)
})
test.each(['Enter', 'Tab'])('ordinary %s selects the slash Table command before RichText can change the trigger paragraph', async value => {
  const original = tables()[0]
  expect((await key(value)).defaultPrevented).toBe(true)
  expectInsertion(original)
})
test.each([false, true])('a real queued slash Table update cannot cross bulk ownership (exit=%s)', async exit => {
  const control = option(), before = snapshot()
  await act(async () => editor.update(() => {
    control.click()
    mode(true)
    if (exit) mode(false)
  }, { discrete: true })); await settle()
  expect(snapshot()).toEqual(before)
  expect(tables()).toHaveLength(1); expect(errors).toEqual([])
})
test.each(['Enter', 'Tab'])('bulk ownership keeps %s from invoking the old slash Table command', async value => {
  await act(async () => mode(true)); await settle()
  const before = snapshot()
  await key(value)
  expect(snapshot()).toEqual(before)
  expect(tables()).toHaveLength(1); expect(errors).toEqual([])
})
test.each([false, true])('a completed atomic slash Table insertion is preserved by subsequent bulk selection (exit=%s)', async exit => {
  const control = option(), original = tables()[0]
  await act(async () => {
    control.click()
    mode(true)
    if (exit) mode(false)
  }); await settle()
  expectInsertion(original)
})
