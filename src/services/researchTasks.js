import { api } from './api'
import { buildStudyCompilation } from './studyCompilation'

export const RESEARCH_TASK_PREFIX = 'localNotepad.researchTask.v1:'
export const MAX_RESEARCH_TASKS = 10
export const MAX_RESEARCH_TASK_BYTES = 3 * 1024 * 1024
export const RESEARCH_PHASES = Object.freeze({ draft: '已存草稿', submitted: '已发送，待查回', uncertain: '结果待确认', confirmed: '已查回创建结果' })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA = /^[0-9a-f]{64}$/
const FORMAT = 'local-notepad-research-task'
const fail = message => { throw new Error(message) }
const record = x => !!x && typeof x === 'object' && !Array.isArray(x)
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x) }; return x }
const check = options => { if (options?.signal?.aborted || options?.isCurrent?.() === false) fail('操作已取消；没有自动重试') }
const text = (x, max, empty = false) => { if (typeof x !== 'string' || x.length > max || x.includes('\0') || (!empty && !x.length)) fail('研究草稿字段无效'); return x }
const date = x => { if (typeof x !== 'string' || !Number.isFinite(Date.parse(x)) || new Date(x).toISOString() !== x) fail('研究草稿时间无效'); return x }
function bounded(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_RESEARCH_TASK_BYTES || new TextEncoder().encode(raw).length > MAX_RESEARCH_TASK_BYTES) fail('研究任务超过 3 MiB，未截断或保存')
  return raw
}
function normalizeDocument(value) {
  if (!record(value) || !record(value.config) || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 200) fail('研究草稿结构无效')
  const seen = new Set()
  const rows = value.rows.map(row => {
    if (!record(row)) fail('研究草稿条目损坏')
    const collectionId = text(row.collectionId, 255), id = text(row.id, 255), key = JSON.stringify([collectionId, id])
    if (seen.has(key) || !['unread', 'read', 'revisit'].includes(row.status) || !Number.isSafeInteger(row.ordinal) || row.ordinal < 1) fail('研究草稿条目重复或状态无效')
    seen.add(key)
    const note = text(row.note, 2000)
    if (!note.trim()) fail('研究草稿包含没有批注的条目')
    return { collectionId, collectionKey: collectionId, id, collectionName: text(row.collectionName, 255), title: text(row.title, 1024, true),
      folderPath: text(row.folderPath || '', 32768, true), ordinal: row.ordinal, status: row.status, note,
      updatedAt: row.updatedAt === null ? null : date(row.updatedAt) }
  })
  const config = { title: text(value.config.title, 120), goal: text(value.config.goal, 2000, true), parentId: text(value.config.parentId, 255, true), group: value.config.group }
  const preparedAt = date(value.preparedAt), loadedAt = date(value.loadedAt)
  const preview = buildStudyCompilation(rows, config, preparedAt, loadedAt)
  return { document: { config, rows, preparedAt, loadedAt }, preview }
}
function documentFromPreview(preview) {
  const value = { config: { title: preview.title.replace(/\.md$/, ''), goal: preview.goal, parentId: preview.parentId, group: preview.group },
    rows: preview.groups.flatMap(group => group.items), preparedAt: preview.preparedAt, loadedAt: preview.loadedAt }
  const normalized = normalizeDocument(value)
  if (normalized.preview.content !== preview.content || normalized.preview.markdown !== preview.markdown) fail('研究预览内容不一致，未保存')
  return normalized
}
export async function researchPayloadFingerprint(preview) {
  if (!globalThis.crypto?.subtle) fail('当前环境无法校验研究草稿，未发送创建请求')
  const bytes = new TextEncoder().encode(preview.title + '\0' + preview.parentId + '\0' + preview.content)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('')
}
function receiptFor(value, task) {
  if (!record(value) || value.found !== true || value.request_id !== task.id || value.payload_sha256 !== task.payloadSHA256 ||
      typeof value.file_id !== 'string' || !UUID.test(value.file_id) || value.title !== task.preview.title || value.parent_id !== task.preview.parentId ||
      !Number.isSafeInteger(value.created_at) || value.created_at <= 0 || !['available', 'deleted', 'missing'].includes(value.state)) fail('创建回执与研究任务不一致，未确认成功')
  return { found: true, request_id: value.request_id, payload_sha256: value.payload_sha256, file_id: value.file_id,
    title: value.title, parent_id: value.parent_id, created_at: value.created_at, state: value.state }
}
function decode(raw, key) {
  const data = JSON.parse(bounded(raw))
  if (!record(data) || data.format !== FORMAT || data.version !== 1 || !UUID.test(data.id) || key !== RESEARCH_TASK_PREFIX + data.id ||
    !SHA.test(data.payloadSHA256) || !Object.hasOwn(RESEARCH_PHASES, data.phase)) fail('研究任务身份、版本或状态无效；原记录保留')
  const { document, preview } = normalizeDocument(data.document)
  const task = { format: FORMAT, version: 1, id: data.id, createdAt: date(data.createdAt), updatedAt: date(data.updatedAt),
    phase: data.phase, payloadSHA256: data.payloadSHA256, document, preview, receipt: null }
  if (data.receipt !== null) task.receipt = receiptFor(data.receipt, task)
  if ((task.phase === 'confirmed') !== !!task.receipt) fail('研究任务回执状态不一致')
  return freeze(task)
}
function encode(task) { const { preview, ...data } = task; return bounded(JSON.stringify(data)) }

