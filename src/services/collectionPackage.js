import { readSearchCollection, SEARCH_COLLECTION_PREFIX, MAX_SEARCH_COLLECTIONS, searchCollections } from './searchCollections'
import { collectionStudy, COLLECTION_STUDY_PREFIX, MAX_STUDY_BYTES,
  normalizeCollectionStudyData, collectionReportFingerprint } from './collectionStudy'

export const MAX_COLLECTION_PACKAGE_BYTES = 4 * 1024 * 1024
const FORMAT = 'local-notepad-collection-package'
const STUDY_FORMAT = 'local-notepad-collection-study'
const STUDY_BACKUP = 'local-notepad-collection-study-backup'
const fail = message => { throw new Error(message) }
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value)
  }
  return value
}
function bounded(raw, max = MAX_COLLECTION_PACKAGE_BYTES) {
  if (typeof raw !== 'string' || raw.length > max || new TextEncoder().encode(raw).length > max) {
    fail('便携备份超过容量或格式无效，未截断、读取正文或写入')
  }
  return raw
}
function date(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('便携备份时间无效')
  return value
}
async function hash(value) {
  if (!globalThis.crypto?.subtle) fail('当前环境无法校验便携备份，未写入')
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function payload(collectionValue, studyValue) {
  const collection = readSearchCollection(JSON.stringify(collectionValue))
  const reportSHA256 = await collectionReportFingerprint(collection)
  let study = null
  if (studyValue !== null) {
    bounded(JSON.stringify(studyValue), MAX_STUDY_BYTES)
    if (studyValue?.format !== STUDY_BACKUP || studyValue?.collectionId !== collection.id) fail('阅读记录与资料集不配套，未恢复')
    const data = normalizeCollectionStudyData({ ...studyValue, format: STUDY_FORMAT }, collection, reportSHA256)
    study = { ...data, format: STUDY_BACKUP }
  }
  return freeze({ collection, study })
}

// Checksums detect accidental corruption; they are not signatures or trust in a sender.
export async function readCollectionPackage(raw) {
  let value
  try { value = JSON.parse(bounded(raw).replace(/^\uFEFF/, '')) }
  catch (failure) { fail(failure instanceof SyntaxError ? '不是有效的便携备份 JSON，未恢复' : failure.message) }
  if (value?.format !== FORMAT || value.version !== 1 || !Object.hasOwn(value, 'study') ||
      value.integrity?.algorithm !== 'SHA-256' || !/^[a-f0-9]{64}$/.test(value.integrity?.digest || '')) fail('便携备份类型、版本或校验信息无效')
  const clean = await payload(value.collection, value.study)
  const digest = await hash(clean)
  if (digest !== value.integrity.digest) fail('便携备份校验不一致，文件可能损坏；未写入任何记录')
  return freeze({ format: FORMAT, version: 1, exportedAt: date(value.exportedAt), ...clean,
    integrity: { algorithm: 'SHA-256', digest } })
}

export function createCollectionPackageService({ storage = () => globalThis.localStorage,
  locks = () => globalThis.navigator?.locks, sourceStore = searchCollections,
  studyStore = collectionStudy, now = () => new Date() } = {}) {
  // Only service-issued immutable previews can be confirmed. No caller-supplied keys or raw writes.
  const issued = new WeakSet()
  function db() {
    const value = storage()
    if (!value || !['getItem', 'setItem', 'key'].every(name => typeof value[name] === 'function')) fail('本地存储不可用，无法预检或恢复')
    return value
  }
  function keys() {
    const store = db(), all = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key?.startsWith(SEARCH_COLLECTION_PREFIX)) all.push(key)
    }
    return all.sort()
  }
  const capture = target => ({ keys: keys(), collectionRaw: db().getItem(target.collectionKey), studyRaw: db().getItem(target.studyKey) })
  const cancelled = options => {
    if (options.signal?.aborted || options.isCurrent?.() === false) throw new DOMException('已取消便携备份操作，未继续写入', 'AbortError')
  }
  async function exportPackage(entry, options = {}) {
    cancelled(options)
    const snapshot = await studyStore.load(entry, sourceStore)
    cancelled(options)
    const study = snapshot.raw === null ? null : JSON.parse(studyStore.export(snapshot, sourceStore))
    const clean = await payload(snapshot.collection, study)
    const digest = await hash(clean)
    const result = bounded(JSON.stringify({ format: FORMAT, version: 1, exportedAt: now().toISOString(), ...clean,
      integrity: { algorithm: 'SHA-256', digest } }))
    cancelled(options)
    // Recheck both source keys after asynchronous fingerprinting, including absent study records.
    sourceStore.readUnchanged(snapshot.entry)
    if (db().getItem(snapshot.key) !== snapshot.raw) fail('阅读记录在备份期间已变化，请重新备份；未下载过期组合')
    return result
  }
  async function prepareImport(raw, options = {}) {
    cancelled(options)
    const pack = await readCollectionPackage(raw)
    cancelled(options)
    // Stable for the same canonical source pair, independent of the export timestamp.
    // Allows recovery after a process stops between the two writes without creating duplicate copies.
    const id = 'pack-' + pack.integrity.digest
    const collection = readSearchCollection(JSON.stringify({ ...pack.collection, id }))
    const data = pack.study ? normalizeCollectionStudyData({ ...pack.study, format: STUDY_FORMAT, collectionId: id },
      collection, pack.study.reportSHA256) : null
    if (data) bounded(JSON.stringify({ ...data, format: STUDY_BACKUP }), MAX_STUDY_BYTES)
    const target = { collectionKey: SEARCH_COLLECTION_PREFIX + id, studyKey: COLLECTION_STUDY_PREFIX + id,
      collectionRaw: JSON.stringify(collection), studyRaw: data ? bounded(JSON.stringify(data), MAX_STUDY_BYTES) : null }
    const expected = capture(target)
    let action = 'create'
    if (expected.collectionRaw !== null) {
      if (expected.collectionRaw !== target.collectionRaw) fail('恢复目标已被修改或标识冲突，未覆盖；请保留备份并检查本地资料集')
      if (expected.studyRaw !== null) {
        normalizeCollectionStudyData(JSON.parse(bounded(expected.studyRaw, MAX_STUDY_BYTES)), collection,
          await collectionReportFingerprint(collection))
      }
      action = target.studyRaw !== null && expected.studyRaw === null ? 'complete' : 'existing'
    } else {
      if (expected.keys.length >= MAX_SEARCH_COLLECTIONS) fail('本地资料集已达 40 份，请先备份并手动清理；不会自动淘汰')
      if (expected.studyRaw !== null && expected.studyRaw !== target.studyRaw) fail('发现不同的暂存阅读记录，未覆盖；请保留文件并检查本地数据')
      if (expected.studyRaw !== null) action = 'resume'
    }
    cancelled(options)
    // Fingerprinting above may have yielded; confirmation must start from one actual captured state.
    if (JSON.stringify(expected) !== JSON.stringify(capture(target))) fail('本地记录在预检期间已变化，请重新预检')
    const preview = freeze({ pack, collection, target, expected, action, counts: {
      items: collection.report.count, read: data?.records.filter(item => item.status === 'read').length || 0,
      revisit: data?.records.filter(item => item.status === 'revisit').length || 0,
      notes: data?.records.filter(item => item.note.length > 0).length || 0, bookmark: data?.bookmark?.id || null,
    } })
    issued.add(preview)
    return preview
  }
  async function confirmImport(preview, options = {}) {
    if (!issued.has(preview)) fail('导入预检无效，请重新选择文件预检')
    cancelled(options)
    const manager = locks()
    if (typeof manager?.request !== 'function') fail('当前环境不支持安全恢复锁，未写入；请使用桌面应用')
    const controller = new AbortController(), relay = () => controller.abort()
    options.signal?.addEventListener('abort', relay, { once: true })
    const timer = setTimeout(relay, 5000)
    const lockOptions = { mode: 'exclusive', signal: controller.signal }
    try {
      return await manager.request('local-notepad-collection-package-import', lockOptions, () =>
        manager.request('local-notepad-study:' + preview.target.studyKey, lockOptions, () => {
          cancelled(options)
          if (controller.signal.aborted) throw new DOMException('恢复锁已取消', 'AbortError')
          const { target, expected, action } = preview
          if (JSON.stringify(expected) !== JSON.stringify(capture(target))) fail('本地资料集或阅读记录已变化，请重新预检；未覆盖旧记录')
          if (action === 'existing') return { action, collection: preview.collection }
          // No await between these writes. New reading metadata is staged first, and
          // only the final collection write publishes a browsable pair. Existing keys are never replaced.
          const store = db()
          try {
            if (target.studyRaw !== null && expected.studyRaw === null) store.setItem(target.studyKey, target.studyRaw)
            if (store.getItem(target.studyKey) !== target.studyRaw) fail('暂存读取校验失败')
            if (action !== 'complete') store.setItem(target.collectionKey, target.collectionRaw)
          } catch (failure) {
            const error = new Error('恢复未完成，请保留此文件并重新预检继续；已暂存的配套阅读记录保留，现有资料集与批注未覆盖。' +
              (failure?.message ? ' 原因：' + failure.message : ''))
            error.name = 'CollectionPackageIncompleteError'
            throw error
          }
          // Notifications happen after publication, and cannot turn a successful write into failure.
          try { sourceStore.notifyImported?.() } catch { /* view callbacks do not roll back storage */ }
          return { action, collection: preview.collection }
        }))
    } catch (failure) {
      if (failure?.name === 'AbortError') fail('恢复已取消或等待锁超时，未继续写入；可重新预检')
      if (failure?.name === 'SecurityError') fail('无法获取安全恢复锁，未写入；请保留备份文件')
      throw failure
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', relay) }
  }
  return { exportPackage, prepareImport, confirmImport }
}
export const collectionPackages = createCollectionPackageService()
