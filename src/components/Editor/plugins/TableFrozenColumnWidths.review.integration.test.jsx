// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TablePresentationPlugin from './TablePresentationPlugin'
const editorCSS = readFileSync('src/components/Editor/Editor.css', 'utf8')
const documentCSS = readFileSync('src/styles/editor-document.css', 'utf8')

// Use the real TableNode DOM and both production stylesheets. jsdom can verify
// selector matching and the resulting position/inset declarations, but not
// native scrolling geometry; the unchanged Windows wheel checks own that gate.
let host, root, editor, errors, editorStyle, documentStyle
function Capture() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}
const snapshot = () => editor.getEditorState().toJSON()
const tableDOM = () => host.querySelector('table')
const update = async fn => act(async () => editor.update(fn, { discrete: true }))
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; errors = []
  editorStyle = document.createElement('style'); editorStyle.textContent = editorCSS
  documentStyle = document.createElement('style'); documentStyle.textContent = documentCSS
  document.head.append(editorStyle, documentStyle)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); editorStyle.remove(); documentStyle.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function mount({ colWidths, cellWidths = false, editable = true, headers = false } = {}) {
  await act(async () => root.render(<LexicalComposer initialConfig={{
    namespace: 'table-frozen-colwidths', editable,
    nodes: [TableNode, TableRowNode, TableCellNode],
    theme: { table: 'editor-table', tableCell: 'editor-table-cell', tableCellHeader: 'editor-table-cell-header',
      tableRowStriping: 'editor-table-row-striping', tableFrozenRow: 'editor-table-frozen-row', tableFrozenColumn: 'editor-table-frozen-column' },
    editorState: () => {
      const table = $createTableNode()
      for (let r = 0; r < 4; r++) {
        const row = $createTableRowNode()
        for (let c = 0; c < 3; c++) row.append($createTableCellNode(headers && r === 0 ? 1 : 0, 1, cellWidths ? [180, 240, 200][c] : undefined)
          .append($createParagraphNode().append($createTextNode(`R${r + 1}C${c + 1}`))))
        table.append(row)
      }
      if (colWidths !== undefined) table.setColWidths(colWidths)
      table.setFrozenRows(1); table.setFrozenColumns(1); table.setRowStriping(true)
      $getRoot().append(table)
    },
    onError: error => errors.push(error),
  }}>
    <div className="editor-container"><RichTextPlugin contentEditable={<ContentEditable className="editor-input"/>} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/>
      <Capture/><TablePlugin/><TablePresentationPlugin/></div>
  </LexicalComposer>))
  expect(tableDOM().rows).toHaveLength(4)
  expect([...tableDOM().rows].map(row => [...row.cells].map(cell => cell.textContent)))
    .toEqual(Array.from({ length: 4 }, (_, r) => [1, 2, 3].map(c => `R${r + 1}C${c}`)))
  expect(errors).toEqual([])
}
function expectFrozenHeader() {
  const table = tableDOM(), saved = snapshot()
  expect(table.dataset.lexicalFrozenRow).toBe('true')
  expect([...table.rows[0].cells].map(cell => {
    const style = getComputedStyle(cell)
    return { position: style.position, top: Number.parseFloat(style.top) }
  })).toEqual(Array.from({ length: 3 }, () => ({ position: 'sticky', top: 0 })))
  const corner = getComputedStyle(table.rows[0].cells[0])
  expect(corner.zIndex).toBe('3'); expect(Number.parseFloat(corner.left)).toBe(0)
  expect(getComputedStyle(table.rows[1].cells[0]).position).toBe('sticky')
  expect(getComputedStyle(table.rows[1].cells[0]).zIndex).toBe('1')
  expect(getComputedStyle(table.rows[1].cells[1]).position).not.toBe('sticky')
  expect(snapshot()).toEqual(saved)
}
function expectEvenRowStripes(enabled = true) {
  const table = tableDOM()
  const rules = [...editorStyle.sheet.cssRules].filter(rule => rule.selectorText?.includes('.editor-table-row-striping'))
  // Both existing row and cell stripe rules must target the same logical rows.
  expect(rules).toHaveLength(2)
  expect(table.classList.contains('editor-table-row-striping')).toBe(enabled)
  for (const rule of rules) {
    // Stylesheet selectors are matched in document scope, including the table
    // and editor ancestors, then restricted to this mounted table's rows.
    const matchingRows = new Set([...document.querySelectorAll(rule.selectorText)].filter(node => table.contains(node)).map(node => node.closest('tr')))
    expect([...table.rows].flatMap((row, index) => matchingRows.has(row) ? [index + 1] : []))
      .toEqual(enabled ? [2, 4] : [])
  }
}

