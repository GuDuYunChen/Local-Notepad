import { dailyRequest } from './dailyNotes.mjs'

export const LOCAL_IMPORT_LIMIT = 2 * 1024 * 1024
export const LOCAL_IMPORT_FILE_LIMIT = 50 * 1024 * 1024
export const LOCAL_IMPORT_COUNT = 20
export const LOCAL_IMPORT_PREFIX = 'localNotepad.localImportIntent.v1:'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const sha = /^[0-9a-f]{64}$/
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const fail = message => { throw new Error(message) }
export const importBytes = value => new TextEncoder().encode(value).length
const badUnicode = value => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
const freeze = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
const rejectedReasons = ['invalid-payload', 'name-conflict', 'folder-unavailable', 'payload-mismatch']
const validParent = value => typeof value === 'string' && importBytes(value) <= 255 && !badUnicode(value) && !/[\x00-\x1f\x7f-\x9f]/.test(value)

export function validateNativeImportResult(item) {
  if (!object(item) || item.success !== true || item.error === true || typeof item.title !== 'string' || !item.title || typeof item.originalPath !== 'string' || typeof item.content !== 'string' || !['text', 'markdown'].includes(item.contentType) || importBytes(item.content) > LOCAL_IMPORT_LIMIT || (item.warnings !== undefined && (!Array.isArray(item.warnings) || item.warnings.length > 30 || item.warnings.some(w => typeof w !== 'string' || w.length > 2000)))) fail('文件转换格式无效或正文超过2 MiB，未截断内容。')
  const extension = item.originalPath.match(/\.([^./\\]+)$/)?.[1].toLowerCase()
  if (!['md', 'txt', 'doc', 'docx', 'xlsx', 'xls'].includes(extension) || item.format !== extension) fail('转换格式与原文件扩展名不一致，请重新选择文件。')
  const office = ['docx', 'xlsx', 'xls'].includes(extension)
  if (office) {
    if (item.contentType !== 'markdown' || item.tableCellEncoding !== 'base64-utf8-v1' || typeof item.officeTextPrefix !== 'string' || !/^NPIMPORT(?:0|[1-9][0-9]{0,5})$/.test(item.officeTextPrefix) || item.officeTextPrefix !== item.officeTextPrefix.trim()) fail('Office 表格编码标记缺失或无效；未采用可能丢失字面内容的转换结果，请重新打开桌面客户端。')
  } else if ('tableCellEncoding' in item || 'officeTextPrefix' in item) fail('普通 Markdown、文本或旧版 Word 不允许携带 Office 表格编码标记。')
  return item
}

export function importTitle(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || Array.from(value).length > 255 || badUnicode(value) || /[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/.test(value) || value.startsWith('__tpl__')) fail('标题须为1–255个字符，不能有首尾空白、路径符号或保留前缀。')
  return value
}
export function importLink(value) {
  if (typeof value !== 'string' || !value || importBytes(value) > 8192 || value !== value.trim() || badUnicode(value) || /[\x00-\x20\x7f-\x9f\\]/.test(value) || value.startsWith('//')) fail('正文包含不安全的链接，未导入。')
  const protocol = value.match(/^([a-z][a-z0-9+.-]*):/i)
  if (protocol && !['http', 'https', 'mailto', 'tel'].includes(protocol[1].toLowerCase())) fail('正文包含不支持的链接协议，未导入。')
  if (protocol) {
    let parsed
    try { parsed = new URL(value) } catch { fail('正文包含无效链接，未导入。') }
    if (['http:', 'https:'].includes(parsed.protocol) ? (!parsed.hostname || !!parsed.username || !!parsed.password) : !value.slice(protocol[0].length)) fail('正文链接缺少目标或含有身份信息，未导入。')
  }
  return value
}

