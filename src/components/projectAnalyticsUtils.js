import { extractLexicalText } from '~/utils/lexicalText'

export const PROJECT_ANALYTICS_KEY = 'localNotepad.projectAnalytics.v1'

function normalizeId(value) {
  return String(value || '')
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

function dateKeyFromTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function parseDateKey(key) {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
    0,
    0,
    0,
  )
  return Number.isNaN(date.getTime()) ? null : date
}

function dayDistance(fromKey, toKey) {
  const from = parseDateKey(fromKey)
  const to = parseDateKey(toKey)
  if (!from || !to) return null
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

function readAllAnalytics() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECT_ANALYTICS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAllAnalytics(value) {
  try {
    localStorage.setItem(PROJECT_ANALYTICS_KEY, JSON.stringify(value))
  } catch {
    // Analytics are optional and must never block writing.
  }
}

export function readProjectAnalyticsHistory(projectId) {
  const id = normalizeId(projectId)
  if (!id) return []

  const all = readAllAnalytics()
  const history = Array.isArray(all[id]) ? all[id] : []

  return history
    .filter(item => item?.date)
    .map(item => ({
      date: String(item.date),
      totalWords: Math.max(0, Number(item.totalWords) || 0),
      noteWords: item.noteWords && typeof item.noteWords === 'object'
        ? { ...item.noteWords }
        : {},
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function recordProjectAnalyticsSnapshot(
  projectId,
  workspace,
  date = new Date(),
) {
  const id = normalizeId(projectId)
  if (!id || !workspace) return []

  const history = readProjectAnalyticsHistory(id)
  const key = dateKeyFromTimestamp(date)
  if (!key) return history

  const notes = manuscriptNotes(workspace)
  const snapshot = {
    date: key,
    totalWords: Math.max(0, Number(workspace.totalWords) || 0),
    noteWords: Object.fromEntries(
      notes.map(note => [
        note.id,
        Math.max(0, Number(note.wordCount) || 0),
      ])
    ),
  }

  const next = history.filter(item => item.date !== key)
  next.push(snapshot)
  next.sort((a, b) => a.date.localeCompare(b.date))

  const trimmed = next.slice(-180)
  const all = readAllAnalytics()
  all[id] = trimmed
  writeAllAnalytics(all)
  return trimmed
}

export function getWritingRhythm(history, currentDate = new Date()) {
  const items = (Array.isArray(history) ? history : [])
    .filter(item => item?.date)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!items.length) {
    return {
      baselineReady: false,
      dailyDelta: 0,
      weeklyDelta: 0,
      activeDays: 0,
      averageActiveDay: 0,
      streak: 0,
      firstDate: '',
      latestDate: '',
    }
  }

  const deltas = []
  for (let index = 0; index < items.length; index++) {
    const current = items[index]
    const previous = index > 0 ? items[index - 1] : null
    deltas.push({
      date: current.date,
      delta: previous
        ? Number(current.totalWords || 0) - Number(previous.totalWords || 0)
        : 0,
    })
  }

  const todayKey = dateKeyFromTimestamp(currentDate)
  const last = items[items.length - 1]
  const dailyDelta = deltas[deltas.length - 1]?.delta || 0

  const weekly = deltas.filter(item => {
    const distance = dayDistance(item.date, todayKey)
    return distance !== null && distance >= 0 && distance <= 6
  })
  const weeklyDelta = weekly.reduce((sum, item) => sum + item.delta, 0)
  const positiveDays = weekly.filter(item => item.delta > 0)
  const averageActiveDay = positiveDays.length
    ? Math.round(
      positiveDays.reduce((sum, item) => sum + item.delta, 0) /
      positiveDays.length
    )
    : 0

  let streak = 0
  let cursorKey = todayKey
  for (let index = deltas.length - 1; index >= 0; index--) {
    const item = deltas[index]
    const distance = dayDistance(item.date, cursorKey)
    if (distance === null || distance > 1) break
    if (item.delta <= 0) break
    streak += 1
    cursorKey = item.date
  }

  return {
    baselineReady: items.length >= 2,
    dailyDelta,
    weeklyDelta,
    activeDays: positiveDays.length,
    averageActiveDay,
    streak,
    firstDate: items[0]?.date || '',
    latestDate: last?.date || '',
  }
}

function median(values) {
  const numbers = [...values]
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (!numbers.length) return 0
  const mid = Math.floor(numbers.length / 2)
  return numbers.length % 2
    ? numbers[mid]
    : Math.round((numbers[mid - 1] + numbers[mid]) / 2)
}

export function analyzeChapterLengths(
  workspace,
  {
    projectType = 'novel',
    targetWords = 0,
  } = {},
) {
  const notes = manuscriptNotes(workspace)
  const positive = notes
    .map(note => Number(note.wordCount) || 0)
    .filter(value => value > 0)
  const center = Math.max(0, Number(targetWords) || median(positive))

  if (!notes.length) {
    return {
      targetWords: center,
      medianWords: 0,
      averageWords: 0,
      shortest: null,
      longest: null,
      alerts: [],
    }
  }

  const sorted = [...notes].sort(
    (a, b) => Number(a.wordCount || 0) - Number(b.wordCount || 0)
  )
  const averageWords = Math.round(
    notes.reduce((sum, note) => sum + Number(note.wordCount || 0), 0) /
    notes.length
  )
  const medianWords = median(positive)

  if (!center || notes.length < 3) {
    return {
      targetWords: center,
      medianWords,
      averageWords,
      shortest: sorted[0] || null,
      longest: sorted[sorted.length - 1] || null,
      alerts: [],
    }
  }

  const shortFloor = projectType === 'script' ? 120 : 350
  const longFloor = projectType === 'script' ? 1800 : 4200
  const shortThreshold = Math.max(shortFloor, Math.round(center * 0.55))
  const longThreshold = Math.max(longFloor, Math.round(center * 1.75))

  const alerts = notes
    .map(note => {
      const words = Number(note.wordCount) || 0
      if (words < shortThreshold) {
        return {
          id: note.id,
          title: note.title,
          volumeTitle: note.volumeTitle,
          wordCount: words,
          type: 'short',
          threshold: shortThreshold,
        }
      }
      if (words > longThreshold) {
        return {
          id: note.id,
          title: note.title,
          volumeTitle: note.volumeTitle,
          wordCount: words,
          type: 'long',
          threshold: longThreshold,
        }
      }
      return null
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.wordCount - center) - Math.abs(a.wordCount - center))

  return {
    targetWords: center,
    medianWords,
    averageWords,
    shortest: sorted[0] || null,
    longest: sorted[sorted.length - 1] || null,
    alerts,
  }
}

export function findStaleProjectChapters(
  workspace,
  projectMeta = {},
  nowSeconds = Math.floor(Date.now() / 1000),
  staleDays = 14,
) {
  const threshold = Math.max(1, Number(staleDays) || 14) * 86400
  return manuscriptNotes(workspace)
    .filter(note => {
      const status = projectMeta.statuses?.[note.id] || note.status || 'draft'
      if (status === 'done') return false
      const updatedAt = Number(note.updated_at) || 0
      if (!updatedAt) return false
      return nowSeconds - updatedAt >= threshold
    })
    .map(note => ({
      ...note,
      idleDays: Math.max(
        0,
        Math.floor((nowSeconds - Number(note.updated_at || 0)) / 86400)
      ),
    }))
    .sort((a, b) => b.idleDays - a.idleDays)
}

export function getVolumeCompletion(workspace) {
  return (workspace?.volumes || []).map(volume => {
    const notes = volume.notes || []
    const completed = notes.filter(note => note.status === 'done').length
    return {
      id: volume.id,
      title: volume.title,
      completed,
      total: notes.length,
      percent: notes.length
        ? Math.round((completed / notes.length) * 100)
        : 0,
      wordCount: Number(volume.wordCount) || 0,
    }
  })
}

function baseTitle(title) {
  return String(title || '')
    .replace(/\.[^.]+$/, '')
    .trim()
}

function countSubstring(text, query) {
  const source = String(text || '')
  const needle = String(query || '').trim()
  if (!needle) return 0

  let count = 0
  let index = 0
  while (index <= source.length - needle.length) {
    const found = source.indexOf(needle, index)
    if (found < 0) break
    count += 1
    index = found + Math.max(1, needle.length)
  }
  return count
}

export function getProjectEntityFrequencies(
  workspace,
  projectIndexes = {},
) {
  const manuscript = manuscriptNotes(workspace)
    .map(note => extractLexicalText(note.content || ''))
    .join('\n')

  const result = {}
  for (const category of ['characters', 'locations']) {
    result[category] = (projectIndexes?.[category] || [])
      .map(item => ({
        ...item,
        count: countSubstring(manuscript, baseTitle(item.title)),
      }))
      .sort((a, b) => b.count - a.count || baseTitle(a.title).localeCompare(baseTitle(b.title), 'zh-CN'))
  }

  return result
}

export function getForeshadowAnalysis(projectIndexes = {}, projectMeta = {}) {
  const states = projectMeta.foreshadowStates || {}
  const items = (projectIndexes.foreshadows || []).map(item => ({
    ...item,
    state: states[item.id] === 'recovered' ? 'recovered' : 'open',
  }))

  return {
    items,
    open: items.filter(item => item.state === 'open').length,
    recovered: items.filter(item => item.state === 'recovered').length,
  }
}
