import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNearestNodeFromDOMNode, $getNodeByKey, HISTORY_PUSH_TAG } from 'lexical'
import { TableCellNode, TableNode } from '@lexical/table'
import { useEditorWriteScope } from '../hooks/useEditorWriteScope'
import { $getTableModel, $moveTableColumn, $moveTableRow } from '../utils/tableModel'
import { toast } from '~/services/toast'

const REORDER_MIME = 'application/x-local-notepad-table-reorder'
let dragSequence = 0

function findCellInfo(editor, cellElement) {
  let result = null
  editor.getEditorState().read(() => {
    const cell = $getNearestNodeFromDOMNode(cellElement)
    const table = cell instanceof TableCellNode ? cell.getParent()?.getParent() : null
    if (!(table instanceof TableNode) || !table.isAttached()) return
    const model = $getTableModel(table), location = model?.locations.get(cell.getKey())
    if (!location || editor.getElementByKey(cell.getKey()) !== cellElement) return
    result = {
      tableKey: table.getKey(), rowKey: model.rows[location.rowIndex].getKey(), cellKey: cell.getKey(),
      rowIndex: location.rowIndex, colIndex: location.columnIndex,
      colSpan: location.colSpan, signature: model.signature,
    }
  }, { editor })
  return result
}

function $validSession(session) {
  if (!session.canWrite()) return null
  const table = $getNodeByKey(session.tableKey)
  if (!(table instanceof TableNode) || !table.isAttached()) return null
  const model = $getTableModel(table)
  const source = model?.locations.get(session.cellKey)
  if (!source || model.signature !== session.signature || model.rows[source.rowIndex]?.getKey() !== session.rowKey) return null
  return { table, model, source }
}