// This is an import boundary, not a generic editor-state validator. Only the
// nodes emitted by the existing document normalizer can cross it.
export function validateImportedBody(content) {
  if (typeof content !== 'string' || !content || importBytes(content) > LOCAL_IMPORT_LIMIT || badUnicode(content)) fail('转换后的正文无效或超过2 MiB；内容未截断。')
  let doc
  try { doc = JSON.parse(content) } catch { fail('正文不是有效的编辑器文档。') }
  if (!object(doc) || Object.keys(doc).some(k => k !== 'root') || !object(doc.root) || doc.root.type !== 'root') fail('正文缺少完整的编辑器根节点。')
  const element = new Set(['root', 'paragraph', 'heading', 'quote', 'list', 'listitem', 'link', 'autolink', 'code', 'table', 'tablerow', 'tablecell'])
  const leaf = new Set(['text', 'code-highlight', 'tab', 'linebreak', 'code-block', 'formula', 'divider'])
  let count = 0
  const visit = (node, depth, parent) => {
    if (!object(node) || node.version !== 1 || ++count > 20000 || depth > 64 || (!element.has(node.type) && !leaf.has(node.type)) || (node.type === 'root' && depth !== 0)) fail('正文节点不受支持或超过结构上限。')
    if ((node.style !== undefined && node.style !== '') || (node.textStyle !== undefined && node.textStyle !== '')) fail('导入正文含有不受支持的样式。')
    for (const value of Object.values(node)) if (typeof value === 'string' && badUnicode(value)) fail('正文包含无效字符。')
    if (element.has(node.type)) {
      if (!Array.isArray(node.children) || ![null, 'ltr', 'rtl', undefined].includes(node.direction) || (node.indent !== undefined && (!Number.isInteger(node.indent) || node.indent < 0 || node.indent > 64))) fail('正文段落结构无效。')
      if (node.type === 'heading' && !/^h[1-6]$/.test(node.tag)) fail('标题级别无效。')
      if (node.type === 'list' && (!['bullet', 'number', 'check'].includes(node.listType) || !['ul', 'ol'].includes(node.tag) || !Number.isInteger(node.start) || node.start < 0)) fail('列表结构无效。')
      if (node.type === 'listitem' && parent !== 'list') fail('列表项位置无效。')
      if (node.type === 'tablerow' && parent !== 'table') fail('表格行位置无效。')
      if (node.type === 'tablecell' && (parent !== 'tablerow' || !Number.isInteger(node.colSpan) || node.colSpan < 1 || node.colSpan > 100 || !Number.isInteger(node.rowSpan) || node.rowSpan < 1 || node.rowSpan > 100 || (node.backgroundColor != null && node.backgroundColor !== ''))) fail('表格单元格结构无效。')
      if (node.colWidths !== undefined && (!Array.isArray(node.colWidths) || node.colWidths.length > 1000 || node.colWidths.some(x => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 10000))) fail('表格宽度无效。')
      if (node.type === 'link' || node.type === 'autolink') importLink(node.url)
      return node.children.map(child => visit(child, depth + 1, node.type)).join(['root', 'list', 'table', 'tablerow', 'tablecell'].includes(node.type) ? '\n' : '')
    }
    if (node.children !== undefined) fail('正文叶节点带有额外子节点。')
    if (node.type === 'text' || node.type === 'code-highlight') {
      if (typeof node.text !== 'string' || !Number.isInteger(node.format) || node.format < 0 || node.format > 2047) fail('正文文字结构无效。')
      return node.text
    }
    if (node.type === 'code-block') {
      if (typeof node.code !== 'string' || typeof node.language !== 'string' || node.language.length > 60 || !/^[a-z0-9+#._-]+$/i.test(node.language)) fail('代码块结构无效。')
      return node.code
    }
    if (node.type === 'formula') {
      if (typeof node.expression !== 'string' || typeof node.displayMode !== 'boolean') fail('公式结构无效。')
      return node.expression
    }
    return node.type === 'linebreak' ? '\n' : node.type === 'tab' ? '\t' : '——'
  }
  return { content, preview: visit(doc.root, 0, null), bytes: importBytes(content) }
}

export function importFolders(files) {
  if (!Array.isArray(files) || files.length > 100000) fail('目录列表未完整读取，不能选择导入位置。')
  const all = new Map()
  for (const item of files) {
    if (!object(item) || !validParent(item.id) || !item.id || all.has(item.id) || typeof item.title !== 'string' || typeof item.is_folder !== 'boolean' || !validParent(item.parent_id) || item.is_deleted !== false) fail('目录身份或完整性无效，不能选择根目录代替。')
    all.set(item.id, item)
  }
  const paths = new Map([['', '我的笔记']])
  const path = (id, seen = new Set()) => {
    if (paths.has(id)) return paths.get(id)
    const item = all.get(id)
    if (!item?.is_folder || seen.has(id) || seen.size > 64) fail('目录路径不完整或存在循环，未采用部分目录。')
    const result = path(item.parent_id, new Set([...seen, id])) + ' / ' + item.title
    paths.set(id, result)
    return result
  }
  const result = [{ id: '', label: '我的笔记（根目录）' }]
  for (const item of all.values()) {
    if (item.parent_id) path(item.parent_id)
    if (item.is_folder) result.push({ id: item.id, label: path(item.id) })
  }
  return result.slice(0, 1).concat(result.slice(1).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')))
}

function payload(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'content,parent_id,title' || !validParent(value.parent_id)) fail('导入目标身份无效。')
  importTitle(value.title); validateImportedBody(value.content)
  return value
}
export async function importPayloadHash(value) {
  const data = new TextEncoder().encode(value.title + '\0' + value.parent_id + '\0' + value.content)
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('')
}
export function importReceipt(value, intent) {
  if (!object(value) || value.found !== true || value.request_id !== intent.requestId || value.payload_sha256 !== intent.payloadHash || !uuid.test(value.file_id) || value.title !== intent.payload.title || value.parent_id !== intent.payload.parent_id || !Number.isSafeInteger(value.created_at) || value.created_at < 1 || !['available', 'deleted', 'missing'].includes(value.state)) fail('导入回执身份或正文指纹不符；结果尚未确认。')
  return freeze({ found: true, request_id: value.request_id, payload_sha256: value.payload_sha256, file_id: value.file_id, title: value.title, parent_id: value.parent_id, created_at: value.created_at, state: value.state })
}
function rejection(value, intent) {
  if (!object(value) || value.status !== 'rejected' || value.request_id !== intent.requestId || !rejectedReasons.includes(value.reason) || typeof value.message !== 'string' || !value.message || value.message.length > 2000) fail('拒绝响应身份或格式无效；结果尚未确认。')
  return freeze({ status: 'rejected', request_id: value.request_id, reason: value.reason, message: value.message })
}
function validIntent(value) {
  if (!object(value) || value.version !== 1 || !uuid.test(value.requestId) || !sha.test(value.payloadHash) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 1 || typeof value.attempted !== 'boolean' || typeof value.sourceTitle !== 'string' || value.sourceTitle.length > 1024) fail('本地导入记录损坏；没有删除或自动发送。')
  payload(value.payload)
  if (value.outcome !== null) {
    if (value.outcome?.status === 'committed') importReceipt(value.outcome.receipt, value)
    else rejection(value.outcome, value)
  }
  return freeze(value)
}
export const canCancelImport = entry => !!entry?.value && entry.value.attempted === false && entry.value.outcome === null
export const canClearImport = entry => !!entry?.value?.outcome && !(entry.value.outcome.status === 'rejected' && entry.value.outcome.reason === 'payload-mismatch')

// Each request has its own durable key. Payload and identity never change, even
// if the write response is lost or a window closes while it is in flight.
export function createImportLedger(storage, createId = () => crypto.randomUUID(), now = () => Date.now()) {
  const list = () => {
    const entries = []
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (!key?.startsWith(LOCAL_IMPORT_PREFIX)) continue
        const raw = storage.getItem(key)
        try {
          const value = validIntent(JSON.parse(raw))
          if (key !== LOCAL_IMPORT_PREFIX + value.requestId) fail('身份不符')
          entries.push({ key, raw, value })
        } catch { entries.push({ key, raw, error: '本地导入记录损坏，原记录已保留。请先恢复可核对的记录；当前禁止新提交。' }) }
      }
    } catch { fail('无法读取本地导入记录；当前禁止提交，请检查本地存储。') }
    return entries.sort((a, b) => (a.value?.createdAt || 0) - (b.value?.createdAt || 0))
  }
  const read = entry => {
    try {
      if (!entry?.value || entry.key !== LOCAL_IMPORT_PREFIX + entry.value.requestId || storage.getItem(entry.key) !== entry.raw) fail('记录变化')
      return validIntent(JSON.parse(entry.raw))
    } catch { fail('本地导入记录已变化或不可读取；没有发送请求，请重新读取记录。') }
  }
  const write = (value, previous) => {
    const key = LOCAL_IMPORT_PREFIX + value.requestId
    if (previous) read(previous)
    else if (storage.getItem(key) !== null) fail('导入请求标识已存在；没有覆盖原记录。')
    const raw = JSON.stringify(validIntent(value))
    try { storage.setItem(key, raw); if (storage.getItem(key) !== raw) fail('校验失败') }
    catch {
      // setItem can succeed while its verification fails. Keep the allocated
      // identity visible; callers must not turn this into a fresh draft/UUID.
      throw Object.assign(new Error('无法可靠保存本地导入记录；未开始下一项写入，请检查可用空间后重新查回。'), { localImportStorageFailure: true, entry: { key, raw, value: freeze(value) } })
    }
    return { key, raw, value: freeze(value) }
  }
  const verify = async entry => {
    const current = read(entry)
    if (await importPayloadHash(current.payload) !== current.payloadHash) fail('本地正文指纹不符，原记录已保留；请用同一请求的有效备份恢复。')
    read(entry)
    return entry
  }
  return {
    list, read, verify,
    async inspect() {
      const entries = list(), result = []
      for (const entry of entries) {
        if (entry.error) { result.push(entry); continue }
        try { await verify(entry); result.push(entry) }
        catch (error) { result.push({ key: entry.key, raw: entry.raw, error: error.message }) }
      }
      return result
    },
    async reserve(input, sourceTitle = '', signal) {
      const p = freeze({ title: input.title, content: input.content, parent_id: input.parent_id })
      payload(p)
      const payloadHash = await importPayloadHash(p)
      if (signal?.aborted) fail('已停止，未新建导入请求。')
      const existing = await this.inspect()
      if (signal?.aborted) fail('已停止，未新建导入请求。')
      if (existing.some(entry => entry.error)) fail('存在损坏的本地导入记录；没有新建请求。')
      if (existing.length >= LOCAL_IMPORT_COUNT || existing.reduce((total, entry) => total + importBytes(entry.value.payload.content), importBytes(p.content)) > LOCAL_IMPORT_LIMIT) fail('本地导入记录已达20项或2 MiB上限，请先核对并清理已确认记录。')
      return write({ version: 1, requestId: createId(), payloadHash, payload: p, sourceTitle, createdAt: now(), attempted: false, outcome: null })
    },
    update(entry, patch) {
      const current = read(entry)
      if (Object.keys(patch).some(k => !['attempted', 'outcome'].includes(k)) || (current.attempted && patch.attempted === false)) fail('冻结的请求身份和正文不可修改。')
      return write({ ...current, ...patch }, entry)
    },
    remove(entry) {
      read(entry)
      if (!canClearImport(entry)) fail('结果仍未知或身份冲突；请先查回，不可清理或换新请求。')
      try { storage.removeItem(entry.key); if (storage.getItem(entry.key) !== null) fail('未清除') }
      catch { fail('本地导入记录未能清理；请重新读取后核对。') }
    },
    cancel(entry) {
      read(entry)
      if (!canCancelImport(entry)) fail('本项可能已经发送，不可作为未开始项取消；请查回结果。')
      try { storage.removeItem(entry.key); if (storage.getItem(entry.key) !== null) fail('未清除') }
      catch { fail('未开始项未能取消；本地记录保留，请重读后核对。') }
    },
    async restore(entry, rawBackup, signal) {
      if (!entry?.error || typeof entry.key !== 'string' || !entry.key.startsWith(LOCAL_IMPORT_PREFIX) || typeof rawBackup !== 'string' || importBytes(rawBackup) > 6 * LOCAL_IMPORT_LIMIT + 65536) fail('请选择损坏记录并粘贴该记录的完整备份。')
      let restored
      try { restored = validIntent(JSON.parse(rawBackup)) } catch { fail('备份结构无效，损坏原记录没有被覆盖。') }
      if (entry.key !== LOCAL_IMPORT_PREFIX + restored.requestId || await importPayloadHash(restored.payload) !== restored.payloadHash) fail('备份的请求标识或正文指纹不符，原记录没有被覆盖。')
      if (signal?.aborted) fail('已停止恢复，原记录没有被覆盖。')
      let original
      try { original = JSON.parse(entry.raw) } catch {}
      if ((typeof original?.requestId === 'string' && original.requestId !== restored.requestId) || (typeof original?.payloadHash === 'string' && sha.test(original.payloadHash) && original.payloadHash !== restored.payloadHash)) fail('备份与损坏原记录的身份不符，禁止替换未知请求的正文。')
      if (storage.getItem(entry.key) !== entry.raw) fail('原记录已发生变化，请重新读取后恢复。')
      // A backup may predate a POST whose marker was damaged. Restoring it
      // cannot turn an uncertain request into a safely cancellable unsent one.
      restored = validIntent({ ...restored, attempted: true })
      const raw = JSON.stringify(restored)
      try { storage.setItem(entry.key, raw); if (storage.getItem(entry.key) !== raw) fail('写入不一致') }
      catch { fail('备份未能可靠恢复，请保留原文并重新读取；没有发送请求。') }
      return { key: entry.key, raw, value: restored }
    },
  }
}

