import React, { useId, useMemo } from 'react'
import { selectHistoryRecords } from '~/services/syncHistorySearch.mjs'
import { summarizeHistoryRecords } from '~/services/syncHistorySummary.mjs'
import './SyncHistorySummary.css'

// All matched records in the accepted file, never the 25-row displayed page.
// File declarations and current read state remain separate from this view.
export default function SyncHistoryFileSummary({ report, filters, phase, composing }) {
  const scopeID = useId()
  const summary = useMemo(() => {
    try { return summarizeHistoryRecords(selectHistoryRecords(report.records, filters).items) }
    catch { return null }
  }, [report, filters])
  const retained = phase !== 'ready'
  return <details className="sync-history-summary" data-history-file-summary>
    <summary aria-describedby={scopeID}>文件内匹配概览<span>全部匹配记录 · 不限当前页</span></summary>
    <div className="sync-history-summary-body">
      <p id={scopeID} data-file-summary-scope>{summary
        ? `统计本文件全部 ${summary.count} 条匹配记录，不是当前页、本机历史或同步成功率。`
        : '暂不能汇总文件记录，未生成部分统计。'}</p>
      {retained && <p data-file-summary-retained>正在读取、读取失败或已停止时，概览仍属于上一次成功读取的文件。</p>}
      {composing && <p data-file-summary-composing>输入法文字尚未确认，仍按原文件内查找条件统计。</p>}
      {summary && <>
        <h5>文件记载的处理结果（条）</h5>
        <dl className="sync-history-summary-counts" aria-label="离线文件匹配记录的处理结果">
          {summary.outcomes.map(group => <div key={group.key}><dt>{group.label}</dt><dd data-file-summary-outcome={group.key}>{group.count}</dd></div>)}
        </dl>
        <h5>对象类型（记录条数）</h5>
        <dl className="sync-history-summary-counts" aria-label="离线文件匹配记录的对象类型">
          {summary.kinds.map(group => <div key={group.key}><dt>{group.label}</dt><dd data-file-summary-kind={group.key}>{group.count}</dd></div>)}
        </dl>
        <h5>文件内已知处理或失效时间（UTC）</h5>
        {summary.times.known ? <dl className="sync-history-summary-times">
          <div><dt>最早</dt><dd><time data-file-summary-earliest dateTime={summary.times.earliestUTC}>{summary.times.earliestUTC}</time></dd></div>
          <div><dt>最近</dt><dd><time data-file-summary-latest dateTime={summary.times.latestUTC}>{summary.times.latestUTC}</time></dd></div>
        </dl> : <p data-file-summary-no-time>{summary.count ? '匹配记录的处理或失效时间全部缺失。' : '本文件当前没有匹配记录，无法给出时间范围。'}</p>}
        <p data-file-summary-coverage>有时间记录 {summary.times.known} 条，时间缺失 {summary.times.missing} 条；缺失值不参与范围计算。</p>
        <p>只统计记录条数，同一对象可以有多条记录。已失效不等于已解决；格式检查不证明文件来源或当前两端状态。</p>
      </>}
    </div>
  </details>
}
