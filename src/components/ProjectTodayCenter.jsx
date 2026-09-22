import React, { useEffect, useMemo, useState } from 'react'
import {
  formatFocusDuration,
  getTodayFocusSummary,
  readFocusSessionHistory,
} from './focusSessionUtils'
import {
  getTodayQueue,
  readDailyReview,
} from './projectSprintUtils'
import './ProjectTodayCenter.css'

function stripExtension(value) {
  return String(value || '').replace(/\.[^.]+$/, '')
}

function formatTime(timestamp) {
  const value = Number(timestamp) || 0
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export default function ProjectTodayCenter({
  workspace,
  projectMeta,
  onOpenFile,
  onStartFocus,
}) {
  const projectId = workspace?.project?.id || ''
  const [history, setHistory] = useState(() => (
    readFocusSessionHistory(projectId)
  ))

  useEffect(() => {
    setHistory(readFocusSessionHistory(projectId))
  }, [projectId])

  useEffect(() => {
    const refresh = event => {
      if (!event?.detail?.projectId || event.detail.projectId === projectId) {
        setHistory(readFocusSessionHistory(projectId))
      }
    }
    window.addEventListener('focus-session:completed', refresh)
    return () => window.removeEventListener('focus-session:completed', refresh)
  }, [projectId])

  const todayQueue = useMemo(
    () => getTodayQueue(workspace, projectMeta, 4),
    [projectMeta, workspace]
  )
  const todaySummary = useMemo(
    () => getTodayFocusSummary(history, Date.now()),
    [history]
  )
  const todayReview = readDailyReview(projectMeta, new Date())
  const primary = todayQueue[0] || null

  const scrollToReview = () => {
    document.querySelector('.review-card')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }

  return (
    <section className="project-today-center" aria-label="今日创作中心">
      <div className="project-today-center-head">
        <div>
          <strong>今日创作中心</strong>
          <span>选一章，进入专注 Session，把计划落成实际写作。</span>
        </div>

        {primary && (
          <button
            type="button"
            className="btn primary"
            onClick={() => onStartFocus?.(primary, 50)}
          >
            开始下一章 · 50 分钟
          </button>
        )}
      </div>

      <div className="project-today-center-grid">
        <article className="project-today-card tasks">
          <header>
            <div>
              <strong>今日任务</strong>
              <span>来自“下一章节队列”</span>
            </div>
          </header>

          <div className="project-today-task-list">
            {todayQueue.length ? todayQueue.map((note, index) => (
              <div key={note.id}>
                <span className="project-today-task-order">{index + 1}</span>
                <button
                  type="button"
                  className="project-today-task-open"
                  onClick={() => onOpenFile?.(note.id)}
                >
                  <strong>{stripExtension(note.title)}</strong>
                  <small>
                    {note.volumeTitle || '未分卷'} ·
                    {note.status === 'review' ? ' 修订' : ' 草稿'}
                  </small>
                </button>
                <div className="project-today-focus-actions">
                  <button
                    type="button"
                    onClick={() => onStartFocus?.(note, 25)}
                    title="25 分钟专注"
                  >
                    25
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartFocus?.(note, 50)}
                    title="50 分钟专注"
                  >
                    50
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartFocus?.(note, 90)}
                    title="90 分钟专注"
                  >
                    90
                  </button>
                </div>
              </div>
            )) : (
              <div className="project-today-empty">
                当前没有未完成章节。
              </div>
            )}
          </div>
        </article>

        <article className="project-today-card summary">
          <header>
            <div>
              <strong>今日 Session</strong>
              <span>仅统计已经结束的专注 Session</span>
            </div>
          </header>

          <div className="project-today-session-metrics">
            <div>
              <span>次数</span>
              <strong>{todaySummary.sessionCount}</strong>
            </div>
            <div>
              <span>专注时长</span>
              <strong>{formatFocusDuration(todaySummary.totalSeconds)}</strong>
            </div>
            <div>
              <span>净字数</span>
              <strong>
                {todaySummary.wordDelta > 0 ? '+' : ''}
                {todaySummary.wordDelta}
              </strong>
            </div>
            <div>
              <span>完整计时</span>
              <strong>{todaySummary.completedTimers}</strong>
            </div>
          </div>

          <div className="project-today-review-state">
            <div>
              <strong>今日复盘</strong>
              <span>
                {todayReview
                  ? '已记录：' + todayReview.slice(0, 42) + (todayReview.length > 42 ? '…' : '')
                  : '尚未记录，结束写作后补一句即可。'}
              </span>
            </div>
            <button type="button" onClick={scrollToReview}>
              {todayReview ? '查看' : '去复盘'}
            </button>
          </div>
        </article>

        <article className="project-today-card history">
          <header>
            <div>
              <strong>最近 Session</strong>
              <span>保存在当前设备</span>
            </div>
          </header>

          <div className="project-today-history-list">
            {history.length ? history.slice(0, 6).map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenFile?.(item.noteId)}
              >
                <span>
                  <strong>{stripExtension(item.noteTitle)}</strong>
                  <small>
                    {formatFocusDuration(item.elapsedSeconds)}
                    {' · '}
                    {item.wordDelta >= 0 ? '+' : ''}{item.wordDelta} 字
                  </small>
                </span>
                <em>{formatTime(item.endedAt)}</em>
              </button>
            )) : (
              <div className="project-today-empty">
                完成第一个专注 Session 后，这里会留下记录。
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  )
}
