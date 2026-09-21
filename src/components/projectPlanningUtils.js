export function normalizeDateInput(value) {
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return ''
  }
  return text
}

export function dateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return ''
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-')
}

export function parseDateKey(value) {
  const normalized = normalizeDateInput(value)
  if (!normalized) return null
  const [year, month, day] = normalized.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

export function daysBetween(start, end) {
  const a = start instanceof Date ? start : new Date(start)
  const b = end instanceof Date ? end : new Date(end)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.ceil((b.getTime() - a.getTime()) / 86400000)
}

export function addDays(value, days) {
  const date = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  date.setDate(date.getDate() + Math.max(0, Math.ceil(Number(days) || 0)))
  return date
}

export function getProjectPlanningPreset(type = 'novel') {
  if (type === 'script') {
    return {
      dailyGoal: 1200,
      weeklyGoal: 6000,
      chapterBatch: 5,
      label: '剧本节奏',
      description: '以场次推进为主，默认每周 5 个活跃写作日。',
    }
  }

  return {
    dailyGoal: 2000,
    weeklyGoal: 12000,
    chapterBatch: 7,
    label: '小说节奏',
    description: '以章节持续产出为主，默认每周约 6 个活跃写作日。',
  }
}

function manuscriptNotes(workspace) {
  return (workspace?.volumes || []).flatMap(volume => (
    (volume.notes || []).map(note => ({
      ...note,
      volumeId: volume.id,
      volumeTitle: volume.title,
    }))
  ))
}

export function getObservedPlanningPace(rhythm = {}, projectMeta = {}) {
  const observedDaily = rhythm?.baselineReady && Number(rhythm.averageActiveDay) > 0
    ? Math.max(0, Number(rhythm.averageActiveDay) || 0)
    : 0

  const plannedDaily = Math.max(0, Number(projectMeta.dailyGoal) || 0)
  const plannedWeekly = Math.max(0, Number(projectMeta.weeklyGoal) || 0)
  const weeklyDailyEquivalent = plannedWeekly > 0
    ? Math.round(plannedWeekly / 7)
    : 0

  return {
    observedDaily,
    plannedDaily,
    effectiveDaily: observedDaily || plannedDaily || weeklyDailyEquivalent,
    source: observedDaily
      ? 'observed'
      : plannedDaily
        ? 'daily-goal'
        : weeklyDailyEquivalent
          ? 'weekly-goal'
          : 'none',
  }
}

export function calculateProjectPlan(
  workspace,
  projectMeta = {},
  rhythm = {},
  now = new Date(),
) {
  const totalWords = Math.max(0, Number(workspace?.totalWords) || 0)
  const targetWords = Math.max(0, Number(projectMeta.targetWords) || 0)
  const remainingWords = Math.max(0, targetWords - totalWords)
  const deadline = normalizeDateInput(projectMeta.deadline)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0)
  const deadlineDate = deadline ? parseDateKey(deadline) : null
  const remainingDays = deadlineDate
    ? Math.max(0, daysBetween(today, deadlineDate))
    : null

  const pace = getObservedPlanningPace(rhythm, projectMeta)
  const requiredDaily = (
    targetWords > 0 &&
    remainingWords > 0 &&
    remainingDays !== null
  )
    ? Math.ceil(remainingWords / Math.max(1, remainingDays))
    : 0

  const estimatedDays = remainingWords > 0 && pace.effectiveDaily > 0
    ? Math.ceil(remainingWords / pace.effectiveDaily)
    : 0
  const estimatedDate = estimatedDays > 0
    ? dateKey(addDays(today, estimatedDays))
    : (remainingWords === 0 && targetWords > 0 ? dateKey(today) : '')

  let scheduleStatus = 'unplanned'
  if (targetWords > 0 && remainingWords === 0) {
    scheduleStatus = 'complete'
  } else if (deadline && targetWords > 0) {
    if (remainingDays === 0 && remainingWords > 0) {
      scheduleStatus = 'behind'
    } else if (!pace.effectiveDaily) {
      scheduleStatus = 'no-pace'
    } else if (pace.effectiveDaily >= requiredDaily * 1.15) {
      scheduleStatus = 'ahead'
    } else if (pace.effectiveDaily + 1 < requiredDaily) {
      scheduleStatus = 'behind'
    } else {
      scheduleStatus = 'on-track'
    }
  } else if (targetWords > 0 && pace.effectiveDaily > 0) {
    scheduleStatus = 'forecast'
  }

  return {
    totalWords,
    targetWords,
    remainingWords,
    deadline,
    remainingDays,
    requiredDaily,
    estimatedDays,
    estimatedDate,
    scheduleStatus,
    pace,
  }
}

