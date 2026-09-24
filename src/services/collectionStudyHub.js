import { collectionStudy, COLLECTION_STUDY_PREFIX, STUDY_STATUS_LABELS } from './collectionStudy'
import { searchCollections, SEARCH_COLLECTION_PREFIX, MAX_SEARCH_COLLECTIONS } from './searchCollections'

export const MAX_STUDY_HUB_EXPORT_BYTES = 8 * 1024 * 1024
const fail = message => { throw new Error(message) }
const normalize = value => String(value || '').normalize('NFC').toLowerCase()
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value)
  }
  return value
}
const relevant = key => typeof key === 'string' && (key.startsWith(SEARCH_COLLECTION_PREFIX) || key.startsWith(COLLECTION_STUDY_PREFIX))
function capture(storage) {
  const db = storage()
  if (!db || !Number.isSafeInteger(db.length) || db.length > 10000 || typeof db.key !== 'function' || typeof db.getItem !== 'function') fail('本地阅读记录存储不可用或规模超限，不能判断为空')
  const values = []
  for (let i = 0; i < db.length; i++) {
    const key = db.key(i)
    if (relevant(key)) values.push([key, db.getItem(key)])
  }
  return values.sort(([a], [b]) => a.localeCompare(b))
}
function equal(left, right) {
  return left.length === right.length && left.every(([key, raw], i) => key === right[i][0] && raw === right[i][1])
}
function checkSignal(signal) {
  if (signal?.aborted) throw Object.assign(new Error('已取消读取阅读工作台'), { name: 'AbortError' })
}

