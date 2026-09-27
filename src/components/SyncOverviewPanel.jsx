import React, { useId, useState } from 'react'
import { buildSyncOverview } from '~/services/syncOverview.mjs'
import './SyncOverviewPanel.css'
import SyncHelpPanel from './SyncHelpPanel'

export default function SyncOverviewPanel({ onNavigate, ...input }) {
  const view = buildSyncOverview(input)
  const [failed, setFailed] = useState(false)
  const titleID = useId()
  const recommended = view.destinations.find(item => item.key === view.target)
  const navigate = key => {
    const destination = view.destinations.find(item => item.key === key)
    if (!destination?.available || typeof onNavigate !== 'function') return
    setFailed(onNavigate(key) !== true)
  }
  return <section className="sync-overview" data-sync-section="overview" tabIndex={-1} aria-labelledby={titleID}>
    <div className="sync-overview-heading">
      <div><p className="sync-overview-eyebrow">先看状态，再找操作</p><h4 id={titleID}>同步总览</h4></div>
      <span className="sync-overview-provider">{view.provider} · {view.automation}</span>
    </div>
    <div className={'sync-overview-status state-' + view.state}>
      <strong role="status">{view.title}</strong><p>{view.detail}</p>
      {view.recoveryNotice && <p className="sync-overview-warning">{view.recoveryNotice}</p>}
      <button type="button" className="btn small" disabled={!recommended?.available || typeof onNavigate !== 'function'}
        onClick={() => navigate(view.target)}>定位建议区域：{recommended?.label}</button>
    </div>
    <dl className="sync-overview-metrics">
      <div><dt>状态报告待处理</dt><dd>{view.reportedConflicts}</dd></div>
      <div><dt>已读取列表数量</dt><dd>{view.listedConflicts}</dd></div>
      <div className="sync-overview-time"><dt>最近确认成功 · UTC</dt><dd>{view.lastSuccess}</dd></div>
    </dl>
    <p className="sync-overview-note">状态依据：{view.readSource}。读取时间 UTC：{view.readAt}。总览随已读取字段更新，不保证远端实时状态。</p>
    <nav className="sync-overview-nav" aria-label="同步中心分区导航">
      {view.destinations.map(item => <button key={item.key} type="button" className="sync-overview-link"
        aria-label={'定位' + item.label} disabled={!item.available || typeof onNavigate !== 'function'}
        onClick={() => navigate(item.key)}>
        <strong>{item.label}<span aria-hidden="true"> →</span></strong>
        <span>{item.available ? item.detail : item.unavailableReason}</span>
      </button>)}
    </nav>
    <p className="sync-overview-note">导航只定位区域，不读取、不保存、不启用或执行同步；也不会清除草稿或代替冲突确认。</p>
    <SyncHelpPanel/>
    {failed && <p className="sync-overview-warning" role="status">该区域已变化或暂不可定位，请查看当前页面。没有执行其他操作。</p>}
  </section>
}