export function createImportOperations(request, ledger, budget = 10000) {
  let active = false
  const check = signal => { if (signal?.aborted) fail('已停止等待；已发送的项目可能已经完成，请查回结果。') }
  return {
    async run(original, { send = false, signal } = {}) {
      if (active) return { status: 'unknown', entry: original, message: '另一项导入操作尚未结束。' }
      active = true
      let entry = original
      const remember = (outcome, message) => {
        let storageError = ''
        try { entry = ledger.update(entry, { outcome }) } catch (error) { storageError = error.message }
        return { ...outcome, entry, message, storageError }
      }
      try {
        const intent = ledger.read(entry)
        check(signal)
        if (await importPayloadHash(intent.payload) !== intent.payloadHash) fail('本地正文指纹不符；没有发送或替换请求。')
        check(signal)
        const path = '/api/local-import/requests/' + intent.requestId
        const call = init => dailyRequest(request, path, { ...init, signal }, budget)
        const receipt = await call({})
        check(signal)
        if (!object(receipt) || typeof receipt.found !== 'boolean' || receipt.request_id !== intent.requestId) fail('查回响应无效；未据此重新创建。')
        if (receipt.found) return remember({ status: 'committed', receipt: importReceipt(receipt, intent) }, receipt.state === 'available' ? '导入已确认，可以打开笔记。' : '导入曾经完成，但笔记已删除或不在当前数据库；不会重新创建。')
        if (['payload_sha256', 'file_id', 'title', 'parent_id', 'state'].some(k => receipt[k] !== undefined && receipt[k] !== '') || (receipt.created_at !== undefined && receipt.created_at !== 0)) fail('查回响应互相矛盾；未重新创建。')
        if (intent.outcome?.status === 'committed') fail('本地曾确认导入，但当前查回缺少记录；未重新创建，请检查是否切换了数据库。')
        if (intent.outcome?.status === 'rejected') return { ...intent.outcome, entry, message: intent.outcome.message }
        if (!send) return { status: 'unknown', entry, message: '当前尚未查到回执；这不能证明此前没有写入。可再次查回，或明确使用原请求继续。' }
        check(signal)
        entry = ledger.update(entry, { attempted: true })
        ledger.read(entry); check(signal)
        const response = await call({ method: 'POST', body: JSON.stringify(intent.payload) })
        check(signal)
        if (response?.status === 'committed') {
          const confirmed = importReceipt(response.receipt, intent)
          return remember({ status: 'committed', receipt: confirmed }, confirmed.state === 'available' ? '导入已确认，可以打开笔记。' : '导入曾经完成，但笔记已删除或不在当前数据库；不会重新创建。')
        }
        const denied = rejection(response, intent)
        return remember(denied, denied.reason === 'payload-mismatch' ? '请求身份发生冲突；禁止更换标识重复创建，请保留记录查回。' : denied.message + ' 本项已确定没有写入，可返回预检修改。')
      } catch (error) {
        if (error?.localImportStorageFailure && error.entry) entry = error.entry
        return { status: 'unknown', entry, message: signal?.aborted ? '已停止等待；已发送的项目可能已经完成，请查回结果。' : (error?.message || '导入结果尚未确认，请保留记录查回。'), storageError: error?.localImportStorageFailure ? error.message : '' }
      } finally { active = false }
    },
  }
}
