import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { INSERT_TABLE_COMMAND } from '@lexical/table'
import { HISTORY_PUSH_TAG } from 'lexical'
import { UiButton } from '~/components/ui/ControlKit'
import { useEditorWriteScope } from '../hooks/useEditorWriteScope'
import { captureTableSelectionWrite } from '../utils/tableEvents'


export default function TableMenu({ documentId, onInsert } = {}) {
  const [editor] = useLexicalComposerContext()
  const captureWrite = useEditorWriteScope(editor, documentId)
  const [open, setOpen] = useState(false)
  const [editable, setEditable] = useState(editor.isEditable())
  const hostRef = useRef(null)
  const triggerRef = useRef(null)
  const openWriteRef = useRef(null)
  const gridRef = useRef(null)
  const grid = useMemo(
    () => Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 8 }, (_, col) => ({ row: row + 1, col: col + 1 }))
    ),
    []
  )
  const [hoverRect, setHoverRect] = useState({ row: 3, col: 3 })

  useEffect(() => {
    setOpen(false)
    openWriteRef.current = null
    setHoverRect({ row: 3, col: 3 })
    setEditable(editor.isEditable())
    return editor.registerEditableListener(value => {
      setEditable(value)
      openWriteRef.current = null
      setOpen(false)
    })
  }, [editor, documentId])

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = event => {
      if (!hostRef.current?.contains(event.target)) {
        setOpen(false)
        openWriteRef.current = null
      }
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  const pick = (row, col) => {
    const canWrite = openWriteRef.current
    if (!canWrite?.()) return
    let inserted = false
    editor.update(() => {
      if (!canWrite()) return
      inserted = editor.dispatchCommand(INSERT_TABLE_COMMAND, {
        columns: String(col), rows: String(row),
      })
    }, { tag: HISTORY_PUSH_TAG, discrete: true })
    if (!inserted) return
    setOpen(false)
    openWriteRef.current = null
    setHoverRect({ row: 3, col: 3 })
    onInsert?.()
    if (canWrite()) editor.focus()
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
    <div className="table-menu-host" ref={hostRef} onKeyDown={event => {
      if (open && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        openWriteRef.current = null
        triggerRef.current?.focus()
      }
    }}>
      <UiButton density="compact"
        ref={triggerRef}
        type="button"
        className="btn toolbar-menu-action table-insert-trigger"
        disabled={!editable}
        onClick={() => {
          if (open) { setOpen(false); openWriteRef.current = null; return }
          const canWriteDocument = captureWrite(), ownsSelection = captureTableSelectionWrite(editor)
          const canWrite = () => canWriteDocument() && ownsSelection()
          if (!canWrite()) return
          openWriteRef.current = canWrite
          setOpen(true)
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        表格
        <span className="table-insert-size">{hoverRect.row} × {hoverRect.col}</span>
      </UiButton>

      {open && (
        <div className="table-menu product-table-insert-menu" role="dialog" aria-label="插入表格">
          <div className="tm-title-row">
            <div>
              <strong>插入表格</strong>
              <span>选择需要的行列</span>
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
                    <UiButton density="compact"
                      type="button"
                      key={colIndex}
                      className={`tm-grid-cell${selected ? ' selected' : ''}`}
                      onMouseEnter={() => setHoverRect(cell)}
                      onFocus={() => setHoverRect(cell)}
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
