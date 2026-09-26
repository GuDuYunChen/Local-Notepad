import React, { useEffect, useRef, useState } from 'react'
import { api } from '~/services/api'
import { createSyncStatusReader } from '~/services/syncStatusReader.mjs'
import { parseSyncActivity, requestSyncCancellation, syncActivityLabel } from '~/services/syncActivity.mjs'
import './SyncActivityPanel.css'

// Independent from the parent's paused state reader and SQLite-backed endpoints.
export default function SyncActivityPanel({ wakeKey = '', onSettled = () => {} }) {
  const [activity, setActivity] = useState(null)
  const [health, setHealth] = useState({ loading: true, error: '', lastReadAt: 0 })
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const live = useRef(false)
  const reader = useRef(null)
  const current = useRef(null)
  const wake = useRef(wakeKey)
  const settled = useRef(onSettled)
  const cancelRequest = useRef(null)
  const requestedID = useRef('')
  const stopCancelWait = useRef(null)
  wake.current = wakeKey
  settled.current = onSettled

  useEffect(() => {
    live.current = true
    const monitor = createSyncStatusReader({
      load: async signal => parseSyncActivity(await api('/api/sync/activity', { signal })),
      shouldPoll: () => true,
      pollInterval: () => current.current?.active || wake.current ? 1_000 : 5_000,
      timeoutMs: 5_000,
      onHealth: setHealth,
      onSnapshot: next => {
        if (next.active && next.id === requestedID.current) next = { ...next, cancel_requested: true }
        const previous = current.current
        current.current = next
        setActivity(next)
        if (previous?.active && previous.id !== next.id) {
          if (requestedID.current === previous.id) {
            setMessage('原任务已结束；请以同步恢复状态确认结果，取消不等于回滚。')
          }
          settled.current(previous)
        }
      },
    })
    reader.current = monitor
    void monitor.refresh()
    return () => {
      live.current = false
      monitor.dispose()
      if (reader.current === monitor) reader.current = null
      cancelRequest.current?.abort()
      stopCancelWait.current?.()
    }
  }, [])
  useEffect(() => { void reader.current?.refresh() }, [wakeKey])

  const cancelCurrent = async () => {
    if (cancelRequest.current || health.error || !current.current?.active) return
    const target = current.current
    const controller = new AbortController()
    cancelRequest.current = controller
    setSending(true)
    let timer
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('取消结果尚未确认')) }, 5_000)
      })
      const stopped = new Promise((_, reject) => { stopCancelWait.current = () => reject(new Error('面板已关闭')) })
      const receipt = await Promise.race([
        requestSyncCancellation(api, target, text => window.confirm(text), controller.signal), timeout, stopped,
      ])
      if (!live.current) return
      if (receipt.reason === 'declined' || receipt.reason === 'not-requested') return
      if (receipt.accepted) {
        requestedID.current = target.id
        // Update only the captured task. A response arriving late must not relabel its successor.
        if (current.current?.id === target.id) {
          current.current = { ...current.current, cancel_requested: true }
          setActivity(current.current)
        }
        setMessage(current.current?.id === target.id ? '已请求取消，等待任务结束；这不表示写入已撤销。' : '已请求取消；原任务状态已变化，请查看同步恢复状态确认结果。')
      } else setMessage('原任务已结束或已变更；未取消其他任务。')
      void reader.current?.refresh()
    } catch {
      if (live.current) {
        setMessage('取消结果尚未确认，请刷新任务状态；不会自动重复发送取消请求。')
        void reader.current?.refresh()
      }
    } finally {
      clearTimeout(timer)
      stopCancelWait.current = null
      if (cancelRequest.current === controller) cancelRequest.current = null
      if (live.current) setSending(false)
    }
  }

  return <div className="sync-activity" aria-label="当前同步任务">
    <div className="sync-activity-heading">
      <strong role="status">{health.error ? '任务状态暂时不可用，以下为上次读取结果' : activity ? syncActivityLabel(activity) : '正在读取当前任务'}</strong>
      <button className="btn small" disabled={health.loading} onClick={() => void reader.current?.refresh()}>刷新任务状态</button>
    </div>
    {activity?.active && <>
      <span>开始时间：{new Date(activity.started_at * 1000).toLocaleString('zh-CN', { hour12: false })}</span>
      <span>{activity.phase === 'applying' ? '已进入可能写入阶段；取消不能撤销已提交的数据。' : '正在准备或读取远端；阶段可能随时推进，取消仍需核查结果。'}</span>
      <button className="btn" disabled={sending || !!health.error || activity.cancel_requested} onClick={() => void cancelCurrent()}>
        {sending ? '正在请求取消…' : activity.cancel_requested ? '正在取消…' : '取消当前任务'}
      </button>
      <small>仅取消本次任务，不关闭自动同步；只读预检取消后，后续计划仍可能再次运行。</small>
    </>}
    {health.error && <p role="status">无法确认任务是否仍在运行；不会把读取失败当作任务结束。</p>}
    {message && <p role="status">{message}</p>}
  </div>
}
