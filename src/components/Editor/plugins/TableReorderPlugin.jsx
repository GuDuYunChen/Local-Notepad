import React, { useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey, $getRoot } from 'lexical'
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table'

function findCellInfo(editor, cellElement) {
  let result = null

  editor.getEditorState().read(() => {
    const walk = node => {
      if (result || !node?.getChildren) return

      if (node instanceof TableNode) {
        const rows = node.getChildren()
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex]
          const cells = row.getChildren()

          for (let colIndex = 0; colIndex < cells.length; colIndex++) {
            const cell = cells[colIndex]
            if (!(cell instanceof TableCellNode)) continue
            if (editor.getElementByKey(cell.getKey()) !== cellElement) continue

            result = {
              tableKey: node.getKey(),
              rowKey: row.getKey(),
              cellKey: cell.getKey(),
              rowIndex,
              colIndex,
              rowSpan: cell.getRowSpan?.() || 1,
              colSpan: cell.getColSpan?.() || 1,
            }
            return
          }
        }
      }

      for (const child of node.getChildren?.() || []) walk(child)
    }

    walk($getRoot())
  })

  return result
}

function reorderRow(editor, tableKey, fromIndex, toIndex) {
  editor.update(() => {
    const table = $getNodeByKey(tableKey)
    if (!(table instanceof TableNode)) return

    const rows = table.getChildren()
    const row = rows[fromIndex]
    const target = rows[toIndex]
    if (!(row instanceof TableRowNode) || !(target instanceof TableRowNode) || row === target) return

    if (toIndex < fromIndex) target.insertBefore(row)
    else target.insertAfter(row)
  })
}

function reorderColumn(editor, tableKey, fromIndex, toIndex) {
  editor.update(() => {
    const table = $getNodeByKey(tableKey)
    if (!(table instanceof TableNode)) return

    const rows = table.getChildren()

    for (const row of rows) {
      const cells = row.getChildren()
      const source = cells[fromIndex]
      const target = cells[toIndex]
      if (!(source instanceof TableCellNode) || !(target instanceof TableCellNode)) return
      if ((source.getColSpan?.() || 1) !== 1 || (target.getColSpan?.() || 1) !== 1) return
    }

    for (const row of rows) {
      const cells = row.getChildren()
      const source = cells[fromIndex]
      const target = cells[toIndex]

      if (toIndex < fromIndex) target.insertBefore(source)
      else target.insertAfter(source)
    }
  })
}

