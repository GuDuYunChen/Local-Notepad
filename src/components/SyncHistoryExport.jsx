import React, { useId, useState } from 'react'
import { HISTORY_EXPORT_LIMIT, prepareHistoryExport, requestHistoryDownload } from '~/services/syncHistoryExport.mjs'

export default function SyncHistoryExport({ snapshot, query, kind, outcome, phase, composing, matched }) {
  const hintID = useId(), reasonID = useId()
  const [feedback, setFeedback] = useState(null)
  const reason = !snapshot ? '请先读取历史记录。'
    : phase === 'loading' ? '正在读取；完成或停止读取后可导出。'
      : composing ? '请先完成输入法选字。'
        : !matched ? '当前没有匹配记录。'
          : matched > HISTORY_EXPORT_LIMIT ? `单次最多 ${HISTORY_EXPORT_LIMIT} 条，请缩小筛选范围。` : ''
  // An old action message must not describe a changed selection. No effect or
  // persistence is needed, and parent status refreshes do not repeat it.
  const message = feedback && feedback.snapshot === snapshot && feedback.query === query &&
    feedback.kind === kind && feedback.outcome === outcome && feedback.phase === phase &&
    feedback.composing === composing ? feedback.text : ''
  const download = () => {
    if (reason) return
    let prepared, text
    try { prepared = prepareHistoryExport({ snapshot, query, kind, outcome, phase, composing }) }
    catch (error) { text = error.message }
    if (prepared) {
      try {
        requestHistoryDownload(prepared)
        text = `已请求下载 ${prepared.count} 条记录；请在下载位置核对文件，尚未确认落盘。`
      } catch { text = '未能发起下载，记录和筛选未改变，请重试。' }
    }
    setFeedback({ snapshot, query, kind, outcome, phase, composing, text })
  }
  return <div className="sync-history-export" data-history-export>
    <p id={hintID} className="sync-conflict-history-note">导出 JSON 只含当前显示记录的标题、对象与记录标识、时间和处理结果，不含正文或查找词。可能包含私人标题，分享前请检查；不是笔记备份。</p>
    <button type="button" className="btn small" data-history-export-button aria-disabled={!!reason} aria-describedby={hintID + (reason ? ' ' + reasonID : '')}
      onClick={download}>导出当前显示记录（JSON）</button>
    {reason && <span id={reasonID} className="sync-history-export-reason" data-history-export-reason>{reason}</span>}
    <p className="sync-conflict-history-feedback" data-history-export-feedback role="status" aria-live="polite">{message}</p>
  </div>
}
