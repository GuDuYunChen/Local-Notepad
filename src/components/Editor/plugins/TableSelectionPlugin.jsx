import React, { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $createParagraphNode } from 'lexical'
import { TableNode, TableRowNode, TableCellNode, $createTableCellNode, $createTableRowNode } from '@lexical/table'

export default function TableSelectionPlugin() {
  const [editor] = useLexicalComposerContext()
  const [active, setActive] = useState(false)
  const [rects, setRects] = useState([]) // {tableIndex,r1,c1,r2,c2}
  const startRef = useRef(null)
  const overlayRef = useRef(null)
  const ctrlRef = useRef(false)
  const draggingRef = useRef(false)
  const menuRef = useRef(null)
  const [hoverTable, setHoverTable] = useState(null)
  const [addBtnPos, setAddBtnPos] = useState(null)

  useEffect(() => {
    const onMode = (e) => { setActive(!!e.detail); if (!e.detail) setBoxes([]) }
    window.addEventListener('tableSelection:mode', onMode)
    return () => window.removeEventListener('tableSelection:mode', onMode)
  }, [])

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
    const onDown = (e) => {
      const cell = getCell(e.target)
      if (!cell) return
      draggingRef.current = true
      startRef.current = cell
      e.preventDefault()
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
    window.addEventListener('keyup', onKey)
    return () => {
      container.removeEventListener('mousedown', onDown)
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseup', onUp)
      container.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      container.removeEventListener('mouseover', onOver)
    }
  }, [active])

  useEffect(() => {
    const container = document.querySelector('.editor-container')
    if (!container) return
    const onContext = (e) => {
      const cell = e.target.closest('td')
      const table = e.target.closest('table')
      if (!cell || !table) return
      e.preventDefault()
      const ri = Array.from(cell.parentElement.parentElement.children).indexOf(cell.parentElement)
      const ci = Array.from(cell.parentElement.children).indexOf(cell)
      const tIndex = Array.from(container.querySelectorAll('table')).indexOf(table)
      const menu = getMenu()
      menu.style.left = `${e.clientX}px`
      menu.style.top = `${e.clientY}px`
      menu.style.display = 'block'
      menu.dataset.info = JSON.stringify({ tIndex, ri, ci })
    }
    const onClickDoc = (e) => {
      const m = menuRef.current
      if (!m) return
      if (!m.contains(e.target)) m.style.display = 'none'
    }
    container.addEventListener('contextmenu', onContext)
    document.addEventListener('click', onClickDoc)
    return () => { container.removeEventListener('contextmenu', onContext); document.removeEventListener('click', onClickDoc) }
  }, [])

  const getMenu = () => {
    let m = menuRef.current
    if (!m) {
      m = document.createElement('div')
      m.className = 'table-context-menu'
      const make = (text, handler) => { const btn = document.createElement('div'); btn.className='item'; btn.textContent=text; btn.onclick=handler; return btn }
      m.appendChild(make('选择整行', () => doRowColSelect('row')))
      m.appendChild(make('选择整列', () => doRowColSelect('col')))
      m.appendChild(make('合并单元格', () => doMerge()))
      m.appendChild(make('清除内容', () => doClear()))
      m.appendChild(make('添加行', () => doAddRow()))
      m.appendChild(make('删除行', () => doDelRow()))
      m.appendChild(make('添加列', () => doAddCol()))
      m.appendChild(make('删除列', () => doDelCol()))
      document.body.appendChild(m)
      menuRef.current = m
    }
    return m
  }

  const readInfo = () => {
    const m = getMenu()
    try { return JSON.parse(m.dataset.info || '{}') } catch { return {} }
  }

  const doRowColSelect = (type) => {
    const { tIndex, ri, ci } = readInfo()
    const container = document.querySelector('.editor-container')
    const tables = container ? Array.from(container.querySelectorAll('table')) : []
    const table = tables[tIndex]
    if (!table) return
    if (type === 'row') {
      const cols = table.rows[ri]?.children?.length || 1
      setRects([{ tableIndex: tIndex, r1: ri, c1: 0, r2: ri, c2: cols - 1 }])
    } else {
      const rows = table.rows.length
      setRects([{ tableIndex: tIndex, r1: 0, c1: ci, r2: rows - 1, c2: ci }])
    }
    menuRef.current.style.display = 'none'
  }

  const doMerge = () => {
    const r = rects[0]
    if (!r) return
    editor.update(() => {
      const tables = []
      const walk = (node) => { const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
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
    if (menuRef.current) menuRef.current.style.display = 'none'
  }

  const doClear = () => {
    const r = rects[0]
    if (!r) return
    editor.update(() => {
      const tables = []
      const walk = (node) => { const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const table = tables[r.tableIndex]
      if (!table) return
      const rows = table.getChildren()
      for (let rr = r.r1; rr <= r.r2; rr++) {
        const row = rows[rr]
        const cells = row.getChildren()
        for (let cc = r.c1; cc <= r.c2 && cc < cells.length; cc++) {
          const cell = cells[cc]
          const kids = cell.getChildren()
          for (const k of kids) { k.remove() }
          const p = $createParagraphNode()
          cell.append(p)
        }
      }
    })
    if (menuRef.current) menuRef.current.style.display = 'none'
  }

  const doAddRow = () => {
    const { tIndex, ri } = readInfo()
    editor.update(() => {
      const tables = []
      const walk = (node) => { const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const table = tables[tIndex]
      if (!table) return
      const rows = table.getChildren()
      const cols = rows[0]?.getChildren().length || 1
      const row = $createTableRowNode()
      for (let i = 0; i < cols; i++) { const cell = $createTableCellNode(); cell.append($createParagraphNode()); row.append(cell) }
      table.insertAt(ri + 1, row)
    })
    if (menuRef.current) menuRef.current.style.display = 'none'
  }

  const doDelRow = () => {
    const { tIndex, ri } = readInfo()
    editor.update(() => {
      const tables = []
      const walk = (node) => { const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const table = tables[tIndex]
      if (!table) return
      const rows = table.getChildren()
      const row = rows[ri]
      if (row) row.remove()
    })
    if (menuRef.current) menuRef.current.style.display = 'none'
  }

  const doAddCol = () => {
    const { tIndex, ci } = readInfo()
    editor.update(() => {
      const tables = []
      const walk = (node) => { const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const table = tables[tIndex]
      if (!table) return
      const rows = table.getChildren()
      for (const r of rows) { const cell = $createTableCellNode(); cell.append($createParagraphNode()); r.insertAt(ci + 1, cell) }
    })
    if (menuRef.current) menuRef.current.style.display = 'none'
  }

  const addColForTable = (tIndex) => {
    editor.update(() => {
      const tables = []
      const walk = (node) => { const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const table = tables[tIndex]
      if (!table) return
      const rows = table.getChildren()
      const headerState = (() => { const first = rows[0]?.getChildren()?.[0]; try { return first?.getHeaderState?.() ?? 0 } catch { return 0 } })()
      rows.forEach((row, ri) => { const cell = $createTableCellNode(); cell.append($createParagraphNode()); try { if (ri === 0) cell.setHeaderState?.(headerState) } catch {}; row.append(cell) })
    })
  }

  const doDelCol = () => {
    const { tIndex, ci } = readInfo()
    editor.update(() => {
      const tables = []
      const walk = (node) => { const kids = node.getChildren(); for (const k of kids) { if (k instanceof TableNode) tables.push(k); walk(k) } }
      walk($getRoot())
      const table = tables[tIndex]
      if (!table) return
      const rows = table.getChildren()
      for (const r of rows) { const cells = r.getChildren(); const target = cells[ci]; if (target) target.remove() }
    })
    if (menuRef.current) menuRef.current.style.display = 'none'
  }

  const outlines = (() => {
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

  return (
    <div ref={overlayRef} className="table-selection-overlay" style={{ pointerEvents: 'none' }}>
      {outlines.map((b, i) => (
        <div key={i} className="table-selection-outline" style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h }} />
      ))}
      {addBtnPos && hoverTable !== null && (
        <button onClick={() => addColForTable(hoverTable)} className="table-add-col-btn" style={{ pointerEvents: 'auto', position: 'absolute', left: addBtnPos.x, top: addBtnPos.y, transform: 'translateY(-50%)' }}>+列</button>
      )}
    </div>
  )
}
