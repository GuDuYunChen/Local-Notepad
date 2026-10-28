import { dailyRequest } from './dailyNotes.mjs'

export const TASK_PAGE_SIZE = 50
const integer = (n, max = 20000) => Number.isSafeInteger(n) && n >= 0 && n <= max
const text = (s, max) => typeof s === 'string' && s.length <= max
const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
const identity = s => text(s, 128) && s.length > 0 && s.trim() === s && !/[\u0000-\u001f\u007f]/.test(s)
const invalid = () => { throw new Error('待办清单不完整或相互矛盾，没有采用部分结果。请重新读取。') }

export function validateTaskCenter(raw) {
  if (!raw || raw.version !== 1 || raw.complete !== true || !hash(raw.revision) || !integer(raw.captured_at, 253402300799) || !Array.isArray(raw.notes) || raw.notes.length > 20000 || !Array.isArray(raw.items) || raw.items.length > 10000) invalid()
  const byId = new Map()
  const notes = raw.notes.map(note => {
    if (!note || !identity(note.id) || byId.has(note.id) || !text(note.title, 4000) || !hash(note.content_hash) || typeof note.supported !== 'boolean' || !integer(note.updated_at, 253402300799)) invalid()
    const n = Object.freeze({ id: note.id, title: note.title, updated_at: note.updated_at, content_hash: note.content_hash, supported: note.supported })
    byId.set(n.id, n); return n
  })
  const ordinals = new Map()
  const items = raw.items.map(item => {
    if (!item || !byId.has(item.note_id) || !integer(item.ordinal, 10000) || item.ordinal !== (ordinals.get(item.note_id) || 0) + 1 || !text(item.text, 4096) || [...item.text].length > 1024 || typeof item.done !== 'boolean' || typeof item.truncated !== 'boolean' || !['lexical', 'markdown'].includes(item.format) || !integer(item.line, 16 * 1024 * 1024) || !text(item.block_id, 34)) invalid()
    if (item.format === 'markdown' ? item.line < 1 || item.block_id !== '' : item.line !== 0 || (item.block_id !== '' && !/^b-[a-f0-9]{32}$/.test(item.block_id))) invalid()
    ordinals.set(item.note_id, item.ordinal)
    return Object.freeze({ note_id: item.note_id, ordinal: item.ordinal, text: item.text, done: item.done, format: item.format, line: item.line, block_id: item.block_id, truncated: item.truncated })
  })
  const totals = { notes: notes.length, with_tasks: ordinals.size, unsupported: notes.filter(n => !n.supported).length, tasks: items.length, pending: items.filter(t => !t.done).length, done: items.filter(t => t.done).length }
  for (const [key, value] of Object.entries(totals)) if (raw.totals?.[key] !== value) invalid()
  for (const key of ['folders', 'templates', 'trash']) { if (!integer(raw.totals?.[key])) invalid(); totals[key] = raw.totals[key] }
  if (totals.notes + totals.folders + totals.templates + totals.trash > 20000 || new TextEncoder().encode(JSON.stringify({ notes, items })).length > 8 * 1024 * 1024) invalid()
  return Object.freeze({ version: 1, complete: true, revision: raw.revision, captured_at: raw.captured_at, totals: Object.freeze(totals), notes: Object.freeze(notes), items: Object.freeze(items) })
}

export async function readTaskCenter(load, signal, budget = 10000) {
  const raw = await dailyRequest(load, '/api/task-center', { signal }, budget)
  if (signal?.aborted) throw new Error('待办读取已取消')
  return validateTaskCenter(raw)
}
export function filterTasks(snapshot, { query = '', filter = 'pending', sort = 'updated' } = {}) {
  if (!text(query, 128) || !['pending', 'done', 'all'].includes(filter) || !['updated', 'title', 'status'].includes(sort)) throw new Error('待办筛选条件无效')
  const q = query.trim().normalize('NFC').toLocaleLowerCase(), notes = new Map(snapshot.notes.map(n => [n.id, n]))
  return snapshot.items.filter(t => (filter === 'all' || t.done === (filter === 'done')) && (!q || [t.text, notes.get(t.note_id).title].some(s => s.normalize('NFC').toLocaleLowerCase().includes(q))))
    .sort((a, b) => (sort === 'updated' ? notes.get(b.note_id).updated_at - notes.get(a.note_id).updated_at : sort === 'status' ? Number(a.done) - Number(b.done) : notes.get(a.note_id).title.localeCompare(notes.get(b.note_id).title)) || a.note_id.localeCompare(b.note_id) || a.ordinal - b.ordinal)
}

// This reader is passed INTO the existing navigation/save guard. Never select a
// cached body or toggle a second copy of a checklist from the dashboard.
export async function readTaskSource(load, note, signal) {
  const file = await dailyRequest(load, `/api/files/${encodeURIComponent(note.id)}`, { signal }, 10000)
  const stale = () => { const e = new Error('来源笔记已变化，请重新读取待办后再打开。'); e.code = 'STALE_TASK_SOURCE'; throw e }
  if (!file || file.id !== note.id || file.is_folder || file.is_deleted || file.title?.startsWith('__tpl__') || file.title !== note.title || typeof file.content !== 'string') stale()
  const bytes = new TextEncoder().encode(file.content)
  if (bytes.length > 16 * 1024 * 1024) stale()
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  if (signal?.aborted) throw new Error('来源打开已取消')
  if (Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') !== note.content_hash) stale()
  return file
}
export function taskCenterReport(snapshot, options, details = false) {
  const value = validateTaskCenter(snapshot), selected = filterTasks(value, options), titles = new Map(value.notes.map(n => [n.id, n.title]))
  return JSON.stringify({ format: 'local-notepad-task-center', version: 1, revision: value.revision, captured_at: value.captured_at,
    scope: 'saved-active-notes; checklist states, not a task completion history', excludes: ['unsaved drafts', 'templates', 'trash', 'code fences', 'quoted markdown'],
    totals: value.totals, selection: { filter: options.filter || 'pending', sort: options.sort || 'updated', count: selected.length, query: details === true ? options.query || '' : '', query_omitted: details !== true && Boolean(options.query) },
    contains_task_text: details === true, ...(details === true ? { tasks: selected.map(t => ({ ...t, title: titles.get(t.note_id) })) } : {}) }, null, 2) + '\n'
}
export function downloadTaskCenter(snapshot, options, details = false) {
  const content = taskCenterReport(snapshot, options, details)
  let url, anchor
  try { url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' })); anchor = document.createElement('a'); anchor.href = url; anchor.download = 'local-notepad-tasks.json'; document.body.appendChild(anchor); anchor.click() }
  finally { anchor?.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
