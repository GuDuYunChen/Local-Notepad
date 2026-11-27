// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createNodeSelection, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isNodeSelection, $setSelection } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import ToolbarPlugin from './ToolbarPlugin'
import { $createWikiLinkNode, WikiLinkNode } from '../nodes/WikiLinkNode'
import { toast } from '~/services/toast'

const mocks = vi.hoisted(() => ({ loadXLSX: vi.fn() }))
vi.mock('../utils/fileUpload', async original => ({ ...await original(), loadXLSX: mocks.loadXLSX }))
vi.mock('../nodes/WikiLinkView', () => ({ default: () => <span>linked note</span> }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
let host, root, editor, errors, readers, wikiKey
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const snapshot = () => editor.getEditorState().toJSON()
function Capture() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}
function Harness() {
  return <LexicalComposer initialConfig={{
    namespace: 'excel-node-selection-review', nodes: [TableNode, TableRowNode, TableCellNode, WikiLinkNode],
    editorState: () => {
      const wiki = $createWikiLinkNode('linked-id', 'linked note')
      wikiKey = wiki.getKey()
      $getRoot().append($createTableNode().append($createTableRowNode().append(
        $createTableCellNode().append($createParagraphNode().append($createTextNode('preserved '), wiki)),
      )))
    }, onError: error => errors.push(error),
  }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <Capture /><TablePlugin /><ToolbarPlugin documentId="excel-selection-note" />
    </div>
  </LexicalComposer>
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []; readers = []; vi.clearAllMocks()
  mocks.loadXLSX.mockResolvedValue(XLSX)
  vi.stubGlobal('FileReader', class {
    constructor() { this.readyState = 0; readers.push(this) }
    readAsArrayBuffer() { this.readyState = 1 }
    abort() { this.readyState = 2; this.onabort?.() }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<Harness />)); await settle()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('Excel cannot replace a node-selected wiki link inside a cell with a nested table', async () => {
  // EvidenceNavigationPlugin selects wiki-link nodes with this same public
  // Lexical selection API, including links located inside table paragraphs.
  await act(async () => editor.update(() => {
    const selection = $createNodeSelection(); selection.add(wikiKey); $setSelection(selection)
  }, { discrete: true }))
  expect(editor.getEditorState().read(() => $isNodeSelection($getSelection()))).toBe(true)
  const before = snapshot()
  await act(async () => host.querySelector('[aria-label="插入内容"]').click()); await settle()
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['imported']]), 'First')
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
  const input = host.querySelector('input[accept=".xlsx,.xls"]')
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([bytes], 'table.xlsx')] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  const reader = readers[0]
  if (reader) {
    reader.readyState = 2; reader.result = bytes
    await act(async () => reader.onload?.({ target: reader }))
    await settle()
  }
  expect(snapshot()).toEqual(before)
  expect(readers).toHaveLength(0)
  expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/表格外/))
  expect(errors).toEqual([])
})
