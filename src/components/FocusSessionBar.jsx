import React, { useEffect, useMemo, useState } from 'react'
import {
  formatCountdown,
  getFocusSessionElapsedSeconds,
  getFocusSessionRemainingSeconds,
} from './focusSessionUtils'
import './FocusSessionBar.css'

function stripExtension(value) {
  return String(value || '').replace(/\.[^.]+$/, '')
}

export default function FocusSessionBar({
  session,
  currentWords,
  focused,
  onToggleFocus,
  onEnd,
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!session?.active) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [session?.active, session?.id])

  const remaining = useMemo(
    () => getFocusSessionRemainingSeconds(session, now),
    [now, session]
  )
  const elapsed = useMemo(
    () => getFocusSessionElapsedSeconds(session, now),
    [now, session]
  )
  const delta = Number(currentWords || 0) - Number(session?.startWords || 0)
  const timerDone = remaining <= 0

  if (!session?.active) return null

  return (
    <div className={'focus-session-bar' + (timerDone ? ' timer-done' : '')}>
      <div className="focus-session-copy">
        <span>专注 Session</span>
        <strong>{stripExtension(session.noteTitle)}</strong>
      </div>

      <div className="focus-session-clock">
        <span>{timerDone ? '时间到' : '剩余'}</span>
        <strong>{formatCountdown(remaining)}</strong>
      </div>

      <div className="focus-session-stat">
        <span>本次净增</span>
        <strong className={delta < 0 ? 'negative' : ''}>
          {delta > 0 ? '+' : ''}{delta}
        </strong>
      </div>

      <div className="focus-session-stat">
        <span>已专注</span>
        <strong>{Math.floor(elapsed / 60)} 分</strong>
      </div>

      <div className="focus-session-actions">
        <button
          type="button"
          onClick={onToggleFocus}
          title={focused ? '显示普通界面' : '返回无干扰写作'}
        >
          {focused ? '显示界面' : '继续专注'}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onEnd?.(timerDone ? 'timer' : 'manual')}
        >
          结束 Session
        </button>
      </div>
    </div>
  )
}
