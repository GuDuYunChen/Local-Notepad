import React, { useEffect, useMemo, useState } from 'react'
import {
  readFocusSessionHistory,
  updateFocusSessionReview,
} from './focusSessionUtils'
import {
  compareFocusDurations,
  getBestWritingTime,
  getChapterSessionEfficiency,
  getSessionEfficiencySummary,
  getSessionReviewStats,
  getSessionTrend,
} from './focusSessionAnalyticsUtils'
import './FocusSessionAnalyticsPanel.css'

function stripExtension(value) {
  return String(value || '').replace(/\.[^.]+$/, '')
}

function formatWords(value) {
  const number = Number(value) || 0
  return (number > 0 ? '+' : '') + number.toLocaleString('zh-CN')
}

function formatMinutes(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  return Math.round(value / 60) + ' 分'
}

function dateLabel(value) {
  const text = String(value || '')
  const match = text.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return match ? match[1] + '/' + match[2] : text
}

function formatEndedAt(timestamp) {
  const value = Number(timestamp) || 0
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export default function FocusSessionAnalyticsPanel({
  workspace,
  onOpenFile,
}) {
  const projectId = workspace?.project?.id || ''
  const [history, setHistory] = useState(() => (
    readFocusSessionHistory(projectId, 180)
  ))
  const [trendDays, setTrendDays] = useState(7)
  const [editingId, setEditingId] = useState('')
  const [reviewDraft, setReviewDraft] = useState('')

  const reload = () => {
    setHistory(readFocusSessionHistory(projectId, 180))
  }

  useEffect(() => {
    reload()
  }, [projectId])

  useEffect(() => {
    const refresh = event => {
      if (!event?.detail?.projectId || event.detail.projectId === projectId) {
        reload()
      }
    }
    window.addEventListener('focus-session:completed', refresh)
    window.addEventListener('focus-session:review-updated', refresh)
    return () => {
      window.removeEventListener('focus-session:completed', refresh)
      window.removeEventListener('focus-session:review-updated', refresh)
    }
  }, [projectId])

  const summary = useMemo(
    () => getSessionEfficiencySummary(history),
    [history]
  )
  const bestTime = useMemo(
    () => getBestWritingTime(history),
    [history]
  )
  const durations = useMemo(
    () => compareFocusDurations(history),
    [history]
  )
  const trend = useMemo(
    () => getSessionTrend(history, trendDays, Date.now()),
    [history, trendDays]
  )
  const chapters = useMemo(
    () => getChapterSessionEfficiency(history),
    [history]
  )
  const reviews = useMemo(
    () => getSessionReviewStats(history),
    [history]
  )

  const maxTrendWords = Math.max(
    1,
    ...trend.map(item => Math.max(0, Number(item.words) || 0))
  )

  const beginReview = session => {
    setEditingId(session.id)
    setReviewDraft(String(session.reviewNote || ''))
  }

  const saveReview = session => {
    const updated = updateFocusSessionReview(
      projectId,
      session.id,
      reviewDraft,
    )

    if (updated) {
      setEditingId('')
      setReviewDraft('')
      reload()
      window.dispatchEvent(new CustomEvent('focus-session:review-updated', {
        detail: {
          projectId,
          sessionId: session.id,
        },
      }))
    }
  }

  if (!history.length) {
    return (
      <section className="focus-session-analytics-panel" aria-label="Session 分析">
        <div className="focus-session-analytics-head">
          <div>
            <strong>Session 分析与复盘</strong>
            <span>完成几个专注 Session 后，这里会开始形成效率画像。</span>
          </div>
        </div>
        <div className="focus-session-analytics-empty">
          <strong>还没有 Session 数据</strong>
          <span>从“今日创作中心”启动 25 / 50 / 90 分钟专注写作即可开始积累。</span>
        </div>
      </section>
    )
  }

  return (
    <section className="focus-session-analytics-panel" aria-label="Session 分析">
      <div className="focus-session-analytics-head">
        <div>
          <strong>Session 分析与复盘</strong>
          <span>
            少于 5 分钟的 Session 保留历史，但不参与最佳时段和效率排行。
          </span>
        </div>
      </div>

      <div className="focus-session-analytics-grid">
        <article className="focus-analysis-card efficiency">
          <header>
            <div>
              <strong>专注效率</strong>
              <span>{summary.sessionCount} 个有效 Session</span>
            </div>
          </header>

          <div className="focus-analysis-metrics">
            <div>
              <span>平均时薪</span>
              <strong>{formatWords(summary.averageWordsPerHour)}</strong>
              <small>字 / 小时</small>
            </div>
            <div>
              <span>最佳时薪</span>
              <strong>{formatWords(summary.bestWordsPerHour)}</strong>
              <small>字 / 小时</small>
            </div>
            <div>
              <span>总净字数</span>
              <strong>{formatWords(summary.totalWords)}</strong>
              <small>{formatMinutes(summary.totalSeconds)}</small>
            </div>
            <div>
              <span>复盘覆盖</span>
              <strong>{summary.reviewCoverage}%</strong>
              <small>{summary.reviewedSessions}/{summary.sessionCount}</small>
            </div>
          </div>
        </article>

        <article className="focus-analysis-card best-time">
          <header>
            <div>
              <strong>最佳写作时段</strong>
              <span>按实际 Session 开始时间聚合</span>
            </div>
          </header>

          {bestTime.best ? (
            <>
              <div className="focus-best-time-main">
                <strong>{bestTime.best.label}</strong>
                <span>{formatWords(bestTime.best.wordsPerHour)} 字 / 小时</span>
              </div>
              <div className="focus-time-buckets">
                {bestTime.buckets.slice(0, 5).map(item => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.wordsPerHour}</strong>
                    <small>{item.sessions} 次</small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="focus-analysis-empty-small">
              至少完成一个 5 分钟以上 Session 后开始判断。
            </div>
          )}
        </article>

        <article className="focus-analysis-card duration-compare">
          <header>
            <div>
              <strong>25 / 50 / 90 分钟效果</strong>
              <span>比较每次产出、时薪与完整计时率</span>
            </div>
          </header>

          <div className="focus-duration-table">
            {durations.map(item => (
              <div key={item.durationMinutes}>
                <strong>{item.durationMinutes} 分</strong>
                <span>{item.sessions} 次</span>
                <span>{formatWords(item.averageWordDelta)} / 次</span>
                <span>{formatWords(item.wordsPerHour)} / 时</span>
                <em>{item.completionRate}% 完整</em>
              </div>
            ))}
          </div>
        </article>

        <article className="focus-analysis-card trend">
          <header>
            <div>
              <strong>专注趋势</strong>
              <span>按 Session 结束日期聚合</span>
            </div>
            <div className="focus-trend-switch">
              {[7, 30].map(value => (
                <button
                  key={value}
                  type="button"
                  className={trendDays === value ? 'active' : ''}
                  onClick={() => setTrendDays(value)}
                >
                  {value} 天
                </button>
              ))}
            </div>
          </header>

          <div className="focus-trend-chart">
            {trend.map(item => (
              <div key={item.date} title={item.date + ' · ' + item.words + ' 字'}>
                <span
                  style={{
                    height: String(
                      Math.max(
                        item.words > 0 ? 5 : 1,
                        Math.round((Math.max(0, item.words) / maxTrendWords) * 54)
                      )
                    ) + 'px',
                  }}
                />
                <small>{dateLabel(item.date)}</small>
              </div>
            ))}
          </div>

          <div className="focus-trend-summary">
            <span>
              {trend.reduce((sum, item) => sum + item.sessions, 0)} 次 Session
            </span>
            <span>
              {formatWords(trend.reduce((sum, item) => sum + item.words, 0))} 字
            </span>
          </div>
        </article>

        <article className="focus-analysis-card chapter-efficiency">
          <header>
            <div>
              <strong>章节 Session 效率</strong>
              <span>按字 / 小时排序</span>
            </div>
          </header>

          <div className="focus-chapter-efficiency-list">
            {chapters.slice(0, 8).map(item => (
              <button
                key={item.noteId}
                type="button"
                onClick={() => onOpenFile?.(item.noteId)}
              >
                <span>
                  <strong>{stripExtension(item.noteTitle)}</strong>
                  <small>{item.sessions} 次 · {formatWords(item.words)} 字</small>
                </span>
                <em>{formatWords(item.wordsPerHour)} / 时</em>
              </button>
            ))}
          </div>
        </article>

        <article className="focus-analysis-card review">
          <header>
            <div>
              <strong>Session 复盘</strong>
              <span>{reviews.reviewed}/{reviews.total} 已填写 · {reviews.coverage}%</span>
            </div>
          </header>

          <div className="focus-session-review-list">
            {history.slice(0, 8).map(session => (
              <div key={session.id}>
                <div className="focus-session-review-head">
                  <button
                    type="button"
                    onClick={() => onOpenFile?.(session.noteId)}
                  >
                    <strong>{stripExtension(session.noteTitle)}</strong>
                    <small>
                      {formatEndedAt(session.endedAt)} ·
                      {' '}{formatMinutes(session.elapsedSeconds)} ·
                      {' '}{formatWords(session.wordDelta)} 字
                    </small>
                  </button>
                  {editingId !== session.id && (
                    <button
                      type="button"
                      className="focus-session-review-edit"
                      onClick={() => beginReview(session)}
                    >
                      {String(session.reviewNote || '').trim() ? '编辑' : '复盘'}
                    </button>
                  )}
                </div>

                {editingId === session.id ? (
                  <div className="focus-session-review-editor">
                    <textarea
                      value={reviewDraft}
                      onChange={event => setReviewDraft(event.target.value)}
                      placeholder="这一场为什么顺 / 为什么卡？下次怎样进入状态更快？"
                      maxLength={600}
                      autoFocus
                      aria-label="Session 复盘备注"
                    />
                    <div>
                      <span>{reviewDraft.length}/600</span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId('')
                          setReviewDraft('')
                        }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => saveReview(session)}
                      >
                        保存复盘
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className={session.reviewNote ? '' : 'empty'}>
                    {session.reviewNote || '尚未记录 Session 复盘。'}
                  </p>
                )}
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  )
}
