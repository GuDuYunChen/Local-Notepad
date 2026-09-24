import { readSearchCollection, SEARCH_COLLECTION_PREFIX, searchCollections } from './searchCollections'

export const COLLECTION_STUDY_PREFIX = 'localNotepad.collectionStudy.v1:'
export const MAX_STUDY_BYTES = 1024 * 1024
export const MAX_STUDY_NOTE_LENGTH = 2000
export const STUDY_STATUS_LABELS = Object.freeze({ unread: '未读', read: '已读', revisit: '待复看' })
const FORMAT = 'local-notepad-collection-study'
const BACKUP = 'local-notepad-collection-study-backup'
const fail = message => { throw new Error(message) }
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value)
  }
  return value
}
function bytes(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_STUDY_BYTES || new TextEncoder().encode(raw).length > MAX_STUDY_BYTES) {
    fail('阅读记录超过 1 MiB 或格式无效，未截断或写入')
  }
  return raw
}
function date(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('阅读记录时间无效')
  return value
}
function text(value) {
  if (typeof value !== 'string' || value.length > MAX_STUDY_NOTE_LENGTH || value.includes('\0')) fail('批注最多 2000 个字符，且不能含空字符')
  return value
}
export function normalizeCollectionStudyData(value, collection, reportSHA256) {
  const ids = new Set(collection.report.items.map(item => item.id))
  if (!record(value) || value.format !== FORMAT || value.version !== 1 || value.collectionId !== collection.id ||
      value.reportSHA256 !== reportSHA256 || !Array.isArray(value.records) || value.records.length > ids.size) {
    fail('阅读记录损坏、版本不支持或不属于这份历史资料集，原记录保留')
  }
  const seen = new Set()
  const records = value.records.map(item => {
    if (!record(item) || !ids.has(item.id) || seen.has(item.id) || !Object.hasOwn(STUDY_STATUS_LABELS, item.status)) fail('阅读记录含无效或重复笔记')
    seen.add(item.id)
    return { id: item.id, status: item.status, note: text(item.note), updatedAt: date(item.updatedAt) }
  })
  const bookmark = value.bookmark === null ? null : (() => {
    if (!record(value.bookmark) || !ids.has(value.bookmark.id)) fail('阅读书签不在原资料集中')
    return { id: value.bookmark.id, savedAt: date(value.bookmark.savedAt) }
  })()
  return freeze({ format: FORMAT, version: 1, collectionId: collection.id, reportSHA256,
    updatedAt: value.updatedAt === null && !records.length && !bookmark ? null : date(value.updatedAt), bookmark, records })
}
export async function collectionReportFingerprint(collection) {
  if (!globalThis.crypto?.subtle) fail('当前环境无法校验资料集版本，未写入阅读记录')
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(collection.report)))
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')
}

