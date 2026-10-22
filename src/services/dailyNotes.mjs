export const DAILY_WAIT_MS = 10000
export function validDailyDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const [y, m, d] = key.split('-').map(Number)
  const value = new Date(0); value.setUTCFullYear(y, m - 1, d)
  return y > 0 && value.getUTCFullYear() === y && value.getUTCMonth() === m - 1 && value.getUTCDate() === d
}
export function dailyDateKey(date = new Date()) {
  const key = [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  if (!validDailyDate(key)) throw new Error('日期超出支持范围')
  return key
}
export function dailyDate(key) {
  if (!validDailyDate(key)) throw new Error('请选择有效的日历日期')
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(0); date.setHours(12, 0, 0, 0); date.setFullYear(y, m - 1, d)
  return date
}
export function moveDailyMonth(key, delta) {
  if (!Number.isSafeInteger(delta) || Math.abs(delta) !== 1) throw new Error('月份移动无效')
  const date = dailyDate(key), day = date.getDate()
  date.setDate(1); date.setMonth(date.getMonth() + delta)
  if (date.getFullYear() < 1 || date.getFullYear() > 9999) return null
  const last = new Date(date); last.setMonth(last.getMonth() + 1); last.setDate(0)
  date.setDate(Math.min(day, last.getDate()))
  return dailyDateKey(date)
}
export function dailyCalendar(key) {
  const date = dailyDate(key); date.setDate(1)
  const days = Array.from({ length: date.getDay() }, () => null)
  const month = date.getMonth()
  while (date.getMonth() === month) {
    days.push({ date: date.getDate(), key: dailyDateKey(date) })
    date.setDate(date.getDate() + 1)
  }
  return days
}
const issue = (code, message) => Object.assign(new Error(message), { code })
export async function dailyRequest(load, path, init = {}, budget = DAILY_WAIT_MS, onSend = () => {}) {
  if (!(budget > 0 && Number.isFinite(budget))) throw issue('budget', '读取预算无效')
  const controller = new AbortController(), end = performance.now() + budget
  let timer, abort
  const task = new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value) } }
    abort = () => { finish(reject, issue('cancelled', '已停止等待')); controller.abort() }
    init.signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => { finish(reject, issue('timeout', '等待本机服务超时')); controller.abort() }, budget)
    Promise.resolve().then(() => {
      if (init.signal?.aborted || controller.signal.aborted) throw issue('cancelled', '已停止等待')
      if (performance.now() >= end) throw issue('timeout', '等待本机服务超时')
      onSend()
      return load(path, { ...init, signal: controller.signal })
    }).then(value => {
      if (init.signal?.aborted) return abort()
      if (performance.now() >= end) return finish(reject, issue('timeout', '等待本机服务超时'))
      finish(resolve, value)
    }, error => finish(reject, ['cancelled', 'timeout'].includes(error?.code) ? error : issue('request', '本机服务请求失败，请检查服务后重试')))
    if (init.signal?.aborted) abort()
  })
  try { return await task } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort) }
}
function metadata(file) {
  return file && typeof file.id === 'string' && file.id.length > 0 && typeof file.title === 'string' &&
    typeof file.is_folder === 'boolean' && typeof file.parent_id === 'string' &&
    typeof file.is_deleted === 'boolean'
}
export async function readDailyIndex(load, signal, budget = DAILY_WAIT_MS) {
  const end = performance.now() + budget, seen = new Set(), notes = [], conflicts = new Set(), dates = new Set()
  for (let page = 1; page <= 100; page++) {
    if (performance.now() >= end) throw issue('timeout', '读取记录列表超时，请手动重试')
    const response = await dailyRequest(load, `/api/files?page=${page}&size=200&compact=1`, { signal }, Math.max(1, end - performance.now()))
    const batch = response === null ? [] : response
    if (!Array.isArray(batch) || batch.length > 200) throw issue('index', '记录列表格式不正确，请刷新后重试')
    for (const file of batch) {
      if (!metadata(file) || seen.has(file.id)) throw issue('index', '记录列表已变化或格式不正确，请刷新后重试')
      seen.add(file.id)
      if (file.parent_id !== '' || file.is_deleted || !validDailyDate(file.title)) continue
      if (file.is_folder || dates.has(file.title)) conflicts.add(file.title)
      dates.add(file.title)
      if (!file.is_folder) notes.push(Object.freeze({ id: file.id, title: file.title, updated_at: file.updated_at }))
    }
    if (performance.now() >= end) throw issue('timeout', '读取记录列表超时，请手动重试')
    if (batch.length < 200) return { notes: notes.sort((a, b) => b.title.localeCompare(a.title) || a.id.localeCompare(b.id)), conflicts: [...conflicts] }
  }
  throw issue('index-limit', '记录量超过本次读取上限，未采用不完整的列表')
}
function receipt(value, date, readOnly) {
  if (!value || typeof value.created !== 'boolean' || (readOnly && value.created)) throw issue('receipt', '每日笔记响应未确认')
  if (value.file === null && readOnly && !value.created) return null
  const file = value.file
  if (!metadata(file) || file.title !== date || file.parent_id !== '' || file.is_folder || file.is_deleted || typeof file.content !== 'string')
    throw issue('receipt', '每日笔记响应的日期、位置或正文未确认')
  return file
}
// Unconfirmed dates outlive panel mounts. Reconciliation only reads; a stopped
// or timed-out request does not prove rollback and never causes an auto-retry.
export function createDailyWorkspace(load, budget = DAILY_WAIT_MS) {
  let active = null, sequence = 0
  const uncertain = new Set(), listeners = new Set()
  let state = Object.freeze({ busy: false, date: null, message: '', kind: 'idle', uncertain: [] })
  const publish = patch => { state = Object.freeze({ ...state, ...patch, uncertain: [...uncertain] }); for (const listener of listeners) listener() }
  const cancel = () => active?.controller.abort()
  return {
    snapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    cancel,
    async open(date, { inspectOnly = false, acknowledgeUncertain = false } = {}) {
      if (!validDailyDate(date)) throw issue('date', '请选择有效的日历日期')
      if (active) throw issue('busy', '上一项每日笔记操作尚未结束')
      if (uncertain.size >= 100 && !uncertain.has(date) && !inspectOnly) throw issue('unconfirmed-limit', '请先核对未确认的每日笔记')
      const task = { id: ++sequence, date, controller: new AbortController(), sent: false }
      active = task; publish({ busy: true, date, message: '正在核对该日记录…', kind: 'loading' })
      try {
        const base = `/api/files/daily/${date}`, signal = task.controller.signal
        let value = await dailyRequest(load, base + '?read_only=1', { signal }, budget)
        let file = receipt(value, date, true)
        if (!file && !inspectOnly && (!uncertain.has(date) || acknowledgeUncertain)) {
          if (signal.aborted) throw issue('cancelled', '已停止等待')
          publish({ message: '正在创建该日记录…' })
          value = await dailyRequest(load, base, { method: 'POST', signal }, budget, () => { task.sent = true })
          file = receipt(value, date, false)
        }
        if (signal.aborted) throw issue('cancelled', '已停止等待')
        if (file) uncertain.delete(date)
        const unresolved = uncertain.has(date)
        publish({ date, kind: file ? 'success' : unresolved ? 'uncertain' : 'empty',
          message: file ? (value.created ? `${date} 已创建，正在打开编辑器。` : `${date} 记录已找到。`) :
            unresolved ? `${date} 暂未查到记录，不能据此认定之前的创建已撤销。` : `${date} 尚无根目录每日笔记。` })
        return { file, created: value.created, uncertain: unresolved }
      } catch (error) {
        if (task.sent) uncertain.add(date)
        publish({ date, kind: task.sent ? 'uncertain' : error?.code === 'cancelled' ? 'stopped' : 'error',
          message: task.sent ? `${date} 创建结果未确认。停止等待不等于撤销创建，请先核对记录，不会自动重发。` :
            error?.code === 'cancelled' ? '已停止等待，尚未发送创建请求。' : '打开每日笔记失败，当前笔记未被改动；请刷新或核对后重试。' })
        throw error
      } finally { if (active === task) { active = null; publish({ busy: false }) } }
    },
  }
}
