import { dailyRequest } from './dailyNotes.mjs'
export const NOTE_TAG_WAIT_MS = 10000
export const NOTE_TAG_PREFIX = 'local-notepad.note-tags.v1:'
const fail = text => { throw new Error(text) }
const identity = id => typeof id === 'string' && id.length > 0 && id.length <= 128 && id.trim() === id && !/[\u0000-\u001f\u007f]/.test(id)
export function noteTagName(value) {
  if (typeof value !== 'string') fail('请输入标签名称')
  const name = value.trim()
  if (!name || Array.from(name).some(c=>c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff) || Array.from(name).length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) fail('标签名称须为 1–40 个字符，不能包含控制字符')
  return name
}
export function tagColor(value) { return typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) ? value : '#7e5bef' }
export function validateNoteTags(value, fileId) {
  if (!identity(fileId) || !value || value.file_id !== fileId || value.complete !== true || !Array.isArray(value.available) || !Array.isArray(value.tags) || value.available.length > 500)
    fail('标签列表不完整或所属笔记不符，未采用这份结果')
  const byId = new Map()
  const available = value.available.map(row => {
    if (!row || !identity(row.id) || typeof row.name !== 'string' || !row.name || row.name.length > 1000 || typeof row.color !== 'string' || byId.has(row.id)) fail('标签列表格式不正确')
    const next = Object.freeze({ id: row.id, name: row.name, color: row.color }); byId.set(row.id, next); return next
  })
  const seen = new Set()
  const tags = value.tags.map(row => {
    const current = row && byId.get(row.id)
    if (!current || seen.has(row.id) || current.name !== row.name || current.color !== row.color) fail('已分配标签与标签库不一致，请重新读取')
    seen.add(row.id); return current
  })
  return Object.freeze({file_id:fileId,complete:true,available:Object.freeze(available),tags:Object.freeze(tags)})
}
export function validateNoteTagIntent(value, fileId) {
  if (!identity(fileId) || !value || value.version !== 1 || value.file_id !== fileId || !Number.isSafeInteger(value.started_at) || value.started_at < 1) fail('本机标签操作记录无法读取；原记录保留')
  if (value.kind === 'create') {
    if (noteTagName(value.name) !== value.name) fail('标签名称无效')
  } else if (value.kind === 'change') {
    if (!identity(value.tag_id) || typeof value.name !== 'string' || !value.name || typeof value.expected_attached !== 'boolean' || typeof value.attached !== 'boolean' || value.attached === value.expected_attached) fail('标签操作记录格式无效')
  } else fail('标签操作类型无效')
  return Object.freeze({...value})
}
export function noteTagIntent(fileId, payload, now = Date.now()) { return validateNoteTagIntent({...payload,version:1,file_id:fileId,started_at:now},fileId) }
export function createNoteTagJournal(storage, fileId) {
  if (!identity(fileId)) fail('笔记身份无效')
  const key = NOTE_TAG_PREFIX + encodeURIComponent(fileId)
  return {
    read() {
      const raw = storage.getItem(key)
      if (raw === null) return null
      if (typeof raw !== 'string' || raw.length > 8000) fail('本机标签操作记录无法读取；原记录保留')
      try { return validateNoteTagIntent(JSON.parse(raw), fileId) } catch { fail('本机标签操作记录无法读取；原记录保留') }
    },
    save(intent) {
      if (storage.getItem(key) !== null) fail('请先核对已有标签操作，不会覆盖未确认记录')
      const raw = JSON.stringify(validateNoteTagIntent(intent,fileId))
      storage.setItem(key,raw)
      if (storage.getItem(key) !== raw) fail('本机操作记录保存失败，尚未发送标签修改')
      return intent
    },
    clear(intent) {
      const prior = this.read()
      if (intent && JSON.stringify(prior) !== JSON.stringify(intent)) fail('操作记录已变化，未清除')
      storage.removeItem(key)
      if (storage.getItem(key) !== null) fail('操作记录清理失败，请重新核对')
    },
    discardCorrupt() { storage.removeItem(key); if(storage.getItem(key)!==null) fail('操作记录清理失败') },
  }
}
export async function readNoteTags(load,fileId,signal,budget=NOTE_TAG_WAIT_MS) {
  if (!identity(fileId)) fail('笔记身份无效')
  return validateNoteTags(await dailyRequest(load,'/api/note-tags/'+encodeURIComponent(fileId),{signal},budget),fileId)
}
export function intentMatchesCurrent(snapshot,intent) {
  validateNoteTagIntent(intent,snapshot.file_id)
  return intent.kind === 'create' ? snapshot.tags.some(t=>t.name===intent.name) : snapshot.tags.some(t=>t.id===intent.tag_id)===intent.attached
}
export async function sendNoteTagIntent(load,intent,signal,budget=NOTE_TAG_WAIT_MS) {
  validateNoteTagIntent(intent,intent.file_id)
  const payload = intent.kind === 'create' ? {name:intent.name} : {tag_id:intent.tag_id,name:intent.name,expected_attached:intent.expected_attached,attached:intent.attached}
  const value = await dailyRequest(load,'/api/note-tags/'+encodeURIComponent(intent.file_id),{method:intent.kind==='create'?'POST':'PUT',body:JSON.stringify(payload),signal},budget)
  const result = validateNoteTags(value,intent.file_id)
  if (!intentMatchesCurrent(result,intent)) fail('标签修改响应没有确认目标状态，请核对当前标签')
  return result
}
