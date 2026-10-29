import { dailyRequest } from './dailyNotes.mjs'

export const RECOVERY_JOURNAL = 'local-notepad.trash-recovery.v1'
export const RECOVERY_CHANGED = 'trash-recovery:changed'
export const RECOVERY_PAGE_SIZE = 50
export const RECOVERY_ROW_LIMIT = 1000
const fail = message => { throw new Error(message) }
const bytes = value => new TextEncoder().encode(value).length
const unicode = v => typeof v === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)
const id = v => unicode(v) && v.trim() === v && bytes(v) > 0 && bytes(v) <= 128 && !/[\u0000-\u001f\u007f]/.test(v)
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const uuid = v => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v)
const uint = v => Number.isSafeInteger(v) && v >= 0
const fold = s => s.replace(/[A-Z]/g, c => c.toLowerCase())
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b)
const rowKeys = ['id','title','parent_id','is_folder','is_deleted','sort_order','updated_at','deleted_at']
const expectedKeys = ['id','title','parent_id','is_folder']
export const ordinaryRecoveryItem = row => !row.title.startsWith('__tpl__')

export function validateRecoverySnapshot(value) {
  if (!value || value.version !== 1 || value.complete !== true || !digest(value.revision) || !Array.isArray(value.items) || value.items.length > 20000) fail('回收站结果不完整，未采用部分资料')
  const seen = new Set(); let size = 0
  const items = value.items.map(row => {
    if (!row || !id(row.id) || seen.has(row.id) || !unicode(row.title) || bytes(row.title) > 4000 || (row.parent_id !== '' && !id(row.parent_id)) || typeof row.is_folder !== 'boolean' || typeof row.is_deleted !== 'boolean' || !Number.isSafeInteger(row.sort_order) || Math.abs(row.sort_order) > 9007199254740000 || !uint(row.updated_at) || !uint(row.deleted_at)) fail('恢复目录身份或元数据无效')
    seen.add(row.id); size += bytes(row.id) + bytes(row.title) + bytes(row.parent_id)
    if (size > 2 * 1024 * 1024) fail('目录元数据超过完整核对上限')
    return Object.freeze(Object.fromEntries(rowKeys.map(k => [k,row[k]])))
  })
  return Object.freeze({ version:1, complete:true, revision:value.revision, items:Object.freeze(items) })
}
export function recoveryTargetAvailable(snapshot, target) {
  const byID = new Map(snapshot.items.map(r => [r.id,r])), seen = new Set()
  while (target !== '') {
    const row = byID.get(target)
    if (!row || row.is_deleted || !row.is_folder || !ordinaryRecoveryItem(row) || seen.has(target)) return false
    seen.add(target); target = row.parent_id
  }
  return true
}
export function recoveryView(snapshot, query = '', type = 'all') {
  if (typeof query !== 'string' || query.length > 128 || !['all','note','folder'].includes(type)) fail('查找条件无效')
  const needle = query.trim().toLowerCase()
  return snapshot.items.filter(r => r.is_deleted && ordinaryRecoveryItem(r) && (type === 'all' || r.is_folder === (type === 'folder')) && r.title.toLowerCase().includes(needle))
    .sort((a,b) => b.deleted_at - a.deleted_at || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}
export function recoveryPlan(snapshot, ids, mode = 'original', parent = '') {
  validateRecoverySnapshot(snapshot)
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(v => !id(v)) || new Set(ids).size !== ids.length || !['original','target'].includes(mode) || (mode === 'original' && parent !== '') || (parent !== '' && !id(parent))) fail('请选择1–100个互不重复的回收站来源')
  const byID = new Map(snapshot.items.map(r => [r.id,r])), children = new Map(), roots = new Set(ids), restored = new Set(), parents = new Map()
  for (const r of snapshot.items) { if (!children.has(r.parent_id)) children.set(r.parent_id,[]); children.get(r.parent_id).push(r.id) }
  for (const root of ids) {
    const row = byID.get(root)
    if (!row || !row.is_deleted || !ordinaryRecoveryItem(row)) fail('只能恢复普通回收站项目；模板请使用原模板流程')
    const target = mode === 'original' ? row.parent_id : parent
    if (!recoveryTargetAvailable(snapshot,target)) fail('原位置或目标不可用，请选择现存普通文件夹或根目录')
    parents.set(root,target)
    const queue = [root]
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i], value = byID.get(key)
      if (restored.has(key) || (key !== root && roots.has(key))) fail('不能同时选择祖先与内部项目，循环结构也不能恢复')
      if (!value.is_deleted || !ordinaryRecoveryItem(value)) fail('所选目录包含活动或模板子项，未扩大恢复范围')
      restored.add(key)
      if (restored.size > RECOVERY_ROW_LIMIT) fail('本批包含超过1000个项目，请缩小恢复范围')
      const descendants = children.get(key) || []
      if (descendants.length && !value.is_folder) fail('笔记存在不合法子项，未执行恢复')
      queue.push(...descendants)
    }
  }
  const names = new Map()
  const add = (parent,title) => { if (!names.has(parent)) names.set(parent,new Set()); const set = names.get(parent), name = fold(title); if (set.has(name)) return false; set.add(name); return true }
  for (const row of snapshot.items) if (!row.is_deleted) add(row.parent_id,row.title)
  const expected = snapshot.items.filter(r => restored.has(r.id)).map(row => {
    const target = parents.has(row.id) ? parents.get(row.id) : row.parent_id
    if (!add(target,row.title)) fail('恢复位置存在同名项目，整批拒绝；不会覆盖、合并或自动改名')
    return Object.freeze({ id:row.id, title:row.title, parent_id:target, is_folder:row.is_folder })
  })
  if (mode === 'target') {
    const max = snapshot.items.reduce((n,r) => !r.is_deleted && r.parent_id === parent ? Math.max(n,r.sort_order) : n,0)
    if (max > 9007199254740000 - ids.length * 1000) fail('恢复目标排序超过安全范围')
  }
  return Object.freeze(expected)
}
export function validateRecoveryIntent(value) {
  const keys = ['version','request_id','expected_revision','ids','mode','parent_id','started_at','expected']
  if (!value || !same(Object.keys(value).sort(),[...keys].sort()) || value.version !== 1 || !uuid(value.request_id) || !digest(value.expected_revision) || !Array.isArray(value.ids) || !value.ids.length || value.ids.length > 100 || value.ids.some(v => !id(v)) || new Set(value.ids).size !== value.ids.length || !['original','target'].includes(value.mode) || (value.mode === 'original' && value.parent_id !== '') || (value.parent_id !== '' && !id(value.parent_id)) || !uint(value.started_at) || !Array.isArray(value.expected) || !value.expected.length || value.expected.length > RECOVERY_ROW_LIMIT || bytes(JSON.stringify(value)) > 262144) fail('本机恢复记录无效或超过上限，原记录保留')
  const seen = new Set()
  const expected = value.expected.map(row => {
    if (!row || !same(Object.keys(row).sort(),[...expectedKeys].sort()) || !id(row.id) || seen.has(row.id) || !unicode(row.title) || bytes(row.title) > 4000 || !ordinaryRecoveryItem(row) || (row.parent_id !== '' && !id(row.parent_id)) || typeof row.is_folder !== 'boolean') fail('本机恢复目标记录损坏')
    seen.add(row.id); return Object.freeze(Object.fromEntries(expectedKeys.map(k => [k,row[k]])))
  })
  if (value.ids.some(v => !seen.has(v))) fail('恢复记录缺少选择项目')
  return Object.freeze({ version:1, request_id:value.request_id, expected_revision:value.expected_revision, ids:Object.freeze([...value.ids]), mode:value.mode, parent_id:value.parent_id, started_at:value.started_at, expected:Object.freeze(expected) })
}
export function recoveryIntent(snapshot, ids, mode, parent) {
  return validateRecoveryIntent({version:1, request_id:crypto.randomUUID(), expected_revision:snapshot.revision, ids:[...ids], mode, parent_id:parent, started_at:Date.now(), expected:recoveryPlan(snapshot,ids,mode,parent)})
}
export function recoveryCurrentMatches(snapshot, intent) {
  validateRecoverySnapshot(snapshot); validateRecoveryIntent(intent)
  const byID = new Map(snapshot.items.map(r => [r.id,r]))
  return intent.expected.every(expected => { const row = byID.get(expected.id); return row && !row.is_deleted && expectedKeys.every(k => row[k] === expected[k]) })
}
export function validateRecoveryTransition(before, after, intent) {
  validateRecoverySnapshot(before); validateRecoverySnapshot(after); validateRecoveryIntent(intent)
  if (before.revision !== intent.expected_revision || before.revision === after.revision || before.items.length !== after.items.length || !same(recoveryPlan(before,intent.ids,intent.mode,intent.parent_id),intent.expected) || !recoveryCurrentMatches(after,intent)) fail('恢复回执未确认所选范围')
  const afterByID = new Map(after.items.map(r => [r.id,r])), affected = new Map(intent.expected.map(r => [r.id,r])), orders = new Map()
  if (intent.mode === 'target') {
    let max = before.items.reduce((n,r) => !r.is_deleted && r.parent_id === intent.parent_id ? Math.max(n,r.sort_order) : n,0)
    for (const root of intent.ids) { max += 1000; orders.set(root,max) }
  }
  for (const row of before.items) {
    const next = afterByID.get(row.id), target = affected.get(row.id)
    const expected = target ? { ...row, parent_id:target.parent_id, is_deleted:false, deleted_at:0, updated_at:next?.updated_at, sort_order:orders.has(row.id) ? orders.get(row.id) : row.sort_order } : row
    if (!same(next,expected)) fail('恢复回执包含范围以外的修改')
  }
  return after
}
export function createRecoveryJournal(storage) {
  const read = () => { const raw = storage.getItem(RECOVERY_JOURNAL); if (raw === null) return null; if (typeof raw !== 'string' || raw.length > 262144) fail('本机恢复记录无法读取'); try { return validateRecoveryIntent(JSON.parse(raw)) } catch { fail('本机恢复记录损坏，原记录保留') } }
  return { read, raw:() => storage.getItem(RECOVERY_JOURNAL),
    save(intent) { const raw = JSON.stringify(validateRecoveryIntent(intent)); if (storage.getItem(RECOVERY_JOURNAL) !== null) fail('已有待核对恢复记录'); storage.setItem(RECOVERY_JOURNAL,raw); if (storage.getItem(RECOVERY_JOURNAL) !== raw) fail('恢复记录未能写入并读回，未发送请求') },
    clear(intent) { if (!same(read(),intent)) fail('恢复记录已在其它位置变化，未清除'); storage.removeItem(RECOVERY_JOURNAL); if (storage.getItem(RECOVERY_JOURNAL) !== null) fail('本机恢复记录未能清除') },
    discardCorrupt(raw) { if (storage.getItem(RECOVERY_JOURNAL) !== raw) fail('记录已变化，未清除'); storage.removeItem(RECOVERY_JOURNAL); if (storage.getItem(RECOVERY_JOURNAL) !== null) fail('本机恢复记录未能清除') },
  }
}
export async function readTrashRecovery(api, signal, budget = 10000) { return validateRecoverySnapshot(await dailyRequest(api,'/api/trash-recovery',{signal},budget)) }
export async function sendTrashRecovery(api, before, intent, signal, budget = 10000) {
  validateRecoveryIntent(intent)
  const {request_id,expected_revision,ids,mode,parent_id} = intent
  const result = await dailyRequest(api,'/api/trash-recovery/restore',{method:'POST',body:JSON.stringify({request_id,expected_revision,ids,mode,parent_id}),signal},budget)
  if (!result || result.request_id !== request_id || result.before_revision !== expected_revision || !same(result.applied_ids,ids) || !same(result.restored_ids,intent.expected.map(r => r.id))) fail('恢复回执身份不符，请只读核对当前状态')
  return validateRecoveryTransition(before,validateRecoverySnapshot(result.snapshot),intent)
}
