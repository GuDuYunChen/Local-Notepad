import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { $createParagraphNode, $createTextNode, $getNearestNodeFromDOMNode, $getNodeByKey, $getSelection, HISTORY_PUSH_TAG } from 'lexical'
import { $isTableCellNode, TableCellHeaderStates } from '@lexical/table'
import { toast } from '~/services/toast'
import { useEditorWriteScope } from '../hooks/useEditorWriteScope'
import { isShortcutContextBlocked, matchShortcut, shortcutLabel } from '~/services/localShortcuts'
import useLocalShortcuts from '~/hooks/useLocalShortcuts'
import { UiButton } from '~/components/ui/ControlKit'
import { dispatchTableEvent, isTableEventForEditor } from '../utils/tableEvents'
import { $getTableModel, $resolveTableCell, $insertRowAtCell, $insertColumnAtCell, $deleteRowAtCell, $deleteColumnAtCell, $mergeTableCells, $splitTableCell, $moveTableRow, $moveTableColumn } from '../utils/tableModel'

// Retain coordinate-based helpers for existing callers. Live selection keeps
// node keys: removing an earlier row must not silently retarget another cell.
export function forEachSelectedTableCell(tables, rects, callback) {
  const visited = new Set()
  for (const rect of Array.isArray(rects) ? rects : []) {
    const table = rect.tableKey ? tables?.find(node => node.getKey() === rect.tableKey) : tables?.[rect.tableIndex]
    const model = $getTableModel(table)
    if (!model) continue
    const visit = location => {
      if (!location || visited.has(location.cell.getKey())) return
      visited.add(location.cell.getKey())
      callback(location.cell, rect, location.rowIndex, location.columnIndex)
    }
    if (rect.cellKeys) rect.cellKeys.forEach(key => visit(model.locations.get(key)))
    else if ([rect.r1, rect.r2, rect.c1, rect.c2].every(Number.isSafeInteger)) {
      for (let r = Math.max(0, rect.r1); r <= Math.min(rect.r2, model.rowCount - 1); r++) {
        for (let c = Math.max(0, rect.c1); c <= Math.min(rect.c2, model.columnCount - 1); c++) visit(model.grid[r][c])
      }
    }
  }
}

export function countSelectedTableCells(rects) {
  const keys = new Set(), regions = new Map()
  for (const rect of Array.isArray(rects) ? rects : []) {
    if (rect.cellKeys) { rect.cellKeys.forEach(key => keys.add(key)); continue }
    if (![rect.r1, rect.r2, rect.c1, rect.c2].every(value => Number.isSafeInteger(value) && value >= 0) || rect.r2 < rect.r1 || rect.c2 < rect.c1) continue
    const table = rect.tableIndex ?? rect.tableKey ?? 0
    if (!regions.has(table)) regions.set(table, [])
    regions.get(table).push(rect)
  }
  let count = keys.size
  // Count the union without expanding large rectangles into individual cells.
  for (const group of regions.values()) {
    const boundaries = [...new Set(group.flatMap(r => [r.r1, r.r2 + 1]))].sort((a, b) => a - b)
    for (let i = 0; i < boundaries.length - 1; i++) {
      const intervals = group.filter(r => r.r1 <= boundaries[i] && r.r2 >= boundaries[i]).map(r => [r.c1, r.c2 + 1]).sort((a, b) => a[0] - b[0])
      let width = 0, end = -1
      for (const [start, nextEnd] of intervals) { width += Math.max(0, nextEnd - Math.max(start, end)); end = Math.max(end, nextEnd) }
      count += width * (boundaries[i + 1] - boundaries[i])
    }
  }
  return count
}

