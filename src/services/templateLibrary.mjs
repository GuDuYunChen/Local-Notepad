import { dailyRequest } from './dailyNotes.mjs'

export const TEMPLATE_BODY_LIMIT = 256 * 1024
export const TEMPLATE_INTENT_PREFIX = 'localNotepad.templateIntent.v1:'
export const TEMPLATE_DRAFT_KEY = 'localNotepad.templateDraft.v1'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const object = x => x && typeof x === 'object' && !Array.isArray(x)
const fail = text => { throw new Error(text) }
const bytes = s => new TextEncoder().encode(s).length
const frozen = value => { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value) }; return value }
export function templateName(value) {
  if (typeof value !== 'string' || !value || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) || value !== value.trim() || Array.from(value).length > 120 || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(value) || value.startsWith('__tpl__')) fail('名称须为1–120个字符，不能包含路径符号或首尾空格。')
  return value
}
export function templateBody(value) {
  if (typeof value !== 'string' || bytes(value) > TEMPLATE_BODY_LIMIT || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('模板正文无效或超过256 KiB，未截断。')
  return value
}
// Property insertion order matches the locked Lexical serializer, including
// paragraph textFormat/textStyle before type/version. Exact bytes are tested.
export function textTemplateDocument(text) {
  templateBody(text)
  const children = text.split('\n').map(line => ({ children: line ? [{ detail: 0, format: 0, mode: 'normal', style: '', text: line, type: 'text', version: 1 }] : [], direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', type: 'paragraph', version: 1 }))
  return templateBody(JSON.stringify({ root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 } }))
}
export function editableTemplateText(content) {
  templateBody(content)
  let doc
  try { doc = JSON.parse(content) } catch { return content }
  if (!object(doc?.root) || !Array.isArray(doc.root.children)) return null
  const lines = []
  for (const p of doc.root.children) {
    if (p.type !== 'paragraph' || !Array.isArray(p.children) || p.format || p.indent) return null
    if (p.children.some(t => t.type !== 'text' || t.format || t.style || typeof t.text !== 'string')) return null
    lines.push(p.children.map(t => t.text).join(''))
  }
  return lines.join('\n')
}
export function validTemplate(value) {
  if (!object(value) || typeof value.id !== 'string' || !value.id || value.id.length > 255 || typeof value.title !== 'string' || typeof value.content !== 'string' || typeof value.archived !== 'boolean' || !Number.isSafeInteger(value.updated_at) || value.updated_at < 0) fail('模板身份或响应格式无效，未采用。')
  templateBody(value.content)
  return frozen({ id: value.id, title: value.title, content: value.content, archived: value.archived, updated_at: value.updated_at })
}
export const sameTemplate = (a, b) => !!a && !!b && ['id', 'title', 'content', 'archived'].every(k => a[k] === b[k])
export async function readTemplateLibrary(request, signal, budget = 10000) {
  const value = await dailyRequest(request, '/api/template-library', { signal }, budget)
  if (!object(value) || value.complete !== true || !Array.isArray(value.items) || value.items.length > 500) fail('模板库读取不完整，未显示为空列表。')
  const seen = new Set(); let total = 0
  return value.items.map(item => { const row = validTemplate(item); total += bytes(row.content); if (seen.has(row.id) || total > 8 * 1024 * 1024) fail('模板库重复或超过读取上限。'); seen.add(row.id); return row })
}
function validateIntent(value) {
  if (!object(value) || value.version !== 1 || !uuid.test(value.id) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 1) fail('本地操作记录损坏，未自动发送。')
  if (value.type === 'create') {
    const p = value.payload
    if (!object(p) || !['template', 'note'].includes(p.kind) || typeof p.parent_id !== 'string' || p.parent_id.length > 255 || /[\x00-\x1f]/.test(p.parent_id) || (p.kind === 'template' && p.parent_id)) fail('创建记录字段无效。')
    templateName(p.title); templateBody(p.content)
    if (!p.content) fail('创建记录没有编辑器正文。')
  } else if (value.type === 'change') {
    const before = validTemplate(value.expected), after = validTemplate(value.next)
    if (before.id !== after.id) fail('模板身份已变化。')
    templateName(after.title)
    if (before.archived !== after.archived && (before.title !== after.title || before.content !== after.content)) fail('归档或恢复不能混合正文修改。')
  } else fail('未知操作类型，未自动发送。')
  return frozen(value)
}
export function createTemplateJournal(storage, createId = () => crypto.randomUUID(), now = () => Date.now()) {
  const read = entry => {
    if (!entry || typeof entry.raw !== 'string' || entry.key !== TEMPLATE_INTENT_PREFIX + entry.value?.id || storage.getItem(entry.key) !== entry.raw) fail('本地操作记录已变化，请重新读取；未发送请求。')
    return validateIntent(JSON.parse(entry.raw))
  }
  return {
    list() {
      const result = []
      for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (!key?.startsWith(TEMPLATE_INTENT_PREFIX)) continue
        const raw = storage.getItem(key)
        try { const value = validateIntent(JSON.parse(raw)); if (key !== TEMPLATE_INTENT_PREFIX + value.id) fail('身份不符'); result.push({ key, raw, value }) }
        catch { result.push({ key, raw, error: '操作记录损坏，未删除或发送；请保留原记录排查。' }) }
      }
      return result.sort((a,b) => (b.value?.createdAt || 0) - (a.value?.createdAt || 0))
    },
    save(input) {
      if (this.list().length >= 20) fail('已有20份操作记录，请先核对并明确清除已完成记录。')
      const value = validateIntent({ ...input, id: createId(), version: 1, createdAt: now() }), key = TEMPLATE_INTENT_PREFIX + value.id
      if (storage.getItem(key) !== null) fail('操作标识冲突，未覆盖。')
      const raw = JSON.stringify(value)
      try { storage.setItem(key, raw); if (storage.getItem(key) !== raw) fail('写入不一致') } catch { fail('无法保存本地操作记录，未发送请求；请检查可用空间。') }
      return { key, raw, value }
    },
    read,
    remove(entry) {
      if (!entry?.key?.startsWith(TEMPLATE_INTENT_PREFIX) || typeof entry.raw !== 'string' || storage.getItem(entry.key) !== entry.raw) fail('记录已变化，未清除。')
      storage.removeItem(entry.key); if (storage.getItem(entry.key) !== null) fail('记录未清除。')
    },
  }
}
export async function templatePayloadHash(payload) {
  const title = (payload.kind === 'template' ? '__tpl__' : '') + payload.title
  const data = new TextEncoder().encode(title + '\0' + payload.parent_id + '\0' + payload.content)
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2,'0')).join('')
}
// The immutable operation is stored before any write. Reopening a panel never
// sends it. User retries reuse the original ID and compare with the durable
// server ledger, so a lost response cannot create another copy.
export function createTemplateOperations(request, journal, budget = 10000) {
  let active = false
  const check = signal => { if (signal?.aborted) fail('已停止等待；已发送的操作可能已经完成，请只读核对。') }
  return {
    async run(entry, send = false, signal, beforeSend) {
      if (active) fail('另一项模板操作尚未结束。')
      active = true
      try {
        const intent = journal.read(entry); check(signal)
        const call = (path, init = {}) => dailyRequest(request, path, { ...init, signal }, budget)
        if (intent.type === 'change') {
          const path = '/api/template-library/items/' + encodeURIComponent(intent.expected.id)
          let current = validTemplate(await call(path)); check(signal)
          if (sameTemplate(current, intent.next)) return { confirmed: true, current, message: '当前模板与目标一致；没有重复写入。' }
          if (!sameTemplate(current, intent.expected)) fail('模板已被其他操作修改，旧确认失效；未覆盖。')
          if (!send) return { confirmed: false, message: '当前模板仍是原内容；本次只做核对。' }
          await beforeSend?.(); check(signal); journal.read(entry)
          current = validTemplate(await call(path, { method: 'PUT', body: JSON.stringify({ expected: intent.expected, next: intent.next }) }))
          if (!sameTemplate(current, intent.next)) fail('返回模板与目标不一致，结果尚未确认。')
          return { confirmed: true, current, message: '模板修改已确认。' }
        }
        const hash = await templatePayloadHash(intent.payload); check(signal)
        const path = '/api/template-library/requests/' + intent.id
        let receipt = await call(path); check(signal)
        if (!object(receipt) || receipt.request_id !== intent.id || typeof receipt.found !== 'boolean') fail('创建记录查回格式无效。')
        if (!receipt.found) {
          if (!send) return { confirmed: false, message: '当前数据库尚未找到此操作；没有重新创建。' }
          await beforeSend?.(); check(signal); journal.read(entry)
          receipt = await call(path, { method: 'POST', body: JSON.stringify(intent.payload) })
        }
        const title = (intent.payload.kind === 'template' ? '__tpl__' : '') + intent.payload.title
        if (!object(receipt) || receipt.found !== true || receipt.request_id !== intent.id || receipt.payload_sha256 !== hash || typeof receipt.file_id !== 'string' || !uuid.test(receipt.file_id) || !Number.isSafeInteger(receipt.created_at) || receipt.created_at < 1 || receipt.title !== title || receipt.parent_id !== intent.payload.parent_id || !['available', 'deleted', 'missing'].includes(receipt.state)) fail('创建回执身份或正文指纹不符，未确认成功。')
        return { confirmed: true, receipt, message: receipt.state === 'available' ? '创建回执已确认；重复核对不会再次创建。' : '创建曾经完成，但目标已删除或不在当前数据库中；不会重新创建。' }
      } finally { active = false }
    },
  }
}
