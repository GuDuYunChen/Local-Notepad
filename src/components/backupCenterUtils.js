import { copyArchivedReviewData } from '../services/evidenceReviewArchiveData.js'
import { reviewArchiveIdentity } from '../services/evidenceReviewBackup.js'
import { MAX_LOCAL_REVIEW_ARCHIVES } from '../services/evidenceReviewArchives.js'

// Missing/invalid bridge data is an error, never evidence of an empty backup folder.
export function readDatabaseBackupList(response) {
  if (response?.success !== true) throw new Error(response?.message || '无法读取正文数据库备份')
  if (!Array.isArray(response.backups)) throw new Error('数据库备份列表格式不完整，请刷新重试')
  const paths = new Set()
  const backups = response.backups.map(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() ||
      typeof item.path !== 'string' || !item.path.trim() || paths.has(item.path)) {
      throw new Error('数据库备份列表包含无效或重复记录，请刷新重试')
    }
    paths.add(item.path)
    const timestamp = typeof item.date === 'string' ? Date.parse(item.date) : NaN
    return { name: item.name, path: item.path,
      size: typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 ? item.size : null,
      date: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '',
      timestamp: Number.isFinite(timestamp) ? timestamp : null }
  }).sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity) || a.name.localeCompare(b.name))
  return { backups, directory: typeof response.directory === 'string' ? response.directory : '',
    latestPath: backups[0]?.timestamp !== null && backups.length ? backups[0].path : '' }
}

export function formatBackupSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '大小未知'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function formatBackupDate(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '时间未知'
}

// Compare the complete metadata snapshot, independent of save time and import ID.
// This is not proof that a file was downloaded, nor that manuscript drafts were saved.
export function reviewBackupCoverage(session, shelf) {
  if (shelf?.error || !Array.isArray(shelf?.entries)) {
    return { state: 'unknown', total: null, readable: null, unreadable: null, available: null, savedAt: '' }
  }
  const valid = shelf.entries.filter(entry => entry.archive)
  const base = { total: shelf.entries.length, readable: valid.length,
    unreadable: shelf.entries.length - valid.length,
    available: Math.max(0, MAX_LOCAL_REVIEW_ARCHIVES - shelf.entries.length), savedAt: '' }
  if (!session) return { ...base, state: 'inactive' }
  try {
    const signature = data => reviewArchiveIdentity({ savedAt: '', data: copyArchivedReviewData(data) })
    const current = signature(session)
    const matches = valid.filter(entry => signature(entry.archive.data) === current)
      .sort((a, b) => b.archive.savedAt.localeCompare(a.archive.savedAt))
    return { ...base, state: matches.length ? 'saved' : 'unsaved', savedAt: matches[0]?.archive.savedAt || '' }
  } catch { return { ...base, state: 'unknown' } }
}