export function createResearchTaskStore({ storage = () => globalThis.localStorage, locks = () => globalThis.navigator?.locks,
  createId = () => globalThis.crypto.randomUUID(), now = () => new Date() } = {}) {
  const listeners = new Set()
  const publish = () => { for (const fn of [...listeners]) { try { fn() } catch { /* stored bytes, not view success, define a completed save */ } } }
  const db = () => { const s = storage(); if (!s || !['getItem', 'setItem', 'removeItem', 'key'].every(k => typeof s[k] === 'function')) fail('本地研究任务存储不可用'); return s }
  const read = entry => {
    if (!entry?.key?.startsWith(RESEARCH_TASK_PREFIX) || typeof entry.raw !== 'string' || db().getItem(entry.key) !== entry.raw) fail('研究任务已在其他操作中变化，请刷新后重试；未覆盖原记录')
    return decode(entry.raw, entry.key)
  }
  async function locked(action, options = {}) {
    check(options)
    const manager = locks()
    if (typeof manager?.request !== 'function') fail('当前环境不支持安全保存研究草稿，请使用桌面应用或下载 Markdown')
    const controller = new AbortController(), abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const timer = setTimeout(abort, 5000)
    try { return await manager.request('local-notepad-research-tasks', { mode: 'exclusive', signal: controller.signal }, () => { check(options); return action() }) }
    catch (e) { if (e?.name === 'AbortError') fail('等待研究草稿保存已取消或超时，未发送请求'); throw e }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
  }
  function write(key, task) {
    const raw = encode(task); decode(raw, key)
    try { db().setItem(key, raw) } catch { fail('研究草稿保存失败，可能空间不足或权限受限；未发送创建请求') }
    const entry = freeze({ key, raw }); publish(); return entry
  }
  return {
    read,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    list() {
      const s = db(), keys = []
      for (let i = 0; i < s.length; i++) { const key = s.key(i); if (key?.startsWith(RESEARCH_TASK_PREFIX)) keys.push(key) }
      return keys.map(key => { const raw = s.getItem(key); try { return { key, raw, task: decode(raw, key) } } catch (e) { return { key, raw, error: e.message } } })
        .sort((a, b) => (b.task?.updatedAt || '').localeCompare(a.task?.updatedAt || ''))
    },
    async save(preview, options = {}) {
      const { document, preview: rebuilt } = documentFromPreview(preview)
      const payloadSHA256 = await researchPayloadFingerprint(rebuilt); check(options)
      return locked(() => {
        const s = db(); let count = 0
        for (let i = 0; i < s.length; i++) if (s.key(i)?.startsWith(RESEARCH_TASK_PREFIX)) count++
        if (count >= MAX_RESEARCH_TASKS) fail('已有 10 份研究任务，请先下载并明确移除不需要的记录；未自动清理')
        const id = createId(), key = RESEARCH_TASK_PREFIX + id
        if (!UUID.test(id) || s.getItem(key) !== null) fail('研究任务身份冲突，未覆盖')
        const timestamp = now().toISOString()
        return write(key, { format: FORMAT, version: 1, id, createdAt: timestamp, updatedAt: timestamp, document,
          payloadSHA256, phase: 'draft', receipt: null })
      }, options)
    },
    update(entry, phase, receipt = null, options = {}) {
      return locked(() => { const task = read(entry); return write(entry.key, { ...task, phase, receipt, updatedAt: now().toISOString() }) }, options)
    },
    remove(entry, options = {}) {
      return locked(() => {
        // Permit explicit removal of corrupt tasks, but only exact own bytes.
        if (!entry?.key?.startsWith(RESEARCH_TASK_PREFIX) || typeof entry.raw !== 'string' || db().getItem(entry.key) !== entry.raw) fail('研究任务已变化，未移除')
        db().removeItem(entry.key); publish()
      }, options)
    },
  }
}

