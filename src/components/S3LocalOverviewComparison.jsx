import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { comparisonDelta, LOCAL_COMPARISON_NOTICE } from '../services/s3LocalOverviewComparison.mjs'

import { createLocalComparisonExport, COMPARISON_EXPORT_NOTICE } from '../services/s3LocalComparisonExport.mjs'
export default function S3LocalOverviewComparison({ report, localSummary }) {
  const id = useId(), token = useMemo(() => ({}), [report, localSummary]), committed = useRef(null)
  const [selected, setSelected] = useState(null)
  const activeOutput = useRef(null)
  useLayoutEffect(() => {
    committed.current = token; activeOutput.current = null; setSelected(null)
    return () => { if (committed.current === token) { committed.current = null; activeOutput.current = null } }
  }, [token])
  const view = selected?.token === token ? selected : null
  const compare = () => {
    if (committed.current !== token || !report || !localSummary) return
    try {
      const output = createLocalComparisonExport(report, localSummary)
      activeOutput.current = output
      setSelected({ token, display: output.display, output, differencesOnly: false })
    }
    catch { activeOutput.current = null; setSelected({ token, error: '比较依据无效，未显示部分差值。' }) }
  }
  const clear = () => { if (committed.current === token) { activeOutput.current = null; setSelected(null) } }
  const display = view?.display, data = display?.comparison
  const differencesOnly = view?.differencesOnly === true
  const rows = display ? (differencesOnly ? display.changedTotals : display.totals) : []
  const categories = display ? (differencesOnly ? display.changedCategories : display.categories) : []
  const toggleDifferences = () => {
    if (committed.current !== token) return
    setSelected(current => current?.token === token && current.display
      ? { ...current, differencesOnly: !current.differencesOnly } : current)
  }
  const exportComparison = format => {
    if (committed.current !== token || !view?.output || activeOutput.current !== view.output) return
    const output = view.output
    let feedback
    try { output.download(format); feedback = '已请求下载完整比较报告，请核对下载位置；尚未确认落盘。' }
    catch { feedback = '未能发起比较报告下载，当前比较结果没有改变。' }
    setSelected(current => current?.token === token && current.output === output
      ? { ...current, exportFeedback: feedback } : current)
  }
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
      <div className="local-inventory-actions">
        <button type="button" className="btn small" data-local-compare-differences aria-pressed={differencesOnly}
          aria-describedby={`${id}-metrics`} onClick={toggleDifferences}>仅看有差异的指标</button>
      </div>
      <p id={`${id}-metrics`} role="status" aria-live="polite" aria-atomic="true" className="local-inventory-note" data-local-compare-metrics>
        共 {display.metricCount} 个统计指标，{display.changedCount} 个数值不同。{differencesOnly ? '当前仅显示有差异的指标。' : '当前显示全部指标。'} 指标个数不是发生变化的笔记数量。
      </p>
      {differencesOnly && display.changedCount === 0 && <p className="local-inventory-note" data-local-compare-empty>
        这 {display.metricCount} 个统计指标的数值相同；这不代表笔记或附件内容相同。关闭“仅看有差异的指标”可查看两侧原值。
      </p>}
      {rows.length > 0 && <div className="local-inventory-table" role="region" aria-label="统计总量比较" tabIndex={0}>
        <table><caption>总量：本次本地盘点减去所选报告</caption>
          <thead><tr><th scope="col">指标</th><th scope="col">所选报告</th><th scope="col">本次本地盘点</th><th scope="col">差值</th></tr></thead>
          <tbody>{rows.map(({ id: key, label, values, unit }) => <tr key={key}><th scope="row">{label}</th><td>{values.reference} {unit}</td><td>{values.local} {unit}</td><td>{comparisonDelta(values.delta)} {unit}</td></tr>)}</tbody>
        </table>
      </div>}
      {categories.length > 0 && <div className="local-inventory-table" role="region" aria-label="对象分类比较" tabIndex={0}>
        <table><caption>分类：正数表示本次盘点的统计值更大，负数表示更小</caption>
          <thead><tr><th scope="col">对象与指标</th><th scope="col">所选报告</th><th scope="col">本次本地盘点</th><th scope="col">差值</th></tr></thead>
          <tbody>{categories.map(({ id: key, label, values, unit }) =>
            <tr key={key}><th scope="row">{label}</th><td>{values.reference} {unit}</td><td>{values.local} {unit}</td><td>{comparisonDelta(values.delta)} {unit}</td></tr>)}</tbody>
        </table>
      </div>}
      <div data-local-compare-export-panel>
        <p id={`${id}-export-scope`} className="local-inventory-note">{COMPARISON_EXPORT_NOTICE} 导出始终包含全部 12 项指标及双方原值，不受“仅看有差异的指标”影响。HTML 文件可离线阅读，并使用浏览器打印。</p>
        <div className="local-inventory-actions">
          <button type="button" className="btn small" data-local-compare-export="json" aria-describedby={`${id}-export-scope`} onClick={() => exportComparison('json')}>导出完整比较（JSON）</button>
          <button type="button" className="btn small" data-local-compare-export="csv" aria-describedby={`${id}-export-scope`} onClick={() => exportComparison('csv')}>导出完整比较（CSV）</button>
          <button type="button" className="btn small" data-local-compare-export="html" aria-describedby={`${id}-export-scope`} onClick={() => exportComparison('html')}>导出完整比较（HTML）</button>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="local-inventory-note" data-local-compare-export-status>{view.exportFeedback || ''}</p>
      </div>
    </div>}
  </section>
}
