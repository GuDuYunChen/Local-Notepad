import React, { useEffect, useId, useRef, useState } from 'react'
import './S3LocalOverviewFile.css'
import { hasLocalReportFileDrag, selectLocalReportDrop, LOCAL_REPORT_DROP_MESSAGES } from '../services/s3LocalReportDrop.mjs'
import S3LocalOverviewComparison from './S3LocalOverviewComparison.jsx'
import { LOCAL_REPORT_FILE_NOTICE, readLocalOverviewFile } from '../services/s3LocalOverviewFile.mjs'

const labels = { file: '笔记与文件夹（含回收站）', tag: '标签', 'file-tag': '笔记与标签关联', attachment: '附件' }
const initial = { state: 'idle', report: null, message: '选择已导出的统计 JSON 文件即可查看；不需要先读取当前工作区。' }
export default function S3LocalOverviewFile({ currentSummary = null }) {
  const id = useId(), active = useRef(null), input = useRef(null)
  const [view, setView] = useState(initial)
  const [dropCode, setDropCode] = useState(''), [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const resetDrag = () => { dragDepth.current = 0; setDragging(false) }
  const revoke = () => { const old = active.current; active.current = null; old?.abort() }
  useEffect(() => () => revoke(), [])
  const openFile = file => {
    setDropCode(''); resetDrag()
    revoke()
    const task = new AbortController(); active.current = task
    setView({ state: 'reading', report: null, message: '正在读取所选文件…' })
    void readLocalOverviewFile(file, { signal: task.signal }).then(report => {
      if (active.current === task) { active.current = null; setView({ state: 'ready', report, message: '文件格式与统计校验通过；来源和真实性未经验证。' }) }
    }, error => {
      if (active.current === task) { active.current = null; setView({ state: 'failed', report: null, message: error.message }) }
    })
  }
  const choose = event => {
    const file = event.target.files?.[0]
    if (!file) return // Cancelling the picker preserves the current file view.
    event.target.value = '' // Reselecting the same file is an explicit new read.
    openFile(file)
  }
  // Stop bubbling BEFORE inspecting the payload so a rejected drop cannot
  // accidentally reach the application's ordinary note import handlers.
  const contain = event => { event.preventDefault(); event.stopPropagation() }
  const dragEnter = event => {
    contain(event)
    if (hasLocalReportFileDrag(event.dataTransfer)) { dragDepth.current++; setDragging(true) }
  }
  const dragOver = event => {
    contain(event)
    try { event.dataTransfer.dropEffect = hasLocalReportFileDrag(event.dataTransfer) ? 'copy' : 'none' } catch {}
  }
  const dragLeave = event => {
    contain(event)
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const drop = event => {
    contain(event); resetDrag()
    const selected = selectLocalReportDrop(event.dataTransfer)
    if (selected.file) { if (input.current) input.current.value = ''; openFile(selected.file) }
    else setDropCode(selected.code)
  }
  const clear = () => { revoke(); resetDrag(); setDropCode(''); if (input.current) input.current.value = ''; setView(initial) }
  const data = view.report?.summary
  return <details className="local-inventory-note" data-local-report-file>
    <summary>查看已导出的统计报告</summary>
    <p id={id}>{LOCAL_REPORT_FILE_NOTICE} 仅接受不超过 4 KiB 的 UTF-8 JSON v1 报告。</p>
    <div className="local-report-drop-zone" data-local-report-drop data-file-drag={dragging ? 'true' : 'false'}
      role="group" aria-labelledby={`${id}-drop-label`} onDragEnter={dragEnter} onDragOver={dragOver}
      onDragLeave={dragLeave} onDragEnd={resetDrag} onDrop={drop}>
      <p id={`${id}-drop-label`}><strong>{dragging ? '松开以查看这份报告' : '将单个统计 JSON 报告拖到这里'}</strong></p>
      <p>也可使用下方文件选择按钮。只查看统计，不导入笔记；仍按 4 KiB 上限完整校验。</p>
      <div className="local-inventory-actions">
        <label>选择统计报告 <input ref={input} type="file" accept=".json,application/json" aria-describedby={id} aria-label="选择统计 JSON 报告" onChange={choose} /></label>
        <button type="button" className="btn small" onClick={clear} disabled={view.state === 'idle' && !dropCode}>{view.state === 'reading' ? '停止读取文件' : '清除文件视图'}</button>
      </div>
    </div>
    <p role="status" aria-live="polite" aria-atomic="true" data-local-report-drop-status={dropCode}>{LOCAL_REPORT_DROP_MESSAGES[dropCode] || ''}</p>
    <p role="status" aria-live="polite" aria-atomic="true" data-local-file-state={view.state}>{view.message}</p>
    {data && <div data-local-file-result>
      <p>文件声明的生成时间（UTC）：<time>{view.report.generatedAtUTC}</time>，不是盘点完成时间。</p>
      <p>文件记录合计：{data.records}；规范记录：{data.record_bytes} B；附件正文：{data.attachment_bytes} B；共同基线：{data.base_items}。</p>
      <div className="local-inventory-table" role="region" aria-label="所选报告分类" tabIndex={0}>
        <table><caption>所选文件中的统计（不是当前工作区）</caption>
          <thead><tr><th scope="col">对象</th><th scope="col">数量</th><th scope="col">规范记录字节</th></tr></thead>
          <tbody>{data.kinds.map(row => <tr key={row.kind}><th scope="row">{labels[row.kind]}</th><td>{row.records}</td><td>{row.record_bytes} B</td></tr>)}</tbody>
        </table>
      </div>
      <S3LocalOverviewComparison report={view.report} localSummary={currentSummary} />
    </div>}
  </details>
}