// Every retry is user-triggered, reuses the stored task ID and immutable payload,
// and checks the server receipt before POST. No legacy endpoint fallback exists.
export function createResearchTaskService({ store = createResearchTaskStore(), request = api } = {}) {
  const inFlight = new Set()
  async function requestWithTimeout(path, init, options) {
    check(options)
    const controller = new AbortController(), abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const timer = setTimeout(abort, 15000)
    try { return await request(path, { ...init, signal: controller.signal }) }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
  }
  async function verify(entry, options) {
    const task = store.read(entry)
    if (await researchPayloadFingerprint(task.preview) !== task.payloadSHA256) fail('研究草稿内容指纹不符，未发送请求')
    check(options); store.read(entry); return task
  }
  async function persistResult(entry, task, value) {
    const receipt = receiptFor(value, task)
    try { return { entry: await store.update(entry, 'confirmed', receipt), receipt, localWarning: '' } }
    catch (e) { return { entry, receipt, localWarning: '服务端已确认，但本地回执未保存：' + e.message + '。可再次查回；不要新建任务重试。' } }
  }
  async function lookup(task, options) {
    const value = await requestWithTimeout('/api/research-notes/' + task.id, {}, options)
    if (!record(value) || typeof value.found !== 'boolean' || value.request_id !== task.id) fail('后端不支持研究任务查回或响应无效，请确认前后端已同时升级')
    if (value.found) receiptFor(value, task)
    return value
  }
  async function run(entry, send, options = {}) {
    let task = await verify(entry, options)
    if (inFlight.has(task.id)) fail('此研究任务正在处理，请勿重复确认')
    inFlight.add(task.id)
    try {
      const existing = await lookup(task, options)
      check(options)
      if (existing.found) return persistResult(entry, task, existing)
      if (task.receipt) fail('本地已有成功回执，但当前数据库没有此任务。可能切换或回退了数据库；不会再次创建，请先核对数据库')
      if (!send) return { entry, receipt: null, localWarning: '当前数据库尚未查到创建回执；查回本身不会新建笔记。' }
      await options.beforeSend?.(); check(options); store.read(entry)
      entry = await store.update(entry, 'submitted', null, options)
      task = store.read(entry)
      try {
        // Source validation is deliberately repeated AFTER the asynchronous local
        // journal lock, immediately before sending a fresh live compilation.
        await options.beforeSend?.(); check(options)
      } catch (e) { try { await store.update(entry, 'draft') } catch { /* retain pending for safe manual check */ }; throw e }
      try {
        const value = await requestWithTimeout('/api/research-notes/' + task.id, { method: 'POST', body: JSON.stringify({ title: task.preview.title, content: task.preview.content, parent_id: task.preview.parentId }) }, options)
        return await persistResult(entry, task, value)
      } catch (e) {
        try { entry = await store.update(entry, 'uncertain') } catch { /* submitted remains recoverable */ }
        throw Object.assign(new Error('创建结果尚未确认，可能已写入。研究草稿已保存，可在“研究草稿与创建记录”中查回，或明确使用同一任务重试。' + (e.message || '')), { mayHaveCreated: true, taskId: task.id })
      }
    } finally { inFlight.delete(task.id) }
  }
  return { store, save: (preview, options) => store.save(preview, options), check: (entry, options) => run(entry, false, options), submit: (entry, options) => run(entry, true, options) }
}
export const researchTasks = createResearchTaskService()
