import { dailyRequest } from './dailyNotes.mjs'
import { readFolderWorkspace } from './folderWorkspace.mjs'

export const COMPARISON_PAGE = 50
export const COMPARISON_BODY_LIMIT = 512 * 1024
export const COMPARISON_LINES = 2000
export const COMPARISON_CELLS = 300000
export const COMPARISON_ROW_PAGE = 60
export const COMPARISON_REPORT_LIMIT = 8 * 1024 * 1024
const bytes = text => new TextEncoder().encode(text)
const unicode = v => typeof v === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)
const identity = v => unicode(v) && v.length > 0 && bytes(v).length <= 128 && v.trim() === v && !/[\u0000-\u001f\u007f-\u009f]/.test(v)
const text = (v, max) => unicode(v) && bytes(v).length <= max
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const integer = v => Number.isSafeInteger(v) && v >= 0 && v <= 253402300799
const issue = (code, message) => Object.assign(new Error(message), { code })
const refuse = () => { throw issue('invalid', '比较响应不完整或来源不符，未采用任何一侧的部分结果。') }
export async function comparisonHash(content) {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes(content))), n => n.toString(16).padStart(2, '0')).join('')
}
export async function readComparisonIndex(load, signal) {
  const snapshot = await readFolderWorkspace(load, signal)
  if (signal?.aborted) throw issue('cancelled', '目录读取已取消')
  const byId = new Map(snapshot.items.map(n => [n.id, n]))
  return Object.freeze({ revision: snapshot.revision, hidden: snapshot.hidden_count,
    notes: Object.freeze(snapshot.items.filter(n => !n.is_folder).map(n => Object.freeze({ id: n.id, title: n.title,
      parent_id: n.parent_id, folder: n.parent_id ? byId.get(n.parent_id).title : '根目录', updated_at: n.updated_at }))) })
}
export function comparisonChoices(index, query = '') {
  if (typeof query !== 'string' || query.length > 128) throw issue('input', '查找文字过长')
  const q = query.trim().normalize('NFC').toLocaleLowerCase('zh-CN')
  return index.notes.filter(n => !q || [n.title, n.folder].some(t => t.normalize('NFC').toLocaleLowerCase('zh-CN').includes(q)))
    .sort((a, b) => b.updated_at - a.updated_at || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id))
}
export async function validateComparison(raw, ids, signal) {
  if (!Array.isArray(ids) || ids.length !== 2 || ids.some(id => !identity(id)) || ids[0] === ids[1]) refuse()
  if (!raw || raw.version !== 1 || raw.complete !== true || !integer(raw.captured_at) || !hash(raw.revision) || !Array.isArray(raw.notes) || raw.notes.length !== 2 || typeof raw.raw_equal !== 'boolean') refuse()
  const notes = []
  for (let i = 0; i < 2; i++) {
    const n = raw.notes[i]
    if (!n || n.id !== ids[i] || !text(n.title, 4000) || n.title.startsWith('__tpl__') || !(n.parent_id === '' || identity(n.parent_id)) || !text(n.folder, 4000) || !integer(n.updated_at) || !text(n.content, COMPARISON_BODY_LIMIT) || !hash(n.content_hash) || !Number.isSafeInteger(n.content_bytes) || n.content_bytes !== bytes(n.content).length) refuse()
    if (await comparisonHash(n.content) !== n.content_hash) refuse()
    if (signal?.aborted) throw issue('cancelled', '比较已取消')
    notes.push(Object.freeze(Object.fromEntries(['id', 'title', 'parent_id', 'folder', 'updated_at', 'content', 'content_hash', 'content_bytes'].map(k => [k, n[k]]))))
  }
  if (raw.raw_equal !== (notes[0].content === notes[1].content)) refuse()
  return Object.freeze({ version: 1, complete: true, captured_at: raw.captured_at, revision: raw.revision, raw_equal: raw.raw_equal, notes: Object.freeze(notes) })
}
export async function readNoteComparison(load, ids, signal, budget = 10000) {
  if (!Array.isArray(ids) || ids.length !== 2 || ids.some(id => !identity(id)) || ids[0] === ids[1]) throw issue('selection', '请选择两篇不同的普通笔记')
  const raw = await dailyRequest(load, `/api/note-comparison?left=${encodeURIComponent(ids[0])}&right=${encodeURIComponent(ids[1])}`, { signal }, budget)
  return validateComparison(raw, ids, signal)
}
export const sameNoteComparison = (a, b) => a.revision === b.revision && JSON.stringify(a.notes) === JSON.stringify(b.notes)
export async function readComparisonSource(load, expected, signal) {
  const f = await dailyRequest(load, '/api/files/' + encodeURIComponent(expected.id), { signal }, 10000)
  if (!f || f.id !== expected.id || f.is_folder !== false || f.is_deleted !== false || f.title !== expected.title || f.parent_id !== expected.parent_id || f.updated_at !== expected.updated_at || f.content !== expected.content)
    throw issue('stale', '来源笔记已变化，请重新比较后打开。')
  if (signal?.aborted) throw issue('cancelled', '打开已取消')
  return f
}

