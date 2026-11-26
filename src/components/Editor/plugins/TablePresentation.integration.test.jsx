// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TablePresentationPlugin, { tableBackgroundTextColor } from './TablePresentationPlugin'
import { contrastRatio } from '~/services/localAppearance'
import { $mergeTableCells, $deleteRowAtCell } from '../utils/tableModel'

let host, root, editor, errors
function Capture() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}
const snapshot = () => editor.getEditorState().toJSON()
const columns = () => [...host.querySelectorAll('tr')].map(row => [...row.cells].map(cell => cell.dataset.tableColumn))
const update = async fn => act(async () => editor.update(fn, { discrete: true }))
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<LexicalComposer initialConfig={{
    namespace: 'table-presentation', editable: false,
    nodes: [TableNode, TableRowNode, TableCellNode],
    theme: { table: 'editor-table', tableCell: 'editor-table-cell', tableCellHeader: 'editor-table-cell-header',
      tableRowStriping: 'editor-table-row-striping', tableFrozenRow: 'editor-table-frozen-row', tableFrozenColumn: 'editor-table-frozen-column' },
    editorState: () => {
      const table = $createTableNode()
      for (let r = 0; r < 3; r++) {
        const row = $createTableRowNode()
        for (let c = 0; c < 3; c++) row.append($createTableCellNode(r === 0 ? 1 : 0).append($createParagraphNode().append($createTextNode(r + ':' + c))))
        table.append(row)
      }
      table.setFrozenColumns(1); table.setFrozenRows(1); $getRoot().append(table)
    },
    onError: error => errors.push(error),
  }}>
    <div className="editor-container"><RichTextPlugin contentEditable={<ContentEditable/>} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/>
      <Capture/><TablePlugin/><TablePresentationPlugin/></div>
  </LexicalComposer>))
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  delete document.documentElement.dataset.theme
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('reading mode derives logical columns without changing persisted table data', async () => {
  const before = snapshot()
  expect(editor.isEditable()).toBe(false)
  expect(columns()).toEqual([['0', '1', '2'], ['0', '1', '2'], ['0', '1', '2']])
  expect(host.querySelector('table').dataset.lexicalFrozenColumn).toBe('true')
  expect(host.querySelector('table').dataset.lexicalFrozenRow).toBe('true')
  expect(snapshot()).toEqual(before)
  expect(JSON.stringify(before)).not.toContain('data-table-column')
})
test('a first-column rowspan does not freeze the following physical cell as column zero', async () => {
  await update(() => {
    const table = $getRoot().getFirstChild(), rows = table.getChildren()
    $mergeTableCells(table, [rows[0].getFirstChild().getKey(), rows[1].getFirstChild().getKey()])
  })
  expect(columns()).toEqual([['0', '1', '2'], ['1', '2'], ['0', '1', '2']])
  const saved = snapshot()
  await act(async () => editor.setEditorState(editor.parseEditorState(JSON.stringify(saved))))
  expect(snapshot()).toEqual(saved)
  expect(columns()).toEqual([['0', '1', '2'], ['1', '2'], ['0', '1', '2']])
})
test('deleting a rowspan anchor recomputes presentation for the surviving cells', async () => {
  await update(() => {
    const table = $getRoot().getFirstChild(), rows = table.getChildren()
    $mergeTableCells(table, [rows[0].getFirstChild().getKey(), rows[1].getFirstChild().getKey()])
    $deleteRowAtCell(table.getFirstChild().getFirstChild())
  })
  expect(columns()).toEqual([['0', '1', '2'], ['0', '1', '2']])
  expect(host.querySelector('tr').cells[0].textContent).toContain('0:0')
  expect(host.querySelector('tr').cells[0].textContent).toContain('1:0')
  expect(errors).toEqual([])
})
test('header, stripe, explicit background and frozen states survive serialization independently', async () => {
  await update(() => {
    const table = $getRoot().getFirstChild()
    table.setRowStriping(true); table.setFrozenColumns(0); table.setFrozenRows(0)
    for (const cell of table.getFirstChild().getChildren()) cell.setHeaderStyles(0)
    table.getFirstChild().getFirstChild().setBackgroundColor('#fff3cd')
  })
  const saved = snapshot()
  await act(async () => editor.setEditorState(editor.parseEditorState(JSON.stringify(saved))))
  const table = host.querySelector('table')
  expect(table.hasAttribute('data-lexical-frozen-row')).toBe(false)
  expect(table.hasAttribute('data-lexical-frozen-column')).toBe(false)
  expect(table.dataset.lexicalRowStriping).toBe('true')
  expect(host.querySelectorAll('th')).toHaveLength(0)
  expect(table.rows[0].cells[0].style.backgroundColor).toBe('rgb(255, 243, 205)')
  expect(snapshot()).toEqual(saved)
  expect(errors).toEqual([])
})

test('every existing cell background has readable default text in either theme without persisting theme styles', async () => {
  for (const color of ['#f2f3f5', '#fff3cd', '#d1e7dd', '#f8d7da', '#cff4fc', '#000000', '#777777']) {
    expect(contrastRatio(tableBackgroundTextColor(color), color)).toBeGreaterThanOrEqual(4.5)
  }
  expect(tableBackgroundTextColor('rgba(255, 255, 255, 0.5)')).toBeNull()
  expect(tableBackgroundTextColor('rgb(0, 0, 0)')).toBe('#ffffff')
  await update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().setBackgroundColor('#fff3cd'))
  const saved = snapshot(), cell = host.querySelector('tr').cells[0]
  expect(cell.style.getPropertyValue('--table-cell-ink')).toBe('#000000')
  expect(JSON.stringify(saved)).not.toContain('--table-cell-ink')
  document.documentElement.dataset.theme = 'dark'
  expect(cell.style.getPropertyValue('--table-cell-ink')).toBe('#000000')
  expect(snapshot()).toEqual(saved)
  await update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().setBackgroundColor(null))
  // TableCellNode replaces its DOM when the persisted background changes.
  const clearedCell = host.querySelector('tr').cells[0]
  expect(cell.isConnected).toBe(false)
  expect(clearedCell.hasAttribute('data-table-custom-background')).toBe(false)
  expect(clearedCell.style.getPropertyValue('--table-cell-ink')).toBe('')
  delete document.documentElement.dataset.theme
})
