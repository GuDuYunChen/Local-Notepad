import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import useS3LocalOverview from '../hooks/useS3LocalOverview.js'
import S3LocalOverviewReport from './S3LocalOverviewReport.jsx'
import './S3LocalOverviewPanel.css'

const labels = { file: '笔记与文件夹（含回收站）', tag: '标签', 'file-tag': '笔记与标签关联', attachment: '附件' }
const bytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1048576).toFixed(1)} MiB`
export default function S3LocalOverviewPanel({ revision = 0, disabled = false }) {
  const { result, read, invalidate } = useS3LocalOverview(revision)
  const id = useId(), token = useMemo(() => ({}), [revision, disabled])
  const committed = useRef(null), [notice, setNotice] = useState('')
  useLayoutEffect(() => {
    committed.current = token; invalidate(); setNotice('')
    return () => { if (committed.current === token) committed.current = null }
  }, [token, invalidate])
  const pending = result.state === 'pending'
  const summary = !disabled && result.state === 'ready' ? result.summary : null
  const start = () => {
    if (committed.current !== token || disabled || pending) return
    setNotice('')
    void read({ readOnly: true }).then(out => {
      if (committed.current === token && out.code === 'session-busy') setNotice('上一次读取仍在收尾；本次没有再次读取，请稍后手动重试。')
    })
  }
  const stop = () => { if (committed.current === token) { invalidate(); setNotice('') } }
  return <section className="settings-card consumer-settings-section local-inventory" aria-labelledby={`${id}-heading`} data-local-inventory>
    <header className="local-inventory-header">
      <div><h3 id={`${id}-heading`}>本地只读盘点</h3><p>查看本次笔记、标签与附件的数量及容量。</p></div>
      <span className="settings-status-pill neutral">不上传 · 不改写</span>
    </header>
    <p id={`${id}-boundary`} className="local-inventory-note">{result.limitation}</p>
    <div className="local-inventory-actions">
      <button type="button" className="btn" disabled={disabled || pending} onClick={start} aria-describedby={`${id}-boundary`}>
        {pending ? '正在读取…' : summary ? '重新读取统计' : '读取本地统计'}
      </button>
      {pending && <button type="button" className="btn" onClick={stop}>停止采用本次结果</button>}
    </div>
    <div role="status" aria-live="polite" aria-atomic="true" className="local-inventory-status">
      <strong>{disabled ? '当前上下文不可读取' : summary ? '本次盘点已完成' : pending ? '正在进行本地只读盘点' : '本地统计尚未就绪'}</strong>
      <p>{notice || result.message}</p>
      {result.code === 'local-overview-not-available' && <p>数据可能正在变化、包含不支持的名称，或超过本次读取上限。没有采用部分统计；请停止编辑后手动重试或检查下方范围说明。</p>}
    </div>
    {summary && <>
      <dl className="local-inventory-totals" aria-label="本次本地统计">
        <div><dt>记录合计</dt><dd>{summary.records}</dd></div>
        <div><dt>规范记录数据</dt><dd>{bytes(summary.record_bytes)}</dd></div>
        <div><dt>附件正文容量</dt><dd>{bytes(summary.attachment_bytes)}</dd></div>
      </dl>
      <div className="local-inventory-table" role="region" aria-label="分类统计" tabIndex={0}>
        <table><caption>本次读取的对象分类</caption>
          <thead><tr><th scope="col">对象</th><th scope="col">数量</th><th scope="col">规范记录容量</th></tr></thead>
          <tbody>{summary.kinds.map(row => <tr key={row.kind}><th scope="row">{labels[row.kind]}</th><td>{row.records}</td><td>{bytes(row.record_bytes)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="local-inventory-note">已有共同基线条目：{summary.base_items}。容量为同步规范记录或附件正文大小，不是数据库文件大小；读取后继续编辑会改变数据。</p>
      <S3LocalOverviewReport summary={summary} />
    </>}
    <details className="local-inventory-note"><summary>读取范围与上限</summary>
      <p>每次最多读取 128 条数据库记录（笔记、文件夹、标签及关联合计）、128 个附件与 128 个共同基线条目；单条规范记录最多 256 KiB，规范记录合计最多 2 MiB，单附件最多 32 MiB、附件合计最多 64 MiB。超限会整次拒绝，不截取部分结果。</p>
      <p>只在明确点击后读取当前桌面工作区。停止采用结果不代表磁盘读取已经结束；这里不会比较远端、执行同步或替你选择冲突版本。开发环境或未由桌面管理的后端不会获得读取授权。</p>
    </details>
  </section>
}
