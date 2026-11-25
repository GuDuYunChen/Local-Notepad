import { $createParagraphNode, $getNodeByKey } from 'lexical'
import {
  $insertTableColumnAtNode,
  $insertTableRowAtNode,
  $isSimpleTable,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $mergeCells,
  $moveTableColumn as $moveSimpleTableColumn,
  $moveTableRow as $moveSimpleTableRow,
  $unmergeCellNode,
  TableCellHeaderStates,
} from '@lexical/table'

const invalidTable = () => ({ changed: false, reason: '表格已变化，请重新选择单元格' })

/**
 * A logical grid, rather than child indexes: a spanning cell owns every grid
 * position it covers. Call inside an editor read/update and never retain nodes
 * across updates; keep keys and the structural signature instead.
 */
export function $getTableModel(table) {
  if (!$isTableNode(table)) return null
  // A previously rendered table may already have been garbage-collected after
  // deletion or document replacement. Looking it up first avoids getLatest()
  // throwing when a stale pointer event still carries that node object.
  table = $getNodeByKey(table.getKey())
  if (!$isTableNode(table) || !table.isAttached()) return null
  const rows = table.getChildren()
  if (!rows.length || rows.some(row => !$isTableRowNode(row))) return null
  const firstCells = rows[0].getChildren()
  if (!firstCells.length || firstCells.some(cell => !$isTableCellNode(cell))) return null
  const columnCount = firstCells.reduce((count, cell) => count + cell.getColSpan(), 0)
  if (!Number.isSafeInteger(columnCount) || columnCount < 1) return null
  const grid = rows.map(() => [])
  const locations = new Map()
  const structure = []

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    const cells = row.getChildren()
    let columnIndex = 0
    const rowStructure = [row.getKey()]
    for (const cell of cells) {
      if (!$isTableCellNode(cell)) return null
      while (grid[rowIndex][columnIndex]) columnIndex++
      const rowSpan = cell.getRowSpan()
      const colSpan = cell.getColSpan()
      if (!Number.isSafeInteger(rowSpan) || rowSpan < 1 || !Number.isSafeInteger(colSpan) || colSpan < 1 ||
        rowIndex + rowSpan > rows.length || columnIndex + colSpan > columnCount) return null
      const location = { cell, rowIndex, columnIndex, rowSpan, colSpan }
      for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
        for (let c = columnIndex; c < columnIndex + colSpan; c++) {
          // A malformed colspan must never silently overwrite a rowspan owner.
          if (grid[r][c]) return null
          grid[r][c] = location
        }
      }
      locations.set(cell.getKey(), location)
      rowStructure.push([cell.getKey(), rowSpan, colSpan])
      columnIndex += colSpan
    }
    if (grid[rowIndex].length !== columnCount) return null
    for (let c = 0; c < columnCount; c++) if (!grid[rowIndex][c]) return null
    structure.push(rowStructure)
  }
  return {
    table, rows, grid, locations, rowCount: rows.length, columnCount,
    signature: JSON.stringify([table.getKey(), structure]),
  }
}

export function $resolveTableCell(cellKey, tableKey) {
  if (typeof cellKey !== 'string') return null
  const cell = $getNodeByKey(cellKey)
  if (!$isTableCellNode(cell) || !cell.isAttached()) return null
  const row = cell.getParent()
  const table = row?.getParent()
  if (!$isTableRowNode(row) || !$isTableNode(table) || (tableKey && table.getKey() !== tableKey)) return null
  const model = $getTableModel(table)
  const location = model?.locations.get(cellKey)
  return location ? { ...location, model, table, row } : null
}

function $resolveNode(cell) {
  return $isTableCellNode(cell) ? $resolveTableCell(cell.getKey()) : null
}

const positiveWidth = width => Number.isFinite(width) && width > 0