export function getVolumeMilestonePlan(workspace, projectMeta = {}, now = new Date()) {
  const milestones = projectMeta.volumeMilestones || {}
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0)

  return (workspace?.volumes || []).map(volume => {
    const config = milestones[volume.id || '__ungrouped__'] || {}
    const deadline = normalizeDateInput(config.deadline)
    const deadlineDate = deadline ? parseDateKey(deadline) : null
    const notes = volume.notes || []
    const completed = notes.filter(note => note.status === 'done').length
    const total = notes.length
    const percent = total ? Math.round((completed / total) * 100) : 0
    const overdue = Boolean(
      deadlineDate &&
      daysBetween(today, deadlineDate) < 0 &&
      percent < 100
    )

    return {
      id: volume.id,
      key: volume.id || '__ungrouped__',
      title: volume.title,
      deadline,
      completed,
      total,
      percent,
      overdue,
      daysRemaining: deadlineDate
        ? daysBetween(today, deadlineDate)
        : null,
      wordCount: Number(volume.wordCount) || 0,
    }
  })
}

export function normalizeChapterQueue(workspace, projectMeta = {}) {
  const notes = manuscriptNotes(workspace)
  const byId = new Map(notes.map(note => [note.id, note]))
  const stored = Array.isArray(projectMeta.chapterQueue)
    ? projectMeta.chapterQueue.map(String)
    : []

  const queue = []
  const seen = new Set()

  for (const id of stored) {
    const note = byId.get(id)
    if (!note || note.status === 'done' || seen.has(id)) continue
    queue.push(note)
    seen.add(id)
  }

  for (const note of notes) {
    if (note.status === 'done' || seen.has(note.id)) continue
    queue.push(note)
    seen.add(note.id)
  }

  return queue
}

export function moveChapterQueue(queueIds, noteId, direction) {
  const ids = [...new Set((Array.isArray(queueIds) ? queueIds : []).map(String))]
  const index = ids.indexOf(String(noteId))
  if (index < 0) return ids

  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= ids.length) return ids

  const next = [...ids]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function prioritizeChapterQueue(queueIds, noteId) {
  const id = String(noteId || '')
  if (!id) return Array.isArray(queueIds) ? [...queueIds] : []
  return [
    id,
    ...(Array.isArray(queueIds) ? queueIds : []).map(String).filter(item => item !== id),
  ]
}

export function getNextPlannedChapters(workspace, projectMeta = {}, limit = 6) {
  return normalizeChapterQueue(workspace, projectMeta)
    .slice(0, Math.max(1, Number(limit) || 6))
}

export function getPlanningHealth(plan) {
  const status = plan?.scheduleStatus || 'unplanned'
  const copy = {
    complete: {
      label: '已达目标',
      tone: 'done',
      message: '项目字数目标已经完成。',
    },
    ahead: {
      label: '进度超前',
      tone: 'ahead',
      message: '当前有效写作速度高于按截止日期所需速度。',
    },
    'on-track': {
      label: '按计划推进',
      tone: 'track',
      message: '当前写作速度可以覆盖截止日期所需节奏。',
    },
    behind: {
      label: '进度落后',
      tone: 'behind',
      message: '当前速度低于截止日期需要的速度。',
    },
    'no-pace': {
      label: '缺少节奏',
      tone: 'warning',
      message: '已设置截止日期，但还没有可用于估算的日/周目标或写作基线。',
    },
    forecast: {
      label: '已有预测',
      tone: 'forecast',
      message: '尚未设置截止日期，当前只能给出预计完稿时间。',
    },
    unplanned: {
      label: '尚未规划',
      tone: 'muted',
      message: '设置目标字数和截止日期后可开始计划跟踪。',
    },
  }

  return copy[status] || copy.unplanned
}
