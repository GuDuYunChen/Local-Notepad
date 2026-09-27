import React, { useEffect, useMemo, useRef, useState } from 'react'
import SyncConflictReview from './SyncConflictReview'
import { indexConflictQueue, conflictQueuePage, CONFLICT_QUEUE_FILTERS } from '~/services/syncConflictQueue.mjs'
import { CONFLICT_RISK_FILTERS } from '~/services/syncConflictRisk.mjs'
import './SyncConflictQueue.css'

export default function SyncConflictQueue({ conflicts, scope, busy = false, disabled = false, onResolve, onRefresh }) {
  const [browse, setBrowse] = useState({ query: '', kind: 'all', risk: 'all', page: 1, epoch: 0 })
  const [submitting, setSubmitting] = useState(false)
  const alive = useRef(false), pending = useRef(false), heading = useRef(null), focusRequested = useRef(false)
  const model = useMemo(() => indexConflictQueue(conflicts), [conflicts])
  const view = useMemo(() => conflictQueuePage(model, browse), [model, browse])
  const locked = busy || submitting
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // Keep the actual clamped page, so a later refill does not silently jump back.
  useEffect(() => {
    if (browse.page !== view.page) setBrowse(old => ({ ...old, page: view.page }))
  }, [browse.page, view.page])
  useEffect(() => {
    if (!focusRequested.current) return
    focusRequested.current = false
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView?.({ block: 'nearest' })
  }, [browse.epoch])
  const change = (patch, focus = false) => {
    if (busy || pending.current) return
    focusRequested.current = focus
    // Explicit browsing always closes old reviews, even when an ID remains on
    // both pages/filters. Returning to the same filter never revives consent.
    setBrowse(old => ({ ...old, ...patch, epoch: old.epoch + 1 }))
  }
  const resolve = async (...args) => {
    if (pending.current || busy || disabled || !model.valid || typeof onResolve !== 'function') return false
    pending.current = true
    setSubmitting(true)
    try { return await onResolve(...args) } finally {
      pending.current = false
      if (alive.current) setSubmitting(false)
    }
  }
  return <section className="sync-conflict-list sync-conflict-queue" aria-label="冲突队列">
    <div className="sync-conflict-heading"><strong ref={heading} tabIndex={-1}>冲突中心</strong><span>不会自动覆盖，必须明确选择</span></div>
    <p className="sync-queue-hint">搜索两端名称或编号，不搜索正文。筛选、清空条件或翻页会收起对照并清除旧确认，不会处理冲突。</p>
    {!model.valid ? <p className="sync-queue-notice" role="alert">{model.message}</p> : <>
      <div className="sync-queue-tools">
        <label className="sync-queue-search">搜索冲突<input type="search" aria-label="搜索冲突" maxLength={256}
          placeholder="两端标题、附件名或编号" value={browse.query} disabled={locked}
          onChange={event => change({ query: event.target.value, page: 1 })}/></label>
        <label>对象类型<select aria-label="冲突对象类型" value={browse.kind} disabled={locked}
          onChange={event => change({ kind: event.target.value, page: 1 })}>
          {CONFLICT_QUEUE_FILTERS.map(([value, title]) => <option key={value} value={value}>{title}（{value === 'all' ? model.total : model.counts[value]}）</option>)}
        </select></label>
        <label>关注项<select aria-label="冲突关注项" value={browse.risk} disabled={locked}
          onChange={event => change({ risk: event.target.value, page: 1 })}>
          {CONFLICT_RISK_FILTERS.map(([value, title]) => <option key={value} value={value}>{title}（{value === 'all' ? model.total : model.riskCounts[value]}）</option>)}
        </select></label>
        <button type="button" className="btn small" disabled={locked || (!browse.query && browse.kind === 'all' && browse.risk === 'all')}
          onClick={() => change({ query: '', kind: 'all', risk: 'all', page: 1 })}>清空筛选</button>
      </div>
      <p className="sync-queue-count" role="status">匹配 {view.matched} / 当前列表 {view.total} 条 · 显示 {view.from}–{view.to}</p>
      <p className="sync-queue-hint">类型数量基于最近读取的完整列表，不随搜索条件变化；新记录需刷新状态。列表保留服务端顺序。</p>
      <p className="sync-queue-hint">删除与缺失标记仅描述两端快照，不代表将执行删除。各类关注项可能重叠，未标记不代表没有风险。</p>
      <div className="sync-queue-items">
        {view.rows.map(entry => <div className="sync-queue-row" key={`${browse.epoch}:${entry.id}`} data-conflict-id={entry.id}>
          <div className="sync-queue-identifiers"><span>{CONFLICT_QUEUE_FILTERS.find(([value]) => value === entry.kind)?.[1]}</span><bdi>对象：{entry.itemID}</bdi></div>
          {entry.risk.notices.length > 0 && <div className="sync-queue-risk" aria-label="删除与缺失提示">
            {entry.risk.notices.map(notice => <span key={notice.side} className={'sync-queue-risk-label is-' + notice.state}>{notice.label}</span>)}
          </div>}
          {entry.open ? <SyncConflictReview conflict={conflicts[entry.index]} scope={scope}
            disabled={disabled || busy || submitting} onResolve={resolve} onRefresh={onRefresh}/> :
            <div className="sync-queue-notice" role="status"><strong>{entry.localLabel} · {entry.remoteLabel}</strong><p>记录未确认处于待处理状态，请刷新后再对照；这里不会替你处理。</p></div>}
        </div>)}
        {!view.rows.length && <p className="sync-queue-empty" role="status">{model.total === 0
          ? '当前读取的列表中没有待处理冲突；这不代表两端已经完成同步。'
          : '没有匹配的冲突，不代表冲突已解决。请调整条件或清空筛选。'}</p>}
      </div>
      <nav className="sync-queue-pagination" aria-label="冲突列表分页">
        <button type="button" className="btn small" disabled={locked || view.page <= 1} onClick={() => change({ page: view.page - 1 }, true)}>上一页冲突</button>
        <span>第 {view.page} / {view.pages} 页</span>
        <button type="button" className="btn small" disabled={locked || view.page >= view.pages} onClick={() => change({ page: view.page + 1 }, true)}>下一页冲突</button>
      </nav>
    </>}
  </section>
}
