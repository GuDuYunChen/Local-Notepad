// Renderer-only, explicitly invoked adapter. No HTTP fallback, persistence or
// sync-provider registration. Main/Go remain the authority for outbound I/O.
export const S3_PROBE_WAIT_MS = 10_000
export const S3_PROBE_LIMITATION = '仅代表这一次指定对象的只读检查；不验证凭据有效性、列举或写入权限，不表示同步已完成。'
const REQUIRED = ['endpoint', 'bucket', 'region', 'accessKeyId', 'secretAccessKey', 'key', 'maxBytes', 'readOnly']
const OPTIONAL = ['prefix', 'sessionToken']
const NATIVE_CODES = new Set(['invalid-bridge-request', 'native-probe-busy', 'native-probe-cancelled',
  'native-probe-timeout', 'native-probe-unavailable', 'native-probe-invalid-response', 'untrusted-frame'])
const SERVICE_CODES = new Map([
  [400, ['invalid-request', 'invalid-request-target']], [403, ['native-loopback-required']],
  [405, ['method-not-allowed']], [413, ['request-too-large']],
  [415, ['json-required', 'encoded-request-refused']], [429, ['probe-busy']], [503, ['probe-unavailable']],
])
const MESSAGES = Object.freeze({
  'not-checked': '尚未检查。只有明确调用才会读取指定对象。',
  checking: '正在等待本次只读检查。不会上传、删除或启动同步。',
  readable: '本次指定对象已完整读取；结果不包含对象正文。',
  'invalid-input': '检查参数格式或大小不受支持；未调用原生桥。',
  'native-unavailable': '当前环境没有可用的原生只读检查桥；不会改走浏览器网络请求。',
  'invalid-reply': '检查返回格式不符合约定；未采纳其中的数据。',
  'session-busy': '上一次原生调用尚未返回；本次没有再次发起读取。',
  'wait-stopped': '已停止采用本次结果；这不证明原生读取已取消或结束。',
  'wait-timeout': '等待结果超时；原生调用结束前不会再次发起读取，也不会自动重试。',
  disposed: '检查会话已关闭；未发起新的读取。',
  'invalid-config': '本次配置格式被拒绝；未验证连接或权限。',
  'invalid-credentials': '本次凭据格式被拒绝；不是密码正确或错误的验证结论。',
  'invalid-key': '本次对象键格式被拒绝；不会猜测或读取其他对象。',
  'access-denied': '本次读取被拒绝（401/403）；不能据此判断密码错误。',
  'not-found': '本次对象读取返回404；不能据此确认配置或权限正确。',
  'redirect-refused': '本次重定向被拒绝；不会跟随到其他地址。',
  'http-failure': '本次对象读取返回不支持的HTTP状态；不会自动重试。',
  'too-large': '对象超过本次读取限额；未接受部分对象。',
  'body-rejected': '对象正文或编码不符合读取约定；未接受部分对象。',
  'transport-failure': '本次传输未完成；不推断网络、证书或凭据的具体原因。',
  cancelled: '原生端报告本次读取已取消；未采纳部分对象。',
  'deadline-exceeded': '原生端报告本次读取超时；不会自动重试。',
})
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
function record(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return null
  const keys = Reflect.ownKeys(value)
  if (keys.some(k => typeof k !== 'string' || (!required.includes(k) && !optional.includes(k)))) return null
  const copy = Object.create(null)
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key)
    if (!d || !d.enumerable || !own(d, 'value')) return null
    copy[key] = d.value
  }
  return required.every(k => own(copy, k)) ? copy : null
}
function wellFormed(s) {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = s.charCodeAt(++i)
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}
function inputSnapshot(input) {
  try {
    const copy = record(input, REQUIRED, OPTIONAL)
    if (!copy || copy.readOnly !== true || !Number.isSafeInteger(copy.maxBytes) || copy.maxBytes < 1 || copy.maxBytes > 1048576) return null
    for (const key of Object.keys(copy)) {
      if (key === 'maxBytes' || key === 'readOnly') continue
      if (typeof copy[key] !== 'string' || copy[key].length > 65536 || !wellFormed(copy[key])) return null
    }
    return new TextEncoder().encode(JSON.stringify(copy)).length <= 65536 ? copy : null
  } catch { return null }
}
function view(state, code, serviceStatus = 0, summary = null) {
  const message = own(MESSAGES, code) ? MESSAGES[code]
    : '原生只读检查未完成；请核对本机状态，不会自动重试或推断凭据有效。'
  return Object.freeze({ state, code, serviceStatus, summary, message, limitation: S3_PROBE_LIMITATION })
}
function invalidReply() { throw new TypeError('Invalid S3 probe reply') }
function replyView(raw, limit) {
  try {
    const reply = record(raw, ['success', 'status', 'code', 'data'])
    if (!reply || typeof reply.success !== 'boolean' || !Number.isSafeInteger(reply.status) || typeof reply.code !== 'string') invalidReply()
    if (reply.status === 0 && reply.success === false && reply.data === null && NATIVE_CODES.has(reply.code)) return view('failed', reply.code)
    if (!reply.success && reply.data === null && SERVICE_CODES.get(reply.status)?.includes(reply.code)) return view('failed', reply.code, reply.status)
    const data = record(reply.data, ['outcome', 'httpStatus', 'acceptedBytes'])
    if (!data || !Number.isSafeInteger(data.httpStatus) || !Number.isSafeInteger(data.acceptedBytes) || data.acceptedBytes < 0 || data.acceptedBytes > limit) invalidReply()
    const { outcome, httpStatus, acceptedBytes } = data
    if (reply.success) {
      if (reply.status !== 200 || reply.code !== 'OK' || outcome !== 'readable' || httpStatus !== 200) invalidReply()
    } else {
      if (reply.status !== 422 || reply.code !== 'probe-not-readable' || acceptedBytes !== 0) invalidReply()
      const redirects = [301, 302, 303, 307, 308]
      if (outcome === 'access-denied') { if (![401, 403].includes(httpStatus)) invalidReply() }
      else if (outcome === 'not-found') { if (httpStatus !== 404) invalidReply() }
      else if (outcome === 'redirect-refused') { if (!redirects.includes(httpStatus)) invalidReply() }
      else if (outcome === 'http-failure') {
        if (httpStatus < 100 || httpStatus > 599 || [200, 401, 403, 404, ...redirects].includes(httpStatus)) invalidReply()
      } else if (!['invalid-config', 'invalid-credentials', 'invalid-key', 'too-large', 'body-rejected',
        'transport-failure', 'cancelled', 'deadline-exceeded'].includes(outcome) || httpStatus !== 0) invalidReply()
    }
    return view(reply.success ? 'readable' : 'failed', outcome, reply.status, Object.freeze({ outcome, httpStatus, acceptedBytes }))
  } catch { return view('failed', 'invalid-reply') }
}

