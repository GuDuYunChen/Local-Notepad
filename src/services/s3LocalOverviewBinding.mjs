import { encodeS3LocalOverviewRequest, sanitizeS3LocalOverviewResult } from '../../electron/s3-local-overview-codec.js'

export const S3_LOCAL_OVERVIEW_WAIT_MS = 10_000
export const S3_LOCAL_OVERVIEW_LIMITATION = '仅为本次本地只读盘点；不代表原子快照、远端比较、同步完成或写入授权。'
const messages = Object.freeze({
  'not-checked': '尚未盘点；只有明确操作才会读取本地概览。',
  checking: '正在等待本次本地只读盘点，不会写入笔记或附件。',
  ready: '本次数量与容量统计已校验；没有执行同步。',
  'invalid-input': '盘点请求格式不符合约定，未调用原生入口。',
  'native-unavailable': '当前环境没有可用的原生盘点入口，不会改走浏览器网络请求。',
  'invalid-reply': '盘点返回的格式或统计无效，未采纳其中的数据。',
  'session-busy': '上一次原生调用尚未返回，本次未发起新的读取。',
  'wait-stopped': '本次结果已失效；停止等待不代表原生读取已经取消或结束。',
  'wait-timeout': '等待盘点超时，不会自动重试；原生调用返回前不会再次读取。',
  'stale-input': '盘点上下文已变化，请在当前界面明确重新读取。',
  disposed: '盘点上下文已关闭，未发起新的读取。',
})
function view(state, code, serviceStatus = 0, summary = null) {
  return Object.freeze({ state, code, serviceStatus, summary,
    message: Object.hasOwn(messages, code) ? messages[code] : '本次只读盘点未完成，不会自动重试或推断同步状态。',
    limitation: S3_LOCAL_OVERVIEW_LIMITATION })
}
export const S3_LOCAL_OVERVIEW_DISCONNECTED = view('disposed', 'disposed')
export const S3_LOCAL_OVERVIEW_STALE_INPUT = view('stopped', 'stale-input')
const IDLE = view('idle', 'not-checked'), STOPPED = view('stopped', 'wait-stopped')
const BUSY = view('blocked', 'session-busy'), TIMEOUT = view('stopped', 'wait-timeout')
const UNAVAILABLE = view('failed', 'native-unavailable')

