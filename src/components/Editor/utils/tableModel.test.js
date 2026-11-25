import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot,
  createEditor, HISTORY_PUSH_TAG, REDO_COMMAND, UNDO_COMMAND,
} from 'lexical'
import {
  $createTableCellNode, $createTableNode, $createTableRowNode,
  registerTablePlugin, TableCellHeaderStates, TableCellNode, TableNode, TableRowNode,
} from '@lexical/table'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import {
  $deleteColumnAtCell, $deleteRowAtCell, $getTableModel, $insertColumnAtCell,
  $insertRowAtCell, $mergeTableCells, $moveTableColumn, $moveTableRow,
  $resolveTableCell, $splitTableCell,
} from './tableModel'

const config = {
  namespace: 'TableModel', nodes: [TableNode, TableRowNode, TableCellNode],
  onError: error => { throw error },
}

function fixture(matrix, { widths, history = false } = {}) {
  const editor = createEditor(config)
  registerTablePlugin(editor)
  const historyState = createEmptyHistoryState()
  if (history) registerHistory(editor, historyState, 1000)
  let tableKey
  const keys = {}
  editor.update(() => {
    const table = $createTableNode()
    tableKey = table.getKey()
    if (widths) table.setColWidths(widths)
    for (const values of matrix) {
      const row = $createTableRowNode()
      for (const value of values) {
        const data = typeof value === 'string' ? { text: value } : value
        const cell = $createTableCellNode(data.header || 0, data.cs || 1, data.width)
        cell.setRowSpan(data.rs || 1)
        cell.append($createParagraphNode().append($createTextNode(data.text)))
        keys[data.text] = cell.getKey()
        row.append(cell)
      }
      table.append(row)
    }
    $getRoot().append(table)
  }, { discrete: true })
  const update = callback => editor.update(() => callback($getNodeByKey(tableKey)), { discrete: true, tag: HISTORY_PUSH_TAG })
  const read = callback => editor.getEditorState().read(() => callback($getNodeByKey(tableKey)))
  return { editor, tableKey, keys, update, read, historyState }
}

function gridText(table) {
  const model = $getTableModel(table)
  expect(model).not.toBeNull()
  return model.grid.map(row => row.map(location => location.cell.getTextContent()))
}

// This oracle reads each physical node independently of the logical grid. It
// catches accidental deletion, duplication and edits to non-target records.
function records(table) {
  return Object.fromEntries(table.getChildren().flatMap(row => row.getChildren()).map(cell => [cell.getKey(), cell.getTextContent()]))
}

function serial(editor) {
  return editor.getEditorState().toJSON()
}