// Read-only aggregation. No keys, drafts, historical reports or manuscript are mutated.
// Retain provenance separately: two collections may have different notes for one ID.
export function createCollectionStudyHub({ storage = () => globalThis.localStorage,
  sourceStore = searchCollections, studyStore = collectionStudy, now = () => new Date() } = {}) {
  const receipts = new WeakMap()
  function assertCurrent(model) {
    const receipt = receipts.get(model)
    if (!receipt || !equal(receipt, capture(storage))) fail('阅读工作台数据已变化，请刷新后重试；未使用过期批注')
    return model
  }
  async function load({ signal } = {}) {
    checkSignal(signal)
    const before = capture(storage), sourceKeys = before.filter(([key]) => key.startsWith(SEARCH_COLLECTION_PREFIX)).map(([key]) => key)
    if (sourceKeys.length > MAX_SEARCH_COLLECTIONS) fail('本地资料集超过 40 份，未截断汇总，请先单独备份并整理')
    const shelf = sourceStore.list()
    if (shelf.error) fail(shelf.error)
    const rows = [], collections = [], issues = []
    for (const entry of shelf.entries) {
      checkSignal(signal)
      if (!entry.collection) { issues.push({ key: entry.key, reason: '资料集不可读取，未纳入统计' }); continue }
      let snapshot
      try { snapshot = await studyStore.load(entry, sourceStore) }
      catch (failure) { issues.push({ key: entry.key, reason: failure.message || '配套阅读记录不可读取' }); continue }
      checkSignal(signal)
      const byId = new Map(snapshot.data.records.map(item => [item.id, item]))
      const collection = snapshot.collection
      collections.push({ key: entry.key, id: collection.id, name: collection.name, count: collection.report.count })
      collection.report.items.forEach((item, index) => {
        const saved = byId.get(item.id)
        rows.push({ key: JSON.stringify([entry.key, item.id]), collectionKey: entry.key, collectionId: collection.id,
          collectionName: collection.name, id: item.id, title: item.title, folderPath: item.folderPath,
          ordinal: index + 1, status: saved?.status || 'unread', note: saved?.note || '',
          updatedAt: saved?.updatedAt || null, bookmarked: snapshot.data.bookmark?.id === item.id,
          entry: snapshot.entry })
      })
    }
    for (const [key] of before) {
      if (key.startsWith(COLLECTION_STUDY_PREFIX) && !sourceKeys.includes(SEARCH_COLLECTION_PREFIX + key.slice(COLLECTION_STUDY_PREFIX.length))) {
        issues.push({ key, reason: '缺少来源资料集的阅读记录，可能是历史遗留或恢复暂存；已保留，未读取为有效批注' })
      }
    }
    checkSignal(signal)
    if (!equal(before, capture(storage))) fail('汇总期间本地记录发生变化，请刷新；未混用不同时间的数据')
    const counts = { total: rows.length, unread: 0, read: 0, revisit: 0, notes: 0, bookmarks: 0 }
    rows.forEach(row => { counts[row.status]++; if (row.note.length) counts.notes++; if (row.bookmarked) counts.bookmarks++ })
    const model = freeze({ loadedAt: now().toISOString(), sourceCount: sourceKeys.length, collections, rows, issues, counts })
    receipts.set(model, before)
    return model
  }
  return {
    load, assertCurrent,
    locate(model, key) {
      assertCurrent(model)
      const row = model.rows.find(item => item.key === key)
      if (!row) fail('阅读条目已不在本次工作台中，请刷新')
      sourceStore.readUnchanged(row.entry)
      return { entry: row.entry, documentId: row.id }
    },
    export(model, filters, format = 'markdown') {
      assertCurrent(model)
      if (model.issues.length) fail('存在未读取或未关联的记录，不能导出完整阅读清单；请先处理提示或使用单份备份')
      if (!['markdown', 'json'].includes(format)) fail('阅读清单导出格式不支持')
      const view = selectCollectionStudyHub(model, filters)
      if (!view.total) fail('当前筛选没有阅读条目，未生成空清单')
      // Pagination is deliberately not serialized and never limits export.
      const report = { format: 'local-notepad-reading-list', version: 1, exportedAt: now().toISOString(),
        loadedAt: model.loadedAt, scope: view.filters, collectionCount: new Set(view.matches.map(row => row.collectionId)).size,
        count: view.total, note: '人工阅读标记与已存批注；不是正文备份，也不能导入恢复。同一笔记跨资料集分别计数。',
        items: view.matches.map(({ entry, key, collectionKey, ...item }) => item) }
      const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1').replace(/\r\n?/g, '\n').replace(/\n/g, '\n\n')
      const text = format === 'json' ? JSON.stringify(report, null, 2) : [
        '# 阅读批注清单', '', report.note, '', `导出时间：${report.exportedAt}`, `读取快照：${report.loadedAt}`,
        `资料集：${report.collectionCount} 份 · 条目：${report.count} 条`,
        `筛选：${escape(JSON.stringify(report.scope))}`, '',
        ...report.items.flatMap((item, i) => [`## ${i + 1}. ${escape(item.title || '未命名')}`, '',
          `资料集：${escape(item.collectionName)}（${escape(item.collectionId)}）`,
          `笔记 ID：${escape(item.id)} · 原序号：${item.ordinal}`, `历史目录：${escape(item.folderPath || '根目录')}`,
          `人工状态：${STUDY_STATUS_LABELS[item.status]}${item.bookmarked ? ' · 上次书签' : ''}`, `批注保存：${item.updatedAt || '尚无保存记录'}`, '',
          item.note.length ? escape(item.note) : '（无已存批注）', '']),
      ].join('\n')
      if (new TextEncoder().encode(text).length > MAX_STUDY_HUB_EXPORT_BYTES) fail('阅读清单超过 8 MiB，请缩小筛选范围；未截断或下载')
      assertCurrent(model)
      return { text, filename: `Local-Notepad-阅读批注-${report.exportedAt.slice(0, 10)}.${format === 'json' ? 'json' : 'md'}`,
        type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' }
    },
  }
}

export function selectCollectionStudyHub(model, options = {}) {
  const filters = { query: typeof options.query === 'string' ? options.query.slice(0, 512) : '',
    status: Object.hasOwn(STUDY_STATUS_LABELS, options.status) ? options.status : 'all',
    collectionKey: typeof options.collectionKey === 'string' ? options.collectionKey : '',
    notesOnly: options.notesOnly === true, sort: ['updated', 'collection'].includes(options.sort) ? options.sort : 'updated' }
  const query = normalize(filters.query).trim()
  const matches = (model?.rows || []).filter(row => (!filters.collectionKey || row.collectionKey === filters.collectionKey) &&
    (filters.status === 'all' || row.status === filters.status) && (!filters.notesOnly || row.note.length > 0) &&
    (!query || [row.collectionName, row.title, row.folderPath, row.id, row.note].some(value => normalize(value).includes(query))))
    .sort((a, b) => (filters.sort === 'updated' ? (b.updatedAt || '').localeCompare(a.updatedAt || '') : 0) ||
      a.collectionName.localeCompare(b.collectionName, 'zh-CN') || a.collectionKey.localeCompare(b.collectionKey) || a.ordinal - b.ordinal)
  const pages = Math.max(1, Math.ceil(matches.length / 12))
  const page = Number.isSafeInteger(options.page) ? Math.min(pages, Math.max(1, options.page)) : 1
  return { filters, matches, rows: matches.slice((page - 1) * 12, page * 12), page, pages, total: matches.length }
}
export const collectionStudyHub = createCollectionStudyHub()
