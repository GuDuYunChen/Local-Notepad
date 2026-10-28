import { dailyRequest } from './dailyNotes.mjs'
import { noteTagName } from './noteTags.mjs'
export const TAG_WORKSPACE_JOURNAL = 'local-notepad.tag-workspace.v1'
export const TAG_WORKSPACE_PAGE_SIZE = 50
export const TAG_WORKSPACE_CHANGED = 'tag-workspace:changed'
const fail = message => { throw new Error(message) }
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 50000
export function validateTagWorkspace(value) {
  if (!value || value.version !== 1 || value.complete !== true || !digest(value.revision) || !Array.isArray(value.tags) || value.tags.length > 500) fail('标签库不完整，未采用这份结果')
  const seen = new Set(), names = new Set()
  let links = 0
  const tags = value.tags.map(tag => {
    if (!tag || !identity(tag.id) || seen.has(tag.id) || typeof tag.name !== 'string' || !tag.name || tag.name.length > 4000 || names.has(tag.name) || typeof tag.color !== 'string' || tag.color.length > 1000 || !count(tag.active_count) || !count(tag.hidden_count) || !count(tag.total_count) || tag.total_count !== tag.active_count + tag.hidden_count) fail('标签列表身份或关联数量不正确')
    seen.add(tag.id); names.add(tag.name); links += tag.total_count
    return Object.freeze({ id: tag.id, name: tag.name, color: tag.color, active_count: tag.active_count, hidden_count: tag.hidden_count, total_count: tag.total_count })
  })
  if (links > 50000) fail('标签关联超过完整核对上限')
  return Object.freeze({ version: 1, complete: true, revision: value.revision, tags: Object.freeze(tags) })
}
export function validateTagWorkspacePage(value, snapshot, id, offset) {
  const tag = snapshot.tags.find(item => item.id === id)
  if (!tag || !Number.isSafeInteger(offset) || offset < 0 || offset % 50 !== 0 || offset > tag.active_count || !value || value.tag_id !== id || value.revision !== snapshot.revision || value.complete !== true || value.offset !== offset || value.total !== tag.active_count || value.has_more !== (offset + 50 < value.total) || !Array.isArray(value.notes) || value.notes.length !== Math.min(50, value.total - offset)) fail('关联笔记列表已变化或不完整，请重新读取标签库')
  const seen = new Set()
  const notes = value.notes.map(note => {
    if (!note || !identity(note.id) || seen.has(note.id) || typeof note.title !== 'string' || note.title.length > 4000) fail('关联笔记列表身份无效')
    seen.add(note.id); return Object.freeze({ id: note.id, title: note.title })
  })
  return Object.freeze({ tag_id: id, revision: value.revision, complete: true, offset, total: value.total, has_more: value.has_more, notes: Object.freeze(notes) })
}
export function validateTagWorkspaceIntent(value) {
  if (!value || value.version !== 1 || !uuid(value.request_id) || !digest(value.expected_revision) || !identity(value.id) || !Number.isSafeInteger(value.started_at) || value.started_at < 1 || typeof value.label !== 'string' || value.label.length > 8000) fail('标签工作台操作记录损坏，原记录保留')
  const keys = ['version','request_id','expected_revision','id','started_at','label','kind']
  const out = Object.fromEntries(keys.map(key => [key, value[key]]))
  if (value.kind === 'create' || value.kind === 'rename') {
    if (noteTagName(value.name) !== value.name || !/^#[a-f\d]{6}$/i.test(value.color) || (value.kind === 'create' && !uuid(value.id))) fail('标签名称、颜色或身份无效')
    keys.push('name','color'); out.name = value.name; out.color = value.color
  } else if (value.kind === 'merge') {
    if (!identity(value.target_id) || value.target_id === value.id) fail('请选择不同的目标标签')
    keys.push('target_id'); out.target_id = value.target_id
  } else if (value.kind !== 'delete') fail('标签操作类型无效')
  if (Object.keys(value).some(key => !keys.includes(key))) fail('标签操作记录包含未知字段')
  return Object.freeze(out)
}
export function tagWorkspaceIntent(snapshot, kind, { id, name, color, target_id } = {}, random = () => crypto.randomUUID(), now = Date.now()) {
  validateTagWorkspace(snapshot)
  const source = snapshot.tags.find(tag => tag.id === id), target = snapshot.tags.find(tag => tag.id === target_id)
  if (kind !== 'create' && !source) fail('请选择源标签')
  if (kind === 'merge' && !target) fail('请选择合并目标')
  const value = { version: 1, request_id: random(), expected_revision: snapshot.revision, id: kind === 'create' ? random() : id, started_at: now, kind,
    label: kind === 'create' ? `创建“${name || ''}”` : kind === 'merge' ? `合并“${source.name}”到“${target.name}”` : `${kind === 'rename' ? '修改' : '删除'}“${source.name}”` }
  if (kind === 'create' || kind === 'rename') {
    value.name = noteTagName(name); value.color = color
    if (snapshot.tags.some(tag => tag.id !== id && tag.name === value.name)) fail('同名标签已存在；请使用合并，不会覆盖')
    if (kind === 'create' && snapshot.tags.length >= 500) fail('标签库已达到500项上限')
  }
  if (kind === 'merge') value.target_id = target_id
  return validateTagWorkspaceIntent(value)
}
export function tagWorkspaceCurrentMatches(snapshot, intent) {
  validateTagWorkspace(snapshot); validateTagWorkspaceIntent(intent)
  const source = snapshot.tags.find(tag => tag.id === intent.id)
  if (intent.kind === 'create' || intent.kind === 'rename') return Boolean(source && source.name === intent.name && source.color === intent.color)
  return !source && (intent.kind === 'delete' || snapshot.tags.some(tag => tag.id === intent.target_id))
}
export function createTagWorkspaceJournal(storage) {
  const read = () => {
    const raw = storage.getItem(TAG_WORKSPACE_JOURNAL)
    if (raw === null) return null
    if (typeof raw !== 'string' || raw.length > 16000) fail('标签工作台操作记录无法读取')
    try { return validateTagWorkspaceIntent(JSON.parse(raw)) } catch { fail('标签工作台操作记录损坏，原记录保留') }
  }
  return {
    read,
    save(intent) {
      if (storage.getItem(TAG_WORKSPACE_JOURNAL) !== null) fail('已有待核对操作，未发送新修改')
      const raw = JSON.stringify(validateTagWorkspaceIntent(intent))
      storage.setItem(TAG_WORKSPACE_JOURNAL, raw)
      if (storage.getItem(TAG_WORKSPACE_JOURNAL) !== raw) fail('操作记录未能写入并读回，尚未发送修改')
    },
    clear(intent) {
      if (JSON.stringify(read()) !== JSON.stringify(intent)) fail('操作记录已被其他窗口改变，未清除')
      storage.removeItem(TAG_WORKSPACE_JOURNAL)
      if (storage.getItem(TAG_WORKSPACE_JOURNAL) !== null) fail('操作记录清理失败')
    },
    corruptRaw: () => storage.getItem(TAG_WORKSPACE_JOURNAL),
    discardCorrupt(expectedRaw) {
      if (storage.getItem(TAG_WORKSPACE_JOURNAL) !== expectedRaw) fail('损坏记录已变化，未清除')
      storage.removeItem(TAG_WORKSPACE_JOURNAL)
      if (storage.getItem(TAG_WORKSPACE_JOURNAL) !== null) fail('操作记录清理失败')
    },
  }
}
export async function readTagWorkspace(api, signal, budget = 10000) {
  return validateTagWorkspace(await dailyRequest(api, '/api/tag-workspace', { signal }, budget))
}
export async function readTagWorkspaceNotes(api, snapshot, id, offset, signal, budget = 10000) {
  validateTagWorkspace(snapshot)
  if (!identity(id) || !Number.isSafeInteger(offset) || offset < 0 || offset > 50000 || offset % 50) fail('分页位置无效')
  const query = new URLSearchParams({ revision: snapshot.revision, offset: String(offset) })
  return validateTagWorkspacePage(await dailyRequest(api, `/api/tag-workspace/${encodeURIComponent(id)}/notes?${query}`, { signal }, budget), snapshot, id, offset)
}
export async function sendTagWorkspaceIntent(api, intent, signal, budget = 10000) {
  validateTagWorkspaceIntent(intent)
  const { version, started_at, label, ...payload } = intent
  const value = await dailyRequest(api, '/api/tag-workspace/changes', { method: 'POST', body: JSON.stringify(payload), signal }, budget)
  if (!value || value.request_id !== intent.request_id || value.kind !== intent.kind || value.before_revision !== intent.expected_revision) fail('标签操作回执身份不符，须核对当前状态')
  const snapshot = validateTagWorkspace(value.snapshot)
  if (!tagWorkspaceCurrentMatches(snapshot, intent)) fail('标签操作未确认目标状态')
  return snapshot
}
