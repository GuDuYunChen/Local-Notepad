import React, { useEffect, useMemo, useState } from 'react'
import { SYNC_PLAN_FILTERS, syncPlanPage } from '~/services/syncPlanView.mjs'
import './SyncPlanPanel.css'

const timestamp = value => value === null ? '时间不可用' : new Date(value).toLocaleString('zh-CN', { hour12: false })

export default function SyncPlanPanel({ snapshot, onPreview, disabled = false }) {
  const [filter, setFilter] = useState('changes')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  // Invalidating the same snapshot preserves the user's current inspection.
  useEffect(() => { setPage(1) }, [snapshot?.items])
  const view = useMemo(() => syncPlanPage(snapshot, { filter, query, page }), [snapshot, filter, query, page])
  if (!snapshot) return null
  const historical = snapshot.source === 'run'
  const complete = snapshot.detailState === 'complete'
  const c = snapshot.counts
  return <section className="sync-plan-view" aria-label="同步计划详情">
    <div className="sync-plan-view-heading">
      <div><h4>最近同步计划</h4><span>{historical ? '执行时计划（历史）' : '预演快照（只读）'} · {timestamp(snapshot.capturedAt)}</span></div>
      <button type="button" className="btn small" disabled={disabled || typeof onPreview !== 'function'} onClick={() => onPreview()}>重新预演</button>
    </div>
    <p className="sync-plan-boundary">{historical
      ? '这是该次执行使用的计划，不是剩余任务或实际写入数量；执行结果以同步状态和冲突中心为准。'
      : '仅反映生成时读取的数据，不持续追踪两端变化；执行同步会重新计算，不保证按此快照执行。'}</p>
    {snapshot.stale && <p className="sync-plan-notice" role="status">此计划已失效：生成后观察到配置、状态或操作变化。旧结果仅供对照，请重新预演。</p>}
    {snapshot.detailState === 'invalid' && <p className="sync-plan-notice" role="alert">{snapshot.message}</p>}
    {snapshot.detailState !== 'invalid' && c && <>
      <p className="sync-plan-counts">上传 {c.uploads} · 下载 {c.downloads} · 冲突 {c.conflicts} · 无变化 {c.noops}</p>
      {snapshot.generation !== null && <small>计划读取的远端代次：{snapshot.generation}</small>}
      {snapshot.needsInit && <small>{historical ? '该次计划读取时，远端尚未初始化。' : '该次预演读取时远端尚未初始化；首次执行才会创建仓库身份。'}</small>}
    </>}
    {snapshot.detailState === 'unavailable' && <p className="sync-plan-notice" role="status">{snapshot.message}</p>}
    {complete && <>
      <div className="sync-plan-tools">
        <label>方向<select aria-label="同步计划方向" value={filter} onChange={event => { setFilter(event.target.value); setPage(1) }}>
          {SYNC_PLAN_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="sync-plan-search">搜索对象<input type="search" aria-label="同步计划搜索" maxLength={256} value={query}
          placeholder="对象编号或附件名称" onChange={event => { setQuery(event.target.value); setPage(1) }}/></label>
      </div>
      <p className="sync-plan-boundary">上传：本机 → 远端；下载：远端 → 本机；冲突：需要人工处理，不在这里选边。方向不代表新增、编辑或删除。笔记 / 文件夹仅显示编号，接口未提供标题和具体类型。</p>
      <p role="status">匹配 {view.matched} / 全部 {view.total} 个对象 · 显示 {view.from}–{view.to}</p>
      {view.rows.length > 0 ? <ul className="sync-plan-items" aria-label="同步计划明细">
        {view.rows.map(item => <li key={item.id}>
          <span className={'sync-plan-direction ' + (item.action === 'conflict' ? 'is-conflict' : '')}>{item.direction}</span>
          <div><small>{item.kind}</small><bdi className="sync-plan-object">{item.label}</bdi>
            {item.label !== item.id && <details><summary>查看对象编号</summary><code>{item.id}</code></details>}
          </div>
        </li>)}
      </ul> : <p className="sync-plan-empty">{view.total === 0 ? '该次计划未包含对象。'
        : view.filter === 'changes' && !query.trim() ? '该次计划没有变化或冲突；可切换“全部对象”查看无变化项。'
          : '没有匹配对象；请调整方向或搜索条件。这不代表整个计划为空。'}</p>}
      <nav className="sync-plan-pagination" aria-label="同步计划分页">
        <button type="button" className="btn small" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>上一页</button>
        <span>第 {view.page} / {view.pages} 页</span>
        <button type="button" className="btn small" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>下一页</button>
      </nav>
    </>}
  </section>
}
