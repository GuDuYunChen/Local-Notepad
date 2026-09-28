import React, { useState } from 'react'
import { deviceSyncTimeZone, syncClockDisplay } from '~/services/syncClock.mjs'
import './SyncOverviewTimes.css'
import { readSyncClockPreference, saveSyncClockPreference, clearSyncClockPreference } from '~/services/syncClockPreference.mjs'

function TimeValue({ value }) {
  return value.iso ? <time dateTime={value.iso} title={'UTC：' + value.iso}>{value.text}</time> : value.text
}
export default function SyncOverviewTimes({ view }) {
  // Mount reads only. A remembered local choice resolves this device's current
  // zone afresh; no cached geographic zone or old timestamp is persisted.
  const [initial] = useState(readSyncClockPreference)
  const [zone, setZone] = useState(() => initial.mode === 'local' ? deviceSyncTimeZone() : null)
  const [savedMode, setSavedMode] = useState(initial.mode)
  const [preferenceError, setPreferenceError] = useState(initial.status === 'unavailable' ? 'read' : initial.status === 'invalid' ? 'invalid' : '')
  const mode = zone === null ? 'utc' : 'local'
  const clock = syncClockDisplay(view.lastSuccess, view.readAt, zone)
  const label = clock.mode === 'local' ? '本机时区' : 'UTC'
  const remember = () => {
    if (clock.fallback) return
    if (saveSyncClockPreference(mode)) { setSavedMode(mode); setPreferenceError('') }
    else setPreferenceError('save')
  }
  const forget = () => {
    if (clearSyncClockPreference()) { setSavedMode(null); setPreferenceError('') }
    else setPreferenceError('clear')
  }
  const preferenceMessage = {
    read: '无法读取时间偏好，打开时已使用 UTC。你仍可切换显示；没有修改同步设置。',
    invalid: '已有时间偏好无法识别，打开时已使用 UTC。可重新记住或清除；未读取其他设置。',
    save: '未能确认时间偏好已保存。当前显示仍可使用，下次可能保留原选择；没有修改同步设置。',
    clear: '未能确认时间偏好已清除，下次可能仍沿用原选择；当前显示没有改变。',
  }[preferenceError]
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
    <details className="sync-clock-preference" data-sync-clock-preference>
      <summary>时间显示偏好<span>{!preferenceMessage && savedMode ? '已记住：' + (savedMode === 'local' ? '本机时区' : 'UTC') : '可选择在此设备记住'}</span></summary>
      <div className="sync-clock-preference-actions" role="group" aria-label="记住时间显示方式">
      <button type="button" className="btn small sync-clock-preference-button" data-sync-clock-save
        disabled={clock.fallback} onClick={remember}>记住当前选择</button>
      <button type="button" className="btn small sync-clock-preference-button" data-sync-clock-clear
        onClick={forget}>清除时间偏好</button>
      <span className="sync-clock-preference-summary">{preferenceMessage ? '时间偏好未确认，请查看下方提示。' : savedMode === null ? '未记住选择，下次打开默认 UTC。' : '已记住：' + (savedMode === 'local' ? '本机时区' : 'UTC') + '。'}只在本应用此设备保存，其他已打开页面不跟随切换。</span>
      </div>
    </details>
    {preferenceMessage && <p className="sync-clock-preference-error" role="status">{preferenceMessage}</p>}
    <dl className="sync-overview-metrics">
      <div><dt>状态报告待处理</dt><dd>{view.reportedConflicts}</dd></div>
      <div><dt>已读取列表数量</dt><dd>{view.listedConflicts}</dd></div>
      <div className="sync-overview-time"><dt>最近确认成功 · {label}</dt><dd><TimeValue value={clock.lastSuccess}/></dd></div>
    </dl>
    <p className="sync-overview-note">状态依据：{view.readSource}。读取时间 {label}：<TimeValue value={clock.readAt}/>。总览随已读取字段更新，不保证远端实时状态。</p>
    <p className="sync-clock-note">切换只改变时间显示，不刷新、不执行同步。本机时区取自此设备设置；UTC 原始时间保留在时间提示中。再次切换后需点击“记住当前选择”才更新偏好；清除偏好不改变当前显示。</p>
  </>
}
