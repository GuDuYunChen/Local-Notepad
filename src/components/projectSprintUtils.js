import {
  addDays,
  dateKey,
  daysBetween,
  parseDateKey,
} from './projectPlanningUtils'

function sortedHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter(item => item?.date)
    .map(item => ({
      date: String(item.date),
      totalWords: Math.max(0, Number(item.totalWords) || 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function getDailyWritingDeltas(history) {
  const items = sortedHistory(history)
  return items.map((item, index) => ({
    ...item,
    baseline: index === 0,
    delta: index === 0
      ? 0
      : Number(item.totalWords || 0) - Number(items[index - 1].totalWords || 0),
  }))
}

function activityLevel(delta, dailyGoal) {
  const value = Math.max(0, Number(delta) || 0)
  const goal = Math.max(0, Number(dailyGoal) || 0)
  if (!value) return 0

  if (goal > 0) {
    const ratio = value / goal
    if (ratio >= 1.5) return 4
    if (ratio >= 1) return 3
    if (ratio >= 0.5) return 2
    return 1
  }

  if (value >= 3000) return 4
  if (value >= 1500) return 3
  if (value >= 500) return 2
  return 1
}

export function buildWritingCalendar(
  history,
  year,
  month,
  dailyGoal = 0,
  today = new Date(),
) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return {
      year: y,
      month: m,
      leadingDays: 0,
      days: [],
      totalDelta: 0,
      activeDays: 0,
      goalDays: 0,
    }
  }

  const deltas = new Map(
    getDailyWritingDeltas(history).map(item => [item.date, item])
  )
  const count = new Date(y, m, 0).getDate()
  const first = new Date(y, m - 1, 1, 12)
  const todayKey = dateKey(today)
  const days = []

  for (let day = 1; day <= count; day++) {
    const current = new Date(y, m - 1, day, 12)
    const key = dateKey(current)
    const snapshot = deltas.get(key) || null
    const delta = Number(snapshot?.delta) || 0
    const goal = Math.max(0, Number(dailyGoal) || 0)
    const completion = goal > 0 && !snapshot?.baseline
      ? Math.max(0, Math.round((Math.max(0, delta) / goal) * 100))
      : 0

    days.push({
      date: key,
      day,
      delta,
      baseline: Boolean(snapshot?.baseline),
      hasSnapshot: Boolean(snapshot),
      future: key > todayKey,
      today: key === todayKey,
      goalMet: goal > 0 && delta >= goal && !snapshot?.baseline,
      completion,
      level: snapshot?.baseline ? 0 : activityLevel(delta, goal),
    })
  }

  return {
    year: y,
    month: m,
    leadingDays: first.getDay(),
    days,
    totalDelta: days.reduce((sum, item) => sum + item.delta, 0),
    activeDays: days.filter(item => item.delta > 0).length,
    goalDays: days.filter(item => item.goalMet).length,
  }
}

export function getTodayWritingStatus(
  history,
  dailyGoal = 0,
  today = new Date(),
) {
  const key = dateKey(today)
  const item = getDailyWritingDeltas(history).find(entry => entry.date === key)
  const goal = Math.max(0, Number(dailyGoal) || 0)
  const delta = Number(item?.delta) || 0

  return {
    date: key,
    delta,
    goal,
    baseline: Boolean(item?.baseline),
    completion: goal > 0 && !item?.baseline
      ? Math.max(0, Math.round((Math.max(0, delta) / goal) * 100))
      : 0,
    remaining: goal > 0
      ? Math.max(0, goal - Math.max(0, delta))
      : 0,
    met: goal > 0 && delta >= goal && !item?.baseline,
  }
}

export function createWritingSprint(
  workspace,
  durationDays,
  dailyGoal = 0,
  startDate = new Date(),
) {
  const duration = [7, 14, 30].includes(Number(durationDays))
    ? Number(durationDays)
    : 7
  const startWords = Math.max(0, Number(workspace?.totalWords) || 0)
  const goalPerDay = Math.max(0, Number(dailyGoal) || 0)
  const defaultGoal = goalPerDay > 0 ? goalPerDay * duration : 0

  return {
    startDate: dateKey(startDate),
    durationDays: duration,
    startWords,
    goalWords: defaultGoal,
    active: true,
  }
}

export function calculateWritingSprint(
  sprint,
  workspace,
  today = new Date(),
) {
  if (!sprint?.active || !sprint.startDate) {
    return {
      active: false,
      durationDays: 0,
      elapsedDays: 0,
      remainingDays: 0,
      startWords: 0,
      currentWords: Math.max(0, Number(workspace?.totalWords) || 0),
      gainedWords: 0,
      goalWords: 0,
      remainingWords: 0,
      completion: 0,
      finished: false,
      expired: false,
      endDate: '',
    }
  }

  const start = parseDateKey(sprint.startDate)
  const duration = [7, 14, 30].includes(Number(sprint.durationDays))
    ? Number(sprint.durationDays)
    : 7
  const end = start ? addDays(start, duration - 1) : null
  const current = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    12,
  )
  const elapsedRaw = start ? daysBetween(start, current) + 1 : 0
  const elapsedDays = Math.max(0, Math.min(duration, elapsedRaw))
  const remainingDays = Math.max(0, duration - elapsedDays)
  const startWords = Math.max(0, Number(sprint.startWords) || 0)
  const currentWords = Math.max(0, Number(workspace?.totalWords) || 0)
  const gainedWords = Math.max(0, currentWords - startWords)
  const goalWords = Math.max(0, Number(sprint.goalWords) || 0)
  const completion = goalWords > 0
    ? Math.max(0, Math.round((gainedWords / goalWords) * 100))
    : 0
  const finished = goalWords > 0 && gainedWords >= goalWords
  const expired = Boolean(end && current > end && !finished)

  return {
    active: true,
    durationDays: duration,
    elapsedDays,
    remainingDays,
    startWords,
    currentWords,
    gainedWords,
    goalWords,
    remainingWords: Math.max(0, goalWords - gainedWords),
    completion,
    finished,
    expired,
    endDate: end ? dateKey(end) : '',
  }
}

export function getBreakReminder(
  history,
  today = new Date(),
  thresholdDays = 3,
) {
  const deltas = getDailyWritingDeltas(history)
    .filter(item => !item.baseline && item.delta > 0)
  const threshold = Math.max(1, Number(thresholdDays) || 3)
  const todayKey = dateKey(today)

  if (!deltas.length) {
    return {
      shouldRemind: false,
      idleDays: 0,
      lastActiveDate: '',
      message: '还没有足够的写作增量历史。',
    }
  }

  const last = deltas[deltas.length - 1]
  const lastDate = parseDateKey(last.date)
  const current = parseDateKey(todayKey)
  const idleDays = lastDate && current
    ? Math.max(0, daysBetween(lastDate, current))
    : 0

  return {
    shouldRemind: idleDays >= threshold,
    idleDays,
    lastActiveDate: last.date,
    message: idleDays >= threshold
      ? '已经 ' + idleDays + ' 天没有记录到正向写作增量。'
      : '最近一次正向写作在 ' + last.date + '。',
  }
}

export function getTodayQueue(workspace, projectMeta = {}, limit = 3) {
  const notes = (workspace?.volumes || []).flatMap(volume => (
    (volume.notes || []).map(note => ({
      ...note,
      volumeId: volume.id,
      volumeTitle: volume.title,
    }))
  ))
  const byId = new Map(notes.map(note => [String(note.id), note]))
  const stored = Array.isArray(projectMeta.chapterQueue)
    ? projectMeta.chapterQueue.map(String)
    : []
  const ordered = []
  const seen = new Set()

  for (const id of stored) {
    const note = byId.get(id)
    if (!note || note.status === 'done' || seen.has(id)) continue
    ordered.push(note)
    seen.add(id)
  }

  for (const note of notes) {
    if (note.status === 'done' || seen.has(note.id)) continue
    ordered.push(note)
    seen.add(note.id)
  }

  return ordered.slice(0, Math.max(1, Number(limit) || 3))
}

export function readDailyReview(projectMeta = {}, date = new Date()) {
  const key = dateKey(date)
  const reviews = projectMeta.dailyReviews || {}
  return String(reviews[key] || '')
}

export function writeDailyReview(projectMeta = {}, text, date = new Date()) {
  const key = dateKey(date)
  const reviews = {
    ...(projectMeta.dailyReviews || {}),
  }
  const value = String(text || '').trim()

  if (value) reviews[key] = value
  else delete reviews[key]

  return {
    ...projectMeta,
    dailyReviews: reviews,
  }
}