function getWidths(model) {
  const stored = model.table.getColWidths()
  if (stored?.length === model.columnCount && stored.every(positiveWidth)) return [...stored]
  // Older resizing stored only cell.width. Resolve those widths before changing
  // spans or removing cells, giving canonical columns and single cells priority.
  // Unknown columns remain automatic; an operation must not invent 90px widths.
  const widths = Array.from({ length: model.columnCount }, (_, index) => positiveWidth(stored?.[index]) ? stored[index] : undefined)
  const spans = []
  for (const { cell, columnIndex, colSpan } of model.locations.values()) {
    const width = cell.getWidth()
    if (!positiveWidth(width)) continue
    if (colSpan === 1) widths[columnIndex] ??= width
    else spans.push({ columnIndex, colSpan, width })
  }
  const fill = (span, singleOnly = false) => {
    const missing = []
    let known = 0
    for (let index = span.columnIndex; index < span.columnIndex + span.colSpan; index++) {
      if (widths[index] === undefined) missing.push(index)
      else known += widths[index]
    }
    if (!missing.length || (singleOnly && missing.length !== 1) || span.width <= known) return false
    for (const index of missing) widths[index] = (span.width - known) / missing.length
    return true
  }
  // Resolve determinate span constraints first. For columns represented only
  // by a span, distribute its remaining width without altering known columns.
  let changed = true
  while (changed) {
    changed = false
    for (const span of spans) changed = fill(span, true) || changed
  }
  for (const span of spans.sort((a, b) => a.colSpan - b.colSpan)) fill(span)
  return widths.some(positiveWidth) ? widths : null
}

function spanWidth(widths, columnIndex, colSpan) {
  if (!widths) return undefined
  const values = widths.slice(columnIndex, columnIndex + colSpan)
  return values.length === colSpan && values.every(positiveWidth)
    ? values.reduce((sum, width) => sum + width, 0) : undefined
}

function $syncWidths(model, widths) {
  if (!model || !widths) return
  // COLGROUP requires a complete list. Keep partial legacy sizing on cells so
  // unrelated automatic columns are not assigned a guessed width.
  model.table.setColWidths(widths.every(positiveWidth) ? widths : undefined)
  for (const { cell, columnIndex, colSpan } of model.locations.values()) {
    const width = spanWidth(widths, columnIndex, colSpan)
    if (width !== undefined) cell.setWidth(width)
  }
}

function $copyPresentation(source, target, width) {
  target.setBackgroundColor(source.getBackgroundColor())
  target.setVerticalAlign(source.getVerticalAlign())
  target.setFormat(source.getFormatType())
  target.setStyle(source.getStyle())
  target.setDirection(source.getDirection())
  target.setIndent(source.getIndent())
  target.setWidth(width)
}

function $selectAt(table, rowIndex, columnIndex) {
  const model = $getTableModel(table)
  const location = model?.grid[Math.min(rowIndex, model.rowCount - 1)]?.[Math.min(columnIndex, model.columnCount - 1)]
  location?.cell.selectStart()
  return location?.cell.getKey()
}

function $removeTable(table) {
  if (table.getPreviousSibling()) table.selectPrevious()
  else if (table.getNextSibling()) table.selectNext()
  else {
    const paragraph = $createParagraphNode()
    table.insertBefore(paragraph)
    paragraph.selectStart()
  }
  table.remove()
  return { changed: true }
}

export function $insertRowAtCell(cell, after = true) {
  const current = $resolveNode(cell)
  if (!current) return invalidTable()
  const { model, table, rowIndex, rowSpan } = current
  const boundary = rowIndex + (after ? rowSpan : 0)
  const referenceRow = after ? boundary - 1 : boundary
  const widths = getWidths(model)
  const inserted = $insertTableRowAtNode(current.cell, after)
  if (!inserted) return invalidTable()
  // A merged cell appears once per logical column in Lexical's insertion map.
  // Set its span from the snapshot once, even when it was already writable.
  for (const location of model.locations.values()) {
    if (location.rowIndex < boundary && location.rowIndex + location.rowSpan > boundary) {
      location.cell.setRowSpan(location.rowSpan + 1)
    }
  }
  inserted.setHeight(model.rows[referenceRow].getHeight())
  const next = $getTableModel(table)
  for (const location of next.locations.values()) {
    if (model.locations.has(location.cell.getKey())) continue
    const source = model.grid[referenceRow][location.columnIndex]
    $copyPresentation(source.cell, location.cell, widths?.[location.columnIndex] ??
      (source.cell.getWidth() === undefined ? undefined : source.cell.getWidth() / source.colSpan))
  }
  $syncWidths(next, widths)
  return { changed: true, cellKey: $selectAt(table, boundary, current.columnIndex) }
}

