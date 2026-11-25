import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNearestNodeFromDOMNode, $getNodeByKey, HISTORY_PUSH_TAG } from 'lexical'
import { TableCellNode, TableNode } from '@lexical/table'
import { useEditorWriteScope } from '../hooks/useEditorWriteScope'
import { $getTableModel } from '../utils/tableModel'

export function clampTableColumnWidth(width) {
  return Math.max(70, Math.min(600, Math.round(Number(width) || 70)))
}

function widthSignature(table, model) {
  return JSON.stringify([
    table.getColWidths(),
    [...model.locations.values()].map(({ cell }) => [cell.getKey(), cell.getWidth()]),
  ])
}

function findCellInfo(editor, cellElement) {
  let result = null
  editor.getEditorState().read(() => {
    const cell = $getNearestNodeFromDOMNode(cellElement)
    const table = cell instanceof TableCellNode ? cell.getParent()?.getParent() : null
    if (!(table instanceof TableNode) || !table.isAttached()) return
    const model = $getTableModel(table)
    const location = model?.locations.get(cell.getKey())
    if (!location || editor.getElementByKey(cell.getKey()) !== cellElement) return
    result = {
      tableKey: table.getKey(), cellKey: cell.getKey(),
      colIndex: location.columnIndex, colSpan: location.colSpan,
      signature: model.signature, widthSignature: widthSignature(table, model),
      columnCount: model.columnCount, storedWidths: table.getColWidths(),
      cells: [...model.locations.values()].map(({ cell: item, columnIndex, colSpan }) => ({
        key: item.getKey(), columnIndex, colSpan, width: item.getWidth(),
      })),
    }
  }, { editor })
  return result
}

function measureWidths(editor, info) {
  const positive = value => Number.isFinite(value) && value > 0
  const measure = cell => positive(cell.width) ? cell.width : editor.getElementByKey(cell.key)?.getBoundingClientRect().width
  const widths = Array.from({ length: info.columnCount }, (_, index) => positive(info.storedWidths?.[index]) ? info.storedWidths[index] : undefined)
  for (const cell of info.cells) {
    if (cell.colSpan !== 1 || widths[cell.columnIndex] !== undefined) continue
    const measured = measure(cell)
    if (positive(measured)) widths[cell.columnIndex] = measured
  }
  // An imported table can have columns represented only by spanning cells.
  // Infer those columns from the existing span width before creating a colgroup;
  // otherwise resizing a neighbour would silently shrink an untouched merge.
  for (const cell of info.cells.filter(cell => cell.colSpan > 1).sort((a, b) => a.colSpan - b.colSpan)) {
    const missing = [], total = measure(cell)
    let known = 0
    for (let index = cell.columnIndex; index < cell.columnIndex + cell.colSpan; index++) {
      if (widths[index] === undefined) missing.push(index)
      else known += widths[index]
    }
    if (missing.length && positive(total) && total > known) {
      for (const index of missing) widths[index] = (total - known) / missing.length
    }
  }
  return widths.map(width => width ?? 90)
}

function measureContentWidth(editor, session) {
  const container = editor.getRootElement()?.parentElement
  if (!container) return null
  const measurement = session.tableElement.cloneNode(false)
  measurement.removeAttribute('id')
  measurement.setAttribute('data-table-autofit-measure', '')
  measurement.setAttribute('aria-hidden', 'true')
  Object.assign(measurement.style, {
    position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
    width: 'max-content', minWidth: '0', maxWidth: 'none', tableLayout: 'auto',
    margin: '0', left: '0', top: '0',
  })
  for (const cell of session.cells) {
    if (cell.columnIndex !== session.colIndex || cell.colSpan !== 1) continue
    const element = editor.getElementByKey(cell.key)
    if (!element) continue
    const row = document.createElement('tr'), copy = element.cloneNode(true)
    const computed = window.getComputedStyle(element)
    copy.removeAttribute('id')
    copy.removeAttribute('rowspan')
    copy.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'))
    Object.assign(copy.style, {
      width: 'auto', minWidth: '0', maxWidth: 'none', whiteSpace: 'pre',
      font: computed.font, letterSpacing: computed.letterSpacing,
    })
    row.append(copy)
    measurement.append(row)
  }
  // The clone is outside contenteditable: observers, undo, and autosave never
  // see it. Intrinsic measurement can shrink a wide column and is repeatable.
  container.append(measurement)
  try {
    return Math.max(90, measurement.getBoundingClientRect().width)
  } finally {
    measurement.remove()
  }
}