// All cooperating windows serialize mutations with one same-origin Web Lock.
// Never fall back to an unsafe read/modify/write when that capability is absent.
export function createCollectionStudyStore({ storage = () => globalThis.localStorage,
  locks = () => globalThis.navigator?.locks, now = () => new Date() } = {}) {
  const listeners = new Set()
  const publish = () => { for (const listener of [...listeners]) { try { listener() } catch { /* a view error is not a failed save */ } } }
  function db() {
    const value = storage()
    if (!value || !['getItem', 'setItem', 'removeItem'].every(name => typeof value[name] === 'function')) fail('本地阅读记录存储不可用')
    return value
  }
  function unchanged(snapshot, sourceStore) {
    const collection = readSearchCollection(sourceStore.readUnchanged(snapshot.entry))
    if (snapshot.key !== COLLECTION_STUDY_PREFIX + collection.id || snapshot.entry.key !== SEARCH_COLLECTION_PREFIX + collection.id) fail('资料集身份不一致')
    const current = db().getItem(snapshot.key)
    if (current !== snapshot.raw) fail('阅读记录已在其他操作中更新，请加载最新记录后重试；未覆盖你的批注')
    return collection
  }
  async function load(entry, sourceStore = searchCollections) {
    const raw = sourceStore.readUnchanged(entry), collection = readSearchCollection(raw)
    if (entry.key !== SEARCH_COLLECTION_PREFIX + collection.id) fail('资料集身份不一致')
    const reportSHA256 = await collectionReportFingerprint(collection)
    sourceStore.readUnchanged(entry)
    const key = COLLECTION_STUDY_PREFIX + collection.id, stored = db().getItem(key)
    const value = stored === null ? { format: FORMAT, version: 1, collectionId: collection.id, reportSHA256,
      updatedAt: null, bookmark: null, records: [] } : JSON.parse(bytes(stored))
    return freeze({ entry: { key: entry.key, raw }, key, raw: stored, collection,
      data: normalizeCollectionStudyData(value, collection, reportSHA256) })
  }
  async function change(snapshot, transform, options = {}) {
    const sourceStore = options.sourceStore || searchCollections
    const manager = locks()
    if (typeof manager?.request !== 'function') fail('当前环境不支持安全的多窗口保存；阅读记录未写入，请使用桌面应用或导出批注草稿')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try { return await manager.request('local-notepad-study:' + snapshot.key, { mode: 'exclusive', signal: controller.signal }, () => {
      if (options.isCurrent?.() === false) fail('操作已取消，未写入阅读记录')
      const collection = unchanged(snapshot, sourceStore)
      const data = normalizeCollectionStudyData(transform(snapshot.data, now().toISOString()), collection, snapshot.data.reportSHA256)
      const raw = bytes(JSON.stringify(data))
      bytes(JSON.stringify({ ...data, format: BACKUP })) // Every accepted save must remain exportable.
      // Recheck after validation and just before the single atomic setItem.
      unchanged(snapshot, sourceStore)
      if (options.isCurrent?.() === false) fail('操作已取消，未写入阅读记录')
      try { db().setItem(snapshot.key, raw) } catch { fail('阅读记录保存失败，可能空间不足或权限受限；原记录和草稿保留') }
      const result = freeze({ ...snapshot, raw, data })
      publish(); return result
    }) } catch (failure) {
      if (failure?.name === 'AbortError') fail('等待安全保存锁超时，未写入；请重试或先导出批注草稿')
      if (failure?.name === 'SecurityError') fail('当前页面无法获取安全保存锁，未写入；请先导出批注草稿')
      throw failure
    } finally { clearTimeout(timer) }
  }
  function validateExport(snapshot, sourceStore = searchCollections) {
    const collection = unchanged(snapshot, sourceStore)
    return normalizeCollectionStudyData(snapshot.data, collection, snapshot.data.reportSHA256)
  }
  function prepareImport(snapshot, raw, sourceStore = searchCollections) {
    unchanged(snapshot, sourceStore)
    const input = JSON.parse(bytes(raw).replace(/^\uFEFF/, ''))
    if (!record(input) || input.format !== BACKUP || input.version !== 1 || input.reportSHA256 !== snapshot.data.reportSHA256) {
      fail('备份不属于同一份历史检索结果，未创建笔记或替换记录')
    }
    const data = normalizeCollectionStudyData({ ...input, format: FORMAT, collectionId: snapshot.collection.id }, snapshot.collection, snapshot.data.reportSHA256)
    return freeze({ data, reportSHA256: snapshot.data.reportSHA256, expectedRaw: snapshot.raw, key: snapshot.key })
  }
  return {
    load,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    saveNote(snapshot, id, status, note, options) {
      return change(snapshot, (before, timestamp) => {
        if (!snapshot.collection.report.items.some(item => item.id === id)) fail('笔记不在资料集中')
        if (!Object.hasOwn(STUDY_STATUS_LABELS, status)) fail('阅读状态无效')
        const item = { id, status, note: text(note), updatedAt: timestamp }
        const records = before.records.filter(row => row.id !== id)
        if (status !== 'unread' || note !== '') records.push(item)
        return { ...before, records, updatedAt: timestamp, bookmark: { id, savedAt: timestamp } }
      }, options)
    },
    bookmark(snapshot, id, options) {
      return change(snapshot, (before, timestamp) => ({ ...before, updatedAt: timestamp, bookmark: { id, savedAt: timestamp } }), options)
    },
    export(snapshot, sourceStore) {
      const data = validateExport(snapshot, sourceStore)
      return bytes(JSON.stringify({ ...data, format: BACKUP }))
    },
    prepareImport,
    import(snapshot, preview, options) {
      return change(snapshot, (_before, timestamp) => {
        if (preview.key !== snapshot.key || preview.expectedRaw !== snapshot.raw || preview.reportSHA256 !== snapshot.data.reportSHA256) fail('导入预检已过期，请重新预检')
        return { ...preview.data, updatedAt: timestamp }
      }, options)
    },
  }
}
export const collectionStudy = createCollectionStudyStore()
export function summarizeCollectionStudy(snapshot) {
  const counts = { unread: snapshot.collection.report.count, read: 0, revisit: 0, notes: 0 }
  snapshot.data.records.forEach(item => {
    if (item.status !== 'unread') { counts.unread--; counts[item.status]++ }
    if (item.note.length) counts.notes++
  })
  return counts
}
export function nextUnreadCollectionItem(snapshot, currentId = null, queue = snapshot.collection.report.items) {
  const read = new Set(snapshot.data.records.filter(item => item.status === 'read').map(item => item.id))
  const current = queue.findIndex(item => item.id === currentId)
  for (let step = 1; step <= queue.length; step++) {
    const item = queue[(current + step) % queue.length]
    if (!read.has(item.id) && item.id !== currentId) return item
  }
  return null
}