export default function TableReorderPlugin() {
  const [editor] = useLexicalComposerContext()
  const [handle, setHandle] = useState(null)
  const [dragState, setDragState] = useState(null)

  useEffect(() => {
    const rootElement = editor.getRootElement()
    const container = rootElement?.closest('.editor-container')
    if (!rootElement || !container) return undefined

    let frame = 0

    const updateHandle = event => {
      if (dragState) return
      if (frame) window.cancelAnimationFrame(frame)

      frame = window.requestAnimationFrame(() => {
        const cellElement = event.target?.closest?.('td, th')
        if (!cellElement || !rootElement.contains(cellElement)) {
          setHandle(null)
          return
        }

        const info = findCellInfo(editor, cellElement)
        if (!info) {
          setHandle(null)
          return
        }

        const rowElement = cellElement.parentElement
        const tableElement = cellElement.closest('table')
        if (!rowElement || !tableElement) return

        const cellRect = cellElement.getBoundingClientRect()
        const rowRect = rowElement.getBoundingClientRect()
        const tableRect = tableElement.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()

        setHandle({
          ...info,
          tableElement,
          rowElement,
          row: {
            top: rowRect.top - containerRect.top + container.scrollTop + rowRect.height / 2 - 13,
            left: tableRect.left - containerRect.left + container.scrollLeft - 28,
          },
          col: {
            top: tableRect.top - containerRect.top + container.scrollTop - 28,
            left: cellRect.left - containerRect.left + container.scrollLeft + cellRect.width / 2 - 13,
          },
        })
      })
    }

    const hide = event => {
      if (dragState) return
      if (event.relatedTarget?.closest?.('.table-reorder-handle')) return
      setHandle(null)
    }

    container.addEventListener('mousemove', updateHandle)
    container.addEventListener('mouseleave', hide)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      container.removeEventListener('mousemove', updateHandle)
      container.removeEventListener('mouseleave', hide)
    }
  }, [editor, dragState])

  useEffect(() => {
    if (!dragState) return undefined

    const rootElement = editor.getRootElement()
    const container = rootElement?.closest('.editor-container')
    if (!rootElement || !container) return undefined

    const clearTargets = () => {
      container.querySelectorAll('.table-row-drop-target,.table-col-drop-target').forEach(element => {
        element.classList.remove('table-row-drop-target', 'table-col-drop-target')
      })
    }

    const onDragOver = event => {
      const cellElement = event.target?.closest?.('td, th')
      if (!cellElement || !rootElement.contains(cellElement)) return

      const info = findCellInfo(editor, cellElement)
      if (!info || info.tableKey !== dragState.tableKey) return

      event.preventDefault()
      clearTargets()

      if (dragState.type === 'row') {
        const rowElement = cellElement.parentElement
        rowElement?.classList.add('table-row-drop-target')
        setDragState(previous => previous ? { ...previous, targetIndex: info.rowIndex } : previous)
      } else {
        const tableElement = cellElement.closest('table')
        for (const row of Array.from(tableElement?.rows || [])) {
          row.cells?.[info.colIndex]?.classList.add('table-col-drop-target')
        }
        setDragState(previous => previous ? { ...previous, targetIndex: info.colIndex } : previous)
      }

      event.dataTransfer.dropEffect = 'move'
    }

    const onDrop = event => {
      event.preventDefault()
      clearTargets()

      if (
        dragState.targetIndex === undefined ||
        dragState.targetIndex === dragState.sourceIndex
      ) {
        setDragState(null)
        return
      }

      if (dragState.type === 'row') {
        reorderRow(editor, dragState.tableKey, dragState.sourceIndex, dragState.targetIndex)
      } else {
        reorderColumn(editor, dragState.tableKey, dragState.sourceIndex, dragState.targetIndex)
      }

      setDragState(null)
      setHandle(null)
    }

    const onDragEnd = () => {
      clearTargets()
      setDragState(null)
      setHandle(null)
    }

    container.addEventListener('dragover', onDragOver)
    container.addEventListener('drop', onDrop)
    container.addEventListener('dragend', onDragEnd, true)

    return () => {
      clearTargets()
      container.removeEventListener('dragover', onDragOver)
      container.removeEventListener('drop', onDrop)
      container.removeEventListener('dragend', onDragEnd, true)
    }
  }, [editor, dragState])

  if (!handle) return null

  const startDrag = (event, type) => {
    event.stopPropagation()

    if (type === 'col' && handle.colSpan !== 1) {
      event.preventDefault()
      return
    }

    const sourceIndex = type === 'row' ? handle.rowIndex : handle.colIndex
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-local-notepad-table-reorder', type)

    setDragState({
      type,
      tableKey: handle.tableKey,
      sourceIndex,
      targetIndex: sourceIndex,
    })
  }

  return (
    <>
      <button
        type="button"
        className="table-reorder-handle row"
        draggable
        style={{ top: handle.row.top, left: handle.row.left }}
        onDragStart={event => startDrag(event, 'row')}
        aria-label="拖动当前行排序"
        title="拖动当前行"
      >
        ⋮⋮
      </button>

      <button
        type="button"
        className="table-reorder-handle col"
        draggable={handle.colSpan === 1}
        disabled={handle.colSpan !== 1}
        style={{ top: handle.col.top, left: handle.col.left }}
        onDragStart={event => startDrag(event, 'col')}
        aria-label="拖动当前列排序"
        title={handle.colSpan === 1 ? '拖动当前列' : '合并单元格所在列暂不支持拖动'}
      >
        ⋮⋮
      </button>
    </>
  )
}
