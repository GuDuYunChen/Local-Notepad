function validSessions(history) {
  return (Array.isArray(history) ? history : [])
    .filter(item => item && item.endedAt && item.startedAt)
    .map(item => ({
      ...item,
      elapsedSeconds: Math.max(0, Number(item.elapsedSeconds) || 0),
      wordDelta: Number(item.wordDelta) || 0,
      durationMinutes: Math.max(1, Number(item.durationMinutes) || 0),
      startedAt: Number(item.startedAt) || 0,
      endedAt: Number(item.endedAt) || 0,
    }))
}

function productiveSessions(history) {
  return validSessions(history).filter(item => item.elapsedSeconds >= 300)
}

function wordsPerHour(session) {
  const seconds = Math.max(1, Number(session.elapsedSeconds) || 0)
  return Math.round((Number(session.wordDelta || 0) * 3600) / seconds)
}

function localDateKey(timestamp) {
  const date = new Date(Number(timestamp) || 0)
  if (Number.isNaN(date.getTime())) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function startOfDay(timestamp) {
  const date = new Date(Number(timestamp) || 0)
  if (Number.isNaN(date.getTime())) return null
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
    0,
    0,
    0,
  )
}

export function getSessionEfficiencySummary(history) {
  const sessions = productiveSessions(history)
  const positive = sessions.filter(item => item.wordDelta > 0)
  const totalSeconds = sessions.reduce((sum, item) => sum + item.elapsedSeconds, 0)
  const totalWords = sessions.reduce((sum, item) => sum + item.wordDelta, 0)

  return {
    sessionCount: sessions.length,
    productiveSessionCount: positive.length,
    totalSeconds,
    totalWords,
    averageWordsPerHour: totalSeconds > 0
      ? Math.round((totalWords * 3600) / totalSeconds)
      : 0,
    bestWordsPerHour: positive.length
      ? Math.max(...positive.map(wordsPerHour))
      : 0,
    reviewedSessions: sessions.filter(item => String(item.reviewNote || '').trim()).length,
    reviewCoverage: sessions.length
      ? Math.round(
        (sessions.filter(item => String(item.reviewNote || '').trim()).length /
          sessions.length) * 100
      )
      : 0,
  }
}

function timeBucket(hour) {
  if (hour >= 5 && hour < 9) return '清晨'
  if (hour >= 9 && hour < 12) return '上午'
  if (hour >= 12 && hour < 14) return '中午'
  if (hour >= 14 && hour < 18) return '下午'
  if (hour >= 18 && hour < 22) return '晚上'
  return '深夜'
}

export function getBestWritingTime(history) {
  const groups = new Map()

  for (const session of productiveSessions(history)) {
    const hour = new Date(session.startedAt).getHours()
    const bucket = timeBucket(hour)
    const group = groups.get(bucket) || {
      label: bucket,
      sessions: 0,
      seconds: 0,
      words: 0,
    }
    group.sessions += 1
    group.seconds += session.elapsedSeconds
    group.words += session.wordDelta
    groups.set(bucket, group)
  }

  const result = Array.from(groups.values())
    .map(item => ({
      ...item,
      wordsPerHour: item.seconds > 0
        ? Math.round((item.words * 3600) / item.seconds)
        : 0,
    }))
    .sort((a, b) => (
      b.wordsPerHour - a.wordsPerHour ||
      b.sessions - a.sessions
    ))

  return {
    best: result[0] || null,
    buckets: result,
  }
}

export function compareFocusDurations(history) {
  const durations = [25, 50, 90]
  return durations.map(durationMinutes => {
    const sessions = productiveSessions(history)
      .filter(item => item.durationMinutes === durationMinutes)

    const totalSeconds = sessions.reduce(
      (sum, item) => sum + item.elapsedSeconds,
      0,
    )
    const totalWords = sessions.reduce(
      (sum, item) => sum + item.wordDelta,
      0,
    )

    return {
      durationMinutes,
      sessions: sessions.length,
      totalWords,
      averageWordDelta: sessions.length
        ? Math.round(totalWords / sessions.length)
        : 0,
      wordsPerHour: totalSeconds > 0
        ? Math.round((totalWords * 3600) / totalSeconds)
        : 0,
      completionRate: sessions.length
        ? Math.round(
          (sessions.filter(item => item.completedTimer).length /
            sessions.length) * 100
        )
        : 0,
    }
  })
}

export function getSessionTrend(
  history,
  days = 7,
  now = Date.now(),
) {
  const count = Math.max(1, Number(days) || 7)
  const today = startOfDay(now)
  if (!today) return []

  const byDate = new Map()

  for (const session of validSessions(history)) {
    const key = localDateKey(session.endedAt)
    const existing = byDate.get(key) || {
      date: key,
      sessions: 0,
      seconds: 0,
      words: 0,
    }
    existing.sessions += 1
    existing.seconds += session.elapsedSeconds
    existing.words += session.wordDelta
    byDate.set(key, existing)
  }

  const result = []
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = new Date(today.getTime())
    date.setDate(date.getDate() - offset)
    const key = localDateKey(date.getTime())
    const item = byDate.get(key) || {
      date: key,
      sessions: 0,
      seconds: 0,
      words: 0,
    }
    result.push({
      ...item,
      wordsPerHour: item.seconds > 0
        ? Math.round((item.words * 3600) / item.seconds)
        : 0,
    })
  }

  return result
}

export function getChapterSessionEfficiency(history) {
  const groups = new Map()

  for (const session of productiveSessions(history)) {
    const id = String(session.noteId || '')
    if (!id) continue

    const item = groups.get(id) || {
      noteId: id,
      noteTitle: String(session.noteTitle || '未命名'),
      sessions: 0,
      seconds: 0,
      words: 0,
      completedTimers: 0,
    }
    item.sessions += 1
    item.seconds += session.elapsedSeconds
    item.words += session.wordDelta
    if (session.completedTimer) item.completedTimers += 1
    groups.set(id, item)
  }

  return Array.from(groups.values())
    .map(item => ({
      ...item,
      averageWordDelta: item.sessions
        ? Math.round(item.words / item.sessions)
        : 0,
      wordsPerHour: item.seconds > 0
        ? Math.round((item.words * 3600) / item.seconds)
        : 0,
      completionRate: item.sessions
        ? Math.round((item.completedTimers / item.sessions) * 100)
        : 0,
    }))
    .sort((a, b) => (
      b.wordsPerHour - a.wordsPerHour ||
      b.sessions - a.sessions
    ))
}

export function getSessionReviewStats(history) {
  const sessions = validSessions(history)
  const withReview = sessions.filter(item => String(item.reviewNote || '').trim())
  const recent = withReview
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 6)

  return {
    total: sessions.length,
    reviewed: withReview.length,
    coverage: sessions.length
      ? Math.round((withReview.length / sessions.length) * 100)
      : 0,
    recent,
  }
}
