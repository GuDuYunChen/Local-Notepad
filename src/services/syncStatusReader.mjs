// This retries read-only UI status requests, never sync/run or conflict writes.
export const STATUS_POLL_MS = 15_000
export const STATUS_MAX_RETRY_MS = 300_000

export function statusRetryDelay(failures) {
  if (!Number.isFinite(failures) || failures <= 0) return STATUS_POLL_MS
  return Math.min(STATUS_MAX_RETRY_MS, STATUS_POLL_MS * 2 ** Math.min(5, Math.floor(failures)))
}

export function mergeSyncDraft(draft, settings, dirty = {}) {
  return {
    endpoint: dirty.endpoint ? draft.endpoint : (settings?.sync_endpoint || ''),
    username: dirty.username ? draft.username : (settings?.sync_username || ''),
    // Never hydrate a password from settings or a background response.
    password: draft.password || '',
  }
}

export function syncStatusLabel(value) {
  return ({ never: '尚未同步', ok: '最近一次同步完成', error: '最近一次同步失败',
    conflicts: '有冲突待处理', rebound: '已重新绑定，等待预演' })[value] || '状态待确认'
}

export function syncHealthLabel(settings, status, readError = '') {
  if (readError) return '状态暂时无法刷新，以下为上次读取结果'
  if (!settings || !status) return '正在读取同步状态'
  if (!settings.sync_enabled) return '同步未启用'
  if (status.open_conflicts > 0) return '有冲突待处理，自动同步暂缓'
  if (status.last_status === 'error') return '同步失败，请检查连接或凭据'
  if (settings.sync_auto_enabled) return '自动同步已开启'
  return '手动同步模式'
}

export function createSyncStatusReader({
  load, onSnapshot, onHealth = () => {}, shouldPoll = () => false,
  now = Date.now, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 12_000,
  pollInterval = () => STATUS_POLL_MS,
}) {
  let disposed = false
  let paused = false
  let generation = 0
  let inFlight = null
  let retryTimer = null
  let abortRead = null
  let failures = 0
  let lastReadAt = 0
  let error = ''

  const emit = (extra = {}) => {
    if (!disposed) onHealth({ failures, lastReadAt, error, loading: false, retryAt: 0, ...extra })
  }
  const clearRetry = () => {
    if (retryTimer !== null) cancel(retryTimer)
    retryTimer = null
  }
  const planNext = () => {
    clearRetry()
    if (disposed || paused || (!failures && !shouldPoll())) return
    const requested = Number(pollInterval())
    const normalDelay = Number.isFinite(requested) ? Math.max(1_000, Math.min(60_000, requested)) : STATUS_POLL_MS
    const delay = failures ? statusRetryDelay(failures) : normalDelay
    emit({ retryAt: now() + delay })
    retryTimer = schedule(() => { retryTimer = null; void refresh() }, delay)
  }

  function refresh({ allowPaused = false } = {}) {
    if (disposed || (paused && !allowPaused)) return Promise.resolve(false)
    if (inFlight) return inFlight
    clearRetry()
    const ticket = generation
    const controller = new AbortController()
    let deadline
    let rejectCancelled
    const cancelled = new Promise((_, reject) => { rejectCancelled = reject })
    abortRead = () => {
      controller.abort()
      rejectCancelled(new Error('状态读取已取消'))
    }
    const timeout = new Promise((_, reject) => {
      deadline = schedule(() => {
        reject(new Error('状态读取超时，请检查本地数据服务'))
        controller.abort()
      }, timeoutMs)
    })
    emit({ loading: true })
    const task = Promise.race([
      Promise.resolve().then(() => load(controller.signal)), timeout, cancelled,
    ]).then(snapshot => {
      if (disposed || ticket !== generation) return false
      onSnapshot(snapshot)
      failures = 0
      error = ''
      lastReadAt = now()
      emit()
      return true
    }).catch(reason => {
      if (disposed || ticket !== generation) return false
      failures = Math.min(failures + 1, 1000)
      // Do not surface arbitrary server response bodies in the automatic banner.
      error = reason?.message === '状态读取超时，请检查本地数据服务'
        ? reason.message : '暂时无法读取同步状态，请检查本地数据服务'
      emit()
      return false
    }).finally(() => {
      cancel(deadline)
      if (inFlight === task) {
        inFlight = null
        abortRead = null
        planNext()
      }
    })
    inFlight = task
    return task
  }

  const invalidate = () => {
    generation += 1
    clearRetry()
    abortRead?.()
    abortRead = null
    inFlight = null
  }
  return {
    refresh,
    setPaused(value) {
      paused = Boolean(value)
      if (paused) { invalidate(); emit() } else planNext()
    },
    dispose() {
      disposed = true
      invalidate()
    },
  }
}
