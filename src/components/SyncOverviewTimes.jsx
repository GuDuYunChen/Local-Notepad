import React, { useState } from 'react'
import { deviceSyncTimeZone, syncClockDisplay } from '~/services/syncClock.mjs'
import './SyncOverviewTimes.css'

function TimeValue({ value }) {
  return value.iso ? <time dateTime={value.iso} title={'UTC：' + value.iso}>{value.text}</time> : value.text
}
export default function SyncOverviewTimes({ view }) {
  // Per mounted overview only. Snapshot updates do not reset the user's choice.
  // Resolve the device zone only after explicit selection, never use geolocation.
  const [zone, setZone] = useState(null)
  const clock = syncClockDisplay(view.lastSuccess, view.readAt, zone)
  const label = clock.mode === 'local' ? '本机时区' : 'UTC'
  return <>
    <div className="sync-clock-controls" role="group" aria-label="同步时间显示方式">
      <span>时间显示</span>
      <button type="button" className="btn small sync-clock-button" aria-pressed={zone === null}
        onClick={() => setZone(null)}>UTC</button>
      <button type="button" className="btn small sync-clock-button" aria-pressed={zone !== null}
        onClick={() => setZone(deviceSyncTimeZone())}>本机时区</button>
      <span className="sync-clock-zone">{clock.mode === 'local' ? clock.timeZone : 'UTC'}</span>
    </div>
    {clock.fallback && <p className="sync-clock-fallback" role="status">本机时区显示不可用，已保留 UTC 时间；没有刷新或执行同步。</p>}
    <dl className="sync-overview-metrics">
      <div><dt>状态报告待处理</dt><dd>{view.reportedConflicts}</dd></div>
      <div><dt>已读取列表数量</dt><dd>{view.listedConflicts}</dd></div>
      <div className="sync-overview-time"><dt>最近确认成功 · {label}</dt><dd><TimeValue value={clock.lastSuccess}/></dd></div>
    </dl>
    <p className="sync-overview-note">状态依据：{view.readSource}。读取时间 {label}：<TimeValue value={clock.readAt}/>。总览随已读取字段更新，不保证远端实时状态。</p>
    <p className="sync-clock-note">切换只改变时间显示，不刷新、不执行同步。本机时区取自此设备设置；UTC 原始时间保留在时间提示中。</p>
  </>
}