// Preview changes never enter the editor state or autosave. Restore only styles
// still owned by this gesture; a newer Lexical reconciliation takes precedence.
function restorePreview(session) {
  for (const [element, { original, preview }] of session?.previews || []) {
    if (element.style.width === preview) element.style.width = original
  }
}

function previewWidth(editor, session, width) {
  const widths = [...session.widths]
  widths[session.colIndex] = width
  const write = (element, nextWidth) => {
    if (!element) return
    let saved = session.previews.get(element)
    if (!saved) {
      saved = { original: element.style.width }
      session.previews.set(element, saved)
    }
    saved.preview = `${nextWidth}px`
    element.style.width = saved.preview
  }
  write(session.tableElement.querySelectorAll(':scope > colgroup > col')[session.colIndex], width)
  for (const cell of session.cells) {
    if (cell.columnIndex <= session.colIndex && cell.columnIndex + cell.colSpan > session.colIndex) {
      write(editor.getElementByKey(cell.key), widths.slice(cell.columnIndex, cell.columnIndex + cell.colSpan).reduce((sum, item) => sum + item, 0))
    }
  }
}

function $validSession(session) {
  if (!session.canWrite()) return null
  const table = $getNodeByKey(session.tableKey)
  if (!(table instanceof TableNode) || !table.isAttached()) return null
  const model = $getTableModel(table)
  const source = model?.locations.get(session.cellKey)
  if (!source || source.columnIndex !== session.colIndex || model.signature !== session.signature || widthSignature(table, model) !== session.widthSignature) return null
  return { table, model }
}

