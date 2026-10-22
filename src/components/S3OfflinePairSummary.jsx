import React, { useId } from 'react'
import { summarizeOfflinePair } from '../services/s3OfflinePairSummary.mjs'

export default function S3OfflinePairSummary({ comparison }) {
  const id = useId()
  if (!comparison) return null
  let summary
  try { summary = summarizeOfflinePair(comparison) }
  catch { return <p role="status" data-offline-summary-invalid>比较概览依据不完整，未显示部分统计。</p> }
  return <section data-offline-summary aria-labelledby={`${id}-heading`}>
    <h4 id={`${id}-heading`}>完整比较概览 · 报告 B − A</h4>
    <dl className="local-inventory-totals" aria-label="全部 12 项指标的方向分布">
      {[['increase', '数值增加'], ['decrease', '数值减少'], ['unchanged', '数值未变']].map(([key, label]) =>
        <div key={key}><dt>{label}</dt><dd><span data-offline-summary-count={key}>{summary.all[key]}</span> 项指标</dd></div>)}
    </dl>
    <p data-offline-summary-group="counts">数量指标（6 项）：增加 {summary.counts.increase}，减少 {summary.counts.decrease}，未变 {summary.counts.unchanged}。</p>
    <p data-offline-summary-group="bytes">容量指标（6 项）：增加 {summary.bytes.increase}，减少 {summary.bytes.decrease}，未变 {summary.bytes.unchanged}。</p>
    <p className="local-inventory-note">概览始终基于全部 12 项指标，不随筛选变化。数量与容量分别计数，不代表变化的笔记数；数值相同不代表内容相同。</p>
  </section>
}
