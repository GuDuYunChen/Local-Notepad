import React, { useMemo, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { INSERT_TABLE_COMMAND } from '@lexical/table'

export default function TableMenu() {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const gridRef = useRef(null)
  const grid = useMemo(
    () => Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 8 }, (_, col) => ({ row: row + 1, col: col + 1 }))
    ),
    []
  )
  const [hoverRect, setHoverRect] = useState({ row: 3, col: 3 })

  const pick = (row, col) => {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, {
      columns: String(col),
      rows: String(row),
    })
    setOpen(false)
    setHoverRect({ row: 3, col: 3 })
    editor.focus()
  }

  const updateHoverFromPointer = (event) => {
    const gridElement = gridRef.current
    if (!gridElement) return

    const cells = Array.from(gridElement.querySelectorAll('.tm-grid-cell'))
    const target = event.target.closest('.tm-grid-cell')
    if (!target) return

    const index = cells.indexOf(target)
    if (index < 0) return

    setHoverRect({
      row: Math.floor(index / 8) + 1,
      col: (index % 8) + 1,
    })
  }

  return (
    <div className="table-menu-host">
      <button
        type="button"
        className="btn toolbar-menu-action table-insert-trigger"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        表格
        <span className="table-insert-size">{hoverRect.row} × {hoverRect.col}</span>
      </button>

      {open && (
        <div className="table-menu product-table-insert-menu" role="dialog" aria-label="插入表格">
          <div className="tm-title-row">
            <div>
              <strong>插入表格</strong>
              <span>移动鼠标选择行列</span>
            </div>
            <span className="tm-size-preview">{hoverRect.row} × {hoverRect.col}</span>
          </div>

          <div
            className="tm-grid"
            ref={gridRef}
            onMouseMove={updateHoverFromPointer}
            onMouseLeave={() => setHoverRect({ row: 3, col: 3 })}
          >
            {grid.map((row, rowIndex) => (
              <div key={rowIndex} className="tm-grid-row">
                {row.map((cell, colIndex) => {
                  const selected = rowIndex < hoverRect.row && colIndex < hoverRect.col
                  return (
                    <button
                      type="button"
                      key={colIndex}
                      className={`tm-grid-cell${selected ? ' selected' : ''}`}
                      onMouseEnter={() => setHoverRect(cell)}
                      onClick={() => pick(cell.row, cell.col)}
                      aria-label={`${cell.row} 行 ${cell.col} 列`}
                    />
                  )
                })}
              </div>
            ))}
          </div>

          <div className="tm-help">插入后，在单元格右上角使用“···”调整行列、样式与表头。</div>
        </div>
      )}
    </div>
  )
}
