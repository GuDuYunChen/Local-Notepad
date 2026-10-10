import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LOCAL_REPORT_NOTICE, localOverviewClipboard, requestLocalOverviewDownload } from '../services/s3LocalOverviewReport.mjs'

const messages = Object.freeze({
  copying: '正在等待剪贴板确认…', copied: '本次统计摘要已复制；不会重新读取本地数据。',
  'copy-busy': '上一次复制仍未结束，本次没有再次写入剪贴板。',
  'copy-timeout': '尚未收到复制确认，请检查剪贴板；超时不代表系统复制已经取消，不会自动重试。',
  'copy-unconfirmed': '未能确认复制，请检查剪贴板权限，或使用导出报告。',
  'invalid-report': '统计格式无效，未复制或导出部分报告。',
  'download-requested': '已请求下载 JSON 报告，请在下载位置核对文件；尚未确认落盘。',
  'download-failed': '未能发起报告下载，本地统计未改变。',
})

export default function S3LocalOverviewReport({ summary }) {
  const hint = useId(), scope = useMemo(() => ({}), [summary])
  const committed = useRef(null), action = useRef(null)
  const [feedback, setFeedback] = useState(null)
  useLayoutEffect(() => {
    committed.current = scope; action.current = null; setFeedback(null)
    return () => { if (committed.current === scope) committed.current = null }
  }, [scope])
  const code = feedback?.scope === scope ? feedback.code : ''
  const publish = (task, next) => {
    if (committed.current === scope && action.current === task) setFeedback({ scope, code: next })
  }
  const copy = () => {
    if (committed.current !== scope || !summary || action.current?.pending) return
    const task = { pending: true }; action.current = task; publish(task, 'copying')
    void localOverviewClipboard.copy(summary).then(result => {
      task.pending = false; publish(task, result.code)
    })
  }
  const download = () => {
    if (committed.current !== scope || !summary || action.current?.pending) return
    const task = {}; action.current = task
    try { requestLocalOverviewDownload(summary); publish(task, 'download-requested') }
    catch { publish(task, 'download-failed') }
  }
  return <div data-local-report>
    <p id={hint} className="local-inventory-note">{LOCAL_REPORT_NOTICE} 数量和容量也可能透露使用规模，分享前请检查。</p>
    <div className="local-inventory-actions">
      <button type="button" className="btn small" data-local-report-copy disabled={!summary || code === 'copying'} aria-describedby={hint} onClick={copy}>复制统计摘要</button>
      <button type="button" className="btn small" data-local-report-download disabled={!summary || code === 'copying'} aria-describedby={hint} onClick={download}>导出统计报告（JSON）</button>
    </div>
    <p role="status" aria-live="polite" aria-atomic="true" className="local-inventory-note" data-local-report-status={code}>{messages[code] || ''}</p>
  </div>
}
