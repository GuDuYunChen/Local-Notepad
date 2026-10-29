import { dailyRequest } from './dailyNotes.mjs'
export const DUPLICATE_PAGE_SIZE = 50
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const integer = (v, max = 20000) => Number.isSafeInteger(v) && v >= 0 && v <= max
const text = (v, max) => typeof v === 'string' && v.length <= max
const identity = v => text(v, 128) && v.length > 0 && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v)
const invalid = () => { throw new Error('重复检查响应不完整或相互矛盾，没有采用部分结果。请重新检查。') }
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export function validateDuplicateNotes(raw) {
  if (!raw || raw.version !== 1 || raw.complete !== true || !hash(raw.revision) || !integer(raw.captured_at, 253402300799) || !Array.isArray(raw.notes) || raw.notes.length > 20000 || !Array.isArray(raw.groups) || raw.groups.length > 10000) invalid()
  const seen = new Set(), buckets = new Map()
  let bytes = 0, empty = 0
  const notes = raw.notes.map(n => {
    if (!n || !identity(n.id) || seen.has(n.id) || !(n.parent_id === '' || identity(n.parent_id)) || !text(n.title, 4000) || !text(n.folder, 4000) || !integer(n.updated_at, 253402300799) || !hash(n.content_hash) || !integer(n.content_bytes, 16 * 1024 * 1024) || (n.content_bytes === 0) !== (n.content_hash === emptyHash)) invalid()
    seen.add(n.id); bytes += n.content_bytes
    const value = Object.freeze({ id: n.id, title: n.title, parent_id: n.parent_id, folder: n.folder, updated_at: n.updated_at, content_hash: n.content_hash, content_bytes: n.content_bytes })
    if (!n.content_bytes) empty++
    else { const list = buckets.get(n.content_hash) || []; if (list.length && list[0].content_bytes !== n.content_bytes) invalid(); list.push(value); buckets.set(n.content_hash, list) }
    return value
  })
  if (bytes > 64 * 1024 * 1024 || new TextEncoder().encode(JSON.stringify(notes)).length > 8 * 1024 * 1024) invalid()
  const groupHashes = new Set()
  let duplicateCount = 0
  const groups = raw.groups.map(g => {
    if (!g || !hash(g.hash) || groupHashes.has(g.hash) || !integer(g.content_bytes, 16 * 1024 * 1024) || g.content_bytes === 0 || !Array.isArray(g.ids) || g.ids.length < 2 || g.ids.length > 20000) invalid()
    const expected = buckets.get(g.hash), expectedIDs = new Set(expected?.map(n => n.id))
    if (!expected || g.ids.length !== expected.length || g.content_bytes !== expected[0].content_bytes || new Set(g.ids).size !== g.ids.length || g.ids.some(id => !identity(id) || !expectedIDs.has(id))) invalid()
    groupHashes.add(g.hash); duplicateCount += g.ids.length
    return Object.freeze({ hash: g.hash, content_bytes: g.content_bytes, ids: Object.freeze([...g.ids]) })
  })
  if ([...buckets].some(([key, values]) => values.length > 1 && !groupHashes.has(key))) invalid()
  const totals = { notes: notes.length, empty, groups: groups.length, duplicate_notes: duplicateCount, additional_copies: duplicateCount - groups.length, content_bytes: bytes }
  for (const [key, value] of Object.entries(totals)) if (raw.totals?.[key] !== value) invalid()
  for (const key of ['folders', 'templates', 'trash']) { if (!integer(raw.totals?.[key])) invalid(); totals[key] = raw.totals[key] }
  if (totals.notes + totals.folders + totals.templates + totals.trash > 20000) invalid()
  return Object.freeze({ version: 1, complete: true, revision: raw.revision, captured_at: raw.captured_at, totals: Object.freeze(totals), notes: Object.freeze(notes), groups: Object.freeze(groups) })
}
export async function readDuplicateNotes(load, signal, budget = 10000) {
  const raw = await dailyRequest(load, '/api/duplicate-notes', { signal }, budget)
  if (signal?.aborted) throw new Error('重复检查已取消')
  return validateDuplicateNotes(raw)
}
export function duplicateGroups(snapshot, { query = '', sort = 'count' } = {}) {
  if (!text(query, 128) || !['count', 'updated', 'size'].includes(sort)) throw new Error('重复检查筛选参数无效')
  const q = query.trim().normalize('NFC').toLocaleLowerCase(), byId = new Map(snapshot.notes.map(n => [n.id, n]))
  // A title/folder match includes the WHOLE group, never hides its other members.
  return snapshot.groups.filter(g => !q || g.ids.some(id => [byId.get(id).title, byId.get(id).folder].some(s => s.normalize('NFC').toLocaleLowerCase().includes(q))))
    .sort((a, b) => (sort === 'count' ? b.ids.length - a.ids.length : sort === 'size' ? b.content_bytes - a.content_bytes : Math.max(...b.ids.map(id => byId.get(id).updated_at)) - Math.max(...a.ids.map(id => byId.get(id).updated_at))) || a.hash.localeCompare(b.hash))
}
export async function readDuplicateSource(load, note, signal) {
  const fail = () => { const error = new Error('来源笔记已变化，请重新检查后再打开。'); error.code = 'STALE_DUPLICATE_SOURCE'; throw error }
  const file = await dailyRequest(load, `/api/files/${encodeURIComponent(note.id)}`, { signal }, 10000)
  if (!file || file.id !== note.id || file.is_folder !== false || file.is_deleted !== false || file.title?.startsWith('__tpl__') || file.title !== note.title || file.parent_id !== note.parent_id || typeof file.content !== 'string') fail()
  const bytes = new TextEncoder().encode(file.content)
  if (bytes.length !== note.content_bytes || bytes.length > 16 * 1024 * 1024) fail()
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  if (signal?.aborted) throw new Error('来源打开已取消')
  if (Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') !== note.content_hash) fail()
  return file
}
export function duplicateReport(snapshot, options = {}, details = false) {
  const value = validateDuplicateNotes(snapshot), groups = duplicateGroups(value, options), notes = new Map(value.notes.map(n => [n.id, n]))
  return JSON.stringify({ format: 'local-notepad-duplicate-notes', version: 1, captured_at: value.captured_at,
    scope: 'exact saved UTF-8 body bytes; not semantic equality or permission to delete',
    excludes: ['unsaved drafts', 'templates', 'trash', 'zero-byte bodies', 'attachment bytes'], totals: value.totals,
    selection: { groups: groups.length, notes: groups.reduce((n, g) => n + g.ids.length, 0), query: details === true ? options.query || '' : '', query_omitted: details !== true && Boolean(options.query), sort: options.sort || 'count' },
    contains_identities: details === true,
    ...(details === true ? { revision: value.revision, groups: groups.map(g => ({ ...g, notes: g.ids.map(id => notes.get(id)) })) } : {}) }, null, 2) + '\n'
}
export function downloadDuplicateReport(snapshot, options = {}, details = false) {
  const content = duplicateReport(snapshot, options, details)
  let url, anchor
  try { url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' })); anchor = document.createElement('a'); anchor.href = url; anchor.download = 'local-notepad-duplicates.json'; document.body.appendChild(anchor); anchor.click() }
  finally { anchor?.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
