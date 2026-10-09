import React, { useEffect, useId, useRef, useState } from 'react'
import './S3LocalOverviewFile.css'
import { LOCAL_REPORT_FILE_NOTICE, readLocalOverviewFile } from '../services/s3LocalOverviewFile.mjs'

const labels = { file: '笔记与文件夹（含回收站）', tag: '标签', 'file-tag': '笔记与标签关联', attachment: '附件' }
const initial = { state: 'idle', report: null, message: '选择已导出的统计 JSON 文件即可查看；不需要先读取当前工作区。' }
export default function S3LocalOverviewFile() {
  const id = useId(), active = useRef(null), input = useRef(null)
  const [view, setView] = useState(initial)
  const revoke = () => { const old = active.current; active.current = null; old?.abort() }
  useEffect(() => () => revoke(), [])
  const choose = event => {
    const file = event.target.files?.[0]
    if (!file) return // Cancelling the picker preserves the current file view.
    event.target.value = '' // Reselecting the same file is an explicit new read.
    revoke()
    const task = new AbortController(); active.current = task
    setView({ state: 'reading', report: null, message: '正在读取所选文件…' })
    void readLocalOverviewFile(file, { signal: task.signal }).then(report => {
      if (active.current === task) { active.current = null; setView({ state: 'ready', report, message: '文件格式与统计校验通过；来源和真实性未经验证。' }) }
    }, error => {
      if (active.current === task) { active.current = null; setView({ state: 'failed', report: null, message: error.message }) }
    })
  }
  const clear = () => { revoke(); if (input.current) input.current.value = ''; setView(initial) }
  const data = view.report?.summary
  return <details className="local-inventory-note" data-local-report-file>
    <summary>查看已导出的统计报告</summary>
    <p id={id}>{LOCAL_REPORT_FILE_NOTICE} 仅接受不超过 4 KiB 的 UTF-8 JSON v1 报告。</p>
    <div className="local-inventory-actions">
      <label>选择统计报告 <input ref={input} type="file" accept=".json,application/json" aria-describedby={id} aria-label="选择统计 JSON 报告" onChange={choose} /></label>
      <button type="button" className="btn small" onClick={clear} disabled={view.state === 'idle'}>{view.state === 'reading' ? '停止读取文件' : '清除文件视图'}</button>
    </div>
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
    </div>}
  </details>
}
