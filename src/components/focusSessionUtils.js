export const FOCUS_SESSIONS_KEY = 'localNotepad.focusSessions.v1'

function normalizeId(value) {
  return String(value || '')
}

export function createFocusSession({
  projectId,
  noteId,
  noteTitle,
  durationMinutes = 50,
  startWords = 0,
  startedAt = Date.now(),
} = {}) {
  const minutes = [25, 50, 90].includes(Number(durationMinutes))
    ? Number(durationMinutes)
    : Math.max(1, Math.round(Number(durationMinutes) || 50))

  return {
    id: String(startedAt) + ':' + normalizeId(noteId),
    projectId: normalizeId(projectId),
    noteId: normalizeId(noteId),
    noteTitle: String(noteTitle || '未命名'),
    durationMinutes: minutes,
    startWords: Math.max(0, Number(startWords) || 0),
    startedAt: Number(startedAt) || Date.now(),
    active: true,
  }
}

export function getFocusSessionElapsedSeconds(
  session,
  now = Date.now(),
) {
  if (!session?.startedAt) return 0
  return Math.max(
    0,
    Math.floor((Number(now) - Number(session.startedAt)) / 1000),
  )
}

export function getFocusSessionRemainingSeconds(
  session,
  now = Date.now(),
) {
  if (!session?.durationMinutes) return 0
  const total = Math.max(1, Number(session.durationMinutes) || 0) * 60
  return Math.max(0, total - getFocusSessionElapsedSeconds(session, now))
}

export function finalizeFocusSession(
  session,
  currentWords,
  {
    endedAt = Date.now(),
    reason = 'manual',
  } = {},
) {
  if (!session?.projectId || !session?.noteId) return null

  const endWords = Math.max(0, Number(currentWords) || 0)
  const ended = Math.max(
    Number(session.startedAt) || 0,
    Number(endedAt) || Date.now(),
  )
  const elapsedSeconds = Math.max(
    0,
    Math.floor((ended - Number(session.startedAt || ended)) / 1000),
  )
  const plannedSeconds = Math.max(
    60,
    Math.round(Number(session.durationMinutes) || 0) * 60,
  )

  return {
    id: String(session.id || (session.startedAt + ':' + session.noteId)),
    projectId: normalizeId(session.projectId),
    noteId: normalizeId(session.noteId),
    noteTitle: String(session.noteTitle || '未命名'),
    durationMinutes: Math.max(1, Number(session.durationMinutes) || 50),
    startWords: Math.max(0, Number(session.startWords) || 0),
    endWords,
    wordDelta: endWords - Math.max(0, Number(session.startWords) || 0),
    startedAt: Number(session.startedAt) || ended,
    endedAt: ended,
    elapsedSeconds,
    completedTimer: elapsedSeconds >= plannedSeconds,
    reason: String(reason || 'manual'),
  }
}

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOCUS_SESSIONS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function readFocusSessionHistory(projectId, limit = 50) {
  const id = normalizeId(projectId)
  if (!id) return []

  const all = readAll()
  const history = Array.isArray(all[id]) ? all[id] : []
  return history
    .filter(item => item?.id && item?.noteId)
    .sort((a, b) => Number(b.endedAt || 0) - Number(a.endedAt || 0))
    .slice(0, Math.max(1, Number(limit) || 50))
}

export function appendFocusSession(record, limit = 180) {
  if (!record?.projectId || !record?.id) return []

  const all = readAll()
  const id = normalizeId(record.projectId)
  const previous = Array.isArray(all[id]) ? all[id] : []
  const next = [
    record,
    ...previous.filter(item => item?.id !== record.id),
  ]
    .sort((a, b) => Number(b.endedAt || 0) - Number(a.endedAt || 0))
    .slice(0, Math.max(1, Number(limit) || 180))

  try {
    all[id] = next
    localStorage.setItem(FOCUS_SESSIONS_KEY, JSON.stringify(all))
  } catch {
    // Session history is optional and must never block writing.
  }

  return next
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

export function getTodayFocusSummary(
  history,
  now = Date.now(),
) {
  const today = localDateKey(now)
  const sessions = (Array.isArray(history) ? history : [])
    .filter(item => localDateKey(item.endedAt || item.startedAt) === today)

  return {
    sessions,
    sessionCount: sessions.length,
    totalSeconds: sessions.reduce(
      (sum, item) => sum + Math.max(0, Number(item.elapsedSeconds) || 0),
      0,
    ),
    wordDelta: sessions.reduce(
      (sum, item) => sum + Number(item.wordDelta || 0),
      0,
    ),
    completedTimers: sessions.filter(item => item.completedTimer).length,
  }
}

export function formatFocusDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  if (hours > 0) return hours + ' 小时 ' + minutes + ' 分'
  return minutes + ' 分'
}

export function formatCountdown(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(value / 60)
  const secs = value % 60
  return String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0')
}


export function updateFocusSessionReview(
  projectId,
  sessionId,
  reviewNote,
) {
  const project = normalizeId(projectId)
  const id = String(sessionId || '')
  if (!project || !id) return null

  const all = readAll()
  const history = Array.isArray(all[project]) ? all[project] : []
  const index = history.findIndex(item => String(item?.id || '') === id)
  if (index < 0) return null

  const value = String(reviewNote || '').trim()
  const nextRecord = {
    ...history[index],
    reviewNote: value,
  }
  const next = [...history]
  next[index] = nextRecord

  try {
    all[project] = next
    localStorage.setItem(FOCUS_SESSIONS_KEY, JSON.stringify(all))
  } catch {
    // Review notes are optional and must never block writing.
  }

  return nextRecord
}

export function getFocusSessionReviewNote(session) {
  return String(session?.reviewNote || '')
}
