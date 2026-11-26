import { afterEach, expect, test } from 'vitest'
import { $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, createEditor } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, registerTablePlugin, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { $deleteColumnAtCell, $getTableModel, $insertColumnAtCell, $mergeTableCells, $moveTableColumn, $splitTableCell } from './tableModel'

const cleanups = []
afterEach(() => { while (cleanups.length) cleanups.pop()() })

function mountedEditor() {
  const editor = createEditor({ namespace: 'legacy-table-width-review', nodes: [TableNode, TableRowNode, TableCellNode], onError: error => { throw error } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  document.body.append(root)
  editor.setRootElement(root)
  const unregister = registerTablePlugin(editor)
  cleanups.push(() => { unregister(); editor.setRootElement(null); root.remove() })
  return editor
}

function fixture(widths) {
  const editor = mountedEditor(), keys = {}
  editor.update(() => {
    const cell = (text, width, span = 1) => {
      const node = $createTableCellNode(0, span, width).append($createParagraphNode().append($createTextNode(text)))
      keys[text] = node.getKey()
      return node
    }
    const table = $createTableNode()
    keys.table = table.getKey()
    table.append(
      $createTableRowNode().append(cell('merged', widths.slice(0, 2).every(Number.isFinite) ? widths[0] + widths[1] : undefined, 2), cell('top-tail', widths[2])),
      $createTableRowNode().append(cell('left', widths[0]), cell('right', widths[1]), cell('bottom-tail', widths[2])),
    )
    $getRoot().append(table)
    // This is the serialized shape produced by the earlier cell-only resize:
    // widths live on each cell, without the newer canonical COLGROUP widths.
    expect(table.getColWidths()).toBeUndefined()
  }, { discrete: true })
  return { editor, keys }
}

function assertWidths(editor, expected, originalText) {
  const serialized = editor.getEditorState().toJSON()
  const tableJSON = serialized.root.children[0]
  const expectedWidth = (columnIndex, colSpan) => {
    const values = expected.slice(columnIndex, columnIndex + colSpan)
    return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : undefined
  }
  editor.getEditorState().read(() => {
    const model = $getTableModel($getRoot().getFirstChild())
    expect(model.columnCount).toBe(expected.length)
    for (const { cell, columnIndex, colSpan } of model.locations.values()) {
      const width = expectedWidth(columnIndex, colSpan)
      expect.soft(cell.getWidth(), `${cell.getTextContent()} persisted model width`).toBe(width)
      expect.soft(editor.getElementByKey(cell.getKey()).style.width, `${cell.getTextContent()} reconciled DOM width`).toBe(width === undefined ? '' : `${width}px`)
    }
    expect([...model.locations.values()].map(({ cell }) => cell.getTextContent()).filter(Boolean)).toEqual(originalText)
  })
  const loaded = mountedEditor()
  loaded.setEditorState(loaded.parseEditorState(JSON.stringify(serialized)))
  loaded.getEditorState().read(() => {
    const model = $getTableModel($getRoot().getFirstChild())
    for (const { cell, columnIndex, colSpan } of model.locations.values()) {
      const width = expectedWidth(columnIndex, colSpan)
      expect.soft(cell.getWidth(), `${cell.getTextContent()} serialized reload width`).toBe(width)
    }
  })
  expect(tableJSON.children[0].children[0].width).toBe(expectedWidth(0, tableJSON.children[0].children[0].colSpan))
}

test.each([
  { widths: [120, 120, 160], target: 'left', deleted: 0 },
  { widths: [90, 150, 160], target: 'left', deleted: 0 },
  { widths: [90, 150, 160], target: 'right', deleted: 1 },
])('legacy widths $widths shrink a crossing merged cell by the actual deleted column $deleted', ({ widths, target, deleted }) => {
  const { editor, keys } = fixture(widths)
  editor.update(() => expect($deleteColumnAtCell($getNodeByKey(keys[target])).changed).toBe(true), { discrete: true })
  assertWidths(editor, widths.filter((_, index) => index !== deleted), ['merged', 'top-tail', target === 'left' ? 'right' : 'left', 'bottom-tail'])
})

test.each([
  { target: 'left', after: true, insertedWidth: 90 },
  { target: 'right', after: false, insertedWidth: 150 },
])('legacy widths extend a crossing merged cell by the inserted column from $target', ({ target, after, insertedWidth }) => {
  const { editor, keys } = fixture([90, 150, 160])
  editor.update(() => expect($insertColumnAtCell($getNodeByKey(keys[target]), after).changed).toBe(true), { discrete: true })
  assertWidths(editor, [90, insertedWidth, 150, 160], ['merged', 'top-tail', 'left', 'right', 'bottom-tail'])
})

test('partial legacy widths repair a crossing merge without assigning a width to an automatic column', () => {
  const { editor, keys } = fixture([90, 150, undefined])
  editor.update(() => $deleteColumnAtCell($getNodeByKey(keys.left)), { discrete: true })
  assertWidths(editor, [150, undefined], ['merged', 'top-tail', 'right', 'bottom-tail'])
  expect(editor.getEditorState().toJSON().root.children[0].colWidths).toBeUndefined()
})

test('a moved automatic column stays automatic beside a legacy-width merged block', () => {
  const { editor, keys } = fixture([90, 150, undefined])
  editor.update(() => expect($moveTableColumn($getNodeByKey(keys.table), 2, -2).changed).toBe(true), { discrete: true })
  assertWidths(editor, [undefined, 90, 150], ['top-tail', 'merged', 'bottom-tail', 'left', 'right'])
  expect(editor.getEditorState().toJSON().root.children[0].colWidths).toBeUndefined()
})

test('splitting a legacy merge preserves unequal widths defined by the other row', () => {
  const { editor, keys } = fixture([90, 150, 160])
  editor.update(() => $splitTableCell($getNodeByKey(keys.merged)), { discrete: true })
  assertWidths(editor, [90, 150, 160], ['merged', 'top-tail', 'left', 'right', 'bottom-tail'])
})

test('merging snapshots legacy column widths before removing the only single-column owners', () => {
  const { editor, keys } = fixture([90, 150, 160])
  editor.update(() => $mergeTableCells($getNodeByKey(keys.table), [keys.left, keys.right]), { discrete: true })
  assertWidths(editor, [90, 150, 160], ['merged', 'top-tail', 'left\n\nright', 'bottom-tail'])
  expect(editor.getEditorState().toJSON().root.children[0].colWidths).toEqual([90, 150, 160])
})

test('a fully automatic table stays automatic when inserting through a merged cell', () => {
  const { editor, keys } = fixture([undefined, undefined, undefined])
  editor.update(() => $insertColumnAtCell($getNodeByKey(keys.left), true), { discrete: true })
  assertWidths(editor, [undefined, undefined, undefined, undefined], ['merged', 'top-tail', 'left', 'right', 'bottom-tail'])
  expect(editor.getEditorState().toJSON().root.children[0].colWidths).toBeUndefined()
})
