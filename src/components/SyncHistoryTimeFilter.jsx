import React, { useEffect, useId, useRef, useState } from 'react'
import { HISTORY_TIME_ALL, describeHistoryTimeFilter, normalizeHistoryTimeFilter, sameHistoryTimeFilter } from '~/services/syncHistoryTime.mjs'
import './SyncHistoryTimeFilter.css'

export default function SyncHistoryTimeFilter({ value = HISTORY_TIME_ALL, onApply, resetVersion = 0, onDraftChange }) {
  const [draft, setDraft] = useState(value), [error, setError] = useState('')
  const start = useRef(null), end = useRef(null)
  const hintID = useId(), errorID = useId()
  // Global clear also resets an uncommitted draft when the applied value was
  // already "all". Do not remount the disclosure or move focus on local edits.
  useEffect(() => { setDraft(value); setError('') }, [resetVersion])
  useEffect(() => { onDraftChange?.(draft.mode !== 'all' || !!draft.from || !!draft.to) }, [draft, onDraftChange])
  const pending = !sameHistoryTimeFilter(draft, value)
  const edit = patch => { setDraft(previous => ({ ...previous, ...patch })); setError('') }
  const apply = () => {
    try {
      if (draft.mode === 'range' && [start.current, end.current].some(n => n && !n.validity.valid)) {
        throw new Error('请填写完整且有效的日期；当前筛选未改变。')
      }
      const next = normalizeHistoryTimeFilter(draft.mode === 'range'
        ? { mode: 'range', from: start.current.value, to: end.current.value } : draft)
      setDraft(next); setError(''); onApply(next)
    } catch (e) { setError(e.message) }
  }
  const enter = event => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); apply()
    }
  }
  return <div className="sync-history-time-filter" data-history-time-filter>
    <details data-history-time-controls>
      <summary>按处理日期筛选（UTC）</summary>
      <p id={hintID}>按处理或失效日期筛选，包含结束当日；单边日期可留空。仅作用于已读取记录，不使用创建时间代替。</p>
      <div className="sync-history-time-fields">
        <label>处理日期<select data-history-time-mode aria-label="处理日期筛选方式" value={draft.mode}
          onChange={event => edit({ mode: event.target.value, from: '', to: '' })}>
          <option value="all">全部处理日期</option><option value="range">指定日期范围</option><option value="missing">仅时间缺失</option>
        </select></label>
        {draft.mode === 'range' && <>
          <label>起始日期（UTC）<input ref={start} type="date" data-history-time-from aria-label="起始处理日期（UTC）"
            min="1970-01-01" max="9999-12-31" defaultValue={draft.from} aria-describedby={hintID + (error ? ' ' + errorID : '')}
            onChange={event => edit({ from: event.target.value })} onKeyDown={enter}/></label>
          <label>结束日期（UTC）<input ref={end} type="date" data-history-time-to aria-label="结束处理日期（UTC）"
            min="1970-01-01" max="9999-12-31" defaultValue={draft.to} aria-describedby={hintID + (error ? ' ' + errorID : '')}
            onChange={event => edit({ to: event.target.value })} onKeyDown={enter}/></label>
        </>}
        <button type="button" className="btn small" data-history-time-apply onClick={apply}>应用日期筛选</button>
      </div>
      {pending && <p data-history-time-pending>日期条件尚未应用；列表、概览和导出仍使用当前已应用条件。</p>}
      {error && <p id={errorID} role="alert" data-history-time-error>{error}</p>}
    </details>
    {value.mode !== 'all' && <p data-history-time-applied role="status" aria-live="polite">{describeHistoryTimeFilter(value)}</p>}
  </div>
}