// invalidate() is for edits, replacement, navigation or unmount in a future
// caller. It drops result adoption, NOT native I/O. An unsettled native Promise
// holds this session's slot even after the renderer stops waiting. No queue.
export function createS3ReadProbeSession({ getBridge = () => globalThis.window?.electronAPI,
  timeoutMs = S3_PROBE_WAIT_MS, schedule = setTimeout, cancel = clearTimeout } = {}) {
  if (typeof getBridge !== 'function' || typeof schedule !== 'function' || typeof cancel !== 'function' ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > S3_PROBE_WAIT_MS) throw new TypeError('Invalid S3 read probe session options')
  let active = null, disposed = false, generation = {}, current = view('idle', 'not-checked')
  const clear = task => {
    if (task.hasTimer) { task.hasTimer = false; try { cancel(task.timer) } catch { /* Never leak native errors. */ } }
  }
  function finish(task, result, publish = true) {
    if (task.finished) return
    task.finished = true; clear(task)
    if (publish && !disposed && task.generation === generation) current = result
    task.resolve(result)
  }
  function release(task, result) {
    if (active === task) active = null
    if (task.finished) return
    finish(task, result, !disposed && task.generation === generation)
  }
  function invalidate() {
    generation = {}
    current = view(disposed ? 'disposed' : active ? 'stopped' : 'idle', disposed ? 'disposed' : active ? 'wait-stopped' : 'not-checked')
    if (active) finish(active, current, false)
    return current
  }
  function read(input) {
    if (disposed) return Promise.resolve(view('disposed', 'disposed'))
    if (active) return Promise.resolve(view('blocked', 'session-busy'))
    let payload = null, resolve
    const promise = new Promise(done => { resolve = done })
    generation = {}
    const task = { resolve, generation, finished: false, hasTimer: false, limit: 0 }
    // Reserve before reflection: even an input Proxy must not reenter read().
    active = task; current = view('pending', 'checking')
    try {
      payload = inputSnapshot(input)
      if (task.finished) { release(task); return promise }
      if (!payload) { release(task, view('failed', 'invalid-input')); return promise }
      task.limit = payload.maxBytes
      const bridge = getBridge(), invoke = bridge?.s3ProbeRead
      if (task.finished) { release(task); return promise }
      if (typeof invoke !== 'function') { release(task, view('failed', 'native-unavailable')); return promise }
      task.timer = schedule(() => finish(task, view('stopped', 'wait-timeout')), timeoutMs)
      task.hasTimer = true
      if (task.finished) { clear(task); release(task); return promise }
      // Copy, then drop our payload reference immediately after this call. No
      // guarantee of secure memory erasure or control over the native clone.
      const native = invoke.call(bridge, payload)
      Promise.resolve(native).then(raw => {
        if (task.finished) release(task)
        else release(task, replyView(raw, task.limit))
      }, () => release(task, view('failed', 'native-unavailable')))
    } catch { release(task, view('failed', 'native-unavailable')) }
    finally { payload = null }
    return promise
  }
  return Object.freeze({ read, invalidate, snapshot: () => current,
    dispose: () => { disposed = true; return invalidate() } })
}
