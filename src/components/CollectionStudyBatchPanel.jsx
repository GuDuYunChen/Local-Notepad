import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createCollectionStudyBatch } from '~/services/collectionStudyBatch'
import { MAX_STUDY_STATUS_BATCH, STUDY_STATUS_LABELS } from '~/services/collectionStudy'

export function useStudyBatch({ active, disabled, model, filters, hub, sourceStore, studyStore, onCommitted }) {
  const service = useMemo(() => createCollectionStudyBatch({ hub, sourceStore, studyStore }), [hub, sourceStore, studyStore])
  const [selected, setSelected] = useState(new Set())
  const [status, setStatus] = useState('revisit'), [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [result, setResult] = useState(null), [undoCount, setUndoCount] = useState(0)
  const operation = useRef(null), mounted = useRef(false)
  const current = useRef(null)
  // Page is deliberately absent: selection spans pages, but never silently spans new filters.
  const signature = JSON.stringify(filters)
  current.current = { active, disabled, model, signature, service }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort() } }, [])
  useEffect(() => { if (!active) operation.current?.abort() }, [active])
  useEffect(() => { setSelected(new Set()); setPreview(null) }, [model, signature, active])
  useEffect(() => { if (disabled) setPreview(null) }, [disabled])

  const setKeys = next => {
    if (busy || disabled) return
    if (next.size > MAX_STUDY_STATUS_BATCH) { setNotice('每次最多选择 200 条；未截断选择，请分批处理。'); return }
    setSelected(next); setPreview(null); setNotice('')
  }
  const toggle = key => { const next = new Set(selected); next.has(key) ? next.delete(key) : next.add(key); setKeys(next) }
  const run = async (kind, action) => {
    if (operation.current || !current.current.active) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setNotice('')
    const options = { signal: controller.signal, isCurrent: () => mounted.current && current.current.active &&
      operation.current === controller && current.current.service === service &&
      (kind !== 'prepare' || (!current.current.disabled && current.current.model === model && current.current.signature === signature)) }
    try { await action(options) }
    catch (failure) { if (mounted.current) setNotice(failure.message || '操作未完成，原记录与草稿保留') }
    finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false) } }
  }
  const refreshAfterWrite = count => {
    if (count && mounted.current && current.current.active) {
      // Refresh failure must not turn a committed write into a reported failure.
      try { Promise.resolve(onCommitted?.()).catch(() => {}) } catch { /* refresh remains available */ }
    }
  }
  return {
    selected, status, preview, busy, notice, result, undoCount, toggle,
    selectPage: rows => setKeys(new Set([...selected, ...rows.map(row => row.key)])),
    clear: () => { if (!busy) { setSelected(new Set()); setPreview(null); setNotice('') } },
    setStatus: value => { if (!busy) { setStatus(value); setPreview(null) } },
    cancelPreview: () => setPreview(null),
    cancel: () => { operation.current?.abort(); setNotice('正在停止后续处理；已完成的标记会保留，可在本轮撤销。') },
    prepare: () => {
      if (disabled || !selected.size || undoCount) return
      return run('prepare', async options => {
        const next = await service.prepare(model, [...selected], status, options)
        if (options.isCurrent() && !options.signal.aborted) setPreview(next)
      })
    },
    apply: () => {
      if (!preview || disabled) return
      return run('apply', async options => {
        const next = await service.apply(preview, options)
        if (mounted.current) {
          setPreview(null); setResult(next); setUndoCount(next.changed)
          setNotice(`已修改 ${next.changed} 条，原状态相同 ${next.unchanged} 条，尚未修改 ${next.remaining} 条。${next.failures.join('；')}`)
        }
        refreshAfterWrite(next.changed)
      })
    },
    undo: () => {
      if (!result || !undoCount) return
      return run('undo', async options => {
        const next = await service.undo(result, options)
        if (mounted.current) {
          setUndoCount(next.remaining)
          setNotice(`本次已撤销 ${next.restored} 条，未撤销 ${next.remaining} 条。` +
            next.failures.map(item => `${item.name}（${item.count} 条）：${item.reason}`).join('；'))
        }
        refreshAfterWrite(next.restored)
      })
    },
    finish: () => { if (!busy) { setResult(null); setUndoCount(0); setNotice('本轮标记已保留，撤销记录已结束。') } },
  }
}

export default function CollectionStudyBatchPanel({ batch, disabled, rows }) {
  return <section className="study-hub-batch" aria-label="批量阅读标记">
    <header><h4>批量整理阅读状态</h4><p>跨页选择，先预检后确认。只改人工状态，保留批注文字和书签；不改正文。</p></header>
    <div className="study-hub-actions">
      <button type="button" disabled={disabled || batch.busy || !rows.length} onClick={() => batch.selectPage(rows)}>选择本页批注</button>
      <button type="button" disabled={batch.busy || !batch.selected.size} onClick={batch.clear}>清空批量选择</button>
      <strong role="status">已选 {batch.selected.size} / 200 条</strong>
      <label>标记为 <select aria-label="批量阅读目标状态" value={batch.status} disabled={batch.busy} onChange={e => batch.setStatus(e.target.value)}>
        {Object.entries(STUDY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button type="button" disabled={disabled || batch.busy || !batch.selected.size || !!batch.undoCount} onClick={batch.prepare}>预检批量标记</button>
      {batch.busy && <button type="button" onClick={batch.cancel}>停止批量处理</button>}
    </div>
    {batch.notice && <p className="study-hub-notice" role="status" aria-live="polite">{batch.notice}</p>}
    {batch.preview && <div className="study-hub-batch-preview" role="region" aria-label="批量标记预检">
      <p>已选 {batch.preview.total} 条，来自 {batch.preview.collectionCount} 份资料集：将把 {batch.preview.changed} 条改为“{batch.preview.label}”，另 {batch.preview.unchanged} 条状态相同、不写入。</p>
      <details><summary>查看全部所选条目（{batch.preview.total}）</summary><ol>
        {batch.preview.items.map(item => <li key={item.key}><strong>{item.title || '未命名'}</strong> · {item.collectionName}（{item.collectionId}） · {item.id}：{STUDY_STATUS_LABELS[item.previousStatus]} → {STUDY_STATUS_LABELS[item.status]}</li>)}
      </ol></details>
      <p>按资料集逐份保存，不是整批事务。失败或停止时保留已成功项；本轮可撤销，但后续已修改的资料集不会被覆盖。</p>
      <div className="study-hub-actions"><button type="button" disabled={disabled || batch.busy || !batch.preview.changed} onClick={batch.apply}>确认批量标记</button>
        <button type="button" disabled={batch.busy} onClick={batch.cancelPreview}>取消批量预检</button></div>
    </div>}
    {batch.result && <div className="study-hub-actions" aria-label="本轮标记结果">
      <span>本轮可尝试撤销 {batch.undoCount} 条</span>
      <button type="button" disabled={batch.busy || !batch.undoCount} onClick={batch.undo}>撤销本轮标记</button>
      <button type="button" disabled={batch.busy} onClick={batch.finish}>结束本轮并保留当前状态</button>
    </div>}
    <p className="study-hub-caption">翻页保留选择；更换筛选、刷新或切换页签会清空选择。撤销记录仅在本次检索窗口内保留，关闭后不再可用。未保存批注草稿不参与批量标记。</p>
  </section>
}
