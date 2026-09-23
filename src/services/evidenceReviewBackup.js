import { readReviewArchive, REVIEW_ARCHIVE_FORMAT, MAX_REVIEW_ARCHIVE_LENGTH } from './evidenceReviewArchiveData.js'
import { MAX_LOCAL_REVIEW_ARCHIVES, REVIEW_ARCHIVE_PREFIX } from './evidenceReviewArchives.js'

export const REVIEW_BACKUP_FORMAT = 'local-notepad-evidence-review-backup'
export const MAX_REVIEW_BACKUP_LENGTH = MAX_REVIEW_ARCHIVE_LENGTH * MAX_LOCAL_REVIEW_ARCHIVES + 4096
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = () => { throw new Error('备份包格式无效、版本不支持或超出限制；没有导入任何存档') }
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value

// A backup is metadata, not a manuscript backup. The existing archive validator
// copies the field allowlist and strips content and runtime navigation tokens.
export function readReviewBackup(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_REVIEW_BACKUP_LENGTH) invalid()
  let value
  try { value = JSON.parse(raw.replace(/^\ufeff/u, '')) } catch { invalid() }
  if (!object(value)) invalid()
  if (value.format === REVIEW_ARCHIVE_FORMAT) {
    const archive = readReviewArchive(JSON.stringify(value))
    return Object.freeze({ format: REVIEW_BACKUP_FORMAT, version: 1, exportedAt: archive.savedAt,
      archives: Object.freeze([archive]) })
  }
  if (value.format !== REVIEW_BACKUP_FORMAT || value.version !== 1 || !validDate(value.exportedAt) ||
    !Array.isArray(value.archives) || !value.archives.length || value.archives.length > MAX_LOCAL_REVIEW_ARCHIVES) invalid()
  const archives = value.archives.map(item => readReviewArchive(JSON.stringify(item)))
  return Object.freeze({ format: REVIEW_BACKUP_FORMAT, version: 1, exportedAt: value.exportedAt,
    archives: Object.freeze(archives) })
}

// IDs change during import. Deduplicate the *historical snapshot*, not its ID.
// Object property order is immaterial; chapter order, exact notes and save time are not.
export function reviewArchiveIdentity(archive) {
  const d = archive.data
  return JSON.stringify([archive.savedAt, d.projectId, d.entityId, d.entityLabel,
    d.filters.query, d.filters.source, d.filters.volumeId, d.filters.page, d.chapterId,
    d.chapters.map(c => [c.id, c.title, c.ordinal]), [...d.reviewedIds].sort(),
    Object.entries(d.annotations).filter(([, n]) => n.text || n.needsChanges)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, n]) => [id, n.text, n.needsChanges])])
}

function listing(store) {
  const result = store.list()
  if (result.error) throw new Error(result.error)
  return result.entries
}
function sameEntries(left, right) {
  if (left.length !== right.length) return false
  const values = new Map(left.map(entry => [entry.key, entry.raw]))
  return right.every(entry => values.has(entry.key) && values.get(entry.key) === entry.raw)
}

export function buildReviewBackup(entries, store, exportedAt = new Date()) {
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_LOCAL_REVIEW_ARCHIVES) {
    throw new Error('请选择包含 1 至 40 份存档的查看范围；没有生成空备份')
  }
  if (new Set(entries.map(entry => entry.key)).size !== entries.length) throw new Error('备份范围包含重复存档，请刷新后重试')
  if (entries.some(entry => !entry.archive)) {
    throw new Error('此范围有不可读取的存档，请先逐份导出原 JSON 后处理；不会静默遗漏它们生成备份')
  }
  listing(store) // Storage failure is not an empty collection.
  const archives = entries.map(entry => {
    const archive = readReviewArchive(store.readUnchanged(entry))
    if (entry.key !== REVIEW_ARCHIVE_PREFIX + archive.id) throw new Error('存档标识不一致，请刷新后重试')
    return archive
  })
  const raw = JSON.stringify({ format: REVIEW_BACKUP_FORMAT, version: 1, exportedAt: exportedAt.toISOString(), archives })
  if (raw.length > MAX_REVIEW_BACKUP_LENGTH) throw new Error('备份包过大，未生成；请缩小查看范围或逐份导出')
  // Recheck all selected records after serialization, before offering the bytes.
  for (const entry of entries) store.readUnchanged(entry)
  return raw
}

export function planReviewBackupImport(raw, store) {
  const backup = readReviewBackup(raw)
  const entries = listing(store)
  const existing = new Set(entries.filter(entry => entry.archive).map(entry => reviewArchiveIdentity(entry.archive)))
  const seen = new Set()
  const items = backup.archives.map((archive, index) => {
    const identity = reviewArchiveIdentity(archive)
    const status = existing.has(identity) ? 'existing' : seen.has(identity) ? 'duplicate' : 'new'
    seen.add(identity)
    return Object.freeze({ index, archive, status })
  })
  const newCount = items.filter(item => item.status === 'new').length
  return Object.freeze({ backup, items: Object.freeze(items), newCount,
    skippedCount: items.length - newCount, available: Math.max(0, MAX_LOCAL_REVIEW_ARCHIVES - entries.length),
    fits: entries.length + newCount <= MAX_LOCAL_REVIEW_ARCHIVES,
    baseline: Object.freeze(entries.map(entry => Object.freeze({ key: entry.key, raw: entry.raw }))) })
}

// localStorage has no multi-key transaction. Commit independent snapshots in order.
// On failure, keep successes, stop immediately, and report exactly what remains.
// Re-running preview skips those successes, so retry never requires deleting data.
export function importReviewBackup(preview, store) {
  const fresh = planReviewBackupImport(JSON.stringify(preview.backup), store)
  if (!sameEntries(preview.baseline, fresh.baseline)) throw new Error('本地存档已变化，请重新预检；尚未写入任何存档')
  if (!fresh.fits) throw new Error('本地剩余容量不足，请先备份并手动整理存档；没有自动删除或导入')
  const imported = []
  let expected = [...fresh.baseline]
  let error = ''
  for (const item of fresh.items.filter(item => item.status === 'new')) {
    try {
      if (!sameEntries(expected, listing(store))) throw new Error('导入期间本地存档发生变化，已停止；请重新预检')
      const archive = store.importFile(JSON.stringify(item.archive))
      imported.push(Object.freeze({ index: item.index, id: archive.id }))
      // A store save has succeeded. Any subsequent failure must still count it.
      const current = listing(store)
      const created = current.find(entry => entry.key === REVIEW_ARCHIVE_PREFIX + archive.id)
      if (!created || !created.archive || reviewArchiveIdentity(created.archive) !== reviewArchiveIdentity(item.archive) ||
        !sameEntries(expected, current.filter(entry => entry.key !== created.key))) {
        throw new Error('写入后检测到本地存档变化，已停止；请刷新并重新预检')
      }
      expected = [...expected, { key: created.key, raw: created.raw }]
    } catch (reason) { error = reason.message || '存档写入失败，已停止导入'; break }
  }
  return Object.freeze({ imported: Object.freeze(imported), importedCount: imported.length,
    skippedCount: fresh.skippedCount, remainingCount: fresh.newCount - imported.length, error,
    complete: !error && imported.length === fresh.newCount })
}

export function downloadReviewBackup(raw) {
  const backup = readReviewBackup(raw)
  const clean = JSON.stringify(backup)
  const url = URL.createObjectURL(new Blob([clean], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = '核对存档备份-' + backup.exportedAt.slice(0, 10) + '-' + backup.archives.length + '份.json'
    document.body.append(link)
    link.click()
  } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
