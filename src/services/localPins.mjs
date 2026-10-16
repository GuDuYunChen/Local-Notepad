import {dailyRequest} from './dailyNotes.mjs'
import {readQuickTarget} from './quickSwitcher.mjs'

export const PIN_JOURNAL_KEY = 'local-notepad.pending-pin.v1'
export const PIN_PAGE_SIZE = 20
export const PIN_LIMIT = 2000
const bytes = text => new TextEncoder().encode(text).length
const bad = (code, text) => { throw Object.assign(new Error(text), {code}) }
const validText = s => typeof s === 'string' && !Array.from(s).some(c => c.codePointAt(0) >= 0xd800 && c.codePointAt(0) <= 0xdfff)
export const pinID = id => validText(id) && bytes(id) > 0 && bytes(id) <= 512 && !/[\u0000-\u001f\u007f]/.test(id)
export function pinItem(value) {
  if (!value || !pinID(value.id) || !validText(value.title) || bytes(value.title) > 16384 || value.title.startsWith('__tpl__') || typeof value.is_folder !== 'boolean' || typeof value.is_pinned !== 'boolean' || !Number.isSafeInteger(value.updated_at) || value.updated_at < 0)
    bad('invalid', '置顶目标身份或元数据无效，未采用这份结果。')
  return Object.freeze({id:value.id,title:value.title,is_folder:value.is_folder,is_pinned:value.is_pinned,updated_at:value.updated_at})
}
export function validatePins(value) {
  if (!value || value.scope !== 'active-note-pins-v1' || value.complete !== true || !Array.isArray(value.items)) bad('invalid', '置顶笔记列表不完整，请重新读取。')
  if (value.items.length > PIN_LIMIT) bad('limit', '笔记库超过2000篇完整读取上限，未采用部分列表。')
  const ids = new Set(), items = value.items.map(row => {
    const item = pinItem(row)
    if (item.is_folder || ids.has(item.id)) bad('invalid', '笔记列表含目录或重复身份，未采用这份列表。')
    ids.add(item.id); return item
  })
  const out = {scope:value.scope,complete:true,items:Object.freeze(items)}
  if (bytes(JSON.stringify(out)) > 2 * 1024 * 1024) bad('limit', '笔记库元数据超过2MiB完整读取上限。')
  return Object.freeze(out)
}
export function pinQuery(query) {
  if (!validText(query) || Array.from(query).length > 100 || /[\u0000-\u001f\u007f]/.test(query)) bad('query','查找词最多100个字符，不能包含控制字符。')
  return query.trim()
}
export function pinView(snapshot, query = '', scope = 'pinned', order = 'updated') {
  const q = pinQuery(query).toLocaleLowerCase()
  if (!['pinned','all'].includes(scope) || !['updated','title'].includes(order)) bad('view','置顶筛选条件无效。')
  return snapshot.items.filter(n => (scope === 'all' || n.is_pinned) && (!q || n.title.toLocaleLowerCase().includes(q)))
    .sort((a,b) => Number(b.is_pinned) - Number(a.is_pinned) || (order === 'updated' ? b.updated_at-a.updated_at : 0) || a.title.localeCompare(b.title,'zh-CN') || a.id.localeCompare(b.id))
}
export async function readPins(api, signal, timeout) {
  return validatePins(await dailyRequest(api,'/api/local-pins',{signal},timeout))
}
export async function readPin(api, id, signal, timeout) {
  if (!pinID(id)) bad('invalid','置顶目标身份无效。')
  const row = pinItem(await dailyRequest(api,'/api/local-pins/'+encodeURIComponent(id),{signal},timeout))
  if (row.id !== id) bad('invalid','核对结果属于其他笔记，未采用。')
  return row
}
export function validatePinIntent(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.started_at) || value.started_at < 1 || typeof value.pinned !== 'boolean') bad('journal','本机置顶操作记录损坏，原记录保留。')
  const item = pinItem(value.item)
  if (item.is_pinned === value.pinned) bad('journal','置顶操作目标没有变化。')
  return Object.freeze({version:1,started_at:value.started_at,item,pinned:value.pinned})
}
export function pinJournal(storage = globalThis.localStorage) {
  return {
    read() {
      const raw = storage.getItem(PIN_JOURNAL_KEY)
      if (raw === null) return null
      try { if (typeof raw !== 'string' || raw.length > 65536) throw Error(); return validatePinIntent(JSON.parse(raw)) }
      catch { bad('journal','本机置顶操作记录损坏，原记录保留。') }
    },
    save(intent) {
      if (storage.getItem(PIN_JOURNAL_KEY) !== null) bad('pending','已有置顶操作待核对，请打开“置顶笔记”处理，不会重复提交。')
      const raw = JSON.stringify(validatePinIntent(intent))
      storage.setItem(PIN_JOURNAL_KEY,raw)
      if (storage.getItem(PIN_JOURNAL_KEY) !== raw) bad('storage','操作记录未保存成功，尚未发送置顶修改。')
    },
    clear(expectedRaw) {
      if (storage.getItem(PIN_JOURNAL_KEY) !== expectedRaw) bad('changed','操作记录已变化，未清除，请重新核对。')
      storage.removeItem(PIN_JOURNAL_KEY)
      if (storage.getItem(PIN_JOURNAL_KEY) !== null) bad('storage','操作记录未清除，请重新核对。')
    },
    raw: () => storage.getItem(PIN_JOURNAL_KEY),
  }
}
export async function changePin(api, value, pinned, {signal,storage=globalThis.localStorage,timeout} = {}) {
  if (signal?.aborted) bad('cancelled','已取消，尚未发送置顶修改。')
  const intent = validatePinIntent({version:1,started_at:Date.now(),item:pinItem(value),pinned})
  const journal = pinJournal(storage)
  // The shared durable record is written synchronously before any await: two
  // buttons in this renderer cannot simultaneously start independent mutations.
  journal.save(intent)
  const raw = journal.raw()
  try {
    const before = intent.item
    const response = pinItem(await dailyRequest(api,'/api/local-pins/'+encodeURIComponent(before.id),{
      method:'PUT',signal,body:JSON.stringify({title:before.title,is_folder:before.is_folder,expected_pinned:before.is_pinned,pinned}),
    },timeout))
    // A concurrent body save may advance updated_at. Pins do not overwrite it.
    if (response.id !== before.id || response.title !== before.title || response.is_folder !== before.is_folder || response.is_pinned !== pinned)
      bad('unconfirmed','置顶响应没有确认目标状态。')
    if (signal?.aborted) bad('unconfirmed','等待已停止。')
    journal.clear(raw)
    if (typeof window !== 'undefined') { window.dispatchEvent(new Event('local-pins:changed')); window.dispatchEvent(new Event('library:refresh')) }
    return response
  } catch {
    bad('unconfirmed','置顶结果未确认。停止或超时不等于撤销；请在“置顶笔记”核对当前状态，不会自动重发。')
  }
}
export async function readPinnedTarget(api, row, signal, timeout) {
  const expected = pinItem(row)
  if (expected.is_folder) bad('target','目录不能作为笔记打开。')
  const file = await readQuickTarget(api,expected.id,signal,timeout)
  if (file.title !== expected.title || file.is_pinned !== expected.is_pinned) bad('changed','笔记名称或置顶状态已变化，请刷新列表后再打开。')
  return file
}
