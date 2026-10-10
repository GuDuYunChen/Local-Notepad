import React, { useId, useLayoutEffect, useRef, useState } from 'react'
import { readLocalOverviewFile } from '../services/s3LocalOverviewFile.mjs'
import { OFFLINE_PAIR_NOTICE } from '../services/s3OfflineReportPair.mjs'
import { comparisonDelta } from '../services/s3LocalOverviewComparison.mjs'
import './S3OfflineReportPair.css'
import { createOfflinePairExport } from '../services/s3OfflinePairExport.mjs'
import S3OfflinePairExport from './S3OfflinePairExport.jsx'

const idle = () => ({ state: 'idle', report: null, message: '尚未选择报告。' })
const initial = () => ({ a: idle(), b: idle(), comparison: null, error: '' })
export default function S3OfflineReportPair() {
  const id = useId(), [view, setView] = useState(initial)
  const model = useRef(view), owner = useRef(null), tasks = useRef({ a: null, b: null })
  const inputs = useRef({ a: null, b: null })
  const publish = next => { model.current = next; setView(next) }
  const revoke = side => { const old = tasks.current[side]; tasks.current[side] = null; old?.controller.abort() }
  useLayoutEffect(() => {
    const lease = {}; owner.current = lease
    return () => { owner.current = null; revoke('a'); revoke('b') }
  }, [])
  const clear = side => {
    if (!owner.current) return
    revoke(side); if (inputs.current[side]) inputs.current[side].value = ''
    publish({ ...model.current, [side]: idle(), comparison: null, error: '' })
  }
  const reset = () => {
    if (!owner.current) return
    revoke('a'); revoke('b')
    for (const input of Object.values(inputs.current)) if (input) input.value = ''
    publish(initial())
  }
  const choose = (side, event) => {
    const files = event.target.files
    if (!owner.current || !files?.length) return // Picker cancellation keeps the view.
    const count = files.length, file = count === 1 ? files[0] : null
    event.target.value = '' // Capture the file before clearing the native input.
    if (count !== 1) { publish({ ...model.current, error: '每侧只能选择一份报告；现有选择未改变。' }); return }
    revoke(side)
    const task = { controller: new AbortController(), owner: owner.current }; tasks.current[side] = task
    publish({ ...model.current, [side]: { state: 'reading', report: null, message: '正在读取并完整校验…' }, comparison: null, error: '' })
    const finish = next => {
      if (owner.current !== task.owner || tasks.current[side] !== task) return
      tasks.current[side] = null
      publish({ ...model.current, [side]: next, comparison: null, error: '' })
    }
    void readLocalOverviewFile(file, { signal: task.controller.signal }).then(
      report => finish({ state: 'ready', report, message: '文件统计已校验；来源未经验证。' }),
      () => finish({ state: 'failed', report: null, message: '读取未完成或报告无效。仅接受不超过 4 KiB 的 UTF-8 JSON v1；没有采用部分数据，请重新选择。' }),
    )
  }
  const ready = view.a.state === 'ready' && view.b.state === 'ready'
  const compare = () => {
    const current = model.current
    if (!owner.current || current.a.state !== 'ready' || current.b.state !== 'ready') return
    try { publish({ ...current, comparison: createOfflinePairExport(current.a.report, current.b.report), error: '' }) }
    catch { publish({ ...current, comparison: null, error: '报告依据无效，未显示部分比较。' }) }
  }
  const swap = () => {
    const current = model.current
    if (!owner.current || current.a.state !== 'ready' || current.b.state !== 'ready') return
    publish({ a: current.b, b: current.a, comparison: null, error: '' })
  }
  const containDrag = event => { event.preventDefault(); event.stopPropagation() }
  const refuseDrop = event => { containDrag(event); if (owner.current) publish({ ...model.current, error: '请使用各侧的文件选择按钮；本区域不接收拖放，现有选择未改变。' }) }
  const result = view.comparison?.comparison
  return <details className="local-inventory-note offline-report-pair" data-offline-pair onDragEnter={containDrag} onDragOver={containDrag} onDrop={refuseDrop} onToggle={event => { if (!event.currentTarget.open) reset() }}>
    <summary>比较两份离线统计报告</summary>
    <p id={`${id}-notice`}>{OFFLINE_PAIR_NOTICE} 无需读取本地统计。关闭此面板会清空本次选择。</p>
    <div className="offline-pair-inputs">
      {['a', 'b'].map(side => <fieldset key={side} data-offline-side={side}>
        <legend>报告 {side.toUpperCase()}</legend>
        <label htmlFor={`${id}-${side}`}>选择报告 {side.toUpperCase()}（JSON，最多 4 KiB）</label>
        <input id={`${id}-${side}`} ref={node => { inputs.current[side] = node }} type="file" accept=".json,application/json"
          aria-describedby={`${id}-notice ${id}-${side}-state`} onChange={event => choose(side, event)} />
        <p id={`${id}-${side}-state`} role="status" aria-live="polite" data-offline-state={view[side].state}>{view[side].message}</p>
        {view[side].report && <p>文件声明生成时间（UTC）：<time>{view[side].report.generatedAtUTC}</time>，不是读取完成时间。</p>}
        <button type="button" className="btn small" disabled={view[side].state === 'idle'} onClick={() => clear(side)}>
          {view[side].state === 'reading' ? '停止读取' : '清除'}报告 {side.toUpperCase()}</button>
      </fieldset>)}
    </div>
    <div className="local-inventory-actions">
      <button type="button" className="btn" data-offline-compare disabled={!ready} onClick={compare}>比较报告 B − A</button>
      <button type="button" className="btn small" data-offline-swap disabled={!ready} onClick={swap}>交换 A / B</button>
      <button type="button" className="btn small" data-offline-reset onClick={reset}>清空两份报告</button>
    </div>
    <p role="status" aria-live="polite" data-offline-feedback>{view.error || (result ? `${result.changed} / 12 项指标有差异；这不是变化的笔记数。` : '两份文件都校验通过后，点击比较；不会自动比较或扫描。')}</p>
    {result && <div className="local-inventory-table" role="region" aria-label="两份离线报告比较" tabIndex={0} data-offline-result>
      <table><caption>完整统计比较 · 报告 B − 报告 A</caption>
        <thead><tr><th scope="col">指标</th><th scope="col">报告 A</th><th scope="col">报告 B</th><th scope="col">差值 B − A</th><th scope="col">单位</th></tr></thead>
        <tbody>{result.rows.map(row => <tr key={row.key} data-offline-metric={row.key}>
          <th scope="row">{row.label}</th><td>{row.a}</td><td>{row.b}</td><td>{comparisonDelta(row.delta)}</td><td>{row.unit}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {result && <S3OfflinePairExport output={view.comparison} />}
  </details>
}