export default function TableReorderPlugin({ documentId }) {
  const [editor] = useLexicalComposerContext()
  const beginWrite = useEditorWriteScope(editor, documentId)
  const [handle, setHandle] = useState(null)
  const sessionRef = useRef(null)
  const rowButtonRef = useRef(null), colButtonRef = useRef(null)
  const targetsRef = useRef([])

  const clearTargets = useCallback(() => {
    for (const element of targetsRef.current) element.classList.remove('table-row-drop-target', 'table-col-drop-target')
    targetsRef.current = []
  }, [])
  const cancel = useCallback(() => {
    sessionRef.current = null
    clearTargets()
    setHandle(null)
  }, [clearTargets])

  useEffect(() => {
    let frame = 0
    let removeRootEvents = () => {}
    const stopFrame = () => { if (frame) window.cancelAnimationFrame(frame); frame = 0 }
    const clear = () => { stopFrame(); cancel() }
    const ownsHandle = target => rowButtonRef.current?.contains(target) || colButtonRef.current?.contains(target)
    const ownsDrag = event => sessionRef.current && Array.from(event.dataTransfer?.types || []).includes(REORDER_MIME)
    const unregisterRoot = editor.registerRootListener(rootElement => {
      removeRootEvents()
      clear()
      const container = rootElement?.closest('.editor-container')
      if (!container) return
      const updateHandle = event => {
        if (sessionRef.current || ownsHandle(event.target)) { stopFrame(); return }
        stopFrame()
        if (!editor.isEditable()) { setHandle(null); return }
        const target = event.target
        frame = window.requestAnimationFrame(() => {
          frame = 0
          if (!editor.isEditable() || sessionRef.current) return
          const cellElement = target?.closest?.('td, th')
          if (!cellElement || !rootElement.contains(cellElement)) { setHandle(null); return }
          const info = findCellInfo(editor, cellElement)
          if (!info) { setHandle(null); return }
          const rowElement = cellElement.closest('tr'), tableElement = cellElement.closest('table')
          if (!rowElement || !tableElement) return
          const cellRect = cellElement.getBoundingClientRect(), rowRect = rowElement.getBoundingClientRect()
          const tableRect = tableElement.getBoundingClientRect(), containerRect = container.getBoundingClientRect()
          setHandle({
            ...info, cellElement,
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
      const leave = event => { if (!sessionRef.current && !ownsHandle(event.relatedTarget)) { stopFrame(); setHandle(null) } }
      const scroll = () => {
        stopFrame()
        // Native drag scrolling is needed to reach rows outside the viewport.
        // Discard its old marker; drop will resolve the actual destination.
        if (sessionRef.current) clearTargets()
        else setHandle(null)
      }
      const targetInfo = event => {
        const session = sessionRef.current
        const cell = event.target?.closest?.('td, th')
        if (!session?.canWrite() || !cell || !rootElement.contains(cell)) return null
        const info = findCellInfo(editor, cell)
        return info?.tableKey === session.tableKey && info.signature === session.signature ? { info, cell } : null
      }
      const dragOver = event => {
        if (!ownsDrag(event)) return
        event.preventDefault(); event.stopPropagation()
        clearTargets()
        const target = targetInfo(event), session = sessionRef.current
        if (!target) { event.dataTransfer.dropEffect = 'none'; return }
        event.dataTransfer.dropEffect = 'move'
        if (session.type === 'row') {
          const row = target.cell.closest('tr')
          if (row) targetsRef.current.push(row)
        } else {
          editor.getEditorState().read(() => {
            const current = $validSession(session)
            if (!current) return
            for (const { cell, columnIndex, colSpan } of current.model.locations.values()) {
              if (columnIndex <= target.info.colIndex && columnIndex + colSpan > target.info.colIndex) {
                const element = editor.getElementByKey(cell.getKey())
                if (element) targetsRef.current.push(element)
              }
            }
          })
        }
        for (const element of targetsRef.current) element.classList.add(session.type === 'row' ? 'table-row-drop-target' : 'table-col-drop-target')
      }
      const drop = event => {
        if (!ownsDrag(event)) return
        event.preventDefault(); event.stopPropagation()
        const session = sessionRef.current
        const target = event.dataTransfer.getData(REORDER_MIME) === session.token ? targetInfo(event) : null
        clear()
        if (!target) return
        editor.update(() => {
          const current = $validSession(session)
          if (!current) return
          const destination = current.model.locations.get(target.info.cellKey)
          if (!destination) return
          const originIndex = session.type === 'row' ? current.source.rowIndex : current.source.columnIndex
          const destinationIndex = session.type === 'row' ? destination.rowIndex : destination.columnIndex
          const move = session.type === 'row' ? $moveTableRow : $moveTableColumn
          const result = move(current.table, originIndex, destinationIndex - originIndex)
          if (!result.changed && result.reason) toast.warning(result.reason)
        }, { tag: HISTORY_PUSH_TAG })
      }
      // Own table drags must be handled before Lexical's content-drop handler.
      // Unrelated text, file, and whole-block drag events remain untouched.
      container.addEventListener('mousemove', updateHandle)
      container.addEventListener('mouseleave', leave)
      container.addEventListener('scroll', scroll, true)
      container.addEventListener('dragover', dragOver, true)
      container.addEventListener('drop', drop, true)
      removeRootEvents = () => {
        container.removeEventListener('mousemove', updateHandle)
        container.removeEventListener('mouseleave', leave)
        container.removeEventListener('scroll', scroll, true)
        container.removeEventListener('dragover', dragOver, true)
        container.removeEventListener('drop', drop, true)
      }
    })
    const unregisterEditable = editor.registerEditableListener(clear)
    const unregisterUpdate = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      const session = sessionRef.current
      if (!session) {
        if (dirtyElements.size || dirtyLeaves.size) { stopFrame(); setHandle(null) }
        return
      }
      let valid = false
      editorState.read(() => { valid = Boolean($validSession(session)) })
      if (!valid) clear()
    })
    const key = event => { if (event.key === 'Escape' && sessionRef.current) { event.preventDefault(); clear() } }
    window.addEventListener('dragend', clear, true)
    window.addEventListener('drop', clear)
    window.addEventListener('blur', clear)
    window.addEventListener('resize', clear)
    window.addEventListener('keydown', key, true)
    return () => {
      unregisterRoot(); removeRootEvents(); unregisterEditable(); unregisterUpdate()
      window.removeEventListener('dragend', clear, true)
      window.removeEventListener('drop', clear)
      window.removeEventListener('blur', clear)
      window.removeEventListener('resize', clear)
      window.removeEventListener('keydown', key, true)
      stopFrame(); sessionRef.current = null; clearTargets()
    }
  }, [editor, documentId, cancel, clearTargets])

  if (!handle) return null
  const startDrag = (event, type) => {
    event.stopPropagation()
    const canWrite = beginWrite()
    const info = canWrite() && handle.cellElement.isConnected ? findCellInfo(editor, handle.cellElement) : null
    if (!info || info.signature !== handle.signature || (type === 'col' && info.colSpan !== 1)) {
      event.preventDefault(); cancel(); return
    }
    const token = `${info.tableKey}:${++dragSequence}`
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(REORDER_MIME, token)
    sessionRef.current = { ...info, type, token, canWrite }
  }

  return (
    <>
      <button data-ui-native="editor-pointer-handle"
        ref={rowButtonRef}
        type="button"
        className="table-reorder-handle row"
        draggable
        style={{ top: handle.row.top, left: handle.row.left }}
        onDragStart={event => startDrag(event, 'row')}
        aria-label="拖动当前行排序"
        title="拖动当前行"
      >⋮⋮</button>
      <button data-ui-native="editor-pointer-handle"
        ref={colButtonRef}
        type="button"
        className="table-reorder-handle col"
        draggable={handle.colSpan === 1}
        disabled={handle.colSpan !== 1}
        style={{ top: handle.col.top, left: handle.col.left }}
        onDragStart={event => startDrag(event, 'col')}
        aria-label="拖动当前列排序"
        title={handle.colSpan === 1 ? '拖动当前列' : '合并单元格所在列暂不支持拖动'}
      >⋮⋮</button>
    </>
  )
}
