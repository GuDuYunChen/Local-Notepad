import React, { useEffect, useMemo, useState } from 'react'
import {
  recordProjectAnalyticsSnapshot,
} from './projectAnalyticsUtils'
import {
  getProjectPlanningPreset,
} from './projectPlanningUtils'
import {
  buildWritingCalendar,
  calculateWritingSprint,
  createWritingSprint,
  getBreakReminder,
  getTodayQueue,
  getTodayWritingStatus,
  readDailyReview,
  writeDailyReview,
} from './projectSprintUtils'
import './ProjectSprintPanel.css'

function stripExtension(value) {
  return String(value || '').replace(/\.[^.]+$/, '')
}

function formatWords(value) {
  return Math.max(0, Number(value) || 0).toLocaleString('zh-CN')
}

function monthTitle(year, month) {
  return year + ' 年 ' + month + ' 月'
}

function previousMonth(year, month) {
  if (month <= 1) return { year: year - 1, month: 12 }
  return { year, month: month - 1 }
}

function nextMonth(year, month) {
  if (month >= 12) return { year: year + 1, month: 1 }
  return { year, month: month + 1 }
}

export default function ProjectSprintPanel({
  workspace,
  projectMeta,
  onMetaChange,
  onOpenFile,
}) {
  const now = new Date()
  const [history, setHistory] = useState([])
  const [calendarCursor, setCalendarCursor] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  })
  const [reviewDraft, setReviewDraft] = useState(
    () => readDailyReview(projectMeta, now)
  )

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

  useEffect(() => {
    setReviewDraft(readDailyReview(projectMeta, new Date()))
  }, [workspace?.project?.id, projectMeta?.dailyReviews])

  const calendar = useMemo(
    () => buildWritingCalendar(
      history,
      calendarCursor.year,
      calendarCursor.month,
      projectMeta?.dailyGoal || 0,
      new Date(),
    ),
    [
      calendarCursor.month,
      calendarCursor.year,
      history,
      projectMeta?.dailyGoal,
    ]
  )

  const todayStatus = useMemo(
    () => getTodayWritingStatus(
      history,
      projectMeta?.dailyGoal || 0,
      new Date(),
    ),
    [history, projectMeta?.dailyGoal]
  )

  const sprint = useMemo(
    () => calculateWritingSprint(
      projectMeta?.sprint,
      workspace,
      new Date(),
    ),
    [projectMeta?.sprint, workspace]
  )

  const breakReminder = useMemo(
    () => getBreakReminder(history, new Date(), 3),
    [history]
  )

  const todayQueue = useMemo(
    () => getTodayQueue(workspace, projectMeta, 3),
    [projectMeta, workspace]
  )

  const planningPreset = getProjectPlanningPreset(
    workspace?.project?.type || 'novel'
  )

  const updateMeta = patch => {
    onMetaChange?.(previous => ({
      ...previous,
      ...(typeof patch === 'function' ? patch(previous) : patch),
    }))
  }

  const startSprint = duration => {
    const dailyGoal = Math.max(
      0,
      Number(projectMeta?.dailyGoal) || planningPreset.dailyGoal,
    )
    updateMeta({
      sprint: createWritingSprint(
        workspace,
        duration,
        dailyGoal,
        new Date(),
      ),
    })
  }

  const stopSprint = () => {
    updateMeta(previous => ({
      sprint: previous.sprint
        ? { ...previous.sprint, active: false }
        : null,
    }))
  }

  const updateSprintGoal = value => {
    const goalWords = Math.max(0, Number(value) || 0)
    updateMeta(previous => ({
      sprint: previous.sprint
        ? { ...previous.sprint, goalWords }
        : previous.sprint,
    }))
  }

  const saveReview = () => {
    onMetaChange?.(previous => (
      writeDailyReview(
        previous,
        reviewDraft,
        new Date(),
      )
    ))
  }

  const moveCalendar = direction => {
    setCalendarCursor(current => (
      direction === 'previous'
        ? previousMonth(current.year, current.month)
        : nextMonth(current.year, current.month)
    ))
  }

  const resetCalendar = () => {
    const current = new Date()
    setCalendarCursor({
      year: current.getFullYear(),
      month: current.getMonth() + 1,
    })
  }

  return (
    <section className="project-sprint-panel" aria-label="创作日历与冲刺">
      <div className="project-sprint-head">
        <div>
          <strong>创作日历与冲刺</strong>
          <span>
            日历只使用真实每日字数快照；首个快照是基线，不会被计算成当天增量。
          </span>
        </div>
      </div>

      <div className="project-sprint-grid">
        <article className="project-sprint-card calendar-card">
          <header>
            <div>
              <strong>写作日历</strong>
              <span>
                {calendar.activeDays} 个活跃日 · {formatWords(calendar.totalDelta)} 字净增
              </span>
            </div>
            <div className="project-calendar-nav">
              <button
                type="button"
                onClick={() => moveCalendar('previous')}
                aria-label="上个月"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={resetCalendar}
                title="回到本月"
              >
                {monthTitle(calendar.year, calendar.month)}
              </button>
              <button
                type="button"
                onClick={() => moveCalendar('next')}
                aria-label="下个月"
              >
                ›
              </button>
            </div>
          </header>

          <div className="project-calendar-weekdays">
            {['日', '一', '二', '三', '四', '五', '六'].map(day => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="project-calendar-grid">
            {Array.from({ length: calendar.leadingDays }).map((_, index) => (
              <span key={'blank-' + index} className="project-calendar-blank" />
            ))}

            {calendar.days.map(day => (
              <button
                key={day.date}
                type="button"
                className={
                  'project-calendar-day level-' + day.level +
                  (day.today ? ' today' : '') +
                  (day.future ? ' future' : '') +
                  (day.goalMet ? ' goal-met' : '')
                }
                title={
                  day.baseline
                    ? day.date + ' · 基线快照'
                    : day.hasSnapshot
                      ? day.date + ' · ' + (day.delta >= 0 ? '+' : '') + day.delta + ' 字'
                      : day.date + ' · 暂无快照'
                }
              >
                <span>{day.day}</span>
                {day.hasSnapshot && !day.baseline && (
                  <small>{day.delta > 0 ? '+' + day.delta : day.delta}</small>
                )}
              </button>
            ))}
          </div>

          <div className="project-calendar-legend">
            <span>少</span>
            {[0, 1, 2, 3, 4].map(level => (
              <i key={level} className={'level-' + level} />
            ))}
            <span>多</span>
            {projectMeta?.dailyGoal > 0 && (
              <em>{calendar.goalDays} 天达成日目标</em>
            )}
          </div>
        </article>

        <article className="project-sprint-card today-card">
          <header>
            <div>
              <strong>今日执行</strong>
              <span>{todayStatus.date}</span>
            </div>
          </header>

          <div className="project-today-goal">
            <div>
              <span>今日净增</span>
              <strong>{formatWords(todayStatus.delta)}</strong>
            </div>
            <div>
              <span>日目标</span>
              <strong>
                {todayStatus.goal > 0
                  ? formatWords(todayStatus.goal)
                  : '未设置'}
              </strong>
            </div>
            <div>
              <span>完成度</span>
              <strong>
                {todayStatus.baseline
                  ? '基线日'
                  : todayStatus.goal > 0
                    ? todayStatus.completion + '%'
                    : '—'}
              </strong>
            </div>
          </div>

          <div className="project-today-progress">
            <span
              style={{
                width: String(
                  Math.min(100, todayStatus.completion || 0)
                ) + '%',
              }}
            />
          </div>

          <p>
            {todayStatus.baseline
              ? '今天是当前项目的首个字数基线；从下一个不同日期快照开始计算真实增量。'
              : todayStatus.goal > 0
                ? todayStatus.met
                  ? '今天的写作目标已经完成。'
                  : '距离今天目标还差 ' + formatWords(todayStatus.remaining) + ' 字。'
                : '在“创作计划”设置日目标后，这里会显示每日完成度。'}
          </p>

          {breakReminder.shouldRemind && (
            <div className="project-break-reminder">
              <strong>断更提醒</strong>
              <span>{breakReminder.message}</span>
            </div>
          )}

          <div className="project-today-queue">
            <strong>今日待写</strong>
            {todayQueue.length ? todayQueue.map((note, index) => (
              <button
                key={note.id}
                type="button"
                onClick={() => onOpenFile?.(note.id)}
              >
                <span>{index + 1}</span>
                <div>
                  <strong>{stripExtension(note.title)}</strong>
                  <small>
                    {note.volumeTitle || '未分卷'} ·
                    {note.status === 'review' ? ' 修订' : ' 草稿'}
                  </small>
                </div>
              </button>
            )) : (
              <small>当前没有未完成章节。</small>
            )}
          </div>
        </article>

        <article className="project-sprint-card sprint-card">
          <header>
            <div>
              <strong>写作冲刺</strong>
              <span>7 / 14 / 30 天集中推进</span>
            </div>
          </header>

          {!sprint.active ? (
            <>
              <div className="project-sprint-starts">
                {[7, 14, 30].map(duration => (
                  <button
                    key={duration}
                    type="button"
                    onClick={() => startSprint(duration)}
                  >
                    <strong>{duration} 天</strong>
                    <span>
                      目标约 {
                        formatWords(
                          (
                            Number(projectMeta?.dailyGoal) ||
                            planningPreset.dailyGoal
                          ) * duration
                        )
                      } 字
                    </span>
                  </button>
                ))}
              </div>
              <p>
                冲刺开始时会记录当前项目字数；之后只统计本次冲刺期间新增的字数。
              </p>
            </>
          ) : (
            <>
              <div className="project-sprint-status">
                <div>
                  <span>冲刺进度</span>
                  <strong>{sprint.completion}%</strong>
                </div>
                <div>
                  <span>已新增</span>
                  <strong>{formatWords(sprint.gainedWords)}</strong>
                </div>
                <div>
                  <span>剩余目标</span>
                  <strong>{formatWords(sprint.remainingWords)}</strong>
                </div>
                <div>
                  <span>倒计时</span>
                  <strong>
                    {sprint.expired
                      ? '已到期'
                      : sprint.finished
                        ? '已达标'
                        : sprint.remainingDays + ' 天'}
                  </strong>
                </div>
              </div>

              <div className="project-sprint-progress">
                <span
                  style={{
                    width: String(Math.min(100, sprint.completion)) + '%',
                  }}
                />
              </div>

              <label className="project-sprint-goal">
                <span>冲刺目标字数</span>
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={projectMeta?.sprint?.goalWords || ''}
                  onChange={event => updateSprintGoal(event.target.value)}
                  aria-label="冲刺目标字数"
                />
              </label>

              <div className="project-sprint-meta">
                <span>
                  {projectMeta?.sprint?.startDate} → {sprint.endDate}
                </span>
                <span>
                  第 {Math.min(sprint.durationDays, Math.max(1, sprint.elapsedDays))} / {sprint.durationDays} 天
                </span>
              </div>

              <button
                type="button"
                className="btn small"
                onClick={stopSprint}
              >
                结束当前冲刺
              </button>
            </>
          )}
        </article>

        <article className="project-sprint-card review-card">
          <header>
            <div>
              <strong>每日复盘</strong>
              <span>只保存在当前项目本机数据中</span>
            </div>
          </header>

          <textarea
            value={reviewDraft}
            onChange={event => setReviewDraft(event.target.value)}
            placeholder="今天推进了什么？卡在哪里？明天第一步做什么？"
            maxLength={1200}
            aria-label="今日写作复盘"
          />

          <div className="project-review-actions">
            <span>{reviewDraft.length}/1200</span>
            <button
              type="button"
              className="btn small primary"
              onClick={saveReview}
            >
              保存今日复盘
            </button>
          </div>
        </article>
      </div>
    </section>
  )
}
