import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

export default function S3OfflinePairExport({ output }) {
  const hint = useId(), token = useMemo(() => ({}), [output]), committed = useRef(null)
  const [feedback, setFeedback] = useState(null)
  useLayoutEffect(() => {
    committed.current = token; setFeedback(null)
    return () => { if (committed.current === token) committed.current = null }
  }, [token])
  const download = format => {
    if (committed.current !== token || !output) return
    try { output.download(format); setFeedback({ token, code: 'requested' }) }
    catch { setFeedback({ token, code: 'failed' }) }
  }
  const code = feedback?.token === token ? feedback.code : ''
  return <div data-offline-export>
    <p id={hint}>导出保留全部 12 项指标和双方原值，不重新读取文件。两侧均为文件声明统计，不是当前工作区；数值相同不代表内容相同。</p>
    <div className="local-inventory-actions">
      {['json', 'csv', 'html'].map(format => <button key={format} type="button" className="btn small" disabled={!output}
        aria-describedby={hint} data-offline-export-format={format} onClick={() => download(format)}>导出双报告比较（{format.toUpperCase()}）</button>)}
    </div>
    <p role="status" aria-live="polite" aria-atomic="true" data-offline-export-status={code}>
      {code === 'requested' ? '已请求下载，请核对下载文件；尚未确认落盘。' : code === 'failed' ? '未能发起完整报告下载；比较和原文件未改变。' : ''}
    </p>
  </div>
}
