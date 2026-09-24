import { collectionStudy, MAX_STUDY_STATUS_BATCH, STUDY_STATUS_LABELS } from './collectionStudy'
import { collectionStudyHub } from './collectionStudyHub'
import { searchCollections } from './searchCollections'
import { collectionStudyDrafts, studyDraftKey } from './collectionStudyDrafts'

const fail = message => { throw new Error(message) }
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value)
  }
  return value
}
const alive = options => !options.signal?.aborted && options.isCurrent?.() !== false
const checkAlive = options => { if (!alive(options)) fail('操作已取消；已完成的标记保留，剩余记录未写入') }

// A batch is atomic per collection, NOT across collections. Receipts only live in
// this workbench session. No source data, annotations or bookmarks are rewritten.
export function createCollectionStudyBatch({ hub = collectionStudyHub, sourceStore = searchCollections,
  studyStore = collectionStudy, drafts = collectionStudyDrafts } = {}) {
  const previews = new WeakMap(), receipts = new WeakMap()
  const checkDrafts = group => {
    for (const item of group.targets) {
      if (drafts.get(studyDraftKey(group.snapshot, item.id))) fail('所选条目有未保存批注，请先保存或导出并处理草稿；未改写草稿')
    }
  }
  const validateGroup = group => { studyStore.assertCurrent(group.snapshot, sourceStore); checkDrafts(group) }

  async function prepare(model, keys, status, options = {}) {
    checkAlive(options); hub.assertCurrent(model)
    if (model.issues.length) fail('存在未读取或未关联的记录，请先处理工作台提示，未执行批量标记')
    if (!Object.hasOwn(STUDY_STATUS_LABELS, status)) fail('批量阅读状态无效')
    if (!Array.isArray(keys) || !keys.length || keys.length > MAX_STUDY_STATUS_BATCH || new Set(keys).size !== keys.length) {
      fail('每次请选择 1 至 200 条不同记录，未自动截断')
    }
    const byKey = new Map(model.rows.map(row => [row.key, row])), groups = new Map(), rows = []
    for (const key of keys) {
      const row = byKey.get(key)
      if (!row) fail('选择已不在当前工作台中，请刷新后重选')
      rows.push(row)
      if (!groups.has(row.collectionKey)) groups.set(row.collectionKey, { entry: row.entry, name: row.collectionName, targets: [] })
      groups.get(row.collectionKey).targets.push({ id: row.id, status, previousStatus: row.status })
    }
    for (const group of groups.values()) {
      checkAlive(options)
      group.snapshot = await studyStore.load(group.entry, sourceStore)
      validateGroup(group)
      const records = new Map(group.snapshot.data.records.map(row => [row.id, row]))
      for (const target of group.targets) {
        if ((records.get(target.id)?.status || 'unread') !== target.previousStatus) fail('阅读状态已变化，请刷新后重选')
      }
    }
    checkAlive(options); hub.assertCurrent(model)
    const preview = freeze({ status, label: STUDY_STATUS_LABELS[status], total: rows.length,
      changed: rows.filter(row => row.status !== status).length,
      unchanged: rows.filter(row => row.status === status).length, collectionCount: groups.size,
      items: rows.map(row => ({ key: row.key, id: row.id, title: row.title, collectionName: row.collectionName,
        collectionId: row.collectionId, previousStatus: row.status, status })) })
    previews.set(preview, { model, groups: [...groups.values()], consumed: false })
    return preview
  }

  async function apply(preview, options = {}) {
    const pending = previews.get(preview)
    if (!pending || pending.consumed) fail('批量预检已使用或不属于本窗口，请重新预检')
    // Consume synchronously, before awaiting any lock: double-confirm cannot replay.
    pending.consumed = true
    const completed = [], failures = []
    let changed = 0
    try {
      checkAlive(options); hub.assertCurrent(pending.model)
      pending.groups.forEach(validateGroup)
      for (const group of pending.groups) {
        checkAlive(options); validateGroup(group)
        const targets = group.targets.filter(item => item.status !== item.previousStatus)
        if (!targets.length) continue
        const snapshot = await studyStore.setStatuses(group.snapshot, targets, { sourceStore, signal: options.signal, isCurrent: () => {
          if (!alive(options)) return false
          checkDrafts(group); return true
        } })
        completed.push({ snapshot, name: group.name, targets: targets.map(item => ({ id: item.id, status: item.previousStatus })) })
        changed += targets.length
        try { options.onProgress?.({ changed, total: preview.changed }) } catch { /* view errors cannot undo committed data */ }
      }
    } catch (failure) { failures.push(failure.message || '批量标记未全部完成') }
    const result = freeze({ total: preview.total, changed, unchanged: preview.unchanged,
      remaining: preview.changed - changed, failures, cancelled: !alive(options), status: preview.status })
    receipts.set(result, { groups: completed.reverse(), running: false })
    return result
  }

  async function undo(result, options = {}) {
    const receipt = receipts.get(result)
    if (!receipt || receipt.running) fail('撤销记录不可用或正在处理，请勿重复提交')
    receipt.running = true
    let restored = 0
    const failures = [], remaining = []
    try {
      for (const group of receipt.groups) {
        try {
          checkAlive(options); validateGroup(group)
          await studyStore.setStatuses(group.snapshot, group.targets, { sourceStore, signal: options.signal, isCurrent: () => {
            if (!alive(options)) return false
            checkDrafts(group); return true
          } })
          restored += group.targets.length
        } catch (failure) {
          remaining.push(group)
          failures.push({ name: group.name, count: group.targets.length, reason: failure.message || '该资料集未撤销' })
        }
      }
      receipt.groups = remaining
      return freeze({ restored, remaining: remaining.reduce((sum, group) => sum + group.targets.length, 0), failures })
    } finally { receipt.running = false }
  }
  return { prepare, apply, undo }
}
