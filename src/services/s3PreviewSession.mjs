// Renderer preview lifecycle. Only an explicit read may invoke the existing
// native bridge. There is no HTTP fallback, persistence, database or sync job.
import { encodeS3PreviewRequest, decodeS3PreviewResponse } from '../../electron/s3-preview-codec.js'

export const S3_PREVIEW_WAIT_MS = 10_000
export const S3_PREVIEW_LIMITATION = '仅为这一次只读比较的候选统计，不代表同步完成、凭据有效或具备写入/删除权限。'
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const NATIVE_CODES = new Set(['invalid-preview-request', 'native-preview-busy', 'native-preview-cancelled',
  'native-preview-timeout', 'native-preview-unavailable', 'native-preview-invalid-response', 'untrusted-frame'])
const MESSAGES = Object.freeze({
  'not-checked': '尚未预览；只有明确调用才会进行只读比较。',
  checking: '正在等待本次只读预览；不会执行同步或写入数据。',
  ready: '本次候选统计已校验；没有执行上传、删除或同步。',
  'invalid-input': '预览参数格式或大小不符合约定；未调用原生桥。',
  'native-unavailable': '当前环境没有可用的原生预览入口；不会改走浏览器网络请求。',
  'invalid-reply': '预览返回格式或统计不符合约定；未采纳其中的数据。',
  'session-busy': '上一次原生调用尚未返回；本次没有再次发起预览。',
  'wait-stopped': '本次结果已失效；这不证明原生读取已经取消或结束。',
  'wait-timeout': '等待预览超时；不会自动重试，原生调用结束前不再次发起预览。',
  disposed: '预览会话已关闭；未发起新的读取。',
})
function view(state, code, serviceStatus = 0, summary = null) {
  return Object.freeze({ state, code, serviceStatus, summary,
    message: own(MESSAGES, code) ? MESSAGES[code] : '本次只读预览未完成；不会推断凭据或权限，也不会自动重试。',
    limitation: S3_PREVIEW_LIMITATION })
}

// A returned IPC object is not trusted just because its sender is native. Copy
// bounded own DATA properties before any JSON operation; never execute a
// getter, toJSON or iterator. Native structured-clone normally makes plain data.
function copyReply(value, depth = 0, ancestors = new Set(), budget = { nodes: 0 }) {
  if (++budget.nodes > 128 || depth > 6) throw new TypeError('Invalid preview reply')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.length <= 256) return value
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Invalid preview reply')
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value)
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new TypeError('Invalid preview reply')
  const keys = Reflect.ownKeys(value)
  if (keys.length > 9 || keys.some(k => typeof k !== 'string')) throw new TypeError('Invalid preview reply')
  const result = array ? [] : Object.create(null)
  ancestors.add(value)
  try {
    let length = 0
    if (array) {
      const d = Object.getOwnPropertyDescriptor(value, 'length')
      if (!d || !own(d, 'value') || !Number.isSafeInteger(d.value) || d.value < 0 || d.value > 4) throw new TypeError('Invalid preview reply')
      length = d.value
      if (keys.length !== length + 1 || keys.some(k => k !== 'length' && !Array.from({ length }, (_, i) => String(i)).includes(k))) throw new TypeError('Invalid preview reply')
      Object.setPrototypeOf(result, null) // No inherited toJSON during encoding.
    }
    for (const key of keys) {
      if (array && key === 'length') continue
      if (key.length > 64) throw new TypeError('Invalid preview reply')
      const d = Object.getOwnPropertyDescriptor(value, key)
      if (!d || !d.enumerable || !own(d, 'value')) throw new TypeError('Invalid preview reply')
      result[key] = copyReply(d.value, depth + 1, ancestors, budget)
    }
    return result
  } finally { ancestors.delete(value) }
}
function replyView(raw, maxItems) {
  try {
    const r = copyReply(raw)
    if (!r || Array.isArray(r) || typeof r !== 'object' || Object.keys(r).length !== 4 ||
        !['success', 'status', 'code', 'data'].every(k => own(r, k)) || typeof r.success !== 'boolean') throw new TypeError('Invalid preview reply')
    if (!r.success && r.status === 0 && r.data === null && NATIVE_CODES.has(r.code)) return view('failed', r.code)
    if (r.success !== (r.status === 200)) throw new TypeError('Invalid preview reply')
    const envelope = Object.assign(Object.create(null), { code: r.success ? 0 : r.status, message: r.code, data: r.data })
    const decoded = decodeS3PreviewResponse(r.status, JSON.stringify(envelope), maxItems)
    if (decoded.code === 'native-preview-invalid-response') throw new TypeError('Invalid preview reply')
    return view(decoded.success ? 'ready' : 'failed', decoded.success ? 'ready' : decoded.code, decoded.status, decoded.data)
  } catch { return view('failed', 'invalid-reply') }
}

