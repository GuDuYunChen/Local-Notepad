import { dailyRequest } from './dailyNotes.mjs'

export const FOLDER_JOURNAL = 'local-notepad.folder-workspace.v1'
export const FOLDER_PAGE_SIZE = 50
export const FOLDER_CHANGED = 'folder-workspace:changed'
const fail = message => { throw new Error(message) }
const unicode = value => typeof value === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
const bytes = value => new TextEncoder().encode(value).length
const id = value => unicode(value) && bytes(value) > 0 && bytes(value) <= 128 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
const fold = value => value.replace(/[A-Z]/g, c => c.toLowerCase())
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 20000
export function folderName(value) {
  if (!unicode(value) || value !== value.trim() || !value || [...value].length > 255 || /^[.]{1,2}$/.test(value) || value.startsWith('__tpl__') || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(value)) fail('名称须为1–255个字符，不能含首尾空格、路径符号、控制字符或模板前缀')
  return value
}
export function validateFolderSnapshot(value) {
  if (!value || value.version !== 1 || value.complete !== true || !digest(value.revision) || !count(value.hidden_count) || !Array.isArray(value.items) || value.items.length + value.hidden_count > 20000) fail('目录结果不完整，未采用部分数据')
  const byID = new Map(); let size = 0, hidden = 0
  const items = value.items.map(item => {
    if (!item || !id(item.id) || byID.has(item.id) || !unicode(item.title) || bytes(item.title) > 4000 || item.title.startsWith('__tpl__') || (item.parent_id !== '' && !id(item.parent_id)) || typeof item.is_folder !== 'boolean' || !Number.isSafeInteger(item.sort_order) || item.sort_order < -9007199254740000 || item.sort_order > 9007199254740000 || !Number.isSafeInteger(item.updated_at) || item.updated_at < 0 || !count(item.hidden_children)) fail('目录身份或元数据无效')
    const row = Object.freeze(Object.fromEntries(['id','title','parent_id','is_folder','sort_order','updated_at','hidden_children'].map(k => [k,item[k]])))
    size += bytes(row.id) + bytes(row.title) + bytes(row.parent_id); hidden += row.hidden_children; byID.set(row.id,row); return row
  })
  if (size > 2 * 1024 * 1024 || hidden > value.hidden_count) fail('目录元数据超出完整核对范围')
  const done = new Set()
  for (const row of items) {
    let key = row.id; const chain = new Set()
    while (key && !done.has(key)) {
      if (chain.has(key)) fail('目录存在循环，未允许修改')
      chain.add(key); const node = byID.get(key)
      if (!node || (node.parent_id && !byID.get(node.parent_id)?.is_folder)) fail('目录父项缺失或不是文件夹')
      key = node.parent_id
    }
    for (const key of chain) done.add(key)
  }
  return Object.freeze({ version:1, complete:true, revision:value.revision, hidden_count:value.hidden_count, items:Object.freeze(items) })
}
export function folderPath(snapshot, key) {
  const byID = new Map(snapshot.items.map(n => [n.id,n])), parts = [], seen = new Set()
  while (key) { if (seen.has(key) || !byID.has(key)) return '（目录不可用）'; seen.add(key); const n = byID.get(key); parts.push(n.title || '未命名'); key = n.parent_id }
  return '/' + parts.reverse().join('/')
}
export function folderChildren(snapshot, parent, query = '') {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  return snapshot.items.filter(n => n.parent_id === parent && n.title.toLocaleLowerCase('zh-CN').includes(needle)).sort((a,b) => Number(b.is_folder) - Number(a.is_folder) || b.sort_order - a.sort_order || a.title.localeCompare(b.title,'zh-CN') || a.id.localeCompare(b.id))
}
export function validateFolderIntent(value) {
  const keys = ['version','request_id','expected_revision','kind','ids','parent_id','name','started_at','label']
  if (!value || Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k)) || value.version !== 1 || !uuid(value.request_id) || !digest(value.expected_revision) || !Array.isArray(value.ids) || !value.ids.length || value.ids.length > 100 || value.ids.some(n => !id(n)) || new Set(value.ids).size !== value.ids.length || (value.parent_id !== '' && !id(value.parent_id)) || typeof value.name !== 'string' || !Number.isSafeInteger(value.started_at) || value.started_at < 1 || typeof value.label !== 'string' || value.label.length > 2000) fail('文件夹操作记录损坏，原记录保留')
  if (['create','rename'].includes(value.kind)) { folderName(value.name); if (value.ids.length !== 1 || (value.kind === 'create' && !uuid(value.ids[0])) || (value.kind === 'rename' && value.parent_id)) fail('文件夹名称操作范围无效') }
  else if (value.kind === 'move') { if (value.name) fail('移动不能混合改名') }
  else if (value.kind === 'trash-empty') { if (value.ids.length !== 1 || value.name || value.parent_id) fail('这里只能删除单个空目录') }
  else fail('不支持的文件夹操作')
  return Object.freeze({ ...Object.fromEntries(keys.map(k => [k,value[k]])), ids:Object.freeze([...value.ids]) })
}
export function folderIntent(snapshot, kind, options = {}, random = () => crypto.randomUUID(), now = Date.now()) {
  validateFolderSnapshot(snapshot)
  const ids = kind === 'create' ? [random()] : [...(options.ids || [])], byID = new Map(snapshot.items.map(n => [n.id,n])), selected = new Set(ids), parent = options.parent_id || '', name = options.name || ''
  const intent = validateFolderIntent({ version:1, request_id:random(), expected_revision:snapshot.revision, kind, ids, parent_id:parent, name, started_at:now, label:kind === 'move' ? `移动 ${ids.length} 项到 ${folderPath(snapshot,parent).slice(0,1000)}` : `${kind === 'create' ? '新建' : kind === 'rename' ? '重命名' : '移到回收站'}文件夹 ${name || byID.get(ids[0])?.title || ''}` })
  if (kind === 'create') { if (byID.has(ids[0]) || snapshot.items.length + snapshot.hidden_count >= 20000) fail('目录已达到上限或身份已存在') }
  else for (const key of ids) { const row = byID.get(key); if (!row || (kind !== 'move' && !row.is_folder)) fail('请选择有效的普通文件夹或笔记') }
  if (kind === 'move' || kind === 'create') { if (parent && !byID.get(parent)?.is_folder) fail('目标必须是普通文件夹或根目录') }
  if (kind === 'move') {
    for (const key of ids) { const row = byID.get(key); if (row.parent_id === parent) fail('所选项目已在目标目录'); for (let p = row.parent_id; p; p = byID.get(p).parent_id) if (selected.has(p)) fail('不能同时移动祖先与其内部项目') }
    for (let p = parent; p; p = byID.get(p).parent_id) if (selected.has(p)) fail('不能移动到自己或自己的子目录')
  }
  if (kind === 'trash-empty' && (snapshot.items.some(n => n.parent_id === ids[0]) || byID.get(ids[0]).hidden_children)) fail('文件夹包含普通、模板或回收站子项，不能删除')
  if (kind === 'rename' && byID.get(ids[0]).title === name) fail('名称没有变化')
  if (kind !== 'trash-empty') {
    const target = kind === 'rename' ? byID.get(ids[0]).parent_id : parent
    const names = new Set(snapshot.items.filter(n => n.parent_id === target && !selected.has(n.id)).map(n => fold(n.title)))
    for (const key of ids) { const value = fold(kind === 'move' ? byID.get(key).title : name); if (names.has(value)) fail('目标存在同名项目或所选项目互相重名，不会覆盖'); names.add(value) }
  }
  return intent
}
export function folderCurrentMatches(snapshot, intent) {
  validateFolderSnapshot(snapshot); validateFolderIntent(intent)
  const byID = new Map(snapshot.items.map(n => [n.id,n]))
  if (intent.kind === 'trash-empty') return !byID.has(intent.ids[0])
  return intent.ids.every(key => { const row = byID.get(key); return !!row && (intent.kind === 'move' ? row.parent_id === intent.parent_id : row.is_folder && row.title === intent.name && (intent.kind !== 'create' || row.parent_id === intent.parent_id)) })
}
export function validateFolderTransition(before, after, intent) {
  validateFolderSnapshot(before); validateFolderSnapshot(after); validateFolderIntent(intent)
  if (before.revision !== intent.expected_revision || after.revision === before.revision || !folderCurrentMatches(after,intent)) fail('目录回执未确认目标状态')
  const a = new Map(after.items.map(n => [n.id,n])), changed = new Set(intent.ids)
  if (after.items.length !== before.items.length + (intent.kind === 'create' ? 1 : intent.kind === 'trash-empty' ? -1 : 0) || after.hidden_count !== before.hidden_count + (intent.kind === 'trash-empty' ? 1 : 0)) fail('目录回执数量不一致')
  if (intent.kind === 'create' && a.get(intent.ids[0])?.hidden_children !== 0) fail('新建目录回执含非预期子项')
  const trashed = intent.kind === 'trash-empty' ? before.items.find(n => n.id === intent.ids[0]) : null
  for (const row of before.items) {
    const next = a.get(row.id)
    if (changed.has(row.id)) {
      if (intent.kind === 'trash-empty') continue
      const expected = { ...row, updated_at:next?.updated_at }
      if (intent.kind === 'move') { expected.parent_id = intent.parent_id; expected.sort_order = next?.sort_order }
      if (intent.kind === 'rename') expected.title = intent.name
      if (JSON.stringify(next) !== JSON.stringify(expected)) fail('回执更改了操作范围之外的字段')
    } else {
      const expected = { ...row, hidden_children:row.hidden_children + (trashed?.parent_id === row.id ? 1 : 0) }
      if (JSON.stringify(next) !== JSON.stringify(expected)) fail('回执包含非预期目录修改')
    }
  }
  return after
}
export function createFolderJournal(storage) {
  const read = () => { const raw = storage.getItem(FOLDER_JOURNAL); if (raw === null) return null; if (typeof raw !== 'string' || raw.length > 65536) fail('操作记录无法读取'); try { return validateFolderIntent(JSON.parse(raw)) } catch { fail('文件夹操作记录损坏，原记录保留') } }
  return { read,
    save(intent) { if (storage.getItem(FOLDER_JOURNAL) !== null) fail('已有待核对操作'); const raw = JSON.stringify(validateFolderIntent(intent)); storage.setItem(FOLDER_JOURNAL,raw); if (storage.getItem(FOLDER_JOURNAL) !== raw) fail('本机操作记录未写入并读回，尚未发送修改') },
    clear(intent) { if (JSON.stringify(read()) !== JSON.stringify(intent)) fail('操作记录已变化，未清除'); storage.removeItem(FOLDER_JOURNAL); if (storage.getItem(FOLDER_JOURNAL) !== null) fail('本机记录清理失败') },
    raw: () => storage.getItem(FOLDER_JOURNAL),
    discardCorrupt(raw) { if (storage.getItem(FOLDER_JOURNAL) !== raw) fail('记录已变化，未清除'); storage.removeItem(FOLDER_JOURNAL); if (storage.getItem(FOLDER_JOURNAL) !== null) fail('本机记录清理失败') },
  }
}
export async function readFolderWorkspace(api, signal, budget = 10000) {
  return validateFolderSnapshot(await dailyRequest(api,'/api/folder-workspace',{ signal },budget))
}
export async function sendFolderChange(api, before, intent, signal, budget = 10000) {
  validateFolderIntent(intent)
  const { version, started_at, label, ...payload } = intent
  const result = await dailyRequest(api,'/api/folder-workspace/changes',{ method:'POST', body:JSON.stringify(payload), signal },budget)
  if (!result || result.request_id !== intent.request_id || result.kind !== intent.kind || result.before_revision !== intent.expected_revision || JSON.stringify(result.applied_ids) !== JSON.stringify(intent.ids)) fail('操作回执身份不符，须只读核对当前状态')
  return validateFolderTransition(before,validateFolderSnapshot(result.snapshot),intent)
}
