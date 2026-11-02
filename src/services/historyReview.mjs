import { dailyRequest } from './dailyNotes.mjs'
import { comparisonHash, compareNoteText, COMPARISON_BODY_LIMIT, COMPARISON_REPORT_LIMIT } from './noteComparison.mjs'

export const HISTORY_REVIEW_LIMIT = 500
export const HISTORY_REVIEW_PAGE = 20
const size = v => new TextEncoder().encode(v).length
const unicode = v => typeof v === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)
const text = (v, max) => unicode(v) && size(v) <= max
const id = v => text(v, 128) && v.length > 0 && v.trim() === v && !/[\u0000-\u001f\u007f-\u009f]/.test(v)
const time = v => Number.isSafeInteger(v) && v >= 0 && v <= 253402300799
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const error = (code, message) => Object.assign(new Error(message), { code })
const invalid = () => { throw error('invalid', '历史响应不完整或所属笔记不符，未采用部分结果。') }
const checkAbort = signal => { if (signal?.aborted) throw error('cancelled', '历史读取已取消。') }
const versionKey = v => Number.isSafeInteger(v) && v > 0

export async function validateHistoryReview(raw, fileId, versionId = null, signal) {
  checkAbort(signal)
  if (!id(fileId) || !(versionId === null || versionKey(versionId))) invalid()
  if (!raw || raw.version !== 1 || raw.complete !== true || !time(raw.captured_at) || !hash(raw.revision) || !Array.isArray(raw.versions) || raw.versions.length > HISTORY_REVIEW_LIMIT || raw.total !== raw.versions.length) invalid()
  const n = raw.current
  if (!n || n.id !== fileId || !text(n.title, 4000) || n.title.startsWith('__tpl__') || !(n.parent_id === '' || id(n.parent_id)) || !text(n.folder, 4000) || !time(n.updated_at) || !text(n.content, COMPARISON_BODY_LIMIT) || !hash(n.content_hash) || n.content_bytes !== size(n.content)) invalid()
  if (await comparisonHash(n.content) !== n.content_hash) invalid()
  checkAbort(signal)
  const current = Object.freeze(Object.fromEntries(['id','title','parent_id','folder','updated_at','content','content_hash','content_bytes'].map(k => [k,n[k]])))
  const seen = new Set(), versions = []
  for (const v of raw.versions) {
    if (!v || !versionKey(v.id) || seen.has(v.id) || v.file_id !== fileId || !text(v.title,4000) || !time(v.created_at) || !Number.isSafeInteger(v.content_bytes) || v.content_bytes < 0) invalid()
    const prior = versions.at(-1)
    if (prior && (v.created_at > prior.created_at || v.created_at === prior.created_at && v.id > prior.id)) invalid()
    seen.add(v.id)
    versions.push(Object.freeze(Object.fromEntries(['id','file_id','title','created_at','content_bytes'].map(k => [k,v[k]]))))
  }
  const expected = versionId
  let selected = null
  if (expected === null) { if (raw.selected !== null) invalid() }
  else {
    const s = raw.selected, metadata = versions.find(v => v.id === expected)
    if (!s || !metadata || Object.keys(metadata).some(k => metadata[k] !== s[k]) || !text(s.content, COMPARISON_BODY_LIMIT) || s.content_bytes !== size(s.content) || !hash(s.content_hash)) invalid()
    if (await comparisonHash(s.content) !== s.content_hash) invalid()
    checkAbort(signal)
    selected = Object.freeze({ ...metadata, content: s.content, content_hash: s.content_hash })
  }
  return Object.freeze({ version:1, complete:true, captured_at:raw.captured_at, revision:raw.revision, current, versions:Object.freeze(versions), selected, total:versions.length })
}

export async function readHistoryReview(load, fileId, versionId = null, signal, budget = 10000) {
  checkAbort(signal)
  if (!id(fileId) || !(versionId === null || versionKey(versionId))) throw error('selection','请选择有效的笔记和历史快照。')
  const query = new URLSearchParams({ file:fileId })
  if (versionId !== null) query.set('version',String(versionId))
  const value = await dailyRequest(load, '/api/history-review?' + query, { signal }, budget)
  return validateHistoryReview(value, fileId, versionId, signal)
}
export function sameHistoryReview(a,b) {
  return !!a && !!b && a.revision === b.revision && JSON.stringify([a.current,a.versions,a.selected]) === JSON.stringify([b.current,b.versions,b.selected])
}
export function historyReviewChoices(snapshot, query = '') {
  if (typeof query !== 'string' || query.length > 128) throw error('input','历史查找文字不能超过128个字符。')
  const q = query.trim().normalize('NFC').toLocaleLowerCase('zh-CN')
  return snapshot.versions.filter(v => !q || [String(v.id),v.title,new Date(v.created_at*1000).toISOString()].some(t => t.normalize('NFC').toLocaleLowerCase('zh-CN').includes(q)))
}
export function historyReviewReport(snapshot, mode = 'text', contents = false) {
  if (!snapshot?.complete || !snapshot.selected || !['text','raw'].includes(mode) || typeof contents !== 'boolean') invalid()
  const diff = compareNoteText(snapshot.selected.content,snapshot.current.content,mode)
  const out = { format:'local-notepad-history-review', version:1, captured_at:snapshot.captured_at,
    scope:'one retained historical snapshot versus current saved body; not drafts, attachments, complete edit history or restoration',
    mode, retained_versions:snapshot.total, state:diff.state, raw_equal:diff.rawEqual, counts:diff.counts, contains_contents:contents,
    ...(contents ? { revision:snapshot.revision, current:snapshot.current, selected:snapshot.selected, rows:diff.rows } : {}) }
  const encoded = JSON.stringify(out,null,2)+'\n'
  if (size(encoded) > COMPARISON_REPORT_LIMIT) throw error('budget','历史对照报告超过8MiB，未生成部分文件。可取消或仅导出计数。')
  return encoded
}
export function downloadHistoryReview(snapshot, mode, contents = false) {
  const content = historyReviewReport(snapshot,mode,contents)
  let url, a
  try { url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));a=document.createElement('a');a.href=url;a.download='local-notepad-history-review.json';document.body.appendChild(a);a.click() }
  finally {a?.remove();if(url)setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