export function tableMatrixToTSV(matrix) {
  return (Array.isArray(matrix) ? matrix : []).map(row => (Array.isArray(row) ? row : []).map(value => String(value ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
}
export function parseTableTSV(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized) return []
  // A spreadsheet clipboard commonly ends its last record with LF.
  return normalized.replace(/\n$/, '').split('\n').map(row => row.split('\t'))
}
function $currentCell() {
  const selection = $getSelection()
  let node = selection?.anchor?.getNode?.() || selection?.getNodes?.()[0]
  while (node && !$isTableCellNode(node)) node = node.getParent()
  return node ? $resolveTableCell(node.getKey()) : null
}
function $target(payload, groups) {
  if (payload?.cellKey) return $resolveTableCell(payload.cellKey, payload.tableKey)
  if (payload?.tableKey) {
    const model = $getTableModel($getNodeByKey(payload.tableKey))
    const cell = model?.grid[payload.ri ?? 0]?.[payload.ci ?? 0]?.cell
    return cell ? $resolveTableCell(cell.getKey(), payload.tableKey) : null
  }
  if (groups[0]?.cellKeys[0]) return $resolveTableCell(groups[0].cellKeys[0], groups[0].tableKey)
  return $currentCell()
}
function $selectedCells(groups, payload) {
  if (payload?.cellKey || payload?.tableKey) {
    const current = $target(payload, [])
    return current ? [current.cell] : []
  }
  if (!groups.length) { const current = $currentCell(); return current ? [current.cell] : [] }
  const cells = new Map()
  for (const group of groups) {
    const model = $getTableModel($getNodeByKey(group.tableKey))
    if (!model) continue
    for (const key of group.cellKeys) {
      const location = model.locations.get(key)
      if (location) cells.set(key, location.cell)
    }
  }
  return [...cells.values()]
}
function $groupBounds(model, keys) {
  const locations = keys.map(key => model.locations.get(key)).filter(Boolean)
  if (!locations.length) return null
  return {
    top: Math.min(...locations.map(p => p.rowIndex)), left: Math.min(...locations.map(p => p.columnIndex)),
    bottom: Math.max(...locations.map(p => p.rowIndex + p.rowSpan - 1)), right: Math.max(...locations.map(p => p.columnIndex + p.colSpan - 1)),
  }
}
function $selectionGroup(anchorKey, focusKey) {
  const anchor = $resolveTableCell(anchorKey), focus = $resolveTableCell(focusKey, anchor?.table.getKey())
  if (!anchor || !focus) return null
  const { model, table } = anchor
  let bounds = $groupBounds(model, [anchorKey, focusKey]), expanded = true
  const keys = new Set([anchorKey, focusKey])
  while (expanded) {
    const before = keys.size
    for (let r = bounds.top; r <= bounds.bottom; r++) for (let c = bounds.left; c <= bounds.right; c++) keys.add(model.grid[r][c].cell.getKey())
    bounds = $groupBounds(model, [...keys]); expanded = keys.size !== before
  }
  return { tableKey: table.getKey(), cellKeys: [...keys] }
}
function $serialize(node) {
  const value = node.exportJSON()
  if (node.getChildren) value.children = node.getChildren().map($serialize)
  return value
}

export default function TableSelectionPlugin({ documentId }) {
  const [editor] = useLexicalComposerContext()
  const { bindings } = useLocalShortcuts()
  const isEditable = useLexicalEditable()
  const beginWrite = useEditorWriteScope(editor, documentId)
  const [active, setActive] = useState(false), [groups, setGroups] = useState([]), [busy, setBusy] = useState(false)
  const [geometry, setGeometry] = useState({ outlines: [], top: 10, add: null })
  const activeRef = useRef(false), groupsRef = useRef([]), dragRef = useRef(null), epochRef = useRef(0), busyRef = useRef(null)
  const hoverRef = useRef(null), handlersRef = useRef({})

  const replaceGroups = useCallback(next => {
    if (JSON.stringify(next) === JSON.stringify(groupsRef.current)) return
    epochRef.current += 1; groupsRef.current = next; setGroups(next)
  }, [])
  const reset = useCallback(() => {
    epochRef.current += 1; activeRef.current = false; groupsRef.current = []; dragRef.current = null; hoverRef.current = null; busyRef.current = null
    setActive(false); setGroups([]); setBusy(false); setGeometry({ outlines: [], top: 10, add: null })
  }, [])
  const exit = useCallback(() => {
    reset(); dispatchTableEvent(editor, 'tableSelection:mode', false)
    if (editor.isEditable()) editor.focus()
  }, [editor, reset])
  useLayoutEffect(() => {
    reset()
    const unregister = editor.registerEditableListener(editable => {
      if (!editable) { reset(); dispatchTableEvent(editor, 'tableSelection:mode', false) }
    })
    return () => { epochRef.current += 1; busyRef.current = null; activeRef.current = false; unregister() }
  }, [editor, documentId, reset])

  const run = (operation, canWrite = beginWrite()) => {
    if (!canWrite()) return false
    let result
    editor.update(() => { if (canWrite()) result = operation() }, { discrete: true, tag: HISTORY_PUSH_TAG })
    if (result?.reason && canWrite()) toast.warning(result.reason)
    return !!result?.changed
  }
  const perform = (type, payload) => run(() => {
    const selection = groupsRef.current, current = $target(payload, selection)
    if (type === 'mergeCells') {
      const tableKey = selection[0]?.tableKey
      if (!tableKey || selection.some(group => group.tableKey !== tableKey) || (payload?.tableKey && payload.tableKey !== tableKey)) return { reason: '请先在同一表格中框选连续单元格' }
      return $mergeTableCells($getNodeByKey(tableKey), selection.flatMap(group => group.cellKeys))
    }
    if (type === 'splitCells') {
      let changed = false
      for (const cell of $selectedCells(selection, payload)) {
        if (cell.getColSpan() > 1 || cell.getRowSpan() > 1) changed = $splitTableCell(cell).changed || changed
      }
      return { changed }
    }
    if (['clear', 'background', 'alignVertical', 'alignHorizontal'].includes(type)) {
      const cells = $selectedCells(selection, payload), value = payload?.value ?? payload
      if ((type === 'alignVertical' && !['top', 'middle', 'bottom'].includes(value)) || (type === 'alignHorizontal' && !['left', 'center', 'right', 'justify'].includes(value))) return { changed: false }
      if (type === 'background' && typeof value !== 'string') return { changed: false }
      for (const cell of cells) {
        if (type === 'clear') cell.clear().append($createParagraphNode())
        if (type === 'background') cell.setBackgroundColor(value || null)
        if (type === 'alignVertical') cell.setVerticalAlign(value)
        if (type === 'alignHorizontal') { cell.setFormat(value); for (const child of cell.getChildren()) child.setFormat?.(value) }
      }
      return { changed: cells.length > 0 }
    }
    if (!current) return { changed: false }
    const { cell, table, model, rowIndex, columnIndex } = current
    if (['insertRow', 'insertRowAbove', 'insertRowBelow'].includes(type)) return $insertRowAtCell(cell, type !== 'insertRowAbove' && payload?.mode !== 'above')
    if (['insertCol', 'insertColLeft', 'insertColRight'].includes(type)) return $insertColumnAtCell(cell, type !== 'insertColLeft' && payload?.mode !== 'left')
    if (type === 'deleteRow') return $deleteRowAtCell(cell)
    if (type === 'deleteCol') return $deleteColumnAtCell(cell)
    if (type === 'moveRowUp' || type === 'moveRowDown') return $moveTableRow(table, rowIndex, type === 'moveRowUp' ? -1 : 1)
    if (type === 'moveColLeft' || type === 'moveColRight') return $moveTableColumn(table, columnIndex, type === 'moveColLeft' ? -1 : 1)
    if (type === 'deleteTable') {
      const paragraph = $createParagraphNode()
      table.insertAfter(paragraph); paragraph.selectStart(); table.remove()
    } else if (type === 'toggleRowStriping') table.setRowStriping(!table.getRowStriping())
    else if (type === 'toggleFrozenRow') table.setFrozenRows(table.getFrozenRows() ? 0 : 1)
    else if (type === 'toggleFrozenColumn') table.setFrozenColumns(table.getFrozenColumns() ? 0 : 1)
    else if (type === 'toggleRowHeader' || type === 'toggleColumnHeader') {
      const mask = type === 'toggleRowHeader' ? TableCellHeaderStates.ROW : TableCellHeaderStates.COLUMN
      const locations = type === 'toggleRowHeader' ? model.grid[0] : model.grid.map(row => row[0])
      const cells = [...new Map(locations.map(p => [p.cell.getKey(), p.cell])).values()]
      const enabled = !cells.every(node => (node.getHeaderStyles() & mask) !== 0)
      cells.forEach(node => node.setHeaderStyles(enabled ? mask : 0, mask))
    } else return { changed: false }
    return { changed: true }
  })

  const beginClipboard = () => {
    if (busyRef.current || !activeRef.current || !groupsRef.current.length) return null
    const canWrite = beginWrite()
    if (!canWrite()) return null
    const token = { epoch: epochRef.current, canWrite, groups: groupsRef.current }
    busyRef.current = token; setBusy(true)
    token.valid = () => busyRef.current === token && !token.cancelled && epochRef.current === token.epoch && canWrite() && activeRef.current
    return token
  }
  const endClipboard = token => { if (busyRef.current === token) { busyRef.current = null; setBusy(false) } }
  const copySelection = async () => {
    const token = beginClipboard()
    if (!token) return
    try {
      let text
      editor.getEditorState().read(() => {
        const group = token.groups[0], model = $getTableModel($getNodeByKey(group.tableKey))
        if (!model) return
        const bounds = $groupBounds(model, group.cellKeys)
        if (!bounds) return
        const selected = new Set(group.cellKeys), matrix = []
        for (let r = bounds.top; r <= bounds.bottom; r++) {
          const row = []
          for (let c = bounds.left; c <= bounds.right; c++) {
            const p = model.grid[r][c]
            row.push(selected.has(p.cell.getKey()) && p.rowIndex === r && p.columnIndex === c ? p.cell.getTextContent() : '')
          }
          matrix.push(row)
        }
        text = tableMatrixToTSV(matrix)
      })
      if (text === undefined) return
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const textarea = document.createElement('textarea'), focused = document.activeElement
        textarea.value = text; textarea.readOnly = true; textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
        document.body.append(textarea)
        try { textarea.select(); if (!document.execCommand('copy')) throw new Error('Clipboard copy refused') }
        finally { textarea.remove(); if (token.valid() && focused?.isConnected) focused.focus() }
      }
      if (token.valid()) toast.success(token.groups.length > 1 ? '已复制第一个连续选区' : '已复制所选单元格')
    } catch (error) { if (token.valid()) toast.error('复制失败，请检查剪贴板权限') }
    finally { endClipboard(token) }
  }
  const pasteSelection = async () => {
    const token = beginClipboard()
    if (!token) return
    try {
      if (!navigator.clipboard?.readText) { toast.warning('当前环境不支持读取剪贴板'); return }
      let snapshot
      editor.getEditorState().read(() => {
        const group = token.groups[0], model = $getTableModel($getNodeByKey(group.tableKey))
        if (!model) return
        const bounds = $groupBounds(model, group.cellKeys)
        if (bounds) snapshot = { tableKey: group.tableKey, bounds, signature: model.signature, content: JSON.stringify($serialize(model.table)) }
      })
      if (!snapshot) return
      token.snapshot = snapshot
      const text = await navigator.clipboard.readText()
      if (!token.valid()) return
      const matrix = parseTableTSV(text)
      if (!matrix.length) { toast.warning('剪贴板里没有可粘贴的表格内容'); return }
      token.applying = true
      const changed = run(() => {
        const model = $getTableModel($getNodeByKey(snapshot.tableKey))
        if (!model || model.signature !== snapshot.signature || JSON.stringify($serialize(model.table)) !== snapshot.content) return { reason: '表格内容已变化，请重新选择后粘贴' }
        const { top, left } = snapshot.bounds, targets = [], seen = new Set()
        for (let r = 0; r < matrix.length; r++) for (let c = 0; c < matrix[r].length; c++) {
          const location = model.grid[top + r]?.[left + c]
          if (!location) return { reason: '粘贴内容超出表格范围，请先增加行或列' }
          if (seen.has(location.cell.getKey()) || location.rowIndex !== top + r || location.columnIndex !== left + c) return { reason: '粘贴区域包含合并单元格，请先拆分后粘贴' }
          seen.add(location.cell.getKey()); targets.push([location.cell, matrix[r][c]])
        }
        for (const [cell, value] of targets) {
          const paragraph = $createParagraphNode()
          if (value) paragraph.append($createTextNode(value))
          cell.clear().append(paragraph)
        }
        return { changed: targets.length > 0 }
      }, token.valid)
      token.applying = false
      if (changed && token.valid()) toast.success('已粘贴到所选区域')
    } catch (error) { if (token.valid()) toast.error('粘贴失败，请检查剪贴板权限') }
    finally { endClipboard(token) }
  }
  handlersRef.current = { perform, copySelection, pasteSelection }

  useEffect(() => {
    const onMode = event => {
      if (!isTableEventForEditor(editor, event)) return
      if (event.detail === true && beginWrite()()) { activeRef.current = true; setActive(true) } else reset()
    }
    const onAction = event => {
      if (!isTableEventForEditor(editor, event) || !beginWrite()()) return
      const { type, payload } = event.detail || {}
      handlersRef.current.perform(type, payload)
    }
    window.addEventListener('tableSelection:mode', onMode); window.addEventListener('tableAction', onAction)
    return () => { window.removeEventListener('tableSelection:mode', onMode); window.removeEventListener('tableAction', onAction) }
  }, [editor, beginWrite, reset])

  useEffect(() => {
    if (!active || !isEditable) return
    let detach = () => {}, frame = 0
    const refresh = () => {
      frame = 0
      const root = editor.getRootElement(), container = root?.closest('.editor-container')
      if (!container || !activeRef.current) return
      let next = []
      editor.getEditorState().read(() => {
        next = groupsRef.current.map(group => {
          const model = $getTableModel($getNodeByKey(group.tableKey))
          return model ? { ...group, cellKeys: group.cellKeys.filter(key => model.locations.has(key)) } : null
        }).filter(group => group?.cellKeys.length)
      })
      replaceGroups(next)
      const host = container.getBoundingClientRect()
      const viewports = new Map()
      const outlines = next.flatMap(group => group.cellKeys.map(key => {
        const cell = editor.getElementByKey(key)
        if (!cell || !root.contains(cell)) return null
        const box = cell.getBoundingClientRect()
        let left = box.left, top = box.top, right = box.right, bottom = box.bottom
        const table = cell.closest('table')
        if (table && !viewports.has(table)) {
          const bounds = table.getBoundingClientRect()
          viewports.set(table, {
            bounds,
            left: bounds.left + table.clientLeft, top: bounds.top + table.clientTop,
            right: bounds.left + table.clientLeft + (table.clientWidth || bounds.width),
            bottom: bounds.top + table.clientTop + (table.clientHeight || bounds.height),
            frozenRow: table.dataset.lexicalFrozenRow === 'true' ? table.rows[0] : null,
            frozenRowCells: table.dataset.lexicalFrozenRow === 'true'
              ? [...(table.rows[0]?.cells || [])].map(node => node.getBoundingClientRect()) : [],
            frozenColumns: table.dataset.lexicalFrozenColumn === 'true'
              ? [...table.querySelectorAll('[data-table-column="0"]')].map(node => node.getBoundingClientRect()) : [],
          })
        }
        const viewport = viewports.get(table)
        if (viewport?.bounds.width > 0 && viewport.bounds.height > 0) {
          left = Math.max(left, viewport.left); top = Math.max(top, viewport.top)
          right = Math.min(right, viewport.right); bottom = Math.min(bottom, viewport.bottom)
          // These outlines live outside the scrolling TABLE. Clip both the
          // viewport and sticky cells so hidden selections cannot paint over
          // nearby text or over the visible frozen row/column.
          if (cell.dataset.tableColumn !== '0') {
            for (const frozen of viewport.frozenColumns) {
              if (frozen.top < bottom && frozen.bottom > top) left = Math.max(left, frozen.right)
            }
          }
          if (viewport.frozenRow && cell.parentElement !== viewport.frozenRow) {
            // Sticky positioning belongs to TD/TH; the TR scrolls normally.
            for (const frozen of viewport.frozenRowCells) {
              if (frozen.left < right && frozen.right > left) top = Math.max(top, frozen.bottom)
            }
          }
          if (right <= left || bottom <= top) return null
        }
        return { key, x: left - host.left + container.scrollLeft, y: top - host.top + container.scrollTop, w: right - left, h: bottom - top }
      }).filter(Boolean))
      let add = null
      const tableElement = hoverRef.current && editor.getElementByKey(hoverRef.current.tableKey)
      if (tableElement && root.contains(tableElement)) {
        const box = tableElement.getBoundingClientRect()
        add = { x: Math.max(0, Math.min(box.right - host.left + 6, host.width - 48)) + container.scrollLeft, y: box.top - host.top + box.height / 2 + container.scrollTop }
      }
      setGeometry({ outlines: [...new Map(outlines.map(outline => [outline.key, outline])).values()], top: container.scrollTop + 10, add })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh) }
    const unregisterUpdate = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      if (tags.has('local-notepad:content-load')) {
        reset(); dispatchTableEvent(editor, 'tableSelection:mode', false)
        return
      }
      const token = busyRef.current
      if (token?.snapshot && !token.applying && !token.cancelled && (dirtyElements.size || dirtyLeaves.size)) {
        editorState.read(() => {
          const table = $getNodeByKey(token.snapshot.tableKey), model = $getTableModel(table)
          if (!model || model.signature !== token.snapshot.signature || JSON.stringify($serialize(table)) !== token.snapshot.content) token.cancelled = true
        })
      }
      schedule()
    })
    const unregisterRoot = editor.registerRootListener(root => {
      detach()
      if (!root) { dragRef.current = null; return }
      const container = root.closest('.editor-container') || root
      const cellKey = target => {
        const dom = target?.closest?.('td,th')
        if (!dom || !root.contains(dom)) return null
        return editor.getEditorState().read(() => {
          const node = $getNearestNodeFromDOMNode(dom)
          return $isTableCellNode(node) ? node.getKey() : null
        }, { editor })
      }
      const onDown = event => {
        if (event.button !== 0 || !beginWrite()()) return
        const anchorKey = cellKey(event.target)
        if (!anchorKey) return
        const group = editor.getEditorState().read(() => $selectionGroup(anchorKey, anchorKey))
        if (!group) return
        const previous = event.ctrlKey || event.metaKey ? groupsRef.current : []
        dragRef.current = { anchorKey, previous }
        replaceGroups([...previous, group]); schedule()
        event.preventDefault(); event.stopPropagation()
        root.focus({ preventScroll: true })
      }
      const onMove = event => {
        const key = cellKey(event.target)
        if (!key) return
        editor.getEditorState().read(() => {
          const current = $resolveTableCell(key)
          if (current) hoverRef.current = { tableKey: current.table.getKey(), cellKey: current.model.grid[0][current.model.columnCount - 1].cell.getKey() }
          const drag = dragRef.current
          if (drag && beginWrite()()) {
            const group = $selectionGroup(drag.anchorKey, key)
            if (group) replaceGroups([...drag.previous, group])
          }
        })
        if (dragRef.current) { event.preventDefault(); event.stopPropagation() }
        schedule()
      }
      const onUp = () => { dragRef.current = null }
      const onKey = event => {
        if (!beginWrite()() || editor.isComposing() || isShortcutContextBlocked(event)) return
        const target = event.target?.nodeType === 1 ? event.target : document.activeElement
        if (target?.closest?.('input,textarea,select')) return
        if (target === document.body && !isTableEventForEditor(editor, { target: window })) return
        const focusedEditor = target?.closest?.('[data-lexical-editor="true"]')
        if (focusedEditor && focusedEditor !== root) return
        if (target && target !== document.body && !container.contains(target)) return
        if (event.key === 'Escape') { event.preventDefault(); exit(); return }
        const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase()
        if (modifier && !event.altKey && !event.shiftKey && key === 'c') { event.preventDefault(); void handlersRef.current.copySelection(); return }
        if (modifier && !event.altKey && !event.shiftKey && key === 'v') { event.preventDefault(); void handlersRef.current.pasteSelection(); return }
        if (matchShortcut(event, 'mergeCells')) { event.preventDefault(); handlersRef.current.perform('mergeCells') }
        if (matchShortcut(event, 'splitCell')) { event.preventDefault(); handlersRef.current.perform('splitCells') }
      }
      root.addEventListener('mousedown', onDown, true); root.addEventListener('mousemove', onMove, true); root.addEventListener('mouseover', onMove)
      document.addEventListener('mouseup', onUp); window.addEventListener('blur', onUp); window.addEventListener('keydown', onKey)
      window.addEventListener('resize', schedule); container.addEventListener('scroll', schedule, true)
      detach = () => {
        root.removeEventListener('mousedown', onDown, true); root.removeEventListener('mousemove', onMove, true); root.removeEventListener('mouseover', onMove)
        document.removeEventListener('mouseup', onUp); window.removeEventListener('blur', onUp); window.removeEventListener('keydown', onKey)
        window.removeEventListener('resize', schedule); container.removeEventListener('scroll', schedule, true)
      }
      schedule()
    })
    return () => { unregisterRoot(); detach(); unregisterUpdate(); if (frame) cancelAnimationFrame(frame); dragRef.current = null }
  }, [active, isEditable, editor, documentId, beginWrite, replaceGroups, exit, reset])

  if (!isEditable) return null
  const selectedCellCount = countSelectedTableCells(groups), disabled = selectedCellCount === 0 || busy
  return (
    <div className="table-selection-overlay" style={{ pointerEvents: 'none' }}>
      {active && (
        <div className="table-selection-modebar" style={{ pointerEvents: 'auto', top: geometry.top }} aria-busy={busy}>
          <div className="table-selection-modebar-copy">
            <strong>单元格多选</strong>
            <span>{selectedCellCount ? '已选择 ' + selectedCellCount + ' 个单元格' : '拖动鼠标框选连续单元格，按 Ctrl/Cmd 可追加区域'}</span>
          </div>
          <div className="table-selection-modebar-actions">
            <UiButton density="compact" type="button" onClick={copySelection} disabled={disabled}>复制</UiButton>
            <UiButton density="compact" type="button" onClick={pasteSelection} disabled={disabled}>粘贴</UiButton>
            <UiButton density="compact" type="button" onClick={() => perform('background', '#fff3cd')} disabled={disabled}>浅黄</UiButton>
            <UiButton density="compact" type="button" onClick={() => perform('background', '')} disabled={disabled}>清底色</UiButton>
            <UiButton density="compact" type="button" onClick={() => perform('alignHorizontal', 'left')} disabled={disabled}>左对齐</UiButton>
            <UiButton density="compact" type="button" onClick={() => perform('alignHorizontal', 'center')} disabled={disabled}>居中</UiButton>
            <UiButton density="compact" type="button" onClick={() => perform('alignHorizontal', 'right')} disabled={disabled}>右对齐</UiButton>
            <UiButton density="compact" type="button" onClick={() => perform('alignVertical', 'middle')} disabled={disabled}>垂直居中</UiButton>
            <UiButton density="compact" type="button" onClick={() => perform('mergeCells')} disabled={disabled || selectedCellCount < 2} title={'合并 (' + shortcutLabel('mergeCells', bindings) + ')'}>合并</UiButton>
            <UiButton density="compact" type="button" onClick={() => perform('splitCells')} disabled={disabled} title={'拆分 (' + shortcutLabel('splitCell', bindings) + ')'}>拆分</UiButton>
            <UiButton density="compact" type="button" onClick={() => perform('clear')} disabled={disabled}>清空</UiButton>
            <UiButton density="compact" type="button" className="primary" onClick={exit}>完成</UiButton>
          </div>
        </div>
      )}
      {active && geometry.outlines.map(box => <div key={box.key} className="table-selection-outline" style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }} />)}
      {active && geometry.add && <UiButton density="compact" type="button" onClick={() => perform('insertColRight', hoverRef.current)} className="table-add-col-btn" style={{ pointerEvents: 'auto', position: 'absolute', left: geometry.add.x, top: geometry.add.y, transform: 'translateY(-50%)' }}>+列</UiButton>}
    </div>
  )
}
