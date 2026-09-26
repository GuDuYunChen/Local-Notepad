// Review only the captured conflict. This module never chooses a side or retries
// a write. The sync engine remains the authority for live hashes/transactions.
const HASH = /^[a-f0-9]{64}$/
const KINDS = ['file', 'tag', 'file-tag', 'attachment']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = () => { throw new Error('冲突版本信息不完整或格式不受支持，请刷新后重新查看') }
const text = (value, nonempty = false) => {
  if (typeof value !== 'string' || (nonempty && !value.trim())) fail()
  return value
}
const number = value => {
  if (!Number.isSafeInteger(value)) fail()
  return value
}
const flag = value => {
  if (typeof value !== 'boolean') fail()
  return value
}
const digest = (value, empty = false) => {
  if ((empty && value === '') || (typeof value === 'string' && HASH.test(value))) return value
  fail()
}

function recordSnapshot(raw, id, hash) {
  if (raw == null && hash === '') return null
  if (!object(raw) || raw.format !== 'local-notepad-sync-record' || raw.version !== 1 || raw.id !== id ||
      !KINDS.includes(raw.kind) || !['present', 'purged'].includes(raw.state) || !hash) fail()
  const result = { format: raw.format, version: raw.version, kind: raw.kind, id, state: raw.state }
  const payloadKey = { file: 'file', tag: 'tag', 'file-tag': 'file_tag', attachment: 'attachment' }[raw.kind]
  for (const key of ['file', 'tag', 'file_tag', 'attachment']) {
    if ((key !== payloadKey || raw.state === 'purged') && raw[key] != null) fail()
  }
  if (raw.state === 'purged') return Object.freeze(result)
  const p = raw[payloadKey]
  if (!object(p)) fail()
  if (raw.kind === 'file') {
    if (p.id !== id) fail()
    result.file = Object.freeze({
      id, title: text(p.title, true), content: text(p.content), created_at: number(p.created_at),
      updated_at: number(p.updated_at), is_folder: flag(p.is_folder), parent_id: text(p.parent_id),
      sort_order: number(p.sort_order), is_deleted: flag(p.is_deleted), deleted_at: number(p.deleted_at),
      is_pinned: flag(p.is_pinned),
    })
  } else if (raw.kind === 'tag') {
    if (id !== 'tag:' + text(p.id, true)) fail()
    result.tag = Object.freeze({ id: p.id, name: text(p.name, true), color: text(p.color) })
  } else if (raw.kind === 'file-tag') {
    if (id !== 'filetag:' + text(p.file_id, true) + ':' + text(p.tag_id, true)) fail()
    result.file_tag = Object.freeze({ file_id: p.file_id, tag_id: p.tag_id })
  } else {
    const name = text(p.name, true)
    const encoded = Array.from(new TextEncoder().encode(name), byte => byte.toString(16).padStart(2, '0')).join('')
    if (/[\x00/\\]/.test(name) || name === '.' || name === '..' || id !== 'attachment:' + encoded || number(p.size) < 0) fail()
    result.attachment = Object.freeze({ name, size: p.size, blob_hash: digest(p.blob_hash) })
  }
  return Object.freeze(result)
}

export function conflictScope(settings, status) {
  if (!object(settings) || !object(status) || settings.sync_enabled !== true ||
      !['local-lab', 'webdav'].includes(settings.sync_provider) || typeof status.device_id !== 'string' || !status.device_id) return ''
  return JSON.stringify([status.device_id, settings.sync_provider, settings.sync_endpoint || '',
    settings.sync_username || '', status.remote_store_id || ''])
}

export function captureConflictReview(conflict, scope) {
  if (!object(conflict) || conflict.status !== 'open' || typeof scope !== 'string' || !scope) fail()
  const id = text(conflict.id, true), itemID = text(conflict.item_id, true)
  const base = digest(conflict.base_hash, true), local = digest(conflict.local_hash, true), remote = digest(conflict.remote_hash, true)
  const snapshot = {
    id, item_id: itemID, base_hash: base, local_hash: local, remote_hash: remote, status: 'open', scope,
    local_record: recordSnapshot(conflict.local_record, itemID, local),
    remote_record: recordSnapshot(conflict.remote_record, itemID, remote),
  }
  if (!snapshot.local_record && !snapshot.remote_record) fail()
  return Object.freeze(snapshot)
}

