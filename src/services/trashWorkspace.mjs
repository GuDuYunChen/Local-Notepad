// Local recycle-bin workflow. A request success is a receipt, not a transaction
// spanning all targets. Never replay an uncertain mutation automatically.
export const TRASH_BATCH_LIMIT = 500
export const TRASH_LIST_LIMIT = 20000
export const TRASH_HISTORY_LIMIT = 20
const HISTORY_FULL = '未确认操作记录已达到保留上限。请先查看并明确移除不再保留的历史记录；本次没有发送任何请求。'
const DAY_MS = 86400000
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/
const freeze = value => Object.freeze(value)
const demand = (ok, message) => { if (!ok) throw new Error(message) }
const clock = () => performance.now()
function failureHint(error) {
  try {
    const message = typeof error?.message === 'string' ? error.message : ''
    if (/同名/.test(message)) return '可能存在同名冲突，请核对原位置；不会自动改名或覆盖。'
    if (/父文件夹|父级/.test(message)) return '原父文件夹可能不可用，请先核对或恢复父文件夹。'
    if (/只能永久删除回收站/.test(message)) return '项目可能已离开回收站，请先刷新核对。'
  } catch { /* Never expose an arbitrary exception or getter failure. */ }
  return '请核对本机服务和当前项目状态。'
}


export function trashDaysRemaining(deletedAt, now = Date.now()) {
  if (!Number.isFinite(deletedAt) || deletedAt <= 0) return 30
  return Math.max(0, 30 - Math.floor(Math.max(0, now - deletedAt * 1000) / DAY_MS))
}
export function formatTrashDeletedAt(ts) {
  if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(new Date(ts * 1000).getTime())) return '删除时间未知'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
export function validateTrashList(raw) {
  demand(Array.isArray(raw) && raw.length <= TRASH_LIST_LIMIT, '回收站响应无效；没有将它当作空列表。')
  const seen = new Set()
  return freeze(raw.map(row => {
    demand(row && typeof row === 'object' && !Array.isArray(row), '回收站记录无效。')
    demand(typeof row.id === 'string' && ID.test(row.id) && !seen.has(row.id), '回收站项目标识无效或重复。')
    seen.add(row.id)
    demand(typeof row.title === 'string' && row.title.length <= 8192, '回收站标题无效。')
    demand([true, false, 0, 1].includes(row.is_folder), '回收站项目类型无效。')
    demand(row.is_deleted === undefined || row.is_deleted === true || row.is_deleted === 1, '回收站响应混入未删除的项目。')
    const parent = row.parent_id ?? ''
    demand(typeof parent === 'string' && (parent === '' || ID.test(parent)) && parent !== row.id, '回收站父级标识无效。')
    for (const key of ['deleted_at', 'updated_at']) {
      demand(row[key] == null || (Number.isSafeInteger(row[key]) && row[key] >= 0 && row[key] <= 8640000000000), '回收站时间无效。')
    }
    // Retain only metadata: neither note content nor arbitrary response fields
    // are copied into the view, operation report or session cache.
    return freeze({ id: row.id, title: row.title, is_folder: !!row.is_folder, parent_id: parent,
      deleted_at: row.deleted_at ?? 0, updated_at: row.updated_at ?? 0 })
  }))
}
const identity = row => JSON.stringify([row.id, row.title, row.is_folder, row.parent_id, row.deleted_at, row.updated_at])
export function getTrashView(items, { query = '', type = 'all', sort = 'newest', page = 1, pageSize = 50, now = Date.now() } = {}) {
  demand(typeof query === 'string' && [...query].length <= 200, '搜索词最多 200 个字符。')
  demand(['all', 'note', 'folder', 'soon'].includes(type), '筛选类型无效。')
  demand(['newest', 'oldest', 'title'].includes(sort), '排序类型无效。')
  demand(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100, '分页大小无效。')
  const q = query.normalize('NFC').trim().toLocaleLowerCase('zh-CN')
  const filtered = items.filter(row => (!q || row.title.normalize('NFC').toLocaleLowerCase('zh-CN').includes(q)) &&
    (type === 'all' || type === 'folder' && row.is_folder || type === 'note' && !row.is_folder ||
      type === 'soon' && row.deleted_at > 0 && trashDaysRemaining(row.deleted_at, now) <= 3))
  filtered.sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN', { numeric: true }) :
    (sort === 'oldest' ? 1 : -1) * (a.deleted_at - b.deleted_at)) || a.id.localeCompare(b.id))
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(pages, Math.max(1, Number.isInteger(page) ? page : 1))
  return freeze({ filtered: freeze(filtered), rows: freeze(filtered.slice((current - 1) * pageSize, current * pageSize)),
    total: filtered.length, page: current, pages })
}
export function summarizeTrashReport(report) {
  const result = { succeeded: 0, unconfirmed: 0, notStarted: 0, sending: 0 }
  for (const row of report?.rows || []) {
    if (row.status === 'succeeded') result.succeeded++
    else if (row.status === 'unconfirmed') result.unconfirmed++
    else if (row.status === 'sending') result.sending++
    else result.notStarted++
  }
  return freeze(result)
}