// Dependency options are for trusted local callers/tests, not an IPC transport
// configuration. No URL/headers are accepted here. Actual native I/O and its
// connection-close slot remain owned by main; a renderer timeout only ends wait.
export function createS3PreviewSession({ getBridge = () => globalThis.window?.electronAPI,
  timeoutMs = S3_PREVIEW_WAIT_MS, schedule = setTimeout, cancel = clearTimeout,
  now = () => globalThis.performance.now() } = {}) {
  if (typeof getBridge !== 'function' || typeof schedule !== 'function' || typeof cancel !== 'function' ||
      typeof now !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > S3_PREVIEW_WAIT_MS) throw new TypeError('Invalid preview session options')
  let active = null, disposed = false, epoch = { refusal: null }, current = view('idle', 'not-checked')
  const clear = task => {
    if (task.timerReady) { task.timerReady = false; try { cancel(task.timer) } catch { /* Fixed public result only. */ } }
  }
  function finish(task, result) {
    if (task.finished) return
    task.finished = true; clear(task)
    const final = task.epoch.refusal || result
    if (!disposed && epoch === task.epoch) current = final
    task.resolve(final)
  }
  function release(task, result) {
    // Keep ownership through response reflection/validation, including Proxy
    // reentrancy. A newer task must never be cleared by an old completion.
    if (result) finish(task, result)
    if (active === task) active = null
  }
  function expired(task) {
    const at = now()
    if (!Number.isFinite(at) || at >= task.deadline) { finish(task, view('stopped', 'wait-timeout')); return true }
    return task.finished
  }
  function invalidate() {
    const refusal = view(disposed ? 'disposed' : 'stopped', disposed ? 'disposed' : 'wait-stopped')
    epoch.refusal = refusal; epoch = { refusal: null }
    current = disposed || active ? refusal : view('idle', 'not-checked')
    if (active) finish(active, refusal)
    return current
  }
  function read(input) {
    if (disposed) return Promise.resolve(view('disposed', 'disposed'))
    if (active) return Promise.resolve(view('blocked', 'session-busy'))
    epoch.refusal = view('stopped', 'wait-stopped'); epoch = { refusal: null }
    let resolve, payload = null
    const pending = new Promise(done => { resolve = done })
    const task = { resolve, epoch, finished: false, timerReady: false, deadline: 0 }
    active = task; current = view('pending', 'checking') // Before any reflection.
    // Recheck in the consumer-facing microtask too: settlement and adoption
    // are separate moments. A→B→A never revives an earlier epoch.
    const result = pending.then(value => task.epoch.refusal || value)
    try {
      const start = now()
      if (!Number.isFinite(start)) throw new TypeError('Invalid preview clock')
      task.deadline = start + timeoutMs
      let encoded = encodeS3PreviewRequest(input)
      if (expired(task)) { release(task); return result }
      if (!encoded) { release(task, view('failed', 'invalid-input')); return result }
      const maxItems = encoded.maxItems
      payload = JSON.parse(encoded.body); encoded = null
      const bridge = getBridge()
      const d = bridge && Object.getOwnPropertyDescriptor(bridge, 's3PreviewRead')
      if (expired(task)) { release(task); return result }
      if (!d || !own(d, 'value') || typeof d.value !== 'function') { release(task, view('failed', 'native-unavailable')); return result }
      task.timer = schedule(() => finish(task, view('stopped', 'wait-timeout')), Math.max(1, task.deadline - now()))
      task.timerReady = true
      if (expired(task)) { clear(task); release(task); return result }
      const native = d.value.call(bridge, payload)
      Promise.resolve(native).then(raw => {
        try {
          if (task.finished || expired(task)) { release(task); return }
          const next = replyView(raw, maxItems)
          if (!expired(task)) finish(task, next)
          release(task)
        } catch { release(task, view('failed', 'native-unavailable')) }
      }, () => release(task, view('failed', 'native-unavailable')))
    } catch { release(task, view('failed', 'native-unavailable')) }
    finally { payload = null }
    return result
  }
  return Object.freeze({ read, invalidate, snapshot: () => current,
    dispose: () => { disposed = true; return invalidate() } })
}
