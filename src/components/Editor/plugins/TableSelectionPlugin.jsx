import React, { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $createParagraphNode, $createTextNode, FORMAT_ELEMENT_COMMAND, $getSelection } from 'lexical'
import { TableNode, TableRowNode, TableCellNode, $createTableCellNode, $createTableRowNode, TableCellHeaderStates } from '@lexical/table'
import { $getNodeByKey } from 'lexical'
import { toast } from '~/services/toast'

export function countSelectedTableCells(rects) {
  return (Array.isArray(rects) ? rects : []).reduce((total, rect) => {
    const rows = rect.r2 - rect.r1 + 1
    const cols = rect.c2 - rect.c1 + 1
    return total + rows * cols
  }, 0)
}

export function tableMatrixToTSV(matrix) {
  return (Array.isArray(matrix) ? matrix : [])
    .map(row => (Array.isArray(row) ? row : []).map(value => String(value ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n')
}

export function parseTableTSV(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized) return []
  return normalized.split('\n').map(row => row.split('\t'))
}

export default function TableSelectionPlugin() {
  const [editor] = useLexicalComposerContext()
  const [active, setActive] = useState(false)
  const [rects, setRects] = useState([]) // {tableIndex,r1,c1,r2,c2}
  const startRef = useRef(null)
  const overlayRef = useRef(null)
  const ctrlRef = useRef(false)
  const draggingRef = useRef(false)
  const [hoverTable, setHoverTable] = useState(null)
  const [addBtnPos, setAddBtnPos] = useState(null)

  useEffect(() => {
    const onMode = (e) => { setActive(!!e.detail); if (!e.detail) setRects([]) }
    window.addEventListener('tableSelection:mode', onMode)
    return () => window.removeEventListener('tableSelection:mode', onMode)
  }, [])

  useEffect(() => {
    const onAction = (e) => {
      const { type, payload } = e.detail || {}
      if (type === 'mergeCells') { if (!rects[0]) { toast.warning('请先框选多个单元格'); return } doMerge() }
      else if (type === 'splitCells') doSplit()
      else if (type === 'alignVertical') applyAlign(payload)
      else if (type === 'alignHorizontal') applyHorizontal(payload)
      else if (type === 'borderPreset') applyBorder(payload)
      else if (type === 'background') applyBackground(payload)
      else if (type === 'autoFitWindow') autoSize('fitWindow')
      else if (type === 'autoFitContent') autoSize('fitContent')
      else if (type === 'sortAsc') sortByFirstCol('asc')
      else if (type === 'sortDesc') sortByFirstCol('desc')
      else if (type === 'filterContains') filterRowsContains(payload)
      else if (type === 'paginate') paginateRows(Number(payload) || 10)
      else if (type === 'insertRow' || type === 'insertRowAbove' || type === 'insertRowBelow') doAddRow(payload)
      else if (type === 'deleteRow') doDelRow(payload)
      else if (type === 'insertCol' || type === 'insertColLeft' || type === 'insertColRight') doAddCol(payload)
      else if (type === 'deleteCol') doDelCol(payload)
      else if (type === 'deleteTable') doDelTable(payload)
      else if (type === 'clear') doClear(payload)
      else if (type === 'toggleRowStriping') toggleRowStriping(payload)
      else if (type === 'toggleFrozenRow') toggleFrozenRow(payload)
      else if (type === 'toggleFrozenColumn') toggleFrozenColumn(payload)
      else if (type === 'toggleRowHeader') toggleRowHeader(payload)
      else if (type === 'toggleColumnHeader') toggleColumnHeader(payload)
      
      // 恢复编辑器焦点，防止操作后失焦无法输入
      setTimeout(() => editor.focus(), 0)
    }
    window.addEventListener('tableAction', onAction)
    return () => window.removeEventListener('tableAction', onAction)
  }, [editor, rects])

  useEffect(() => {
    if (!active) return
    const container = document.querySelector('.editor-container')
    if (!container) return

    const getCell = (el) => {
      while (el && el !== container) { if (el.tagName === 'TD') return el; el = el.parentElement }
      return null
    }
    const indexOf = (cell) => {
      const row = cell.parentElement
      const table = row?.parentElement
      const rIdx = Array.from(table.children).indexOf(row)
      const cIdx = Array.from(row.children).indexOf(cell)
      const tableIndex = Array.from(container.querySelectorAll('table')).indexOf(table)
      return { r: rIdx, c: cIdx, table, tableIndex }
    }

    const onKey = (e) => { ctrlRef.current = e.ctrlKey || e.metaKey }
    const onShortcut = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setRects([])
        setActive(false)
        window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: false }))
        editor.focus()
        return
      }
      const modifier = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (modifier && !e.altKey && key === 'c') {
        e.preventDefault()
        void copySelection()
        return
      }
      if (modifier && !e.altKey && key === 'v') {
        if (!navigator.clipboard?.readText) return
        e.preventDefault()
        void pasteSelection()
        return
      }

      if (!modifier || !e.altKey) return
      if (key === 'm') { e.preventDefault(); doMerge() }
      if (key === 's') { e.preventDefault(); doSplit() }
    }
    const onDown = (e) => {
      const cell = getCell(e.target)
      if (!cell) return
      draggingRef.current = true
      startRef.current = cell
      // e.preventDefault() // Removed to allow focus/input
    }
    let lastKey = ''
    const onMove = (e) => {
      if (!draggingRef.current || !startRef.current) return
      const a = startRef.current
      const b = getCell(e.target) || a
      const ai = indexOf(a), bi = indexOf(b)
      if (!ai.table || ai.table !== bi.table) return
      const r1 = Math.min(ai.r, bi.r), r2 = Math.max(ai.r, bi.r)
      const c1 = Math.min(ai.c, bi.c), c2 = Math.max(ai.c, bi.c)
      const key = `${ai.tableIndex}-${r1}-${c1}-${r2}-${c2}`
      if (key === lastKey) return
      lastKey = key
      const rect = { tableIndex: ai.tableIndex, r1, c1, r2, c2 }
      setRects((prev) => ctrlRef.current ? [...prev, rect] : [rect])
    }
    const onUp = () => { draggingRef.current = false; startRef.current = null }
    const onLeave = () => { draggingRef.current = false }
    const onOver = (e) => {
      const table = e.target.closest('table')
      if (!table) { setHoverTable(null); setAddBtnPos(null); return }
      const rootRect = container.getBoundingClientRect()
      const tRect = table.getBoundingClientRect()
      const idx = Array.from(container.querySelectorAll('table')).indexOf(table)
      setHoverTable(idx)
      setAddBtnPos({ x: tRect.right - rootRect.left + 6, y: tRect.top - rootRect.top + tRect.height / 2 })
    }

    container.addEventListener('mousedown', onDown)
    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseup', onUp)
    container.addEventListener('mouseleave', onLeave)
    container.addEventListener('mouseover', onOver)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onShortcut)
    window.addEventListener('keyup', onKey)
    return () => {
      container.removeEventListener('mousedown', onDown)
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseup', onUp)
      container.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onShortcut)
      window.removeEventListener('keyup', onKey)
      container.removeEventListener('mouseover', onOver)
    }
  }, [active, rects, editor])


  const getCurrentCellInfo = () => {
    const selection = $getSelection()
    const node = selection?.getNodes?.()[0]
    let cell = node

    while (cell && !(cell instanceof TableCellNode)) {
      cell = cell.getParent?.()
    }

    if (!(cell instanceof TableCellNode)) return null

    const row = cell.getParent?.()
    const table = row?.getParent?.()
    if (!(row instanceof TableRowNode) || !(table instanceof TableNode)) return null

    return {
      cell,
      row,
      table,
      ri: row.getIndexWithinParent?.() ?? 0,
      ci: cell.getIndexWithinParent?.() ?? 0,
    }
  }


  const doMerge = () => {
    const r = rects[0]
    if (!r) return
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const table = tables[r.tableIndex]
      if (!table) return
      const rows = table.getChildren()
      const tl = rows[r.r1].getChildren()[r.c1]
      if (!(tl instanceof TableCellNode)) return
      tl.setColSpan(r.c2 - r.c1 + 1)
      tl.setRowSpan(r.r2 - r.r1 + 1)
      for (let rr = r.r1; rr <= r.r2; rr++) {
        const row = rows[rr]
        const cells = row.getChildren()
        const start = rr === r.r1 ? r.c1 + 1 : r.c1
        for (let cc = start; cc <= r.c2 && cc < cells.length; cc++) {
          const cell = cells[start]
          if (!cell) break
          const kids = cell.getChildren()
          for (const k of kids) { tl.append(k) }
          cell.remove()
        }
      }
    })
    setRects([])
  }

  const doDelTable = (payload) => {
    editor.update(() => {
      const table = getTable(payload)
      if (table) table.remove()
    })
  }

  const toggleRowStriping = (payload) => {
    editor.update(() => {
      const table = getTable(payload)
      if (table) {
        table.setRowStriping(!table.getRowStriping())
      }
    })
  }

  const toggleFrozenRow = (payload) => {
    editor.update(() => {
      const table = getTable(payload)
      if (table) {
        table.setFrozenRows(table.getFrozenRows() === 0 ? 1 : 0)
      }
    })
  }

  const toggleFrozenColumn = (payload) => {
    editor.update(() => {
      const table = getTable(payload)
      if (table) {
        table.setFrozenColumns(table.getFrozenColumns() === 0 ? 1 : 0)
      }
    })
  }

  const toggleRowHeader = (payload) => {
    editor.update(() => {
      const table = getTable(payload)
      if (!table) return
      const rows = table.getChildren()
      const row = rows[0]
      if (!row) return
      const cells = row.getChildren()
      cells.forEach(cell => {
        if (cell.toggleHeaderStyle) {
          cell.toggleHeaderStyle(TableCellHeaderStates.ROW)
        }
      })
    })
  }

  const toggleColumnHeader = (payload) => {
    editor.update(() => {
      const table = getTable(payload)
      if (!table) return
      const rows = table.getChildren()
      rows.forEach(row => {
        const cell = row.getChildren()[0]
        if (cell && cell.toggleHeaderStyle) {
          cell.toggleHeaderStyle(TableCellHeaderStates.COLUMN)
        }
      })
    })
  }

  const doSplit = () => {
    const r = rects[0]
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      if (r) {
        const table = tables[r.tableIndex]
        if (!table) return
        const rows = table.getChildren()
        const target = rows[r.r1]?.getChildren()?.[r.c1]
        if (!(target instanceof TableCellNode)) return
        const rs = target.getRowSpan?.() || 1
        const cs = target.getColSpan?.() || 1
        if (rs === 1 && cs === 1) return
        target.setRowSpan?.(1)
        target.setColSpan?.(1)
        for (let rr = r.r1; rr < r.r1 + rs; rr++) {
          const row = rows[rr]
          const cells = row.getChildren()
          for (let cc = r.c1; cc < r.c1 + cs; cc++) {
            if (rr === r.r1 && cc === r.c1) continue
            const cell = $createTableCellNode()
            cell.append($createParagraphNode())
            row.insertAt(Math.min(cc, cells.length), cell)
          }
        }
      } else {
        const sel = $getSelection()
        const node = sel?.getNodes?.()[0]
        let cell = node
        while (cell && !(cell instanceof TableCellNode)) { cell = cell.getParent?.() }
        if (!(cell instanceof TableCellNode)) return
        const row = cell.getParent()
        const table = row?.getParent?.()
        const rs = cell.getRowSpan?.() || 1
        const cs = cell.getColSpan?.() || 1
        if (rs === 1 && cs === 1) return
        cell.setRowSpan?.(1)
        cell.setColSpan?.(1)
        const rowIndex = row.getIndexWithinParent?.() ?? 0
        const colIndex = cell.getIndexWithinParent?.() ?? 0
        const rows = table.getChildren()
        for (let rr = rowIndex; rr < rowIndex + rs; rr++) {
          const rNode = rows[rr]
          const cells = rNode.getChildren()
          for (let cc = colIndex; cc < colIndex + cs; cc++) {
            if (rr === rowIndex && cc === colIndex) continue
            const nc = $createTableCellNode()
            nc.append($createParagraphNode())
            rNode.insertAt(Math.min(cc, cells.length), nc)
          }
        }
      }
    })
    setRects([])
  }

  const getRectTable = (rect) => {
    if (!rect) return null
    const tables = []
    const walk = node => {
      if (!node?.getChildren) return
      for (const child of node.getChildren()) {
        if (child instanceof TableNode) tables.push(child)
        walk(child)
      }
    }
    walk($getRoot())
    return tables[rect.tableIndex] || null
  }

  const copySelection = async () => {
    const rect = rects[0]
    if (!rect) return

    let text = ''
    editor.getEditorState().read(() => {
      const table = getRectTable(rect)
      if (!table) return

      const rows = table.getChildren()
      const matrix = []
      for (let rr = rect.r1; rr <= rect.r2; rr++) {
        const row = rows[rr]
        if (!(row instanceof TableRowNode)) continue
        const cells = row.getChildren()
        const values = []
        for (let cc = rect.c1; cc <= rect.c2; cc++) {
          values.push(cells[cc]?.getTextContent?.() || '')
        }
        matrix.push(values)
      }
      text = tableMatrixToTSV(matrix)
    })

    if (!text && selectedCellCount === 0) return

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
      }
      toast.success(rects.length > 1 ? '已复制第一个连续选区' : '已复制所选单元格')
    } catch (error) {
      console.error('复制表格内容失败', error)
      toast.error('复制失败，请检查剪贴板权限')
    }
  }

  const pasteSelection = async () => {
    const rect = rects[0]
    if (!rect) return

    try {
      if (!navigator.clipboard?.readText) {
        toast.warning('当前环境不支持读取剪贴板')
        return
      }
      const text = await navigator.clipboard.readText()
      const matrix = parseTableTSV(text)
      if (!matrix.length) {
        toast.warning('剪贴板里没有可粘贴的表格内容')
        return
      }

      editor.update(() => {
        const table = getRectTable(rect)
        if (!table) return
        const rows = table.getChildren()

        for (let rowOffset = 0; rowOffset < matrix.length; rowOffset++) {
          const row = rows[rect.r1 + rowOffset]
          if (!(row instanceof TableRowNode)) break
          const cells = row.getChildren()

          for (let colOffset = 0; colOffset < matrix[rowOffset].length; colOffset++) {
            const cell = cells[rect.c1 + colOffset]
            if (!(cell instanceof TableCellNode)) break

            for (const child of cell.getChildren()) child.remove()
            const paragraph = $createParagraphNode()
            const value = matrix[rowOffset][colOffset]
            if (value) paragraph.append($createTextNode(value))
            cell.append(paragraph)
          }
        }
      })

      toast.success('已粘贴到所选区域')
    } catch (error) {
      console.error('粘贴表格内容失败', error)
      toast.error('粘贴失败，请检查剪贴板权限')
    }
  }

  const doClear = (payload) => {
    const r = rects[0]

    editor.update(() => {
      const clearCell = (cell) => {
        if (!(cell instanceof TableCellNode)) return
        for (const child of cell.getChildren()) child.remove()
        cell.append($createParagraphNode())
      }

      if (r) {
        const tables = []
        const walk = (node) => {
          if (!node.getChildren) return
          for (const child of node.getChildren()) {
            if (child instanceof TableNode) tables.push(child)
            walk(child)
          }
        }
        walk($getRoot())

        const table = tables[r.tableIndex]
        if (!table) return

        const rows = table.getChildren()
        for (let rr = r.r1; rr <= r.r2; rr++) {
          const row = rows[rr]
          const cells = row.getChildren()
          for (let cc = r.c1; cc <= r.c2 && cc < cells.length; cc++) {
            clearCell(cells[cc])
          }
        }
        return
      }

      const target = payload?.cellKey ? $getNodeByKey(payload.cellKey) : getCurrentCellInfo()?.cell
      clearCell(target)
    })
  }

  const getTable = (payload) => {
    if (payload?.tableKey) return $getNodeByKey(payload.tableKey)

    if (payload?.tIndex !== undefined) {
      const tables = []
      const walk = (node) => {
        if (!node.getChildren) return
        for (const child of node.getChildren()) {
          if (child instanceof TableNode) tables.push(child)
          walk(child)
        }
      }
      walk($getRoot())
      return tables[payload.tIndex]
    }

    return getCurrentCellInfo()?.table || null
  }

  const doAddRow = (payload) => {
    editor.update(() => {
      const current = getCurrentCellInfo()
      const ri = payload?.ri ?? current?.ri ?? 0
      const mode = payload?.mode || 'below'
      const table = getTable(payload) || current?.table
      if (!table) return
      const rows = table.getChildren()
      const cols = rows[0]?.getChildren().length || 1
      const row = $createTableRowNode()
      
      // Get reference row to copy styles
      const refRow = rows[ri]
      const refCells = refRow ? refRow.getChildren() : null

      for (let i = 0; i < cols; i++) { 
        const cell = $createTableCellNode(); 
        cell.append($createParagraphNode()); 
        
        // Copy styles from reference cell
        if (refCells && refCells[i]) {
          const refCell = refCells[i]
          if (refCell.getBackgroundColor()) cell.setBackgroundColor(refCell.getBackgroundColor())
          if (refCell.getVerticalAlign()) cell.setVerticalAlign(refCell.getVerticalAlign())
          if (refCell.getWidth()) cell.setWidth(refCell.getWidth())
          if (refCell.getStyle && cell.setStyle) {
             cell.setStyle(refCell.getStyle())
          }
        }
        
        row.append(cell) 
      }
      
      const targetRow = rows[ri]
      if (targetRow) {
        if (mode === 'above') {
          targetRow.insertBefore(row)
        } else {
          targetRow.insertAfter(row)
        }
      } else {
        table.append(row)
      }
    })
  }

  const doDelRow = (payload) => {
    editor.update(() => {
      const current = getCurrentCellInfo()
      const ri = payload?.ri ?? current?.ri ?? 0
      const table = getTable(payload) || current?.table
      if (!table) return
      const rows = table.getChildren()
      const row = rows[ri]
      if (row) row.remove()
    })
  }

  const doAddCol = (payload) => {
    editor.update(() => {
      const current = getCurrentCellInfo()
      const ci = payload?.ci ?? current?.ci ?? 0
      const mode = payload?.mode || 'right'
      const table = getTable(payload) || current?.table
      if (!table) return
      const rows = table.getChildren()
      for (const r of rows) { 
        const cell = $createTableCellNode(); 
        cell.append($createParagraphNode()); 
        
        // Copy styles from reference cell in the same row
        const cells = r.getChildren()
        const refCell = cells[ci]
        if (refCell) {
           if (refCell.getBackgroundColor()) cell.setBackgroundColor(refCell.getBackgroundColor())
           if (refCell.getVerticalAlign()) cell.setVerticalAlign(refCell.getVerticalAlign())
           if (refCell.getWidth()) cell.setWidth(refCell.getWidth())
           
           if (refCell.getStyle && cell.setStyle) {
              cell.setStyle(refCell.getStyle())
           }
           if (refCell.getHeaderStyles) {
             cell.setHeaderStyles(refCell.getHeaderStyles())
           }
        }

        if (refCell) {
          if (mode === 'left') {
            refCell.insertBefore(cell)
          } else {
            refCell.insertAfter(cell)
          }
        } else {
          r.append(cell)
        }
      }
    })
  }

  const addColForTable = (tIndex) => {
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const table = tables[tIndex]
      if (!table) return
      const rows = table.getChildren()
      const headerState = (() => { const first = rows[0]?.getChildren()?.[0]; try { return first?.getHeaderState?.() ?? 0 } catch { return 0 } })()
      rows.forEach((row, ri) => { const cell = $createTableCellNode(); cell.append($createParagraphNode()); try { if (ri === 0) cell.setHeaderState?.(headerState) } catch {}; row.append(cell) })
    })
  }

  const doDelCol = (payload) => {
    editor.update(() => {
      const current = getCurrentCellInfo()
      const ci = payload?.ci ?? current?.ci ?? 0
      const table = getTable(payload) || current?.table
      if (!table) return
      const rows = table.getChildren()
      for (const r of rows) { const cells = r.getChildren(); const target = cells[ci]; if (target) target.remove() }
    })
  }

  const doMoveRow = (payload, direction) => {
    editor.update(() => {
      const current = getCurrentCellInfo()
      const ri = payload?.ri ?? current?.ri ?? 0
      const table = getTable(payload) || current?.table
      if (!table) return

      const rows = table.getChildren()
      const targetIndex = ri + direction
      if (targetIndex < 0 || targetIndex >= rows.length) return

      const row = rows[ri]
      const target = rows[targetIndex]
      if (!row || !target) return

      if (direction < 0) target.insertBefore(row)
      else target.insertAfter(row)
    })
  }

  const doMoveCol = (payload, direction) => {
    editor.update(() => {
      const current = getCurrentCellInfo()
      const ci = payload?.ci ?? current?.ci ?? 0
      const table = getTable(payload) || current?.table
      if (!table) return

      const rows = table.getChildren()
      const targetIndex = ci + direction
      if (targetIndex < 0) return

      for (const row of rows) {
        const cells = row.getChildren()
        if (targetIndex >= cells.length) return

        const cell = cells[ci]
        const target = cells[targetIndex]
        if (!(cell instanceof TableCellNode) || !(target instanceof TableCellNode)) return

        if ((cell.getColSpan?.() || 1) !== 1 || (target.getColSpan?.() || 1) !== 1) {
          toast.warning('合并单元格暂不支持直接移动列')
          return
        }
      }

      for (const row of rows) {
        const cells = row.getChildren()
        const cell = cells[ci]
        const target = cells[targetIndex]
        if (direction < 0) target.insertBefore(cell)
        else target.insertAfter(cell)
      }
    })
  }

  const sortByFirstCol = (dir) => {
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const container = document.querySelector('.editor-container')
      const tableEls = container ? Array.from(container.querySelectorAll('table')) : []
      const tIndex = hoverTable ?? 0
      const table = tables[tIndex]
      const tableEl = tableEls[tIndex]
      if (!table || !tableEl) return
      const rows = table.getChildren()
      const bodyRows = rows.slice(1)
      const sorted = bodyRows.slice().sort((a, b) => {
        const ta = a.getChildren?.()[0]
        const tb = b.getChildren?.()[0]
        const va = String(ta?.getTextContent?.() || '')
        const vb = String(tb?.getTextContent?.() || '')
        return dir === 'asc' ? va.localeCompare(vb, 'zh-CN') : vb.localeCompare(va, 'zh-CN')
      })
      bodyRows.forEach(r => r.remove())
      sorted.forEach(r => table.append(r))
    })
  }

  const filterRowsContains = (payload) => {
    const q = payload?.value ?? payload
    if (!q) return
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const tIndex = hoverTable ?? 0
      const table = tables[tIndex]
      if (!table) return
      const rows = table.getChildren()
      const header = rows[0]
      const remain = [header]
      rows.slice(1).forEach(r => {
        const text = r.getTextContent?.() || ''
        if (text.includes(q)) remain.push(r)
        else r.remove()
      })
    })
  }

  const paginateRows = (payload) => {
    const pageSize = Number(payload?.value ?? payload)
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const tIndex = hoverTable ?? 0
      const table = tables[tIndex]
      if (!table) return
      const rows = table.getChildren()
      const header = rows[0]
      let group = []
      let remaining = rows.slice(1)
      const parent = table.getParent?.()
      if (!parent) return
      const makeTable = (rowsGroup) => {
        const nt = new TableNode()
        const newRows = [header.clone?.() || header]
        rowsGroup.forEach(r => newRows.push(r))
        newRows.forEach(r => nt.append(r))
        parent.insertAfter(nt, table)
        return nt
      }
      while (remaining.length > 0) {
        group = remaining.splice(0, pageSize)
        makeTable(group)
      }
      // Original table will keep only header
      rows.slice(1).forEach(r => r.remove())
    })
  }

  const outlines = (() => {
    if (typeof document === 'undefined') return []
    const container = document.querySelector('.editor-container')
    if (!container) return []
    const tables = Array.from(container.querySelectorAll('table'))
    return rects.map(r => {
      const table = tables[r.tableIndex]
      if (!table) return null
      const host = container.getBoundingClientRect()
      const tlCell = table.rows[r.r1]?.children?.[r.c1]
      const brCell = table.rows[r.r2]?.children?.[r.c2]
      if (!tlCell || !brCell) return null
      const tl = tlCell.getBoundingClientRect()
      const br = brCell.getBoundingClientRect()
      const x = tl.left - host.left
      const y = tl.top - host.top
      const w = br.right - tl.left
      const h = br.bottom - tl.top
      return { x, y, w, h }
    }).filter(Boolean)
  })()

  const applyAlign = (payload) => {
    const v = payload?.value ?? payload
    const r = rects[0]
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      if (r) {
        const table = tables[r.tableIndex]
        if (!table) return
        const targetRows = table.getChildren()
        for (let rr = r.r1; rr <= r.r2; rr++) {
          const row = targetRows[rr]
          const cells = row.getChildren()
          for (let cc = r.c1; cc <= r.c2 && cc < cells.length; cc++) { cells[cc].setVerticalAlign?.(v) }
        }
      } else if (payload?.cellKey) {
        const cell = $getNodeByKey(payload.cellKey)
        if (cell && cell.setVerticalAlign) cell.setVerticalAlign(v)
      } else {
        const sel = $getSelection()
        const node = sel?.getNodes?.()[0]
        let cell = node
        while (cell && !(cell instanceof TableCellNode)) { cell = cell.getParent?.() }
        if (cell) cell.setVerticalAlign?.(v)
      }
    })
    if (!active) setRects([])
  }

  const applyHorizontal = (payload) => {
    const v = payload?.value ?? payload
    const r = rects[0]
    const patch = `text-align: ${v};`
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const applyCell = (cell) => { const prev = cell.getStyle?.() || ''; cell.setStyle?.(mergeStyle(prev, patch)) }
      if (r) {
        const table = tables[r.tableIndex]
        if (!table) return
        const targetRows = table.getChildren()
        for (let rr = r.r1; rr <= r.r2; rr++) {
          const row = targetRows[rr]
          const cells = row.getChildren()
          for (let cc = r.c1; cc <= r.c2 && cc < cells.length; cc++) { applyCell(cells[cc]) }
        }
      } else if (payload?.cellKey) {
        const cell = $getNodeByKey(payload.cellKey)
        if (cell) applyCell(cell)
      } else {
        const sel = $getSelection()
        const node = sel?.getNodes?.()[0]
        let cell = node
        while (cell && !(cell instanceof TableCellNode)) { cell = cell.getParent?.() }
        if (cell) applyCell(cell)
      }
    })
    if (!active) setRects([])
  }

  const applyBorder = (payload) => {
    const preset = payload?.value ?? payload
    const r = rects[0]
    const style = (() => {
      if (preset === 'none') return 'border: 0;'
      if (preset === 'thin') return 'border: 1px solid #999;'
      if (preset === 'bold') return 'border: 2px solid #333;'
      if (preset === 'dashed') return 'border: 2px dashed #666;'
      return ''
    })()
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const applyCell = (cell) => { const prev = cell.getStyle?.() || ''; cell.setStyle?.(mergeStyle(prev, style)) }
      if (r) {
        const table = tables[r.tableIndex]
        if (!table) return
        const targetRows = table.getChildren()
        for (let rr = r.r1; rr <= r.r2; rr++) {
          const row = targetRows[rr]
          const cells = row.getChildren()
          for (let cc = r.c1; cc <= r.c2 && cc < cells.length; cc++) { applyCell(cells[cc]) }
        }
      } else if (payload?.cellKey) {
        const cell = $getNodeByKey(payload.cellKey)
        if (cell) applyCell(cell)
      } else {
        const sel = $getSelection()
        const node = sel?.getNodes?.()[0]
        let cell = node
        while (cell && !(cell instanceof TableCellNode)) { cell = cell.getParent?.() }
        if (cell) applyCell(cell)
      }
    })
    if (!active) setRects([])
  }

  const applyBackground = (payload) => {
    const color = payload?.value ?? payload
    const r = rects[0]
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      if (r) {
        const table = tables[r.tableIndex]
        if (!table) return
        const targetRows = table.getChildren()
        for (let rr = r.r1; rr <= r.r2; rr++) {
          const row = targetRows[rr]
          const cells = row.getChildren()
          for (let cc = r.c1; cc <= r.c2 && cc < cells.length; cc++) { cells[cc].setBackgroundColor?.(color) }
        }
      } else if (payload?.cellKey) {
        const cell = $getNodeByKey(payload.cellKey)
        if (cell && cell.setBackgroundColor) cell.setBackgroundColor(color)
      } else {
        const sel = $getSelection()
        const node = sel?.getNodes?.()[0]
        let cell = node
        while (cell && !(cell instanceof TableCellNode)) { cell = cell.getParent?.() }
        if (cell) cell.setBackgroundColor?.(color)
      }
    })
    if (!active) setRects([])
  }

  const mergeStyle = (prev, patch) => {
    const map = {}
    const put = (s) => { s.split(';').map(x=>x.trim()).filter(Boolean).forEach((kv)=>{ const i=kv.indexOf(':'); if(i>0){ const k=kv.slice(0,i).trim(); const v=kv.slice(i+1).trim(); map[k]=v } }) }
    put(prev || '')
    put(patch || '')
    return Object.entries(map).map(([k,v])=>`${k}: ${v};`).join(' ')
  }

  const autoSize = (mode) => {
    editor.update(() => {
      const tables = []
      const walk = (node) => { if (!node.getChildren) return; const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const container = document.querySelector('.editor-container')
      const tableEls = container ? Array.from(container.querySelectorAll('table')) : []
      let tableIndex = hoverTable
      if (tableIndex === null || tableIndex === undefined) {
        const sel = $getSelection()
        const node = sel?.getNodes?.()[0]
        let tableNode = node
        while (tableNode && !(tableNode instanceof TableNode)) { tableNode = tableNode.getParent?.() }
        if (tableNode) {
          const list = []
          const walk2 = (n) => { if (!n.getChildren) return; const kids = n.getChildren(); for (const k of kids) { if (k instanceof TableNode) list.push(k); walk2(k) } }
          walk2($getRoot())
          tableIndex = list.indexOf(tableNode)
        } else {
          tableIndex = 0
        }
      }
      const table = tables[tableIndex]
      const tableEl = tableEls[tableIndex]
      if (!table || !tableEl) return
      const rows = table.getChildren()
      const colsCount = rows[0]?.getChildren()?.length || 1
      if (mode === 'fitWindow') {
        const hostW = container.getBoundingClientRect().width - 20
        const colW = Math.max(60, Math.floor(hostW / colsCount))
        rows.forEach((row) => { const cells = row.getChildren(); cells.forEach((cell)=>cell.setWidth?.(colW)) })
      } else if (mode === 'fitContent') {
        const measures = new Array(colsCount).fill(60)
        Array.from(tableEl.rows).forEach((r) => {
          Array.from(r.cells).forEach((c, ci) => { const w = Math.ceil(c.scrollWidth) + 24; measures[ci] = Math.max(measures[ci], w) })
        })
        rows.forEach((row) => { const cells = row.getChildren(); cells.forEach((cell, ci)=>cell.setWidth?.(measures[ci])) })
      }
    })
  }

  const selectedCellCount = countSelectedTableCells(rects)

  const exitSelectionMode = () => {
    setRects([])
    setActive(false)
    window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: false }))
    editor.focus()
  }

  return (
    <div ref={overlayRef} className="table-selection-overlay" style={{ pointerEvents: 'none' }}>
      {active && (
        <div className="table-selection-modebar" style={{ pointerEvents: 'auto' }}>
          <div className="table-selection-modebar-copy">
            <strong>单元格多选</strong>
            <span>{selectedCellCount > 0 ? `已选择 ${selectedCellCount} 个单元格` : '拖动鼠标框选连续单元格，按 Ctrl/Cmd 可追加区域'}</span>
          </div>
          <div className="table-selection-modebar-actions">
            <button type="button" onClick={copySelection} disabled={selectedCellCount === 0}>复制</button>
            <button type="button" onClick={pasteSelection} disabled={selectedCellCount === 0}>粘贴</button>
            <button type="button" onClick={() => applyBackground('#fff3cd')} disabled={selectedCellCount === 0}>浅黄</button>
            <button type="button" onClick={() => applyBackground('')} disabled={selectedCellCount === 0}>清底色</button>
            <button type="button" onClick={() => applyHorizontal('left')} disabled={selectedCellCount === 0}>左对齐</button>
            <button type="button" onClick={() => applyHorizontal('center')} disabled={selectedCellCount === 0}>居中</button>
            <button type="button" onClick={() => applyHorizontal('right')} disabled={selectedCellCount === 0}>右对齐</button>
            <button type="button" onClick={() => applyAlign('middle')} disabled={selectedCellCount === 0}>垂直居中</button>
            <button type="button" onClick={doMerge} disabled={selectedCellCount < 2}>合并</button>
            <button type="button" onClick={doSplit} disabled={selectedCellCount === 0}>拆分</button>
            <button type="button" onClick={() => doClear()} disabled={selectedCellCount === 0}>清空</button>
            <button type="button" className="primary" onClick={exitSelectionMode}>完成</button>
          </div>
        </div>
      )}
      {outlines.map((b, i) => (
        <div key={i} className="table-selection-outline" style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h }} />
      ))}
      {addBtnPos && hoverTable !== null && (
        <button onClick={() => addColForTable(hoverTable)} className="table-add-col-btn" style={{ pointerEvents: 'auto', position: 'absolute', left: addBtnPos.x, top: addBtnPos.y, transform: 'translateY(-50%)' }}>+列</button>
      )}
    </div>
  )
}