export function matchesConflictReview(review, conflict, scope) {
  try { return JSON.stringify(review) === JSON.stringify(captureConflictReview(conflict, scope)) } catch { return false }
}

export function conflictRecordLabel(record, fallback = '未知对象') {
  if (record?.state === 'purged') return '已永久删除'
  if (record?.kind === 'attachment') return typeof record.attachment?.name === 'string' ? record.attachment.name : fallback
  if (record?.kind === 'tag') return typeof record.tag?.name === 'string' ? '标签：' + record.tag.name : fallback
  if (record?.kind === 'file-tag') return '标签关联'
  return typeof record?.file?.title === 'string' ? record.file.title : fallback
}

function clip(value, limit) {
  // Slice before allocating code points: very large notes must not exhaust UI memory.
  const prefix = Array.from(value.slice(0, limit * 2 + 2)).slice(0, limit).join('')
  return { text: prefix, limited: prefix.length < value.length }
}

export function conflictContentPreview(content, limit = 12000) {
  if (typeof content !== 'string') return { text: '', limited: false, notice: '没有可读取的正文' }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12000) limit = 12000
  if (content.length > 512 * 1024) return { ...clip(content, limit), notice: '正文较大，仅展示原始内容开头；请核对完整文档后选择版本' }
  let parsed
  try { parsed = JSON.parse(content) } catch { return { ...clip(content, limit), notice: '纯文本预览，不执行 HTML 或 Markdown' } }
  if (typeof parsed === 'string') return { ...clip(parsed, limit), notice: '纯文本预览' }
  if (!object(parsed?.root) || !Array.isArray(parsed.root.children)) return { ...clip(content, limit), notice: '无法识别文档结构，以下为原始文本预览' }
  const stack = [parsed.root], chunks = []
  let visited = 0, length = 0, partial = false
  const blocks = new Set(['paragraph', 'heading', 'quote', 'listitem', 'tablerow', 'tablecell', 'code', 'code-block'])
  while (stack.length && visited < 20000 && length <= limit * 2) {
    const node = stack.pop()
    if (typeof node === 'string') { chunks.push(node); length += node.length; continue }
    visited++
    if (!object(node)) { partial = true; continue }
    let value = null
    if (node.type === 'linebreak') value = '\n'
    else if (typeof node.text === 'string') value = node.text
    else if (node.type === 'code-block' && typeof node.code === 'string') value = node.code
    else if (node.type === 'wiki-link') value = '〔引用：' + (typeof node.title === 'string' ? node.title : '未命名') + '〕'
    else if (node.type === 'image') { value = '〔图片〕'; partial = true }
    if (value !== null) { chunks.push(value); length += value.length }
    else if (Array.isArray(node.children)) {
      if (blocks.has(node.type)) stack.push(node.type === 'tablecell' ? '\t' : '\n')
      // Bound stack growth as well as traversal; preserve source order.
      const room = Math.max(0, 20000 - visited - stack.length)
      const count = Math.min(node.children.length, room)
      if (count < node.children.length) partial = true
      for (let index = count - 1; index >= 0; index--) stack.push(node.children[index])
    } else { chunks.push('〔未展示的内容节点〕'); partial = true }
  }
  const result = clip(chunks.join(''), limit)
  return { text: result.text, limited: result.limited || stack.length > 0 || partial,
    notice: '正文文本投影；排版、嵌入对象和附件不等同于完整文档' }
}

function timeLabel(seconds) {
  if (seconds <= 0) return '未记录'
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? '时间超出可显示范围' : date.toLocaleString('zh-CN', { hour12: false })
}