/** One store survives view unmount/reopen while an owned request is unresolved.
 * request uses the original api(path, init) contract. Reads may auto-refresh;
 * mutations require a fresh plan and explicit confirm for every batch.
 */
export function createTrashWorkspace(request, { timeoutMs = 15000, now = clock } = {}) {
  demand(typeof request === 'function', '缺少回收站请求接口。')
  demand(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000, '请求预算无效。')
  const listeners = new Set(), restored = new Set()
  let data = { items: freeze([]), loadState: 'idle', error: '', phase: 'idle', plan: null, report: null,
    pending: 0, stopRequested: false, notificationError: '', history: freeze([]), historyError: '' }
  let snapshot = freeze({ ...data }), readGeneration = 0, sequence = 0, running = false, viewers = 0
  const emit = change => {
    data = { ...data, ...change }; snapshot = freeze({ ...data })
    for (const listener of listeners) { try { listener() } catch { /* A view cannot change a write receipt. */ } }
  }
  const reportRows = (rows, extra = {}) => emit({ report: freeze({ ...data.report, ...extra, rows: freeze(rows.map(freeze)) }) })
  const updateRow = (id, status, note) => reportRows(data.report.rows.map(row => row.id === id ? { ...row, status, note } : row))
  const unavailable = () => running || data.pending > 0 || data.phase !== 'idle'

  // Pure preparation: publish the archive and the next report in ONE emit.
  // Otherwise a synchronous listener could start a new operation between them.
  // Never evict an uncertain receipt to make room for another mutation.
  const retainedHistory = () => {
    if (!data.report) return data.history
    const records = [data.report, ...data.history.filter(record => record.key !== data.report.key)]
    while (records.length > TRASH_HISTORY_LIMIT) {
      let removable = records.length - 1
      while (removable >= 0 && summarizeTrashReport(records[removable]).unconfirmed > 0) removable--
      if (removable < 0) return null
      records.splice(removable, 1)
    }
    return freeze(records)
  }

  function call(route, init = {}, canSend = null) {
    const controller = new AbortController(), deadline = now() + timeoutMs
    let answered = false, timer
    const notSent = {}
    emit({ pending: data.pending + 1 })
    return new Promise(resolve => {
      const settle = answer => { if (!answered) { answered = true; clearTimeout(timer); resolve(answer) } }
      timer = setTimeout(() => { settle({ kind: 'timeout' }); controller.abort() }, timeoutMs)
      const release = () => {
        const pending = data.pending - 1
        emit({ pending, ...(pending === 0 && !running && data.phase === 'held' ? { phase: 'idle' } : {}) })
      }
      Promise.resolve().then(() => {
        // Closing/stopping can happen after the row update but before this
        // microtask actually dispatches. Do not send a not-yet-started write.
        if (canSend && (!canSend() || now() >= deadline)) return notSent
        return request(route, { ...init, signal: controller.signal })
      }).then(
        value => { release(); settle(value === notSent ? { kind: 'not-sent' } : now() >= deadline ? { kind: 'timeout' } : { kind: 'ok', value }) },
        error => { release(); settle({ kind: now() >= deadline ? 'timeout' : 'uncertain', hint: failureHint(error) }) },
      )
    })
  }
  async function readList() {
    const response = await call('/api/files/trash')
    if (response.kind !== 'ok') return { ok: false, message: response.kind === 'timeout' ?
      '读取回收站超时。旧列表不是最新状态，请稍后刷新。' : '读取回收站失败。请检查本机服务后手动刷新。' }
    try { return { ok: true, items: validateTrashList(response.value) } }
    catch { return { ok: false, message: '回收站响应不完整或格式无效，未将它当作空列表。' } }
  }
  async function refresh() {
    if (unavailable() || data.loadState === 'loading') return false
    const generation = ++readGeneration
    emit({ loadState: 'loading', error: '', plan: null })
    const result = await readList()
    if (generation !== readGeneration) return false
    if (result.ok) emit({ items: result.items, loadState: 'ready', error: '' })
    else emit({ loadState: data.items.length ? 'stale' : 'error', error: result.message })
    return result.ok
  }
  function plan(action, ids, scope = 'selected') {
    if (unavailable() || data.loadState !== 'ready') return null
    if (!retainedHistory()) { emit({ plan: null, historyError: HISTORY_FULL }); return null }
    demand(['restore', 'delete'].includes(action), '回收站操作无效。')
    demand(['selected', 'snapshot'].includes(scope), '确认范围无效。')
    demand(Array.isArray(ids) && ids.length > 0 && ids.length <= TRASH_BATCH_LIMIT && new Set(ids).size === ids.length, '一次请选择 1–500 个不同项目。')
    const byID = new Map(data.items.map(row => [row.id, row]))
    demand(ids.every(id => byID.has(id)), '所选项目已经变化，请刷新后重新选择。')
    const targets = freeze(ids.map(id => byID.get(id)))
    const value = freeze({ key: ++sequence, action, scope, targets })
    emit({ plan: value, notificationError: '', historyError: '' })
    return value
  }
  const cancelPlan = () => { if (!running) emit({ plan: null }) }
  const stop = () => { if (running) emit({ stopRequested: true }) }
  async function confirm(key) {
    const intent = data.plan
    if (!intent || intent.key !== key || unavailable() || data.loadState !== 'ready') return false
    const history = retainedHistory()
    if (!history) { emit({ plan: null, historyError: HISTORY_FULL }); return false }
    running = true; ++readGeneration
    emit({ phase: 'checking', plan: null, stopRequested: false, error: '', history, historyError: '',
      report: freeze({ key: intent.key, action: intent.action, scope: intent.scope, complete: false,
        message: '正在核对确认范围，尚未发送修改请求。',
        rows: freeze(intent.targets.map(row => freeze({ id: row.id, title: row.title,
          is_folder: row.is_folder, status: 'not-started', note: '尚未发送' }))) }) })
    try {
      const fresh = await readList()
      if (!fresh.ok) {
        emit({ loadState: data.items.length ? 'stale' : 'error', error: fresh.message })
        reportRows(data.report.rows, { message: '核对失败，本批次没有发送任何恢复或删除请求。' })
        return false
      }
      emit({ items: fresh.items, loadState: 'ready' })
      const byID = new Map(fresh.items.map(row => [row.id, row]))
      const changed = intent.targets.some(row => !byID.has(row.id) || identity(row) !== identity(byID.get(row.id)))
      if (changed) {
        reportRows(data.report.rows, { message: '确认后项目发生变化。本批次未执行，请在最新列表中重新选择并确认。' })
        return false
      }
      if (data.stopRequested) {
        reportRows(data.report.rows, { message: '已停止，本批次没有发送修改请求。' })
        return false
      }
      emit({ phase: 'writing' })
      for (const row of intent.targets) {
        if (data.stopRequested) break
        updateRow(row.id, 'sending', '请求已发送，正在等待回执')
        const route = '/api/files/' + encodeURIComponent(row.id) + (intent.action === 'restore' ? '/restore' : '/permanent')
        const response = await call(route, { method: intent.action === 'restore' ? 'POST' : 'DELETE' }, () => !data.stopRequested)
        if (response.kind === 'not-sent') {
          updateRow(row.id, 'not-started', '请求发送前已停止或超时，未发送')
          break
        }
        if (response.kind === 'ok' && response.value === null) {
          updateRow(row.id, 'succeeded', intent.action === 'restore' ? '恢复接口已返回成功' : '永久删除接口已返回成功')
          if (intent.action === 'restore') restored.add(row.id)
        } else {
          // The legacy API erases error type/status. Neither a thrown Error nor
          // a timeout proves rollback. Stop the batch and require explicit review.
          updateRow(row.id, 'unconfirmed', response.kind === 'timeout' ? '等待超时，结果未确认；未自动重试' : '未取得有效成功回执；' + (response.hint || '请核对当前状态，不要直接重复操作。'))
          emit({ stopRequested: true })
          break
        }
      }
      const counts = summarizeTrashReport(data.report)
      reportRows(data.report.rows, { message: `成功 ${counts.succeeded} 项，结果未确认 ${counts.unconfirmed} 项，未执行 ${counts.notStarted} 项。` })
      if (data.pending === 0) {
        const current = await readList()
        if (current.ok) emit({ items: current.items, loadState: 'ready', error: '' })
        else emit({ loadState: 'stale', error: '操作回执已保留，但列表刷新失败。已成功的请求不会重新发送。' })
      } else emit({ loadState: 'stale', error: '原请求仍未结束，暂不允许新操作。迟到回复不会改写本次未确认结果。' })
      return counts.unconfirmed === 0 && counts.notStarted === 0
    } catch {
      // Contain programming/transport boundary faults without inventing success.
      if (data.report) reportRows(data.report.rows.map(row => row.status === 'sending' ?
        { ...row, status: 'unconfirmed', note: '操作中断，结果未确认' } : row), { message: '本批次中断，回执已保留；未自动重试。' })
      emit({ loadState: 'stale', error: '请先刷新并核对当前状态，再明确确认需要的操作。' })
      return false
    } finally {
      running = false
      if (data.report) reportRows(data.report.rows, { complete: true })
      emit({ phase: data.pending ? 'held' : 'idle' })
    }
  }
  function connect(listener) {
    demand(typeof listener === 'function', '缺少视图监听器。')
    listeners.add(listener); viewers++
    let connected = true
    return () => {
      if (!connected) return
      connected = false; listeners.delete(listener); viewers--
      if (viewers === 0) {
        if (running) stop()
        else { ++readGeneration; emit({ plan: null, ...(data.loadState === 'loading' ? { loadState: data.items.length ? 'stale' : 'idle' } : {}) }) }
      }
    }
  }
  return freeze({ snapshot: () => snapshot, connect, refresh, plan, cancelPlan, confirm, stop,
    takeRestored() { const ids = [...restored]; restored.clear(); return ids },
    reportRefreshError() { emit({ notificationError: '恢复已成功，但笔记列表刷新失败。请返回后重新刷新目录；不要重复恢复。' }) },
    clearReport() {
      if (unavailable()) return false
      const history = retainedHistory()
      if (!history) { emit({ historyError: HISTORY_FULL }); return false }
      emit({ report: null, history, notificationError: '', historyError: '' })
      return true
    },
    removeHistory(key, acknowledgeUnconfirmed = false) {
      if (unavailable()) return false
      const record = data.history.find(entry => entry.key === key)
      if (!record || (summarizeTrashReport(record).unconfirmed > 0 && acknowledgeUnconfirmed !== true)) return false
      // Removing local metadata never verifies, cancels or replays the request.
      emit({ history: freeze(data.history.filter(entry => entry.key !== key)), historyError: '' })
      return true
    },
  })
}
