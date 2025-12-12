import React, { useMemo, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { INSERT_TABLE_COMMAND } from '@lexical/table'

export default function TableMenu() {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const grid = useMemo(() => Array.from({length:10}, (_,r)=>Array.from({length:10},(_,c)=>({r:r+1,c:c+1}))), [])
  const [hoverRect, setHoverRect] = useState(null)

  const onPick = (r,c) => {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: String(c), rows: String(r) })
    setOpen(false)
    setHoverRect(null)
  }

  const dispatch = (type, payload) => {
    window.dispatchEvent(new CustomEvent('tableAction', { detail: { type, payload } }))
    setOpen(false)
  }

  const setByEvent = (e) => {
    const box = ref.current
    if (!box) return null
    const host = box.getBoundingClientRect()
    const clientX = (e.touches ? e.touches[0].clientX : e.clientX)
    const clientY = (e.touches ? e.touches[0].clientY : e.clientY)
    const rows = Array.from(box.querySelectorAll('.tm-grid-row'))
    if (rows.length === 0) return null
    const cols = Array.from(rows[0].querySelectorAll('.tm-grid-cell'))
    let c = 1
    for (let i = 0; i < cols.length; i++) {
      const rct = cols[i].getBoundingClientRect()
      if (clientX <= rct.right) { c = i + 1; break }
      c = i + 1
    }
    let r = 1
    for (let i = 0; i < rows.length; i++) {
      const firstCell = rows[i].querySelector('.tm-grid-cell')
      const rct = firstCell.getBoundingClientRect()
      if (clientY <= rct.bottom) { r = i + 1; break }
      r = i + 1
    }
    c = Math.min(10, Math.max(1, c))
    r = Math.min(10, Math.max(1, r))
    return { r, c }
  }

  const onMove = (e) => { const p = setByEvent(e); if (!p) return; setHoverRect(p) }
  const overlayStyle = (() => {
    if (!hoverRect || !ref.current) return { display:'none' }
    const box = ref.current
    const host = box.getBoundingClientRect()
    const first = box.querySelector('.tm-grid-row .tm-grid-cell')
    const rows = Array.from(box.querySelectorAll('.tm-grid-row'))
    const lastCell = rows[hoverRect.r - 1]?.querySelectorAll('.tm-grid-cell')?.[hoverRect.c - 1]
    if (!first || !lastCell) return { display:'none' }
    const fr = first.getBoundingClientRect()
    const lr = lastCell.getBoundingClientRect()
    const left = fr.left - host.left
    const top = fr.top - host.top
    const w = lr.right - fr.left
    const h = lr.bottom - fr.top
    return { left, top, width: w, height: h }
  })()

  return (
    <div className="table-menu-host">
      <button className="btn" onClick={()=>setOpen(v=>!v)}>插入表格</button>
      {open && (
        <div className="table-menu">
          <div className="tm-title">插入表格</div>
          <div className="tm-grid" ref={ref} onMouseMove={onMove} onTouchMove={onMove}>
            <div className="tm-grid-overlay" style={overlayStyle} />
            {grid.map((row, ri) => (
              <div key={ri} className="tm-grid-row">
                {row.map((cell, ci) => (
                  <span key={ci} className="tm-grid-cell" onClick={()=>onPick(cell.r, cell.c)} />
                ))}
              </div>
            ))}
          </div>
          <div className="tm-divider" />
          <div className="tm-group">
            <div className="tm-item" onClick={()=>dispatch('mergeCells')}>合并单元格</div>
            <div className="tm-item" onClick={()=>dispatch('splitCells')}>拆分单元格</div>
            <div className="tm-item" onClick={()=>dispatch('alignVertical', 'top')}>顶对齐</div>
            <div className="tm-item" onClick={()=>dispatch('alignVertical', 'middle')}>居中对齐</div>
            <div className="tm-item" onClick={()=>dispatch('alignVertical', 'bottom')}>底对齐</div>
            <div className="tm-item" onClick={()=>dispatch('alignHorizontal', 'left')}>左对齐</div>
            <div className="tm-item" onClick={()=>dispatch('alignHorizontal', 'center')}>水平居中</div>
            <div className="tm-item" onClick={()=>dispatch('alignHorizontal', 'right')}>右对齐</div>
          </div>
          <div className="tm-group">
            <div className="tm-item" onClick={()=>dispatch('borderPreset','none')}>无边框</div>
            <div className="tm-item" onClick={()=>dispatch('borderPreset','thin')}>细边框</div>
            <div className="tm-item" onClick={()=>dispatch('borderPreset','bold')}>粗边框</div>
            <div className="tm-item" onClick={()=>dispatch('borderPreset','dashed')}>虚线边框</div>
            <div className="tm-item" onClick={()=>dispatch('background','#f2f3f5')}>背景：淡灰</div>
            <div className="tm-item" onClick={()=>dispatch('background','#fff3cd')}>背景：黄色</div>
          </div>
          <div className="tm-group">
            <div className="tm-item" onClick={()=>dispatch('autoFitWindow')}>适应窗口</div>
            <div className="tm-item" onClick={()=>dispatch('autoFitContent')}>适应内容</div>
          </div>
          <div className="tm-divider" />
          <div className="tm-group">
            <div className="tm-item" onClick={()=>dispatch('sortAsc')}>按首列升序排序</div>
            <div className="tm-item" onClick={()=>dispatch('sortDesc')}>按首列降序排序</div>
            <div className="tm-item" onClick={()=>{ const q = window.prompt('筛选包含文本：'); if (q) dispatch('filterContains', q) }}>筛选包含文本…</div>
            <div className="tm-item" onClick={()=>dispatch('paginate', 10)}>分页（每10行）</div>
          </div>
        </div>
      )}
    </div>
  )
}