const simple = [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']]
const spanning = [[{ text: 'A', rs: 2, cs: 2 }, 'B'], ['C'], ['D', 'E', 'F']]

describe('logical table ownership', () => {
  it('resolves spans, header cells, ownership and stable structural identity', () => {
    const f = fixture([[{ text: 'A', rs: 2, cs: 2, header: TableCellHeaderStates.BOTH }, 'B', 'C'], ['D', 'E'], ['F', 'G', 'H', 'I']])
    let signature
    f.read(table => {
      const model = $getTableModel(table)
      expect(gridText(table)).toEqual([['A', 'A', 'B', 'C'], ['A', 'A', 'D', 'E'], ['F', 'G', 'H', 'I']])
      expect(model.grid[0][0]).toBe(model.grid[1][1])
      expect(model.locations.size).toBe(9)
      expect(model.locations.get(f.keys.A)).toMatchObject({ rowIndex: 0, columnIndex: 0, rowSpan: 2, colSpan: 2 })
      expect($resolveTableCell(f.keys.D, f.tableKey)).toMatchObject({ rowIndex: 1, columnIndex: 2 })
      expect($resolveTableCell(f.keys.D, 'different-table')).toBeNull()
      expect($resolveTableCell('missing-cell')).toBeNull()
      signature = model.signature
    })
    f.update(table => {
      const cell = $getNodeByKey(f.keys.D)
      cell.getFirstDescendant().setTextContent('edited')
      cell.setWidth(400)
      expect($getTableModel(table).signature).toBe(signature)
      $insertRowAtCell(cell, true)
      expect($getTableModel(table).signature).not.toBe(signature)
    })
  })

  it('rejects detached, empty, overlapping, incomplete and out-of-range grids', () => {
    const editor = createEditor(config)
    editor.update(() => {
      const table = $createTableNode()
      expect($getTableModel(table)).toBeNull()
      $getRoot().append(table)
      expect($getTableModel(table)).toBeNull()
      const cell = () => $createTableCellNode().append($createParagraphNode())
      const a = cell(), b = cell().setRowSpan(2), c = cell(), d = cell().setColSpan(2), e = cell()
      table.append($createTableRowNode().append(a, b, c), $createTableRowNode().append(d, e))
      expect($getTableModel(table)).toBeNull() // D overlaps B's second row.
      d.setColSpan(1)
      expect($getTableModel(table)).not.toBeNull()
      e.remove(true)
      expect($getTableModel(table)).toBeNull()
      table.getLastChild().append(e)
      b.setRowSpan(3)
      expect($getTableModel(table)).toBeNull()
      b.setRowSpan(2)
      c.setColSpan(0)
      expect($getTableModel(table)).toBeNull()
      table.remove()
      expect($resolveTableCell(a.getKey())).toBeNull()
    }, { discrete: true })
  })

  it('returns null for a retained node after committed deletion has removed it from editor state', () => {
    const f = fixture(simple)
    let removed
    f.update(table => {
      removed = table
      table.replace($createParagraphNode())
    })
    f.read(() => {
      expect($getTableModel(removed)).toBeNull()
      expect($resolveTableCell(f.keys.A)).toBeNull()
    })
  })
})

describe('merge and split preserve table data', () => {
  it('merges a complete 2×3 region in row-major order, retains covered rows, reloads and splits', () => {
    const f = fixture([['A', 'B', 'C'], ['D', 'E', 'F']], { widths: [90, 130, 170] })
    let rowKeys
    f.update(table => {
      rowKeys = table.getChildrenKeys()
      const first = $getNodeByKey(f.keys.A)
      first.setBackgroundColor('#ffeedd').setVerticalAlign('middle').setFormat('center').setDirection('rtl').setIndent(1)
      expect($mergeTableCells(table, Object.values(f.keys))).toEqual({ changed: true, cellKey: f.keys.A })
      expect(first.getChildren().map(paragraph => paragraph.getTextContent())).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
      expect(first.getRowSpan()).toBe(2)
      expect(first.getColSpan()).toBe(3)
      expect(first.getWidth()).toBe(390)
      expect(table.getChildrenKeys()).toEqual(rowKeys)
      expect(table.getLastChild().getChildrenSize()).toBe(0)
    })
    // Registered TablePlugin transforms and serialized reload must keep both rows.
    const loaded = createEditor(config)
    registerTablePlugin(loaded)
    loaded.setEditorState(loaded.parseEditorState(JSON.stringify(serial(f.editor))))
    loaded.getEditorState().read(() => {
      const table = $getRoot().getFirstChild()
      expect($getTableModel(table)).toMatchObject({ rowCount: 2, columnCount: 3 })
      expect(table.getFirstChild().getFirstChild().getChildren().map(node => node.getTextContent())).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    })
    f.update(table => {
      expect($splitTableCell($getNodeByKey(f.keys.A))).toEqual({ changed: true, cellKey: f.keys.A })
      expect($getTableModel(table)).toMatchObject({ rowCount: 2, columnCount: 3 })
      expect(table.getChildrenKeys()).toEqual(rowKeys)
      const cells = table.getChildren().flatMap(row => row.getChildren())
      expect(cells).toHaveLength(6)
      expect(cells.filter(cell => cell.getTextContent())).toHaveLength(1)
      for (const cell of cells) {
        expect(cell.getBackgroundColor()).toBe('#ffeedd')
        expect(cell.getVerticalAlign()).toBe('middle')
        expect(cell.getFormatType()).toBe('center')
        expect(cell.getDirection()).toBe('rtl')
        expect(cell.getIndent()).toBe(1)
      }
      expect(cells.map(cell => cell.getWidth())).toEqual([90, 130, 170, 90, 130, 170])
    })
  })

  it('merges a rectangular selection containing an existing rowspan without touching adjacent cells', () => {
    const f = fixture([[{ text: 'A', rs: 2 }, 'B', 'C'], ['D', 'E']])
    f.update(table => {
      const before = records(table)
      expect($mergeTableCells(table, [f.keys.A, f.keys.B, f.keys.D, f.keys.A]).changed).toBe(true)
      expect($getNodeByKey(f.keys.A).getChildren().map(node => node.getTextContent())).toEqual(['A', 'B', 'D'])
      expect(records(table)).toEqual({ [f.keys.A]: 'A\n\nB\n\nD', [f.keys.C]: before[f.keys.C], [f.keys.E]: before[f.keys.E] })
      expect($getTableModel(table)).toMatchObject({ rowCount: 2, columnCount: 3 })
    })
  })

  it('refuses disjoint selection and foreign keys atomically instead of merging unselected cells', () => {
    const f = fixture(simple)
    const before = serial(f.editor)
    f.update(table => {
      expect($mergeTableCells(table, [f.keys.A, f.keys.I])).toMatchObject({ changed: false, reason: expect.any(String) })
      expect($mergeTableCells(table, [f.keys.A, 'foreign'])).toMatchObject({ changed: false })
      expect($splitTableCell($getNodeByKey(f.keys.A))).toMatchObject({ changed: false })
    })
    expect(serial(f.editor)).toEqual(before)
  })
})

describe('insert logical rows and columns', () => {
  it.each([['B', true], ['C', false]])('inserts a row across a 3×2 span from %s, after=%s, extending its owner only once', (anchor, after) => {
    const f = fixture([[{ text: 'A', rs: 3, cs: 2 }, 'B'], ['C'], ['D']], { widths: [90, 120, 150] })
    f.update(table => {
      const before = records(table)
      $getNodeByKey(f.keys[anchor]).setBackgroundColor('#abc').setVerticalAlign('bottom')
      expect($insertRowAtCell($getNodeByKey(f.keys[anchor]), after).changed).toBe(true)
      expect(gridText(table)).toEqual([['A', 'A', 'B'], ['A', 'A', ''], ['A', 'A', 'C'], ['A', 'A', 'D']])
      expect($getNodeByKey(f.keys.A).getRowSpan()).toBe(4)
      const added = $getTableModel(table).grid[1][2].cell
      expect(added.getBackgroundColor()).toBe('#abc')
      expect(added.getVerticalAlign()).toBe('bottom')
      expect(added.getWidth()).toBe(150)
      const all = records(table)
      for (const [key, text] of Object.entries(before)) expect(all[key]).toBe(text)
    })
  })

  it.each([['D', true], ['E', false]])('inserts a column through a 2×2 span from %s, after=%s, extending its owner only once', (anchor, after) => {
    const f = fixture(spanning, { widths: [100, 200, 300] })
    f.update(table => {
      const before = records(table)
      expect($insertColumnAtCell($getNodeByKey(f.keys[anchor]), after).changed).toBe(true)
      expect(gridText(table)).toEqual([['A', 'A', 'A', 'B'], ['A', 'A', 'A', 'C'], ['D', '', 'E', 'F']])
      expect($getNodeByKey(f.keys.A).getColSpan()).toBe(3)
      expect(table.getColWidths()).toEqual(after ? [100, 100, 200, 300] : [100, 200, 200, 300])
      expect($getNodeByKey(f.keys.A).getWidth()).toBe(after ? 400 : 500)
      const all = records(table)
      for (const [key, text] of Object.entries(before)) expect(all[key]).toBe(text)
    })
  })

  it.each([
    ['A', false, [80, 80, 120, 200]], ['A', true, [80, 80, 120, 200]],
    ['B', true, [80, 120, 120, 200]], ['C', true, [80, 120, 200, 200]],
    ['C', false, [80, 120, 200, 200]],
  ])('keeps existing column widths at their logical positions when inserting at %s after=%s', (anchor, after, expected) => {
    const f = fixture([['A', 'B', 'C']], { widths: [80, 120, 200] })
    f.update(table => {
      $insertColumnAtCell($getNodeByKey(f.keys[anchor]), after)
      expect(table.getColWidths()).toEqual(expected)
      expect($getNodeByKey(f.keys.A).getWidth()).toBe(80)
      expect($getNodeByKey(f.keys.B).getWidth()).toBe(120)
      expect($getNodeByKey(f.keys.C).getWidth()).toBe(200)
    })
  })

  it('inherits header axis semantics without converting inserted body rows to headers', () => {
    const f = fixture([[{ text: 'A', header: 3 }, { text: 'B', header: 1 }], [{ text: 'C', header: 2 }, 'D']])
    f.update(table => {
      $insertRowAtCell($getNodeByKey(f.keys.A), true)
      expect($getTableModel(table).grid[1].map(location => location.cell.getHeaderStyles())).toEqual([2, 0])
      $insertColumnAtCell($getNodeByKey(f.keys.A), true)
      expect($getTableModel(table).grid.map(row => row[1].cell.getHeaderStyles())).toEqual([1, 0, 0])
    })
  })
})

describe('delete exactly the current logical row or column', () => {
  it.each([0, 1, 2])('deletes row %s while preserving every other record and key', rowIndex => {
    const f = fixture(simple)
    f.update(table => {
      const before = records(table)
      const removed = simple[rowIndex].map(text => f.keys[text])
      expect($deleteRowAtCell($getNodeByKey(f.keys[simple[rowIndex][1]])).changed).toBe(true)
      expect(gridText(table)).toEqual(simple.filter((_, index) => index !== rowIndex))
      for (const key of removed) delete before[key]
      expect(records(table)).toEqual(before)
    })
  })

  it.each([0, 1, 2])('deletes column %s while preserving every other record, key and width', columnIndex => {
    const f = fixture(simple, { widths: [100, 200, 300] })
    f.update(table => {
      const before = records(table)
      for (const row of simple) delete before[f.keys[row[columnIndex]]]
      expect($deleteColumnAtCell($getNodeByKey(f.keys[simple[1][columnIndex]])).changed).toBe(true)
      expect(gridText(table)).toEqual(simple.map(row => row.filter((_, index) => index !== columnIndex)))
      expect(records(table)).toEqual(before)
      expect(table.getColWidths()).toEqual([100, 200, 300].filter((_, index) => index !== columnIndex))
    })
  })

  it('moves a rowspan anchor into the surviving row and preserves its content, style and key', () => {
    const f = fixture(spanning)
    f.update(table => {
      const cell = $getNodeByKey(f.keys.A)
      const survivingRow = table.getChildren()[1].getKey()
      cell.setBackgroundColor('#abc').setWidth(240).setHeaderStyles(2)
      expect($deleteRowAtCell(cell).changed).toBe(true)
      expect(gridText(table)).toEqual([['A', 'A', 'C'], ['D', 'E', 'F']])
      expect(table.getFirstChild().getKey()).toBe(survivingRow)
      expect(cell.getParent().getKey()).toBe(survivingRow)
      expect(cell.getRowSpan()).toBe(1)
      expect(cell.getBackgroundColor()).toBe('#abc')
      expect(cell.getWidth()).toBe(240)
      expect(cell.getHeaderStyles()).toBe(2)
      expect(records(table)).toEqual({ [f.keys.A]: 'A', [f.keys.C]: 'C', [f.keys.D]: 'D', [f.keys.E]: 'E', [f.keys.F]: 'F' })
    })
  })

  it('moves multiple staggered anchors in logical order around the next row’s existing cells', () => {
    const f = fixture([[{ text: 'A', rs: 3 }, 'B', { text: 'C', rs: 2, cs: 2 }], ['D'], ['E', 'F', 'G'], ['H', 'I', 'J', 'K']])
    f.update(table => {
      const before = records(table)
      delete before[f.keys.B]
      $deleteRowAtCell($getNodeByKey(f.keys.B))
      expect(gridText(table)).toEqual([['A', 'D', 'C', 'C'], ['A', 'E', 'F', 'G'], ['H', 'I', 'J', 'K']])
      expect(table.getFirstChild().getChildrenKeys()).toEqual([f.keys.A, f.keys.D, f.keys.C])
      expect(records(table)).toEqual(before)
    })
  })

  it('keeps a table whose only cell moves out of the deleted row into a fully covered empty row', () => {
    const f = fixture([[{ text: 'A', rs: 3, cs: 3 }], [], []])
    f.update(table => {
      expect($deleteRowAtCell($getNodeByKey(f.keys.A)).changed).toBe(true)
      expect(table.isAttached()).toBe(true)
      expect(gridText(table)).toEqual([['A', 'A', 'A'], ['A', 'A', 'A']])
      expect($getNodeByKey(f.keys.A).getRowSpan()).toBe(2)
    })
  })

  it('reduces a wide rowspan once when deleting its middle row', () => {
    const f = fixture([[{ text: 'A', rs: 3, cs: 2 }, 'B'], ['C'], ['D']])
    f.update(table => {
      $deleteRowAtCell($getNodeByKey(f.keys.C))
      expect(gridText(table)).toEqual([['A', 'A', 'B'], ['A', 'A', 'D']])
      expect($getNodeByKey(f.keys.A).getRowSpan()).toBe(2)
      expect(records(table)).toEqual({ [f.keys.A]: 'A', [f.keys.B]: 'B', [f.keys.D]: 'D' })
    })
  })

  it.each([
    ['A', [['A', 'B'], ['A', 'C'], ['E', 'F']], ['D']],
    ['E', [['A', 'B'], ['A', 'C'], ['D', 'F']], ['E']],
  ])('deletes a colspan anchor/interior column at %s without deleting the remaining merged content', (anchor, expected, removed) => {
    const f = fixture(spanning, { widths: [100, 200, 300] })
    f.update(table => {
      const before = records(table)
      for (const text of removed) delete before[f.keys[text]]
      $deleteColumnAtCell($getNodeByKey(f.keys[anchor]))
      expect(gridText(table)).toEqual(expected)
      expect(records(table)).toEqual(before)
      expect($getNodeByKey(f.keys.A).getColSpan()).toBe(1)
      expect($getNodeByKey(f.keys.A).getWidth()).toBe(anchor === 'A' ? 200 : 100)
    })
  })

  it('keeps an empty physical row that remains covered by a rowspan', () => {
    const f = fixture([[{ text: 'A', rs: 2 }, 'B'], ['C']])
    f.update(table => {
      $deleteColumnAtCell($getNodeByKey(f.keys.B))
      expect(gridText(table)).toEqual([['A'], ['A']])
      expect(table.getChildrenSize()).toBe(2)
      expect(table.getLastChild().getChildrenSize()).toBe(0)
    })
    f.read(table => expect($getTableModel(table)).toMatchObject({ rowCount: 2, columnCount: 1 }))
  })

  it.each(['row', 'column'])('removes the final %s safely, leaving an editable paragraph', axis => {
    const f = fixture([['A']])
    f.update(table => {
      expect((axis === 'row' ? $deleteRowAtCell : $deleteColumnAtCell)($getNodeByKey(f.keys.A)).changed).toBe(true)
      expect(table.isAttached()).toBe(false)
      expect($getRoot().getFirstChild().getType()).toBe('paragraph')
      expect($resolveTableCell(f.keys.A)).toBeNull()
      expect((axis === 'row' ? $deleteRowAtCell : $deleteColumnAtCell)($getNodeByKey(f.keys.A)).changed).toBe(false)
    })
  })
})

describe('reorder stable logical records', () => {
  it('moves simple rows and columns by an arbitrary delta with widths attached to their columns', () => {
    const f = fixture(simple, { widths: [100, 200, 300] })
    f.update(table => {
      const before = records(table)
      expect($moveTableRow(table, 0, 2)).toEqual({ changed: true })
      expect(gridText(table)).toEqual([['D', 'E', 'F'], ['G', 'H', 'I'], ['A', 'B', 'C']])
      expect($moveTableColumn(table, 0, 2)).toEqual({ changed: true })
      expect(gridText(table)).toEqual([['E', 'F', 'D'], ['H', 'I', 'G'], ['B', 'C', 'A']])
      expect(table.getColWidths()).toEqual([200, 300, 100])
      expect(records(table)).toEqual(before)
    })
  })

  it('allows a row to move past an intact rowspan block', () => {
    const f = fixture(spanning)
    f.update(table => {
      const before = records(table)
      expect($moveTableRow(table, 2, -2)).toEqual({ changed: true })
      expect(gridText(table)).toEqual([['D', 'E', 'F'], ['A', 'A', 'B'], ['A', 'A', 'C']])
      expect(records(table)).toEqual(before)
    })
  })

  it('allows a column to move past an intact colspan block, including rowspans and widths', () => {
    const f = fixture(spanning, { widths: [100, 200, 300] })
    f.update(table => {
      const before = records(table)
      expect($moveTableColumn(table, 2, -2)).toEqual({ changed: true })
      expect(gridText(table)).toEqual([['B', 'A', 'A'], ['C', 'A', 'A'], ['F', 'D', 'E']])
      expect(table.getColWidths()).toEqual([300, 100, 200])
      expect(records(table)).toEqual(before)
    })
  })

  it.each(['row', 'column'])('rejects moving part of a merged %s atomically', axis => {
    const f = fixture(spanning, { widths: [100, 200, 300] })
    const before = serial(f.editor)
    f.update(table => {
      const move = axis === 'row' ? $moveTableRow : $moveTableColumn
      expect(move(table, 0, 1)).toMatchObject({ changed: false, reason: expect.any(String) })
      expect(move(table, 0, -1)).toEqual({ changed: false })
      expect(move(table, 0, 0)).toEqual({ changed: false })
    })
    expect(serial(f.editor)).toEqual(before)
  })
})

describe('document history and scale', () => {
  it('restores the exact document after inserting and deleting through staggered row and column spans', () => {
    const f = fixture([[{ text: 'A', rs: 3 }, 'B', { text: 'C', rs: 2, cs: 2 }], ['D'], ['E', 'F', 'G'], ['H', 'I', 'J', 'K']], { widths: [80, 120, 160, 200] })
    // Normalize cell widths once, as the resize flow does, before taking the
    // independent serialized-document oracle for the inverse operations.
    f.update(table => {
      for (const row of table.getChildren()) {
        for (const cell of row.getChildren()) {
          const location = $resolveTableCell(cell.getKey())
          cell.setWidth(table.getColWidths().slice(location.columnIndex, location.columnIndex + location.colSpan).reduce((sum, width) => sum + width, 0))
        }
      }
    })
    const before = serial(f.editor)
    f.update(table => {
      const inserted = $insertRowAtCell($getNodeByKey(f.keys.B), true)
      expect($getTableModel(table)).toMatchObject({ rowCount: 5, columnCount: 4 })
      $deleteRowAtCell($getNodeByKey(inserted.cellKey))
      const insertedColumn = $insertColumnAtCell($getNodeByKey(f.keys.F), true)
      expect($getTableModel(table)).toMatchObject({ rowCount: 4, columnCount: 5 })
      $deleteColumnAtCell($getNodeByKey(insertedColumn.cellKey))
    })
    expect(serial(f.editor)).toEqual(before)
  })

  it('undoes and redoes an entire structural edit without losing text, merged rows or widths', async () => {
    const f = fixture([['A', 'B', 'C'], ['D', 'E', 'F']], { widths: [80, 120, 200], history: true })
    const before = serial(f.editor)
    f.update(table => $mergeTableCells(table, Object.values(f.keys)))
    const merged = serial(f.editor)
    expect(f.historyState.undoStack).toHaveLength(1)
    f.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await Promise.resolve()
    expect(serial(f.editor)).toEqual(before)
    f.editor.dispatchCommand(REDO_COMMAND, undefined)
    await Promise.resolve()
    expect(serial(f.editor)).toEqual(merged)
    f.read(table => expect($getTableModel(table)).toMatchObject({ rowCount: 2, columnCount: 3 }))
  })

  it('preserves long text and all unaffected keys across a 1,000-row reorder and deletion', () => {
    const longText = '长文本🙂'.repeat(2000)
    const matrix = Array.from({ length: 1000 }, (_, index) => [`R${index}`, index === 500 ? longText : `V${index}`, `E${index}`])
    const f = fixture(matrix)
    f.update(table => {
      const before = records(table)
      expect($moveTableRow(table, 500, 499)).toEqual({ changed: true })
      expect($getTableModel(table).grid[999][1].cell.getTextContent()).toBe(longText)
      $deleteRowAtCell($getNodeByKey(f.keys.R0))
      for (const text of matrix[0]) delete before[f.keys[text]]
      expect(records(table)).toEqual(before)
      expect($getTableModel(table)).toMatchObject({ rowCount: 999, columnCount: 3 })
    })
  })
})
