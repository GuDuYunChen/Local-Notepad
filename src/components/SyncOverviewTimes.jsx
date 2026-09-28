import React, { useState } from 'react'
import { deviceSyncTimeZone, syncClockDisplay } from '~/services/syncClock.mjs'
import './SyncOverviewTimes.css'
import { syncClockPreferenceView } from '~/services/syncClockPreferenceView.mjs'
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
  const [preferenceReceipt, setPreferenceReceipt] = useState('')
  const mode = zone === null ? 'utc' : 'local'
  const clock = syncClockDisplay(view.lastSuccess, view.readAt, zone)
  const label = clock.mode === 'local' ? '本机时区' : 'UTC'
  const remember = () => {
    if (clock.fallback) return
    setPreferenceReceipt('')
    if (saveSyncClockPreference(mode)) { setSavedMode(mode); setPreferenceError('') }
    else setPreferenceError('save')
  }
  const forget = () => {
    setPreferenceReceipt('')
    if (clearSyncClockPreference()) { setSavedMode(null); setPreferenceError('') }
    else setPreferenceError('clear')
  }
  const restore = () => {
    // Re-read at this explicit action: another instance may have saved or cleared.
    // Never trust cached savedMode to select a mode, and never write on restore.
    const preference = readSyncClockPreference()
    setPreferenceReceipt('')
    setSavedMode(preference.mode)
    if (preference.status === 'saved') {
      setZone(preference.mode === 'local' ? deviceSyncTimeZone() : null)
      setPreferenceError('')
      setPreferenceReceipt('已读取保存记录，实际显示方式见上方；没有保存或清除偏好。')
    } else if (preference.status === 'empty') {
      setPreferenceError('')
      setPreferenceReceipt('没有已保存的时间偏好，当前显示保持不变。')
    } else {
      setPreferenceError(preference.status === 'invalid' ? 'restoreInvalid' : 'restoreRead')
    }
  }
  const selectZone = value => { setZone(value); setPreferenceReceipt('') }
  const preferenceMessage = {
    restoreRead: '未能读取已保存的时间偏好，当前显示保持不变。没有保存、清除或修改同步设置。',
    restoreInvalid: '已保存的时间偏好无法识别，当前显示保持不变。没有覆盖或删除记录，可主动重新记住或清除。',
    read: '无法读取时间偏好，打开时已使用 UTC。你仍可切换显示；没有修改同步设置。',
    invalid: '已有时间偏好无法识别，打开时已使用 UTC。可重新记住或清除；未读取其他设置。',
    save: '未能确认时间偏好已保存。当前显示仍可使用，下次可能保留原选择；没有修改同步设置。',
    clear: '未能确认时间偏好已清除，下次可能仍沿用原选择；当前显示没有改变。',
  }[preferenceError]
  const preferenceView = syncClockPreferenceView(mode, savedMode, !!preferenceMessage, clock.fallback)
  return <>
    <div className="sync-clock-controls" role="group" aria-label="同步时间显示方式">
      <span>时间显示</span>
      <button type="button" className="btn small sync-clock-button" aria-pressed={zone === null}
        onClick={() => selectZone(null)}>UTC</button>
      <button type="button" className="btn small sync-clock-button" aria-pressed={zone !== null}
        onClick={() => selectZone(deviceSyncTimeZone())}>本机时区</button>
      <span className="sync-clock-zone">{clock.mode === 'local' ? clock.timeZone : 'UTC'}</span>
    </div>
    {clock.fallback && <p className="sync-clock-fallback" role="status">本机时区显示不可用，已保留 UTC 时间；没有刷新或执行同步。</p>}
    <details className="sync-clock-preference" data-sync-clock-preference>
      <summary>时间显示偏好<span>{preferenceView.summary}</span></summary>
      <div className="sync-clock-preference-actions" role="group" aria-label="记住时间显示方式">
      <p className="sync-clock-preference-summary" data-sync-clock-comparison>{preferenceView.detail}</p>
      <button type="button" className="btn small sync-clock-preference-button" data-sync-clock-restore
        onClick={restore}>读取并使用已保存方式</button>
      <button type="button" className="btn small sync-clock-preference-button" data-sync-clock-save
        disabled={clock.fallback} onClick={remember}>记住当前选择</button>
      <button type="button" className="btn small sync-clock-preference-button" data-sync-clock-clear
        onClick={forget}>清除时间偏好</button>
      <span className="sync-clock-preference-summary">保存状态是上次核对结果，不保证其他页面未修改。读取只使用此设备当前保存的方式，不写入偏好、不刷新或执行同步。</span>
      </div>
    </details>
    {preferenceReceipt && <p className="sync-clock-preference-receipt" role="status">{preferenceReceipt}</p>}
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
