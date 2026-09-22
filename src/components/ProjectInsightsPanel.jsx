import React, { useEffect, useMemo, useState } from 'react'
import { toast } from '~/services/toast'
import {
  readProjectAnalyticsHistory,
  recordProjectAnalyticsSnapshot,
} from './projectAnalyticsUtils'
import {
  readFocusSessionHistory,
} from './focusSessionUtils'
import {
  buildProjectInsights,
  formatProjectInsightReport,
} from './projectInsightUtils'
import './ProjectInsightsPanel.css'

function stripExtension(value) {
  return String(value || '').replace(/\.[^.]+$/, '')
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(value / 3600)
  const minutes = Math.round((value % 3600) / 60)
  if (hours > 0) return hours + ' 小时 ' + minutes + ' 分'
  return minutes + ' 分'
}

async function copyText(value) {
  const text = String(value || '')
  if (!text) return

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export default function ProjectInsightsPanel({
  workspace,
  projectMeta,
  projectIndexes,
  onOpenFile,
  onNavigateView,
}) {
  const projectId = workspace?.project?.id || ''
  const [periodDays, setPeriodDays] = useState(7)
  const [analyticsHistory, setAnalyticsHistory] = useState([])
  const [sessionHistory, setSessionHistory] = useState([])
  const [reportOpen, setReportOpen] = useState(false)

  const reloadAnalytics = () => {
    if (!projectId || !workspace) {
      setAnalyticsHistory([])
      return
    }

    setAnalyticsHistory(
      recordProjectAnalyticsSnapshot(
        projectId,
        workspace,
        new Date(),
      )
    )
  }

  const reloadSessions = () => {
    setSessionHistory(
      projectId
        ? readFocusSessionHistory(projectId, 180)
        : []
    )
  }

  useEffect(() => {
    reloadAnalytics()
  }, [projectId, workspace?.totalWords])

  useEffect(() => {
    reloadSessions()
  }, [projectId])

  useEffect(() => {
    const refresh = event => {
      if (!event?.detail?.projectId || event.detail.projectId === projectId) {
        reloadSessions()
      }
    }

    window.addEventListener('focus-session:completed', refresh)
    window.addEventListener('focus-session:review-updated', refresh)
    return () => {
      window.removeEventListener('focus-session:completed', refresh)
      window.removeEventListener('focus-session:review-updated', refresh)
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    setAnalyticsHistory(readProjectAnalyticsHistory(projectId))
  }, [projectId, projectMeta?.dailyGoal, projectMeta?.weeklyGoal])

  const snapshot = useMemo(
    () => buildProjectInsights({
      workspace,
      projectMeta,
      analyticsHistory,
      sessionHistory,
      projectIndexes,
      periodDays,
      now: new Date(),
    }),
    [
      analyticsHistory,
      periodDays,
      projectIndexes,
      projectMeta,
      sessionHistory,
      workspace,
    ]
  )

  const report = useMemo(
    () => formatProjectInsightReport(
      snapshot,
      workspace,
      projectMeta,
    ),
    [projectMeta, snapshot, workspace]
  )

  const copyReport = async () => {
    try {
      await copyText(report)
      toast.success((periodDays === 30 ? '30 天复盘' : '7 天复盘') + '已复制')
    } catch (error) {
      console.error('复制创作复盘失败', error)
      toast.error('复制复盘失败')
    }
  }

  if (!workspace?.project?.id) return null

  const best = snapshot.bestTime?.best
  const plan = snapshot.plan || {}
  const limited = snapshot.period?.coverageLimited

  return (
    <section className="project-insights-panel" aria-label="创作洞察与自动复盘">
      <div className="project-insights-head">
        <div>
          <strong>创作洞察与自动复盘</strong>
          <span>
            基于本机写作快照、计划和 Session 生成；所有提醒都有可追溯数据条件。
          </span>
        </div>

        <div className="project-insights-head-actions">
          <button
            type="button"
            className="btn small"
            onClick={() => onNavigateView?.('planning')}
          >
            调整计划
          </button>
          <div className="project-insights-period">
          {[7, 30].map(days => (
            <button
              key={days}
              type="button"
              className={periodDays === days ? 'active' : ''}
              onClick={() => {
                setPeriodDays(days)
                setReportOpen(false)
              }}
            >
              {days} 天
            </button>
          ))}
          </div>
        </div>
      </div>

      {limited && (
        <div className="project-insights-data-note">
          当前仅覆盖 {snapshot.period.coverageDays}/{periodDays} 天真实历史，
          报告不会补造缺失日期。
        </div>
      )}

      <div className="project-insights-overview">
        <div>
          <span>净增字数</span>
          <strong>
            {snapshot.period.netWords > 0 ? '+' : ''}
            {formatNumber(snapshot.period.netWords)}
          </strong>
          <small>{snapshot.period.activeDays} 个活跃日</small>
        </div>
        <div>
          <span>有效 Session</span>
          <strong>{snapshot.sessions.effectiveSessionCount}</strong>
          <small>{formatDuration(snapshot.sessions.totalSecondsAll)}</small>
        </div>
        <div>
          <span>Session 效率</span>
          <strong>{formatNumber(snapshot.sessions.averageWordsPerHour)}</strong>
          <small>字 / 小时</small>
        </div>
        <div>
          <span>计划状态</span>
          <strong className={'tone-' + snapshot.planHealth.tone}>
            {snapshot.planHealth.label}
          </strong>
          <small>
            {plan.requiredDaily > 0
              ? '所需 ' + formatNumber(plan.requiredDaily) + ' 字/天'
              : '暂无截止速度要求'}
          </small>
        </div>
        <div>
          <span>最佳时段</span>
          <strong>{best?.label || '—'}</strong>
          <small>
            {best
              ? formatNumber(best.wordsPerHour) + ' 字/小时'
              : 'Session 数据不足'}
          </small>
        </div>
      </div>

      <div className="project-insights-grid">
        <article className="project-insight-card alerts">
          <header>
            <div>
              <strong>需要注意</strong>
              <span>按数据规则触发，不做主观判断</span>
            </div>
          </header>

          <div className="project-insight-alert-list">
            {snapshot.alerts.map(item => (
              <button
                key={item.id}
                type="button"
                className={'tone-' + item.tone}
                onClick={() => item.noteId && onOpenFile?.(item.noteId)}
                disabled={!item.noteId}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                {item.noteId && <em>打开</em>}
              </button>
            ))}
          </div>
        </article>

        <article className="project-insight-card difficult">
          <header>
            <div>
              <strong>难写章节</strong>
              <span>至少 2 个有效 Session 后才参与判断</span>
            </div>
          </header>

          <div className="project-difficult-list">
            {snapshot.difficultChapters.length ? (
              snapshot.difficultChapters.slice(0, 6).map(item => (
                <button
                  key={item.noteId}
                  type="button"
                  onClick={() => onOpenFile?.(item.noteId)}
                >
                  <span>
                    <strong>{stripExtension(item.noteTitle)}</strong>
                    <small>
                      {item.sessions} 次 · {formatNumber(item.wordsPerHour)} 字/小时
                    </small>
                  </span>
                  <em className={'difficulty-' + item.difficulty}>
                    {item.difficulty === 'high' ? '高阻力' : '需关注'}
                  </em>
                </button>
              ))
            ) : (
              <div className="project-insight-empty">
                当前没有满足“重复投入且效率明显偏低”条件的章节。
              </div>
            )}
          </div>
        </article>

        <article className="project-insight-card recommendations">
          <header>
            <div>
              <strong>下一阶段建议</strong>
              <span>从计划偏差、Session 和章节状态生成</span>
            </div>
          </header>

          <div className="project-recommendation-list">
            {snapshot.recommendations.slice(0, 6).map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => item.noteId && onOpenFile?.(item.noteId)}
                disabled={!item.noteId}
              >
                <span>{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
              </button>
            ))}
          </div>
        </article>
      </div>

      <article className="project-insight-report">
        <header>
          <div>
            <strong>{periodDays === 30 ? '自动月度复盘' : '自动周度复盘'}</strong>
            <span>
              当前报告可直接复制为 Markdown；
              {snapshot.period.coverageLimited
                ? '数据覆盖不足时会明确注明。'
                : '当前周期数据覆盖完整。'}
            </span>
          </div>

          <div>
            <button
              type="button"
              className="btn small"
              onClick={() => setReportOpen(value => !value)}
            >
              {reportOpen ? '收起报告' : '预览报告'}
            </button>
            <button
              type="button"
              className="btn small primary"
              onClick={() => void copyReport()}
            >
              复制报告
            </button>
          </div>
        </header>

        {reportOpen && (
          <pre className="project-insight-report-preview">{report}</pre>
        )}
      </article>
    </section>
  )
}
