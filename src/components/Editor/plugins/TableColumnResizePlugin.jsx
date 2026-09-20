import React, { useCallback, useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey, $getRoot } from 'lexical'
import { TableCellNode, TableNode } from '@lexical/table'

export function clampTableColumnWidth(width) {
  return Math.max(70, Math.min(600, Math.round(Number(width) || 70)))
}

function findCellInfo(editor, cellElement) {
  let result = null

  editor.getEditorState().read(() => {
    const walk = node => {
      if (result || !node?.getChildren) return

      if (node instanceof TableNode) {
        const rows = node.getChildren()
        for (const row of rows) {
          const cells = row.getChildren()
          for (let colIndex = 0; colIndex < cells.length; colIndex++) {
            const cell = cells[colIndex]
            if (!(cell instanceof TableCellNode)) continue
            if (editor.getElementByKey(cell.getKey()) === cellElement) {
              result = {
                tableKey: node.getKey(),
                cellKey: cell.getKey(),
                colIndex,
                colSpan: cell.getColSpan?.() || 1,
              }
              return
            }
          }
        }
      }

      for (const child of node.getChildren()) walk(child)
    }

    walk($getRoot())
  })

  return result
}

function setColumnDomWidth(tableElement, colIndex, width) {
  if (!tableElement) return
  for (const row of Array.from(tableElement.rows || [])) {
    const cell = row.cells?.[colIndex]
    if (!cell || cell.colSpan !== 1) continue
    cell.style.width = `${width}px`
    cell.style.minWidth = `${Math.min(width, 120)}px`
  }
}

export default function TableColumnResizePlugin() {
  const [editor] = useLexicalComposerContext()
  const [handle, setHandle] = useState(null)
  const [resizeState, setResizeState] = useState(null)

  const persistColumnWidth = useCallback((tableKey, colIndex, width) => {
    const nextWidth = clampTableColumnWidth(width)

    editor.update(() => {
      const table = $getNodeByKey(tableKey)
      if (!(table instanceof TableNode)) return

      for (const row of table.getChildren()) {
        const cell = row.getChildren()[colIndex]
        if (!(cell instanceof TableCellNode)) continue
        if ((cell.getColSpan?.() || 1) !== 1) continue
        cell.setWidth?.(nextWidth)
      }
    })
  }, [editor])

  useEffect(() => {
    const rootElement = editor.getRootElement()
    const container = rootElement?.closest('.editor-container')
    if (!rootElement || !container) return undefined

    let frame = 0

    const updateHandle = event => {
      if (resizeState) return
      if (frame) window.cancelAnimationFrame(frame)

      frame = window.requestAnimationFrame(() => {
        const cellElement = event.target?.closest?.('td, th')
        if (!cellElement || !rootElement.contains(cellElement)) {
          setHandle(null)
          return
        }

        const cellRect = cellElement.getBoundingClientRect()
        if (Math.abs(event.clientX - cellRect.right) > 7) {
          setHandle(null)
          return
        }

        const info = findCellInfo(editor, cellElement)
        if (!info || info.colSpan !== 1) {
          setHandle(null)
          return
        }

        const tableElement = cellElement.closest('table')
        if (!tableElement) return

        const containerRect = container.getBoundingClientRect()
        const tableRect = tableElement.getBoundingClientRect()

        setHandle({
          ...info,
          tableElement,
          cellElement,
          top: tableRect.top - containerRect.top + container.scrollTop,
          left: cellRect.right - containerRect.left + container.scrollLeft - 3,
          height: tableRect.height,
          width: cellRect.width,
        })
      })
    }

    const hideHandle = event => {
      if (resizeState) return
      if (event.relatedTarget?.closest?.('.table-column-resizer')) return
      setHandle(null)
    }

    container.addEventListener('mousemove', updateHandle)
    container.addEventListener('mouseleave', hideHandle)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      container.removeEventListener('mousemove', updateHandle)
      container.removeEventListener('mouseleave', hideHandle)
    }
  }, [editor, resizeState])

  useEffect(() => {
    if (!resizeState) return undefined

    const onMouseMove = event => {
      const nextWidth = clampTableColumnWidth(
        resizeState.startWidth + (event.clientX - resizeState.startX)
      )

      setColumnDomWidth(resizeState.tableElement, resizeState.colIndex, nextWidth)

      setHandle(previous => previous
        ? { ...previous, width: nextWidth, left: previous.left + (nextWidth - previous.width) }
        : previous
      )

      setResizeState(previous => previous ? { ...previous, currentWidth: nextWidth } : previous)
    }

    const onMouseUp = () => {
      persistColumnWidth(
        resizeState.tableKey,
        resizeState.colIndex,
        resizeState.currentWidth || resizeState.startWidth
      )
      setResizeState(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp, { once: true })

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [persistColumnWidth, resizeState])

  if (!handle) return null

  const autoFit = event => {
    event.preventDefault()
    event.stopPropagation()

    const widths = Array.from(handle.tableElement.rows || []).map(row => {
      const cell = row.cells?.[handle.colIndex]
      if (!cell || cell.colSpan !== 1) return 0
      return cell.scrollWidth + 28
    })

    const nextWidth = clampTableColumnWidth(Math.max(...widths, 90))
    setColumnDomWidth(handle.tableElement, handle.colIndex, nextWidth)
    persistColumnWidth(handle.tableKey, handle.colIndex, nextWidth)
    setHandle(null)
  }

  return (
    <button
      type="button"
      className={`table-column-resizer${resizeState ? ' resizing' : ''}`}
      style={{
        top: handle.top,
        left: handle.left,
        height: handle.height,
      }}
      onMouseDown={event => {
        event.preventDefault()
        event.stopPropagation()
        if (event.detail > 1) return
        setResizeState({
          tableKey: handle.tableKey,
          colIndex: handle.colIndex,
          tableElement: handle.tableElement,
          startX: event.clientX,
          startWidth: handle.width,
          currentWidth: handle.width,
        })
      }}
      onDoubleClick={autoFit}
      aria-label="调整表格列宽"
      title="拖动调整列宽 · 双击适应内容"
    />
  )
}