// Renderer lifetime only. Connecting/subscribing never invokes the bridge.
// A renderer timeout revokes delivery, NOT native I/O. Keep the outstanding
// promise slot across invalidation and connect/cleanup replay until it settles;
// main's independent ClientRequest-close slot remains the transport authority.
// No fetch, persistence, caching, automatic reads, retries or queued requests.
// Options are trusted local dependencies, never renderer/IPC configuration.
export function createS3LocalOverviewBinding({ getBridge = () => globalThis.window?.electronAPI,
  timeoutMs = S3_LOCAL_OVERVIEW_WAIT_MS, schedule = setTimeout, cancel = clearTimeout,
  now = () => globalThis.performance.now() } = {}) {
  if (typeof getBridge !== 'function' || typeof schedule !== 'function' || typeof cancel !== 'function' ||
      typeof now !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > S3_LOCAL_OVERVIEW_WAIT_MS) throw new TypeError('Invalid local overview binding options')
  let owner = null, active = null, snapshot = IDLE
  const listeners = new Set()
  function publish(next) {
    if (next === snapshot) return
    snapshot = next
    for (const notify of [...listeners]) {
      if (!listeners.has(notify)) continue
      try { notify() } catch { /* Observers cannot interrupt cleanup or another observer. */ }
    }
  }
  function revoked(task) {
    return task.owner.closed || owner !== task.owner ? S3_LOCAL_OVERVIEW_DISCONNECTED : task.epoch.refusal
  }
  function clear(task) {
    if (!task.timerReady) return
    task.timerReady = false
    try { cancel(task.timer) } catch { /* Never expose scheduler exceptions. */ }
  }
  function finish(task, next) {
    if (task.finished) return
    task.finished = true
    clear(task)
    const final = revoked(task) || next
    task.resolve(final)
    if (owner === task.owner && !task.owner.closed && owner.epoch === task.epoch) publish(final)
  }
  function release(task) { if (active === task) active = null }
  function stopped(task) {
    if (task.finished) return true
    const refusal = revoked(task)
    if (refusal) { finish(task, refusal); return true }
    try {
      const at = now()
      if (!Number.isFinite(at) || at < task.started) throw new TypeError('Invalid local clock')
      if (at >= task.deadline) { finish(task, TIMEOUT); return true }
    } catch { finish(task, UNAVAILABLE); return true }
    return task.finished
  }
  function connect() {
    if (owner) throw new TypeError('Local overview binding is already connected')
    const lease = { epoch: { refusal: null }, closed: false }
    owner = lease
    publish(active ? BUSY : IDLE)
    return () => {
      if (owner !== lease) return
      lease.closed = true; owner = null // Revoke before callbacks can reenter.
      lease.epoch.refusal = S3_LOCAL_OVERVIEW_DISCONNECTED
      if (active?.owner === lease) finish(active, S3_LOCAL_OVERVIEW_DISCONNECTED)
      if (!owner) publish(S3_LOCAL_OVERVIEW_DISCONNECTED)
    }
  }
  function invalidate() {
    if (!owner) return snapshot
    const lease = owner
    lease.epoch.refusal = STOPPED
    lease.epoch = { refusal: null }
    if (active?.owner === lease) finish(active, STOPPED)
    if (owner === lease && !lease.closed) publish(active ? STOPPED : IDLE)
    return snapshot
  }
  function read(input) {
    if (!owner) return Promise.resolve(S3_LOCAL_OVERVIEW_DISCONNECTED)
    if (active) return Promise.resolve(BUSY) // Do not replace an in-flight view.
    const lease = owner
    lease.epoch.refusal = STOPPED; lease.epoch = { refusal: null }
    let resolve
    const pending = new Promise(done => { resolve = done })
    const task = { owner: lease, epoch: lease.epoch, resolve, finished: false,
      timerReady: false, started: 0, deadline: 0 }
    active = task // Reserve before clock/input/bridge reflection or observers.
    // Recheck adoption after notification and again at the returned boundary.
    const result = pending.then(value => revoked(task) || value).then(value => revoked(task) || value)
    try {
      task.started = now()
      if (!Number.isFinite(task.started) || task.started < 0) throw new TypeError('Invalid local clock')
      task.deadline = task.started + timeoutMs
      publish(view('pending', 'checking'))
      if (stopped(task)) { release(task); return result }
      const encoded = encodeS3LocalOverviewRequest(input)
      if (stopped(task)) { release(task); return result }
      if (!encoded) { finish(task, view('failed', 'invalid-input')); release(task); return result }
      const bridge = getBridge()
      const method = bridge && Object.getOwnPropertyDescriptor(bridge, 's3LocalOverviewRead')
      if (stopped(task)) { release(task); return result }
      if (!method || !Object.hasOwn(method, 'value') || typeof method.value !== 'function') {
        finish(task, UNAVAILABLE); release(task); return result
      }
      task.timer = schedule(() => finish(task, TIMEOUT), Math.max(1, task.deadline - now()))
      task.timerReady = true
      // An injected synchronous scheduler may already have ended the wait.
      if (stopped(task)) { clear(task); release(task); return result }
      const native = method.value.call(bridge, { readOnly: true })
      Promise.resolve(native).then(raw => {
        try {
          if (stopped(task)) return
          const safe = sanitizeS3LocalOverviewResult(raw)
          if (stopped(task)) return
          const next = safe.code === 'native-local-overview-invalid-response'
            ? view('failed', 'invalid-reply')
            : view(safe.success ? 'ready' : 'failed', safe.success ? 'ready' : safe.code, safe.status, safe.data)
          finish(task, next)
        } catch { finish(task, UNAVAILABLE) }
        finally { release(task) }
      }, () => { finish(task, UNAVAILABLE); release(task) })
    } catch { finish(task, UNAVAILABLE); release(task) }
    return result
  }
  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Invalid local overview observer')
    const notify = () => listener() // No captured result payload.
    listeners.add(notify)
    return () => { listeners.delete(notify) }
  }
  return Object.freeze({ connect, read, invalidate, subscribe, snapshot: () => snapshot })
}
