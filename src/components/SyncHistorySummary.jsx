import React, { useId, useMemo } from 'react'
import { summarizeHistoryRecords } from '~/services/syncHistorySummary.mjs'
import './SyncHistorySummary.css'

export default function SyncHistorySummary({ rows, phase, hasMore, composing }) {
  const scopeID = useId()
  const summary = useMemo(() => {
    try { return summarizeHistoryRecords(rows) }
    catch { return null }
  }, [rows])
  const provenance = phase === 'loading' ? '正在读取，概览仍基于此前读取的记录。'
    : phase === 'error' ? '最近读取失败，概览基于上次读取结果，不代表当前状态。'
      : phase === 'stopped' ? '最近读取已停止，概览仅包含此前读取的记录。' : ''
  return <details className="sync-history-summary" data-history-summary>
    <summary aria-describedby={scopeID}>当前结果概览<span>处理结果 · 对象类型 · 时间范围</span></summary>
    <div className="sync-history-summary-body">
      <p id={scopeID} data-history-summary-scope>{summary
        ? `仅统计当前显示的 ${summary.count} 条记录，不是全部历史、同步次数或成功率。`
        : '暂不能汇总这些记录；未生成部分统计，原记录仍可查看。'}</p>
      {provenance && <p data-history-summary-provenance>{provenance}</p>}
      {composing && <p data-history-summary-composition>输入法文字尚未确认，概览仍按原查找条件统计。</p>}
      {hasMore && <p data-history-summary-unread>尚有更早记录未读取，未计入此概览。</p>}
      {summary && <>
        <h5>当时的处理结果（条）</h5>
        <dl className="sync-history-summary-counts" aria-label="当前显示记录的历史处理结果">
          {summary.outcomes.map(group => <div key={group.key}><dt>{group.label}</dt><dd data-history-summary-outcome={group.key}>{group.count}</dd></div>)}
        </dl>
        <h5>对象类型（记录条数）</h5>
        <dl className="sync-history-summary-counts" aria-label="当前显示记录的对象类型">
          {summary.kinds.map(group => <div key={group.key}><dt>{group.label}</dt><dd data-history-summary-kind={group.key}>{group.count}</dd></div>)}
        </dl>
        <h5>已知处理或失效时间（UTC）</h5>
        {summary.times.known ? <dl className="sync-history-summary-times">
          <div><dt>最早</dt><dd><time data-history-summary-earliest dateTime={summary.times.earliestUTC}>{summary.times.earliestUTC}</time></dd></div>
          <div><dt>最近</dt><dd><time data-history-summary-latest dateTime={summary.times.latestUTC}>{summary.times.latestUTC}</time></dd></div>
        </dl> : <p data-history-summary-no-time>{summary.count ? '当前记录没有已知的处理或失效时间。' : '当前没有匹配的已读取记录，无法给出时间范围。'}</p>}
        <p data-history-summary-time-coverage>有时间记录 {summary.times.known} 条，时间缺失 {summary.times.missing} 条；缺失时间不参与范围计算。</p>
        <p>“已失效”不等于“已解决”；历史选边不保证现在仍是该版本，也不证明当前两端一致。同一对象的多条处理记录分别计数。</p>
      </>}
    </div>
  </details>
}
