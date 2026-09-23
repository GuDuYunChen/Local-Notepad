import { copyArchivedReviewData, readReviewArchive, REVIEW_ARCHIVE_FORMAT, MAX_REVIEW_ARCHIVE_LENGTH } from './evidenceReviewArchiveData.js'

export const REVIEW_ARCHIVE_PREFIX = 'localNotepad.evidenceReview.archive.v1:'
export const MAX_LOCAL_REVIEW_ARCHIVES = 40

// One immutable key per explicit save, never a shared read/modify/write array.
// A failed write cannot remove prior snapshots or modify the active review.
export function createReviewArchiveStore({ storage = () => globalThis.localStorage,
  createId = () => globalThis.crypto.randomUUID(), now = () => new Date() } = {}) {
  const listeners = new Set()
  const publish = () => { for (const listener of [...listeners]) listener() }
  function getStorage() {
    const value = storage()
    if (!value || typeof value.getItem !== 'function') throw new Error('本地存储不可用，请导出清单留存')
    return value
  }
  function list() {
    try {
      const db = getStorage()
      const keys = []
      for (let i = 0; i < db.length; i++) {
        const key = db.key(i)
        if (key?.startsWith(REVIEW_ARCHIVE_PREFIX)) keys.push(key)
      }
      const entries = keys.map(key => {
        const raw = db.getItem(key)
        try {
          const archive = readReviewArchive(raw)
          if (key !== REVIEW_ARCHIVE_PREFIX + archive.id) throw new Error('存档标识不一致')
          return { key, raw, archive, error: '' }
        } catch { return { key, raw, archive: null, error: '存档损坏或版本不支持，未覆盖；可导出原文件或删除' } }
      }).sort((a, b) => (b.archive?.savedAt || '').localeCompare(a.archive?.savedAt || '') || a.key.localeCompare(b.key))
      return { entries, error: '' }
    } catch { return { entries: [], error: '无法读取本地核对存档；原存储未改动，请检查存储权限' } }
  }
  function save(data, savedAt = now().toISOString()) {
    const clean = copyArchivedReviewData(data)
    const current = list()
    if (current.error) throw new Error(current.error)
    if (current.entries.length >= MAX_LOCAL_REVIEW_ARCHIVES) throw new Error('本地已保留 40 份存档，请先导出并删除不需要的存档；不会自动淘汰旧记录')
    const id = createId()
    const raw = JSON.stringify({ format: REVIEW_ARCHIVE_FORMAT, version: 1, id, savedAt, data: clean })
    if (raw.length > MAX_REVIEW_ARCHIVE_LENGTH) throw new Error('本轮记录过大，未存档；请使用 Markdown 清单导出，当前记录仍保留')
    const archive = readReviewArchive(raw)
    const key = REVIEW_ARCHIVE_PREFIX + archive.id
    const db = getStorage()
    if (db.getItem(key) !== null) throw new Error('存档标识冲突，请重试；没有覆盖旧存档')
    try { db.setItem(key, raw) } catch { throw new Error('本地存档写入失败，可能空间不足或权限受限；请导出清单，当前核对未改动') }
    publish()
    return archive
  }
  function readUnchanged(entry) {
    if (!entry || typeof entry.key !== 'string' || !entry.key.startsWith(REVIEW_ARCHIVE_PREFIX)) throw new Error('存档标识无效')
    const raw = getStorage().getItem(entry.key)
    if (raw === null || raw !== entry.raw) throw new Error('存档已被另一窗口修改或删除，请刷新存档列表后重试')
    return raw
  }
  return {
    list, save, readUnchanged,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    importFile(raw) { const source = readReviewArchive(raw); return save(source.data, source.savedAt) },
    remove(entry) {
      readUnchanged(entry)
      try { getStorage().removeItem(entry.key) } catch { throw new Error('删除失败，存档仍保留') }
      publish()
    },
  }
}

export const reviewArchives = createReviewArchiveStore()

export function downloadReviewArchive(entry) {
  const raw = reviewArchives.readUnchanged(entry)
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = '核对存档-' + (entry.archive?.id || '待修复') + '.json'
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
