import React, { useEffect, useMemo, useState } from 'react'
import {
  getWritingRhythm,
  recordProjectAnalyticsSnapshot,
} from './projectAnalyticsUtils'
import {
  calculateProjectPlan,
  getNextPlannedChapters,
  getPlanningHealth,
  getProjectPlanningPreset,
  getVolumeMilestonePlan,
  moveChapterQueue,
  normalizeChapterQueue,
  prioritizeChapterQueue,
} from './projectPlanningUtils'
import './ProjectPlanningPanel.css'

function stripExtension(value) {
  return String(value || '').replace(/\.[^.]+$/, '')
}

function formatWords(value) {
  return Math.max(0, Number(value) || 0).toLocaleString('zh-CN')
}

function paceSourceLabel(source) {
  if (source === 'observed') return '按真实写作节奏'
  if (source === 'daily-goal') return '按日目标'
  if (source === 'weekly-goal') return '按周目标折算'
  return '尚无速度基线'
}

export default function ProjectPlanningPanel({
  workspace,
  projectMeta,
  onMetaChange,
  onOpenFile,
}) {
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!workspace?.project?.id) {
      setHistory([])
      return
    }

    setHistory(
      recordProjectAnalyticsSnapshot(
        workspace.project.id,
        workspace,
        new Date(),
      )
    )
  }, [workspace?.project?.id, workspace?.totalWords])

  const rhythm = useMemo(
    () => getWritingRhythm(history, new Date()),
    [history]
  )
  const plan = useMemo(
    () => calculateProjectPlan(
      workspace,
      projectMeta,
      rhythm,
      new Date(),
    ),
    [projectMeta, rhythm, workspace]
  )
  const health = getPlanningHealth(plan)
  const milestones = useMemo(
    () => getVolumeMilestonePlan(
      workspace,
      projectMeta,
      new Date(),
    ),
    [projectMeta, workspace]
  )
  const queue = useMemo(
    () => normalizeChapterQueue(workspace, projectMeta),
    [projectMeta, workspace]
  )
  const nextChapters = getNextPlannedChapters(workspace, projectMeta, 6)
  const preset = getProjectPlanningPreset(workspace?.project?.type || 'novel')

  const updateMeta = patch => {
    onMetaChange?.(previous => ({
      ...previous,
      ...(typeof patch === 'function' ? patch(previous) : patch),
    }))
  }

  const applyPreset = () => {
    updateMeta({
      dailyGoal: preset.dailyGoal,
      weeklyGoal: preset.weeklyGoal,
    })
  }

  const setMilestone = (key, deadline) => {
    updateMeta(previous => ({
      volumeMilestones: {
        ...previous.volumeMilestones,
        [key]: {
          ...(previous.volumeMilestones?.[key] || {}),
          deadline,
        },
      },
    }))
  }

  const persistQueue = nextIds => {
    updateMeta({
      chapterQueue: nextIds,
    })
  }

  const moveQueueItem = (id, direction) => {
    const ids = queue.map(note => note.id)
    persistQueue(moveChapterQueue(ids, id, direction))
  }

  const prioritize = id => {
    const ids = queue.map(note => note.id)
    persistQueue(prioritizeChapterQueue(ids, id))
  }

  return (
    <section className="project-planning-panel" aria-label="创作计划">
      <div className="project-planning-head">
        <div>
          <strong>创作计划</strong>
          <span>把目标、截止日期、卷级里程碑和下一章节排到同一处。</span>
        </div>
        <button
          type="button"
          className="btn small"
          onClick={applyPreset}
          title={preset.description}
        >
          应用{preset.label}
        </button>
      </div>

      <div className="project-planning-grid">
        <article className="project-plan-card schedule">
          <header>
            <div>
              <strong>项目节奏</strong>
              <span className={'project-plan-health ' + health.tone}>
                {health.label}
              </span>
            </div>
            <small>{paceSourceLabel(plan.pace.source)}</small>
          </header>

          <div className="project-plan-fields">
            <label>
              <span>日目标</span>
              <input
                type="number"
                min="0"
                step="100"
                value={projectMeta.dailyGoal || ''}
                placeholder={String(preset.dailyGoal)}
                onChange={event => updateMeta({
                  dailyGoal: Math.max(0, Number(event.target.value) || 0),
                })}
                aria-label="每日写作目标"
              />
            </label>
            <label>
              <span>周目标</span>
              <input
                type="number"
                min="0"
                step="500"
                value={projectMeta.weeklyGoal || ''}
                placeholder={String(preset.weeklyGoal)}
                onChange={event => updateMeta({
                  weeklyGoal: Math.max(0, Number(event.target.value) || 0),
                })}
                aria-label="每周写作目标"
              />
            </label>
            <label>
              <span>完稿截止</span>
              <input
                type="date"
                value={projectMeta.deadline || ''}
                onChange={event => updateMeta({
                  deadline: event.target.value,
                })}
                aria-label="项目完稿截止日期"
              />
            </label>
          </div>

          <div className="project-plan-metrics">
            <div>
              <span>剩余字数</span>
              <strong>{formatWords(plan.remainingWords)}</strong>
            </div>
            <div>
              <span>当前有效日速</span>
              <strong>{formatWords(plan.pace.effectiveDaily)}</strong>
            </div>
            <div>
              <span>截止所需日速</span>
              <strong>{formatWords(plan.requiredDaily)}</strong>
            </div>
            <div>
              <span>预计完稿</span>
              <strong>{plan.estimatedDate || '—'}</strong>
            </div>
          </div>

          <p className={'project-plan-message ' + health.tone}>
            {health.message}
            {plan.deadline && plan.remainingDays !== null && (
              <> 截止日前还剩 {Math.max(0, plan.remainingDays)} 天。</>
            )}
          </p>
        </article>

        <article className="project-plan-card milestones">
          <header>
            <div>
              <strong>卷级里程碑</strong>
              <span>给每卷 / 每幕设置自己的完成日期</span>
            </div>
          </header>

          <div className="project-milestone-list">
            {milestones.map(item => (
              <div
                key={item.key}
                className={'project-milestone-row' + (item.overdue ? ' overdue' : '')}
              >
                <div className="project-milestone-copy">
                  <strong>{item.title}</strong>
                  <span>
                    {item.completed}/{item.total} · {item.percent}% · {formatWords(item.wordCount)} 字
                  </span>
                </div>
                <input
                  type="date"
                  value={item.deadline || ''}
                  onChange={event => setMilestone(item.key, event.target.value)}
                  aria-label={'设置' + item.title + '里程碑日期'}
                />
                <em>
                  {item.deadline
                    ? item.overdue
                      ? '已逾期'
                      : item.percent >= 100
                        ? '已完成'
                        : item.daysRemaining + ' 天'
                    : '未设置'}
                </em>
              </div>
            ))}
            {!milestones.length && (
              <div className="project-plan-empty">项目还没有卷 / 幕。</div>
            )}
          </div>
        </article>

        <article className="project-plan-card queue">
          <header>
            <div>
              <strong>下一章节队列</strong>
              <span>自动排除“完成”章节，可手工调整优先级</span>
            </div>
          </header>

          <div className="project-plan-queue">
            {nextChapters.map((note, index) => {
              const queueIndex = queue.findIndex(item => item.id === note.id)
              return (
                <div key={note.id}>
                  <span className="project-queue-number">{index + 1}</span>
                  <button
                    type="button"
                    className="project-queue-open"
                    onClick={() => onOpenFile?.(note.id)}
                  >
                    <strong>{stripExtension(note.title)}</strong>
                    <small>{note.volumeTitle || '未分卷'} · {note.status === 'review' ? '修订' : '草稿'}</small>
                  </button>
                  <div className="project-queue-actions">
                    <button
                      type="button"
                      disabled={queueIndex <= 0}
                      onClick={() => moveQueueItem(note.id, 'up')}
                      title="上移"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={queueIndex < 0 || queueIndex >= queue.length - 1}
                      onClick={() => moveQueueItem(note.id, 'down')}
                      title="下移"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={queueIndex <= 0}
                      onClick={() => prioritize(note.id)}
                      title="设为下一章"
                    >
                      首
                    </button>
                  </div>
                </div>
              )
            })}
            {!nextChapters.length && (
              <div className="project-plan-empty">
                所有章节都已完成，或者项目暂时没有正文章节。
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  )
}
