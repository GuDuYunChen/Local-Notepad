import { MAX_REVIEW_NOTE_LENGTH } from './evidenceReviewReport.js'

export const MAX_REVIEW_CHAPTERS = 10000
export const REVIEW_ARCHIVE_FORMAT = 'local-notepad-evidence-review'
export const MAX_REVIEW_ARCHIVE_LENGTH = 512000
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = () => { throw new Error('核对存档格式无效或数据超出限制，原记录未改动') }
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail()
  return value
}

// Copy only review metadata. Unknown fields (including manuscript snapshots,
// navigation requests and runtime IDs) can never enter persistent storage.
export function copyArchivedReviewData(value) {
  if (!object(value) || !object(value.filters) || !object(value.annotations) ||
    !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length > MAX_REVIEW_CHAPTERS ||
    !Array.isArray(value.reviewedIds) || value.reviewedIds.length > value.chapters.length) fail()
  const filters = value.filters
  if (!['all', 'wiki', 'canonical', 'alias'].includes(filters.source) ||
    !Number.isSafeInteger(filters.page) || filters.page < 1 || filters.page > MAX_REVIEW_CHAPTERS) fail()
  const ids = new Set()
  const chapters = value.chapters.map(chapter => {
    if (!object(chapter) || !Number.isSafeInteger(chapter.ordinal) || chapter.ordinal < 0) fail()
    const id = text(chapter.id, 512, true)
    if (ids.has(id)) fail()
    ids.add(id)
    return Object.freeze({ id, title: text(chapter.title, 1000), ordinal: chapter.ordinal })
  })
  const chapterId = text(value.chapterId, 512, true)
  if (!ids.has(chapterId)) fail()
  const entries = Object.entries(value.annotations)
  if (entries.length > chapters.length) fail()
  const annotations = Object.fromEntries(entries.map(([id, note]) => {
    if (!ids.has(id) || !object(note) || typeof note.needsChanges !== 'boolean') fail()
    return [id, Object.freeze({ text: text(note.text, MAX_REVIEW_NOTE_LENGTH), needsChanges: note.needsChanges })]
  }))
  const reviewed = new Set()
  for (const id of value.reviewedIds) {
    if (typeof id !== 'string' || !ids.has(id) || reviewed.has(id) ||
      (Object.hasOwn(annotations, id) && annotations[id].needsChanges)) fail()
    reviewed.add(id)
  }
  return Object.freeze({
    projectId: text(value.projectId, 512, true), entityId: text(value.entityId, 512, true),
    entityLabel: text(value.entityLabel, 500),
    filters: Object.freeze({ query: text(filters.query, 500), source: filters.source,
      volumeId: filters.volumeId === null ? null : text(filters.volumeId, 512), page: filters.page }),
    chapters: Object.freeze(chapters), chapterId, reviewedIds: Object.freeze([...reviewed]),
    annotations: Object.freeze(annotations),
  })
}

export function readReviewArchive(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_REVIEW_ARCHIVE_LENGTH) fail()
  let value
  try { value = JSON.parse(raw) } catch { fail() }
  if (!object(value) || value.format !== REVIEW_ARCHIVE_FORMAT || value.version !== 1 ||
    typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id) ||
    typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) ||
    new Date(value.savedAt).toISOString() !== value.savedAt) fail()
  return Object.freeze({ format: REVIEW_ARCHIVE_FORMAT, version: 1, id: value.id,
    savedAt: value.savedAt, data: copyArchivedReviewData(value.data) })
}

// Restoration is deliberately conservative: it cannot revive deleted chapters,
// silently drop their notes, or reinterpret old reviewed marks as current proof.
export function planReviewArchiveRestore(archive, { projectId, entityId, entityLabel, chapterQueue = [] } = {}) {
  const data = copyArchivedReviewData(archive?.data)
  if (projectId !== data.projectId || entityId !== data.entityId) {
    throw new Error('请切换到存档对应的项目和实体后恢复')
  }
  const current = new Map(chapterQueue.map(chapter => [chapter.id, chapter]))
  const missing = data.chapters.filter(chapter => !current.has(chapter.id))
  if (missing.length) throw new Error(`${missing.length} 个原证据章节已删除或不再符合筛选；未恢复。存档与备注仍保留，可导出历史清单`)
  const oldIds = new Set(data.chapters.map(chapter => chapter.id))
  const restored = copyArchivedReviewData({ ...data, entityLabel: entityLabel ?? data.entityLabel,
    chapters: chapterQueue, reviewedIds: [] })
  return { data: restored, resetCount: data.reviewedIds.length,
    addedCount: chapterQueue.filter(chapter => !oldIds.has(chapter.id)).length }
}
