import React, { useId, useRef, useState } from 'react'
import { buildSyncOverview } from '~/services/syncOverview.mjs'
import './SyncOverviewPanel.css'
import SyncHelpPanel from './SyncHelpPanel'
import { syncHelpRecommendation, focusSyncHelpTopic } from '~/services/syncHelpNavigation.mjs'
import './SyncHelpNavigation.css'
import { focusSyncCurrentGuidance } from '~/services/syncHelpReturn.mjs'
import './SyncHelpReturn.css'
import SyncOverviewTimes from './SyncOverviewTimes'

export default function SyncOverviewPanel({ onNavigate, ...input }) {
  const root = useRef(null)
  const view = buildSyncOverview(input)
  const help = syncHelpRecommendation(view.state)
  const [helpFailed, setHelpFailed] = useState(false)
  const [failed, setFailed] = useState(false)
  const titleID = useId()
  const guidanceTitleID = useId()
  const [returnFailed, setReturnFailed] = useState(false)
  const recommended = view.destinations.find(item => item.key === view.target)
  const navigate = key => {
    const destination = view.destinations.find(item => item.key === key)
    if (!destination?.available || typeof onNavigate !== 'function') return
    setFailed(onNavigate(key) !== true)
  }
  return <section ref={root} className="sync-overview" data-sync-section="overview" tabIndex={-1} aria-labelledby={titleID}>
    <div className="sync-overview-heading">
      <div><p className="sync-overview-eyebrow">先看状态，再找操作</p><h4 id={titleID}>同步总览</h4></div>
      <span className="sync-overview-provider">{view.provider} · {view.automation}</span>
    </div>
    <div className={'sync-overview-status state-' + view.state} data-sync-guidance tabIndex={-1} role="region" aria-labelledby={guidanceTitleID}>
      <strong id={guidanceTitleID} role="status">{view.title}</strong><p>{view.detail}</p>
      {view.recoveryNotice && <p className="sync-overview-warning">{view.recoveryNotice}</p>}
      <button type="button" className="btn small" disabled={!recommended?.available || typeof onNavigate !== 'function'}
        onClick={() => navigate(view.target)}>定位建议区域：{recommended?.label}</button>
      <button type="button" className="btn small sync-help-shortcut" data-sync-help-shortcut
        onClick={() => setHelpFailed(!focusSyncHelpTopic(root.current, help.key))}>查看相关帮助：{help.label}</button>
      {helpFailed && <p role="status">暂时无法定位帮助，请手动展开下方“操作帮助”；没有执行同步操作。</p>}
    </div>
    <SyncOverviewTimes view={view}/>
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
    <div className="sync-help-return">
      <button type="button" className="btn small sync-help-return-button" data-sync-help-return
        onClick={() => setReturnFailed(!focusSyncCurrentGuidance(root.current))}>返回当前状态提示</button>
      <span className="sync-help-return-note">只定位，不刷新、不执行同步；保留已展开的帮助。</span>
      {returnFailed && <p className="sync-help-return-error" role="status">暂时无法返回状态提示，请向上查看当前页面；没有刷新或执行同步。</p>}
    </div>
    {failed && <p className="sync-overview-warning" role="status">该区域已变化或暂不可定位，请查看当前页面。没有执行其他操作。</p>}
  </section>
}
