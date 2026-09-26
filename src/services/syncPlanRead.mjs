// Only bounds waiting for a read-only preview. Never wrap run/resolve here:
// aborting their response is not evidence that a write has been rolled back.
// The server's cooperative read budget is 30s; allow 5s for delivery/cleanup.
export const SYNC_PLAN_READ_TIMEOUT_MS = 35_000

function stopped(code) {
  const error = new Error(code === 'SYNC_PLAN_READ_TIMEOUT'
    ? '同步预演等待超时，已停止等待。本次没有发起同步写入；请查看任务状态后手动重新预演。'
    : '已停止等待同步预演。本次没有发起同步写入；只读任务是否已结束，请以任务状态为准。')
  error.name = 'SyncPlanReadError'
  error.code = code
  return error
}

// One attempt, one deadline. Resolve/reject independently of transport abort
// cooperation, and attach both handlers so late responses/rejections are inert.
export function readSyncPlan(load, {
  signal, timeoutMs = SYNC_PLAN_READ_TIMEOUT_MS, schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  if (typeof load !== 'function') return Promise.reject(new TypeError('缺少同步预演读取函数'))
  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(SYNC_PLAN_READ_TIMEOUT_MS, timeoutMs) : SYNC_PLAN_READ_TIMEOUT_MS
  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const cleanup = () => {
      if (timer !== null) cancel(timer)
      timer = null
      signal?.removeEventListener('abort', abort)
    }
    const stop = code => {
      if (settled) return
      settled = true
      cleanup()
      // Settle our own error first: shared API code may replace AbortError with
      // a generic network error, and some transports may never reject at all.
      reject(stopped(code))
      controller.abort()
    }
    const abort = () => stop('SYNC_PLAN_READ_CANCELLED')
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      timer = schedule(() => stop('SYNC_PLAN_READ_TIMEOUT'), limit)
    } catch (error) {
      settled = true
      cleanup()
      reject(error)
      return
    }
    Promise.resolve().then(() => {
      if (!settled) return load(controller.signal)
    }).then(value => {
      if (settled) return
      if (signal?.aborted) { abort(); return }
      settled = true
      cleanup()
      resolve(value)
    }, error => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
  })
}
