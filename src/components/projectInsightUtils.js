import {
  findStaleProjectChapters,
  getForeshadowAnalysis,
  getWritingRhythm,
} from './projectAnalyticsUtils'
import {
  calculateProjectPlan,
  getPlanningHealth,
} from './projectPlanningUtils'
import { getDailyWritingDeltas } from './projectSprintUtils'
import {
  getBestWritingTime,
  getChapterSessionEfficiency,
  getSessionEfficiencySummary,
} from './focusSessionAnalyticsUtils'

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function startOfPeriod(days, now) {
  const date = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  )
  date.setDate(date.getDate() - Math.max(0, Number(days) - 1))
  return date
}

function dayDistance(fromKey, toKey) {
  const from = new Date(fromKey + 'T12:00:00')
  const to = new Date(toKey + 'T12:00:00')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000))
}

function sessionsInPeriod(history, days, now) {
  const start = startOfPeriod(days, now).getTime()
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  ).getTime()

  return (Array.isArray(history) ? history : []).filter(session => {
    const timestamp = Number(session?.endedAt || session?.startedAt) || 0
    return timestamp >= start && timestamp <= end
  })
}

export function getInsightPeriodStats(
  analyticsHistory,
  days = 7,
  now = new Date(),
  dailyGoal = 0,
) {
  const count = Math.max(1, Number(days) || 7)
  const startKey = localDateKey(startOfPeriod(count, now))
  const endKey = localDateKey(now)
  const deltas = getDailyWritingDeltas(analyticsHistory)
    .filter(item => item.date >= startKey && item.date <= endKey)

  const positive = deltas.filter(item => item.delta > 0)
  const negative = deltas.filter(item => item.delta < 0)
  const netWords = deltas.reduce((sum, item) => sum + Number(item.delta || 0), 0)
  const positiveWords = positive.reduce(
    (sum, item) => sum + Number(item.delta || 0),
    0,
  )
  const goal = Math.max(0, Number(dailyGoal) || 0)
  const goalDays = goal > 0
    ? deltas.filter(item => item.delta >= goal && !item.baseline).length
    : 0

  const sortedHistory = (Array.isArray(analyticsHistory) ? analyticsHistory : [])
    .filter(item => item?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const firstDate = sortedHistory[0]?.date || ''
  const coverageStart = firstDate && firstDate > startKey ? firstDate : startKey
  const coverageDays = firstDate
    ? Math.min(count, dayDistance(coverageStart, endKey) + 1)
    : 0

  return {
    days: count,
    startDate: startKey,
    endDate: endKey,
    netWords,
    positiveWords,
    activeDays: positive.length,
    rewriteDays: negative.length,
    averageActiveDay: positive.length
      ? Math.round(positiveWords / positive.length)
      : 0,
    goalDays,
    coverageDays,
    coverageLimited: coverageDays < count,
    firstRecordedDate: firstDate,
  }
}

export function getInsightSessionStats(
  sessionHistory,
  days = 7,
  now = new Date(),
) {
  const sessions = sessionsInPeriod(sessionHistory, days, now)
  const effective = sessions.filter(
    item => Math.max(0, Number(item.elapsedSeconds) || 0) >= 300,
  )
  const summary = getSessionEfficiencySummary(effective)
  const totalSeconds = sessions.reduce(
    (sum, item) => sum + Math.max(0, Number(item.elapsedSeconds) || 0),
    0,
  )
  const totalWords = sessions.reduce(
    (sum, item) => sum + Number(item.wordDelta || 0),
    0,
  )

  return {
    ...summary,
    allSessionCount: sessions.length,
    effectiveSessionCount: effective.length,
    totalSecondsAll: totalSeconds,
    totalWordsAll: totalWords,
    sessions,
    effectiveSessions: effective,
  }
}

export function getDifficultChapters(sessionHistory, days = 30, now = new Date()) {
  const sessions = sessionsInPeriod(sessionHistory, days, now)
    .filter(item => Math.max(0, Number(item.elapsedSeconds) || 0) >= 300)
  const summary = getSessionEfficiencySummary(sessions)
  const projectAverage = Number(summary.averageWordsPerHour) || 0

  if (!projectAverage) return []

  return getChapterSessionEfficiency(sessions)
    .filter(item => item.sessions >= 2)
    .map(item => {
      const ratio = item.wordsPerHour / projectAverage
      let score = 0
      const reasons = []

      if (ratio < 0.6) {
        score += 3
        reasons.push('效率低于项目平均 40% 以上')
      } else if (ratio < 0.8) {
        score += 2
        reasons.push('效率低于项目平均 20% 以上')
      } else if (ratio < 1) {
        score += 1
        reasons.push('效率低于项目平均')
      }

      if (item.completionRate < 50) {
        score += 1
        reasons.push('完整计时率低于 50%')
      }
      if (item.sessions >= 4) {
        score += 1
        reasons.push('已投入至少 4 个有效 Session')
      }

      return {
        ...item,
        projectAverage,
        efficiencyRatio: ratio,
        difficultyScore: score,
        difficulty: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low',
        reasons,
      }
    })
    .filter(item => item.difficultyScore >= 2)
    .sort((a, b) => (
      b.difficultyScore - a.difficultyScore ||
      a.wordsPerHour - b.wordsPerHour
    ))
}

function hasLowEfficiencyStreak(sessionStats) {
  const sessions = [...(sessionStats.effectiveSessions || [])]
    .sort((a, b) => Number(b.endedAt || 0) - Number(a.endedAt || 0))
    .slice(0, 3)
  const average = Number(sessionStats.averageWordsPerHour) || 0

  if (sessions.length < 3 || average <= 0) return false

  return sessions.every(session => {
    const seconds = Math.max(1, Number(session.elapsedSeconds) || 0)
    const wph = Math.round((Number(session.wordDelta || 0) * 3600) / seconds)
    return Number(session.wordDelta || 0) <= 0 || wph < average * 0.65
  })
}

export function buildProjectInsights({
  workspace,
  projectMeta = {},
  analyticsHistory = [],
  sessionHistory = [],
  projectIndexes = {},
  periodDays = 7,
  now = new Date(),
} = {}) {
  const period = getInsightPeriodStats(
    analyticsHistory,
    periodDays,
    now,
    projectMeta.dailyGoal,
  )
  const sessions = getInsightSessionStats(
    sessionHistory,
    periodDays,
    now,
  )
  const rhythm = getWritingRhythm(analyticsHistory, now)
  const plan = calculateProjectPlan(workspace, projectMeta, rhythm, now)
  const planHealth = getPlanningHealth(plan)
  const periodSessions = sessions.effectiveSessions
  const bestTime = getBestWritingTime(periodSessions)
  const difficultChapters = getDifficultChapters(
    sessionHistory,
    Math.max(30, periodDays),
    now,
  )
  const staleChapters = findStaleProjectChapters(
    workspace,
    projectMeta,
    Math.floor(now.getTime() / 1000),
    14,
  )
  const foreshadows = getForeshadowAnalysis(projectIndexes, projectMeta)
  const alerts = []
  const recommendations = []

  if (plan.scheduleStatus === 'behind') {
    alerts.push({
      id: 'plan-behind',
      tone: 'high',
      title: '项目进度落后',
      detail: plan.requiredDaily > 0
        ? '按当前截止日期，至少需要 ' + plan.requiredDaily.toLocaleString('zh-CN') + ' 字/天。'
        : planHealth.message,
    })
    recommendations.push({
      id: 'pace',
      title: '先修正计划节奏',
      detail: plan.requiredDaily > 0
        ? '把接下来几天的日目标对齐到约 ' + plan.requiredDaily.toLocaleString('zh-CN') + ' 字，或重新调整截止日期。'
        : '补充日/周目标或调整截止日期，让计划重新可计算。',
    })
  }

  if (
    periodDays === 7 &&
    Number(projectMeta.weeklyGoal) > 0 &&
    period.netWords < Number(projectMeta.weeklyGoal)
  ) {
    const gap = Math.max(
      0,
      Number(projectMeta.weeklyGoal) - period.netWords,
    )
    alerts.push({
      id: 'weekly-gap',
      tone: 'medium',
      title: '近 7 天低于周目标',
      detail: '当前净增 ' + period.netWords.toLocaleString('zh-CN') +
        ' 字，距离周目标还差 ' + gap.toLocaleString('zh-CN') + ' 字。',
    })
  }

  if (hasLowEfficiencyStreak(sessions)) {
    alerts.push({
      id: 'low-efficiency-streak',
      tone: 'medium',
      title: '最近 3 个 Session 效率持续偏低',
      detail: '这 3 个有效 Session 都低于个人当前平均效率的 65%，或出现净删改。',
    })
    recommendations.push({
      id: 'shorter-session',
      title: '下一次先缩短 Session',
      detail: '先用 25 分钟完成一个明确小目标，再决定是否继续拉长到 50/90 分钟。',
    })
  }

  if (difficultChapters.length) {
    const top = difficultChapters[0]
    alerts.push({
      id: 'difficult-chapter',
      tone: top.difficulty === 'high' ? 'high' : 'medium',
      title: '章节投入与产出不匹配：' + String(top.noteTitle || '未命名').replace(/\.[^.]+$/, ''),
      detail: top.sessions + ' 个有效 Session，约 ' +
        top.wordsPerHour.toLocaleString('zh-CN') + ' 字/小时。',
      noteId: top.noteId,
    })
    recommendations.push({
      id: 'split-hard-chapter',
      title: '先拆解最难写章节',
      detail: '把“' + String(top.noteTitle || '未命名').replace(/\.[^.]+$/, '') +
        '”拆成一个可在单次 Session 内完成的具体段落或场景目标。',
      noteId: top.noteId,
    })
  }

  if (staleChapters.length) {
    const top = staleChapters[0]
    alerts.push({
      id: 'stale-chapter',
      tone: 'medium',
      title: '有未完成章节长期未推进',
      detail: String(top.title || '未命名').replace(/\.[^.]+$/, '') +
        ' 已 ' + top.idleDays + ' 天没有修改。',
      noteId: top.id,
    })
  }

  if (
    bestTime.best &&
    bestTime.best.sessions >= 2 &&
    sessions.averageWordsPerHour > 0 &&
    bestTime.best.wordsPerHour >= sessions.averageWordsPerHour * 1.15
  ) {
    recommendations.push({
      id: 'best-time',
      title: '把难任务安排到' + bestTime.best.label,
      detail: '近 ' + periodDays + ' 天该时段约 ' +
        bestTime.best.wordsPerHour.toLocaleString('zh-CN') +
        ' 字/小时，高于当前有效 Session 平均。',
    })
  }

  if (
    sessions.effectiveSessionCount >= 3 &&
    sessions.reviewCoverage < 50
  ) {
    recommendations.push({
      id: 'review-coverage',
      title: '提高 Session 复盘覆盖率',
      detail: '当前仅 ' + sessions.reviewCoverage +
        '% 的有效 Session 有复盘备注，建议结束后至少记录一句“卡点/下一步”。',
    })
  }

  if (foreshadows.open >= 5) {
    recommendations.push({
      id: 'foreshadows',
      title: '安排一次伏笔清点',
      detail: '当前有 ' + foreshadows.open +
        ' 个待回收伏笔，可在下一卷/下一阶段规划前统一检查。',
    })
  }

  if (!alerts.length) {
    alerts.push({
      id: 'stable',
      tone: 'good',
      title: '当前没有明显异常信号',
      detail: '现有计划、章节推进和 Session 数据没有触发高优先级提醒。',
    })
  }

  if (!recommendations.length) {
    recommendations.push({
      id: 'continue',
      title: '保持当前节奏',
      detail: '优先继续下一章节队列，并保持每日目标与 Session 复盘。',
    })
  }

  return {
    period,
    sessions,
    rhythm,
    plan,
    planHealth,
    bestTime,
    difficultChapters,
    staleChapters,
    foreshadows,
    alerts,
    recommendations,
  }
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(value / 3600)
  const minutes = Math.round((value % 3600) / 60)
  if (hours > 0) return hours + '小时' + (minutes ? minutes + '分' : '')
  return minutes + '分'
}

export function formatProjectInsightReport(
  snapshot,
  workspace,
  projectMeta = {},
) {
  const period = snapshot?.period || {}
  const sessions = snapshot?.sessions || {}
  const best = snapshot?.bestTime?.best
  const title = String(workspace?.project?.title || '创作项目')
  const label = period.days === 30 ? '30 天复盘' : '7 天复盘'
  const currentCompleted = (workspace?.volumes || [])
    .flatMap(volume => volume.notes || [])
    .filter(note => note.status === 'done').length
  const currentTotal = (workspace?.volumes || [])
    .reduce((sum, volume) => sum + (volume.notes || []).length, 0)

  const lines = [
    '# ' + title + ' · ' + label,
    '',
    '## 数据范围',
    '- ' + period.startDate + ' → ' + period.endDate,
    '- 当前覆盖：' + period.coverageDays + '/' + period.days + ' 天' +
      (period.coverageLimited ? '（历史数据不足，报告按现有数据生成）' : ''),
    '',
    '## 写作产出',
    '- 净增字数：' + Number(period.netWords || 0).toLocaleString('zh-CN'),
    '- 活跃写作日：' + Number(period.activeDays || 0),
    '- 活跃日平均：' + Number(period.averageActiveDay || 0).toLocaleString('zh-CN') + ' 字',
    projectMeta.dailyGoal > 0
      ? '- 达成日目标：' + Number(period.goalDays || 0) + ' 天'
      : '- 达成日目标：未设置日目标',
    '',
    '## 专注 Session',
    '- Session：' + Number(sessions.allSessionCount || 0) + ' 次（有效 ' +
      Number(sessions.effectiveSessionCount || 0) + ' 次）',
    '- 专注时长：' + formatDuration(sessions.totalSecondsAll),
    '- Session 净字数：' + Number(sessions.totalWordsAll || 0).toLocaleString('zh-CN'),
    '- 有效 Session 平均效率：' +
      Number(sessions.averageWordsPerHour || 0).toLocaleString('zh-CN') + ' 字/小时',
    '- Session 复盘覆盖：' + Number(sessions.reviewCoverage || 0) + '%',
    best
      ? '- 最佳写作时段：' + best.label + '（约 ' +
        Number(best.wordsPerHour || 0).toLocaleString('zh-CN') + ' 字/小时）'
      : '- 最佳写作时段：数据不足',
    '',
    '## 当前项目状态',
    '- 总字数：' + Number(workspace?.totalWords || 0).toLocaleString('zh-CN'),
    '- 完成章节：' + currentCompleted + '/' + currentTotal,
    '- 计划状态：' + String(snapshot?.planHealth?.label || '尚未规划'),
    '- 待回收伏笔：' + Number(snapshot?.foreshadows?.open || 0),
    '',
    '## 提醒',
    ...(snapshot?.alerts || []).map(item => '- ' + item.title + '：' + item.detail),
    '',
    '## 下一阶段建议',
    ...(snapshot?.recommendations || []).map(
      (item, index) => (index + 1) + '. ' + item.title + '：' + item.detail
    ),
  ]

  return lines.join('\n')
}