export function $insertColumnAtCell(cell, after = true) {
  const current = $resolveNode(cell)
  if (!current) return invalidTable()
  const { model, table, columnIndex, colSpan } = current
  const boundary = columnIndex + (after ? colSpan : 0)
  const referenceColumn = after ? boundary - 1 : boundary
  const widths = getWidths(model)
  const originalWidths = table.getColWidths()
  $insertTableColumnAtNode(current.cell, after, false)
  for (const location of model.locations.values()) {
    if (location.columnIndex < boundary && location.columnIndex + location.colSpan > boundary) {
      location.cell.setColSpan(location.colSpan + 1)
    }
  }
  // The pinned helper splices before insertAfterColumn, not at the boundary.
  if (widths) {
    widths.splice(boundary, 0, widths[referenceColumn])
  } else if (originalWidths) table.setColWidths(originalWidths)
  const next = $getTableModel(table)
  for (const location of next.locations.values()) {
    if (model.locations.has(location.cell.getKey())) continue
    const source = model.grid[location.rowIndex][referenceColumn]
    $copyPresentation(source.cell, location.cell, widths?.[boundary] ??
      (source.cell.getWidth() === undefined ? undefined : source.cell.getWidth() / source.colSpan))
  }
  $syncWidths(next, widths)
  return { changed: true, cellKey: $selectAt(table, current.rowIndex, boundary) }
}

export function $deleteRowAtCell(cell) {
  const current = $resolveNode(cell)
  if (!current) return invalidTable()
  const { model, table, rowIndex } = current
  if (model.rowCount === 1) return $removeTable(table)
  const widths = getWidths(model)
  const moving = []
  for (const location of model.locations.values()) {
    if (location.rowIndex > rowIndex || location.rowIndex + location.rowSpan <= rowIndex) continue
    if (location.rowSpan > 1) {
      location.cell.setRowSpan(location.rowSpan - 1)
      if (location.rowIndex === rowIndex) moving.push(location)
    }
  }
  if (moving.length) {
    const nextRow = model.rows[rowIndex + 1]
    const ordered = [...nextRow.getChildren().map(node => model.locations.get(node.getKey())), ...moving]
      .sort((a, b) => a.columnIndex - b.columnIndex).map(location => location.cell)
    nextRow.splice(0, nextRow.getChildrenSize(), ordered)
  }
  // Unlike delete-at-selection, this removes just the menu's current row, even
  // when its anchor spans several rows. Crossing content keeps its node key.
  model.rows[rowIndex].remove(true)
  $syncWidths($getTableModel(table), widths)
  return { changed: true, cellKey: $selectAt(table, rowIndex, current.columnIndex) }
}

export function $deleteColumnAtCell(cell) {
  const current = $resolveNode(cell)
  if (!current) return invalidTable()
  const { model, table, columnIndex } = current
  if (model.columnCount === 1) return $removeTable(table)
  const widths = getWidths(model)
  for (const location of model.locations.values()) {
    if (location.columnIndex > columnIndex || location.columnIndex + location.colSpan <= columnIndex) continue
    if (location.colSpan > 1) location.cell.setColSpan(location.colSpan - 1)
    else location.cell.remove(true) // Empty physical rows can be covered by rowspans.
  }
  if (widths) {
    widths.splice(columnIndex, 1)
    $syncWidths($getTableModel(table), widths)
  }
  return { changed: true, cellKey: $selectAt(table, current.rowIndex, columnIndex) }
}

export function $mergeTableCells(table, cellKeys) {
  const model = $getTableModel(table)
  if (!model) return invalidTable()
  const keys = new Set(cellKeys || [])
  if (keys.size < 2) return { changed: false, reason: '请先选择多个单元格' }
  const selected = [...keys].map(key => model.locations.get(key))
  if (selected.some(location => !location)) return invalidTable()
  const top = Math.min(...selected.map(location => location.rowIndex))
  const left = Math.min(...selected.map(location => location.columnIndex))
  const bottom = Math.max(...selected.map(location => location.rowIndex + location.rowSpan))
  const right = Math.max(...selected.map(location => location.columnIndex + location.colSpan))
  for (let r = top; r < bottom; r++) {
    for (let c = left; c < right; c++) {
      if (!keys.has(model.grid[r][c].cell.getKey())) {
        return { changed: false, reason: '请选择连续的矩形区域后再合并' }
      }
    }
  }
  const widths = getWidths(model)
  const merged = $mergeCells(selected.map(location => location.cell))
  if (!merged) return invalidTable()
  // Lexical's cell.remove() prunes a now-empty row. A row covered entirely by
  // the new rowspan is still part of the table, so restore its original node.
  if (table.getChildrenSize() !== model.rowCount) table.splice(0, table.getChildrenSize(), model.rows)
  $syncWidths($getTableModel(table), widths)
  merged.selectStart()
  return { changed: true, cellKey: merged.getKey() }
}