export default function TableColumnResizePlugin({ documentId }) {
  const [editor] = useLexicalComposerContext()
  const beginWrite = useEditorWriteScope(editor, documentId)
  const [handle, setHandle] = useState(null)
  const [resizing, setResizing] = useState(false)
  const sessionRef = useRef(null)
  const buttonRef = useRef(null)

  const cancel = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    restorePreview(session)
    setResizing(false)
    setHandle(null)
  }, [])

  const commit = useCallback(session => {
    restorePreview(session)
    if (!session.canWrite()) return
    const nextWidth = clampTableColumnWidth(session.currentWidth)
    editor.update(() => {
      const current = $validSession(session)
      if (!current || !session.changed) return
      const { table, model } = current
      const widths = [...session.widths]
      widths[session.colIndex] = nextWidth
      table.setColWidths(widths)
      for (const { cell, columnIndex, colSpan } of model.locations.values()) {
        if (columnIndex <= session.colIndex && columnIndex + colSpan > session.colIndex) {
          cell.setWidth(widths.slice(columnIndex, columnIndex + colSpan).reduce((sum, width) => sum + width, 0))
        }
      }
    }, { tag: HISTORY_PUSH_TAG })
  }, [editor])

  useEffect(() => {
    let frame = 0
    let removeRootEvents = () => {}
    const stopFrame = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
    }
    const clear = () => { stopFrame(); cancel() }
    const unregisterRoot = editor.registerRootListener(rootElement => {
      removeRootEvents()
      clear()
      const container = rootElement?.closest('.editor-container')
      if (!container) return
      const updateHandle = event => {
        if (sessionRef.current || buttonRef.current?.contains(event.target)) { stopFrame(); return }
        stopFrame()
        if (!editor.isEditable()) { setHandle(null); return }
        const target = event.target, clientX = event.clientX
        frame = window.requestAnimationFrame(() => {
          frame = 0
          if (!editor.isEditable() || sessionRef.current) return
          const cellElement = target?.closest?.('td, th')
          if (!cellElement || !rootElement.contains(cellElement)) { setHandle(null); return }
          const cellRect = cellElement.getBoundingClientRect()
          if (Math.abs(clientX - cellRect.right) > 7) { setHandle(null); return }
          const info = findCellInfo(editor, cellElement)
          if (!info || info.colSpan !== 1) { setHandle(null); return }
          const tableElement = cellElement.closest('table')
          if (!tableElement) return
          const containerRect = container.getBoundingClientRect(), tableRect = tableElement.getBoundingClientRect()
          setHandle({
            ...info, tableElement, cellElement,
            top: tableRect.top - containerRect.top + container.scrollTop,
            left: cellRect.right - containerRect.left + container.scrollLeft - 3,
            height: tableRect.height, width: cellRect.width,
          })
        })
      }
      const leave = event => {
        if (!sessionRef.current && !buttonRef.current?.contains(event.relatedTarget)) { stopFrame(); setHandle(null) }
      }
      container.addEventListener('mousemove', updateHandle)
      container.addEventListener('mouseleave', leave)
      container.addEventListener('scroll', clear, true)
      removeRootEvents = () => {
        container.removeEventListener('mousemove', updateHandle)
        container.removeEventListener('mouseleave', leave)
        container.removeEventListener('scroll', clear, true)
      }
    })
    const move = event => {
      const session = sessionRef.current
      if (!session) return
      if (!session.canWrite()) { clear(); return }
      session.currentWidth = clampTableColumnWidth(session.startWidth + event.clientX - session.startX)
      session.changed = event.clientX !== session.startX && session.currentWidth !== Math.round(session.startWidth)
      previewWidth(editor, session, session.currentWidth)
      setHandle(previous => previous ? { ...previous, width: session.currentWidth, left: session.startLeft + session.currentWidth - session.startWidth } : previous)
    }
    const end = event => {
      const session = sessionRef.current
      if (!session) return
      // Mouseup may arrive before React renders the final mousemove.
      if (event.button !== 0) return
      session.currentWidth = clampTableColumnWidth(session.startWidth + event.clientX - session.startX)
      session.changed = event.clientX !== session.startX && session.currentWidth !== Math.round(session.startWidth)
      sessionRef.current = null
      restorePreview(session)
      setResizing(false)
      if (session.changed) { commit(session); setHandle(null) }
    }
    const key = event => { if (event.key === 'Escape' && sessionRef.current) { event.preventDefault(); clear() } }
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
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', clear)
    window.addEventListener('resize', clear)
    return () => {
      unregisterRoot(); removeRootEvents(); unregisterEditable(); unregisterUpdate()
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', clear)
      window.removeEventListener('resize', clear)
      stopFrame()
      const session = sessionRef.current
      sessionRef.current = null
      restorePreview(session)
    }
  }, [editor, documentId, cancel, commit])

  if (!handle) return null

  const createSession = () => {
    const canWrite = beginWrite()
    if (!canWrite() || !handle.cellElement.isConnected) return null
    const info = findCellInfo(editor, handle.cellElement)
    if (!info || info.colSpan !== 1 || info.signature !== handle.signature || info.widthSignature !== handle.widthSignature) return null
    return { ...info, canWrite, tableElement: handle.tableElement, widths: measureWidths(editor, info), previews: new Map() }
  }
  const autoFit = event => {
    event.preventDefault(); event.stopPropagation()
    const session = createSession()
    if (!session) { cancel(); return }
    const width = measureContentWidth(editor, session)
    if (width === null) { cancel(); return }
    session.currentWidth = clampTableColumnWidth(width)
    session.changed = session.currentWidth !== session.widths[session.colIndex]
    commit(session)
    cancel()
  }

  return (
    <button data-ui-native="editor-pointer-handle"
      ref={buttonRef}
      type="button"
      className={`table-column-resizer${resizing ? ' resizing' : ''}`}
      style={{ top: handle.top, left: handle.left, height: handle.height }}
      onMouseDown={event => {
        event.preventDefault(); event.stopPropagation()
        if (event.button !== 0 || event.detail > 1) return
        const session = createSession()
        if (!session) { cancel(); return }
        sessionRef.current = { ...session, startX: event.clientX, startWidth: handle.width, currentWidth: handle.width, startLeft: handle.left, changed: false }
        setResizing(true)
      }}
      onDoubleClick={autoFit}
      aria-label="调整表格列宽"
      title="拖动调整列宽 · 双击适应内容"
    />
  )
}
