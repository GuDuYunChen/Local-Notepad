import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { compareLocalOverviewReport, comparisonDelta, LOCAL_COMPARISON_NOTICE } from '../services/s3LocalOverviewComparison.mjs'

const labels = { file: '笔记与文件夹（含回收站）', tag: '标签', 'file-tag': '笔记与标签关联', attachment: '附件' }
export default function S3LocalOverviewComparison({ report, localSummary }) {
  const id = useId(), token = useMemo(() => ({}), [report, localSummary]), committed = useRef(null)
  const [selected, setSelected] = useState(null)
  useLayoutEffect(() => {
    committed.current = token; setSelected(null)
    return () => { if (committed.current === token) committed.current = null }
  }, [token])
  const view = selected?.token === token ? selected : null
  const compare = () => {
    if (committed.current !== token || !report || !localSummary) return
    try { setSelected({ token, data: compareLocalOverviewReport(report, localSummary) }) }
    catch { setSelected({ token, error: '比较依据无效，未显示部分差值。' }) }
  }
  const clear = () => { if (committed.current === token) setSelected(null) }
  const data = view?.data
  const rows = data ? [
    ['记录合计', data.records, '项'], ['规范记录容量', data.recordBytes, 'B'],
    ['附件正文容量', data.attachmentBytes, 'B'], ['共同基线条目', data.baseItems, '项'],
  ] : []
  return <section data-local-comparison aria-labelledby={`${id}-title`}>
    <h4 id={`${id}-title`}>与本次本地盘点比较</h4>
    <p id={`${id}-scope`} className="local-inventory-note">{LOCAL_COMPARISON_NOTICE} 比较不会重新读取任何文件或笔记。</p>
    <div className="local-inventory-actions">
      <button type="button" className="btn small" data-local-compare-start disabled={!report || !localSummary} aria-describedby={`${id}-scope`} onClick={compare}>比较已有统计</button>
      {view && <button type="button" className="btn small" data-local-compare-clear onClick={clear}>收起比较结果</button>}
    </div>
    <p role="status" aria-live="polite" aria-atomic="true" data-local-compare-state={data ? 'ready' : view?.error ? 'failed' : 'idle'}>
      {!localSummary ? '请先点击上方“读取本地统计”；这里不会自动扫描。' : view?.error || (data ? '已比较这两份已有统计。差值为 0 也不能证明正文或附件内容相同。' : '准备好后点击比较；文件或本地盘点结果变化后，需要重新确认。')}
    </p>
    {data && <div data-local-compare-result>
      <p className="local-inventory-note">报告声明的生成时间：{data.reportGeneratedAtUTC}（不是盘点时间）。另一侧是本页面最近一次成功的本地盘点；之后编辑可能改变数据。</p>
      <div className="local-inventory-table" role="region" aria-label="统计总量比较" tabIndex={0}>
        <table><caption>总量：本次本地盘点减去所选报告</caption>
          <thead><tr><th scope="col">指标</th><th scope="col">所选报告</th><th scope="col">本次本地盘点</th><th scope="col">差值</th></tr></thead>
          <tbody>{rows.map(([label, values, unit]) => <tr key={label}><th scope="row">{label}</th><td>{values.reference} {unit}</td><td>{values.local} {unit}</td><td>{comparisonDelta(values.delta)} {unit}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="local-inventory-table" role="region" aria-label="对象分类比较" tabIndex={0}>
        <table><caption>分类：正数表示本次盘点的统计值更大，负数表示更小</caption>
          <thead><tr><th scope="col">对象与指标</th><th scope="col">所选报告</th><th scope="col">本次本地盘点</th><th scope="col">差值</th></tr></thead>
          <tbody>{data.kinds.flatMap(row => [['数量', row.records, '项'], ['规范记录容量', row.recordBytes, 'B']].map(([metric, values, unit]) =>
            <tr key={`${row.kind}-${metric}`}><th scope="row">{labels[row.kind]} · {metric}</th><td>{values.reference} {unit}</td><td>{values.local} {unit}</td><td>{comparisonDelta(values.delta)} {unit}</td></tr>))}</tbody>
        </table>
      </div>
    </div>}
  </section>
}