test.each([false, true])('tables without table-level colWidths keep frozen rows and stripes (individual cell widths: %s)', async cellWidths => {
  await mount({ cellWidths })
  expect(tableDOM().querySelector('colgroup')).toBeNull()
  expect(tableDOM().firstElementChild.tagName).toBe('TR')
  expectFrozenHeader(); expectEvenRowStripes()
})

test.each([{ editable: true, headers: true }, { editable: false, headers: false }])('persisted colWidths keep all first-row cells and the corner frozen: %j', async options => {
  await mount({ ...options, colWidths: [240, 320, 240] })
  expect(tableDOM().firstElementChild.tagName).toBe('COLGROUP')
  expect([...tableDOM().children].map(node => node.tagName)).toEqual(['COLGROUP', 'TR', 'TR', 'TR', 'TR'])
  expect(tableDOM().rows[0].cells[0].tagName).toBe(options.headers ? 'TH' : 'TD')
  expectFrozenHeader()
})

test.each([{ colWidths: undefined }, { colWidths: [240, 320, 240] }])('row stripes keep rows two and four with table colWidths %j', async ({ colWidths }) => {
  await mount({ colWidths })
  const saved = snapshot()
  expectEvenRowStripes()
  expect(snapshot()).toEqual(saved)
})

test('setting, serializing, reloading and clearing column widths preserve frozen rows and stripe parity', async () => {
  await mount(); expectFrozenHeader(); expectEvenRowStripes()
  await update(() => $getRoot().getFirstChild().setColWidths([240, 320, 240]))
  const saved = snapshot()
  expect(saved.root.children[0].colWidths).toEqual([240, 320, 240])
  expect(tableDOM().firstElementChild.tagName).toBe('COLGROUP')
  expectFrozenHeader(); expectEvenRowStripes()
  const previousTable = tableDOM()
  await act(async () => editor.setEditorState(editor.parseEditorState(JSON.stringify(saved))))
  expect(previousTable.isConnected).toBe(false)
  expect(snapshot()).toEqual(saved)
  expect(tableDOM().firstElementChild.tagName).toBe('COLGROUP')
  expectFrozenHeader(); expectEvenRowStripes()
  await update(() => $getRoot().getFirstChild().setColWidths(undefined))
  expect(tableDOM().querySelector('colgroup')).toBeNull()
  expectFrozenHeader(); expectEvenRowStripes()
  expect(snapshot().root.children[0].children).toEqual(saved.root.children[0].children)
  expect(errors).toEqual([])
})

test('frozen row, frozen column and striping controls stay independent with a generated colgroup', async () => {
  await mount({ colWidths: [240, 320, 240] })
  await update(() => { const table = $getRoot().getFirstChild(); table.setFrozenRows(0); table.setRowStriping(false) })
  expect(tableDOM().hasAttribute('data-lexical-frozen-row')).toBe(false)
  expect(getComputedStyle(tableDOM().rows[0].cells[0]).position).toBe('sticky')
  expect(Number.parseFloat(getComputedStyle(tableDOM().rows[0].cells[0]).top)).toBeNaN()
  expect(getComputedStyle(tableDOM().rows[0].cells[1]).position).not.toBe('sticky')
  expectEvenRowStripes(false)
  await update(() => { const table = $getRoot().getFirstChild(); table.setFrozenRows(1); table.setFrozenColumns(0); table.setRowStriping(true) })
  expect(tableDOM().hasAttribute('data-lexical-frozen-column')).toBe(false)
  for (const cell of tableDOM().rows[0].cells) {
    const style = getComputedStyle(cell)
    expect(style.position).toBe('sticky'); expect(Number.parseFloat(style.top)).toBe(0); expect(style.zIndex).toBe('2')
  }
  expect(getComputedStyle(tableDOM().rows[1].cells[0]).position).not.toBe('sticky')
  expectEvenRowStripes()
  expect(errors).toEqual([])
})