// A bounded TEXT projection, never HTML, a semantic equality test or an editor
// serializer. Unknown/embed nodes refuse the projection; the raw mode remains.
export function comparisonProjection(content, mode = 'text') {
  if (!['text', 'raw'].includes(mode)) throw issue('mode', '比较模式无效')
  if (!text(content, COMPARISON_BODY_LIMIT)) return { complete: false, reason: '正文超过512KiB预算或编码无效。' }
  if (mode === 'raw') return { complete: true, text: content, kind: 'raw' }
  let doc
  try { doc = JSON.parse(content) } catch { return { complete: true, text: content, kind: 'plain' } }
  if (!doc?.root) return { complete: true, text: content, kind: 'plain' }
  const stack = [{ node: doc.root, depth: 0 }], chunks = []
  const containers = new Set(['root','paragraph','heading','quote','list','listitem','link','autolink','table','tablerow','tablecell','code'])
  let seen = 0, length = 0
  while (stack.length) {
    const { node, depth, suffix } = stack.pop()
    if (suffix !== undefined) { chunks.push(suffix); length += suffix.length; continue }
    if (++seen > 20000 || depth > 64 || !node || typeof node !== 'object' || Array.isArray(node)) return { complete: false, reason: '文档结构超过完整文本投影范围；请查看保存正文原文。' }
    let value
    if (['text', 'code-highlight'].includes(node.type) && typeof node.text === 'string') value = node.text
    else if (node.type === 'linebreak') value = '\n'
    else if (node.type === 'tab') value = '\t'
    else if (node.type === 'code-block' && typeof node.code === 'string') value = node.code + '\n'
    else if (containers.has(node.type) && Array.isArray(node.children)) {
      if (node.children.length + seen + stack.length > 20000) return { complete: false, reason: '文档节点过多，未比较截取片段。' }
      const end = node.type === 'tablecell' ? '\t' : ['paragraph','heading','quote','listitem','tablerow','code'].includes(node.type) ? '\n' : ''
      if (end) stack.push({ suffix: end })
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], depth: depth + 1 })
      continue
    } else return { complete: false, reason: '存在图片、公式、嵌入或未知节点；文本投影不完整，请切换保存正文原文。' }
    chunks.push(value); length += value.length
    if (length > COMPARISON_BODY_LIMIT) return { complete: false, reason: '文本投影过大，未生成部分比较。' }
  }
  return { complete: true, text: chunks.join(''), kind: 'lexical-text' }
}
function linesOf(value) {
  const lines = []; let at = 0
  for (const m of value.matchAll(/\r\n|\r|\n/g)) { lines.push(value.slice(at, m.index + m[0].length)); at = m.index + m[0].length; if (lines.length > COMPARISON_LINES) return null }
  if (at < value.length) lines.push(value.slice(at))
  return lines.length > COMPARISON_LINES ? null : lines
}
const result = (state, message, extra = {}) => Object.freeze({ state, message, rows: Object.freeze([]), changes: Object.freeze([]), counts: null, ...extra })
export function compareNoteText(left, right, mode = 'text') {
  const a = comparisonProjection(left, mode), b = comparisonProjection(right, mode), rawEqual = left === right
  if (!a.complete || !b.complete) return result('unavailable', !a.complete ? a.reason : b.reason, { rawEqual })
  if (a.text === b.text) return result('same', rawEqual ? '保存正文完全相同；标题、标签和历史仍可能不同。' : '文本投影相同，但保存正文不同；格式、链接或结构仍有差别。', { rawEqual })
  const x = linesOf(a.text), y = linesOf(b.text)
  if (!x || !y) return result('unavailable', '超过每侧2000行预算，未裁切成看似完整的差异。', { rawEqual })
  let prefix = 0, suffix = 0
  while (prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix++
  while (suffix < x.length - prefix && suffix < y.length - prefix && x[x.length - 1 - suffix] === y[y.length - 1 - suffix]) suffix++
  const n = x.length - prefix - suffix, m = y.length - prefix - suffix, stride = m + 1
  if ((n + 1) * stride > COMPARISON_CELLS) return result('unavailable', '差异计算超过30万单元预算，未生成近似或截断结果。可分别打开原文。', { rawEqual })
  const dp = new Uint16Array((n + 1) * stride)
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * stride + j] = x[prefix + i] === y[prefix + j] ? 1 + dp[(i + 1) * stride + j + 1] : Math.max(dp[(i + 1) * stride + j], dp[i * stride + j + 1])
  let i = 0, j = 0, leftOnly = 0, rightOnly = 0
  const rows = [], changes = []
  const add = (kind, raw, l, r) => {
    const end = raw.match(/(\r\n|\r|\n)$/)?.[0] || ''
    if (kind !== 'same' && rows.at(-1)?.kind === 'same' || kind !== 'same' && rows.length === 0) changes.push(rows.length)
    rows.push(Object.freeze({ kind, left: l, right: r, text: end ? raw.slice(0, -end.length) : raw, ending: end === '\r\n' ? 'CRLF' : end === '\n' ? 'LF' : end === '\r' ? 'CR' : 'none' }))
  }
  const same = () => { add('same', x[i], i + 1, j + 1); i++; j++ }
  while (i < prefix) same()
  while (i < x.length - suffix || j < y.length - suffix) {
    const l = i - prefix, r = j - prefix
    if (l < n && r < m && x[i] === y[j]) same()
    else if (l < n && (r === m || dp[(l + 1) * stride + r] >= dp[l * stride + r + 1])) { add('left', x[i], i + 1, null); i++; leftOnly++ }
    else { add('right', y[j], null, j + 1); j++; rightOnly++ }
  }
  while (i < x.length) same()
  return result('different', '左侧独有 / 右侧独有表示本次快照差异，不是删除或合并指令。行号属于当前比较模式。', { rawEqual, rows: Object.freeze(rows), changes: Object.freeze(changes), counts: Object.freeze({ leftLines: x.length, rightLines: y.length, leftOnly, rightOnly }) })
}
export function comparisonReport(snapshot, mode, details = false) {
  if (!snapshot?.complete || snapshot.notes?.length !== 2) refuse()
  const model = compareNoteText(snapshot.notes[0].content, snapshot.notes[1].content, mode)
  const encoded = JSON.stringify({ format: 'local-notepad-note-comparison', version: 1, captured_at: snapshot.captured_at, mode,
    scope: 'two saved ordinary notes; not drafts, attachments, semantic equality or merge permission',
    state: model.state, raw_equal: snapshot.raw_equal, counts: model.counts, contains_contents: details === true,
    ...(details === true ? { revision: snapshot.revision, notes: snapshot.notes, rows: model.rows } : {}) }, null, 2) + '\n'
  if (bytes(encoded).length > COMPARISON_REPORT_LIMIT) throw issue('budget', '比较报告超过8MiB预算，未生成部分文件；可取消或改为仅导出计数。')
  return encoded
}
export function downloadComparisonReport(snapshot, mode, details = false) {
  const content = comparisonReport(snapshot, mode, details)
  let url, anchor
  try { url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' })); anchor = document.createElement('a'); anchor.href = url; anchor.download = 'local-notepad-comparison.json'; document.body.appendChild(anchor); anchor.click() }
  finally { anchor?.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