export function $splitTableCell(cell) {
  const current = $resolveNode(cell)
  if (!current) return invalidTable()
  const { model, table, rowIndex, columnIndex, rowSpan, colSpan } = current
  if (rowSpan === 1 && colSpan === 1) return { changed: false, reason: '当前单元格无需拆分' }
  const widths = getWidths(model)
  const oldWidth = current.cell.getWidth()
  const oldHeader = current.cell.getHeaderStyles()
  const columnHeaders = Array.from({ length: colSpan }, (_, offset) => model.grid.reduce(
    (header, row) => header & row[columnIndex + offset].cell.getHeaderStyles(), oldHeader & TableCellHeaderStates.COLUMN,
  ))
  const rowHeaders = Array.from({ length: rowSpan }, (_, offset) => model.grid[rowIndex + offset].reduce(
    (header, location) => header & location.cell.getHeaderStyles(), oldHeader & TableCellHeaderStates.ROW,
  ))
  $unmergeCellNode(current.cell)
  const next = $getTableModel(table)
  for (let r = 0; r < rowSpan; r++) {
    for (let c = 0; c < colSpan; c++) {
      const target = next.grid[rowIndex + r][columnIndex + c].cell
      target.setWidth(widths?.[columnIndex + c] ?? (oldWidth === undefined ? undefined : oldWidth / colSpan))
      if (r || c) target.setHeaderStyles(columnHeaders[c] | rowHeaders[r])
    }
  }
  $syncWidths(next, widths)
  current.cell.selectStart()
  return { changed: true, cellKey: current.cell.getKey() }
}

function getMove(model, origin, delta, axis) {
  const count = axis === 'row' ? model.rowCount : model.columnCount
  const target = origin + delta
  if (!Number.isInteger(origin) || !Number.isInteger(delta) || origin < 0 || origin >= count || target < 0 || target >= count || delta === 0) return null
  const order = Array.from({ length: count }, (_, index) => index)
  order.splice(target, 0, ...order.splice(origin, 1))
  const positions = []
  order.forEach((original, index) => { positions[original] = index })
  for (const location of model.locations.values()) {
    const start = axis === 'row' ? location.rowIndex : location.columnIndex
    const span = axis === 'row' ? location.rowSpan : location.colSpan
    // The cell stays anchored to its original row/column. Every position it
    // owns must remain contiguous to the right/below that anchor after a move.
    for (let index = start; index < start + span; index++) {
      if (positions[index] < positions[start] || positions[index] >= positions[start] + span) return false
    }
  }
  return { target, positions, order }
}

export function $moveTableRow(table, rowIndex, delta) {
  const model = $getTableModel(table)
  if (!model) return invalidTable()
  const move = getMove(model, rowIndex, delta, 'row')
  if (move === null) return { changed: false }
  if (move === false) return { changed: false, reason: '请先拆分跨越移动位置的合并单元格' }
  const widths = getWidths(model)
  if ($isSimpleTable(table)) $moveSimpleTableRow(table, rowIndex, move.target)
  else if (move.target > rowIndex) model.rows[move.target].insertAfter(model.rows[rowIndex])
  else model.rows[move.target].insertBefore(model.rows[rowIndex])
  $syncWidths($getTableModel(table), widths)
  return { changed: true }
}

export function $moveTableColumn(table, columnIndex, delta) {
  const model = $getTableModel(table)
  if (!model) return invalidTable()
  const move = getMove(model, columnIndex, delta, 'column')
  if (move === null) return { changed: false }
  if (move === false) return { changed: false, reason: '请先拆分跨越移动位置的合并单元格' }
  const widths = getWidths(model)
  if ($isSimpleTable(table)) $moveSimpleTableColumn(table, columnIndex, move.target)
  else {
    for (const row of model.rows) {
      const cells = row.getChildren().sort((a, b) => move.positions[model.locations.get(a.getKey()).columnIndex] - move.positions[model.locations.get(b.getKey()).columnIndex])
      row.splice(0, row.getChildrenSize(), cells)
    }
  }
  $syncWidths($getTableModel(table), widths && move.order.map(index => widths[index]))
  return { changed: true }
}