export function conflictVersionSummary(record) {
  if (!record) return { label: '此端无可用版本', kind: '缺失', state: '不可选择', fields: [], content: null, destructive: false }
  const kind = { file: record.file?.is_folder ? '文件夹' : '笔记', tag: '标签', 'file-tag': '标签关联', attachment: '附件' }[record.kind]
  if (record.state === 'purged') return { label: '永久删除标记', kind, state: '已永久删除', fields: [], content: null, destructive: true }
  const p = record.file || record.tag || record.file_tag || record.attachment
  let fields
  if (record.kind === 'file') fields = [['标题', p.title], ['父文件夹 ID', p.parent_id || '根目录'], ['排序', String(p.sort_order)], ['置顶', p.is_pinned ? '是' : '否'], ['创建时间', timeLabel(p.created_at)], ['修改时间', timeLabel(p.updated_at)], ['删除时间', timeLabel(p.deleted_at)]]
  else if (record.kind === 'tag') fields = [['标签名称', p.name], ['颜色值', p.color]]
  else if (record.kind === 'file-tag') fields = [['笔记 ID', p.file_id], ['标签 ID', p.tag_id]]
  else fields = [['文件名', p.name], ['大小', p.size + ' 字节'], ['内容 SHA-256', p.blob_hash]]
  return { label: conflictRecordLabel(record), kind, state: record.file?.is_deleted ? '在回收站' : '存在', fields,
    content: record.file && !record.file.is_folder ? conflictContentPreview(p.content) : null,
    destructive: record.file?.is_deleted === true }
}

export function conflictChangedFields(review) {
  const left = review.local_record, right = review.remote_record
  const result = []
  if (!left || !right || left.state !== right.state) result.push('存在 / 删除状态')
  if (left?.kind !== right?.kind) result.push('对象类型')
  const fields = [
    ['file', 'title', '标题'], ['file', 'content', '正文或格式'], ['file', 'is_folder', '笔记 / 文件夹'],
    ['file', 'parent_id', '所属文件夹'], ['file', 'sort_order', '排序'], ['file', 'is_pinned', '置顶'],
    ['file', 'is_deleted', '回收站状态'], ['file', 'created_at', '创建时间'], ['file', 'updated_at', '修改时间'], ['file', 'deleted_at', '删除时间'],
    ['tag', 'name', '标签名称'], ['tag', 'color', '标签颜色'], ['file_tag', 'file_id', '关联笔记'], ['file_tag', 'tag_id', '关联标签'],
    ['attachment', 'name', '附件名'], ['attachment', 'size', '附件大小'], ['attachment', 'blob_hash', '附件内容'],
  ]
  for (const [key, field, label] of fields) if (left?.[key]?.[field] !== right?.[key]?.[field]) result.push(label)
  return result
}

async function readConflictSnapshot(load, signal, timeoutMs) {
  if (signal?.aborted) throw new Error('对照读取已停止，未提交处理请求')
  const controller = new AbortController()
  let timer, stop
  const interruption = new Promise((_, reject) => {
    stop = () => { controller.abort(); reject(new Error('对照读取已停止，未提交处理请求')) }
    signal?.addEventListener('abort', stop, { once: true })
    timer = setTimeout(() => {
      controller.abort(); reject(new Error('重新核对冲突超时，未提交处理请求'))
    }, Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 8000 ? timeoutMs : 8000)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('对照读取已停止，未提交处理请求')
      return load(controller.signal)
    }), interruption])
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', stop); controller.abort()
  }
}

export async function applyReviewedConflict(review, choice, { load, write, isCurrent = () => true, signal, readTimeoutMs = 8000 }) {
  if (!['local', 'remote'].includes(choice) || !review?.[choice + '_record']) throw new Error('请先选择一个可用版本')
  if (!isCurrent()) throw new Error('当前对照已失效，未提交处理请求')
  const current = await readConflictSnapshot(load, signal, readTimeoutMs)
  if (!object(current) || !Array.isArray(current.conflicts)) throw new Error('无法重新读取冲突，未提交处理请求')
  const candidates = current.conflicts.filter(item => item?.id === review.id)
  if (candidates.length !== 1 || !matchesConflictReview(review, candidates[0], current.scope)) {
    throw new Error('冲突或同步目标已变化，请刷新并重新对照；未提交处理请求')
  }
  if (!isCurrent()) throw new Error('当前对照已失效，未提交处理请求')
  // One explicit submission only. A rejected/lost response is never auto-replayed.
  return write(review.id, choice)
}
