import { createS3PreviewSession, S3_PREVIEW_LIMITATION } from './s3PreviewSession.mjs'

// Fixed refusals never include input, a native reply, or the previous summary.
const refusal = (state, code, message) => Object.freeze({
  state, code, serviceStatus: 0, summary: null, message, limitation: S3_PREVIEW_LIMITATION,
})
export const S3_PREVIEW_DISCONNECTED = refusal('disposed', 'disposed', '预览上下文已关闭；未发起新的读取。')
export const S3_PREVIEW_STALE_INPUT = refusal('stopped', 'stale-input', '预览上下文已变化；请在当前界面明确重新预览。')
const STALE_RESULT = refusal('stopped', 'wait-stopped', '本次预览结果已失效；不代表原生读取已取消或结束。')
const BUSY = refusal('blocked', 'session-busy', '上一次预览尚未返回；本次未发起新的调用。')

// A payload-free observable adapter, not a second transport or result validator.
// Each connect lease owns a fresh session. React setup/cleanup replay is offline.
// Trusted local options have exactly the original session's meaning.
export function createS3PreviewBinding(options) {
  let current = null
  let snapshot = createS3PreviewSession(options).snapshot()
  const listeners = new Set()
  function publish(next) {
    if (next === snapshot) return
    snapshot = next
    for (const notify of [...listeners]) {
      if (!listeners.has(notify)) continue
      try { notify() } catch { /* A broken observer cannot reject another reader. */ }
    }
  }
  function connect() {
    if (current) throw new TypeError('S3 preview binding is already connected')
    const owner = { session: createS3PreviewSession(options), closed: null,
      epoch: { refusal: null }, latest: null, waiting: null }
    current = owner
    publish(owner.session.snapshot())
    return () => {
      if (current !== owner) return
      // Revoke authority before session cleanup or an observer can reenter.
      owner.closed = S3_PREVIEW_DISCONNECTED
      current = null
      const closed = owner.session.dispose()
      if (!current) publish(closed)
    }
  }
  function adopt(owner, task, value) {
    if (owner.closed) return owner.closed
    if (task.epoch.refusal) return task.epoch.refusal
    if (current !== owner || owner.latest !== task) return STALE_RESULT
    return value
  }
  function read(input) {
    const owner = current
    if (!owner) return Promise.resolve(S3_PREVIEW_DISCONNECTED)
    // Reserve before the session reflects input. Busy calls do not displace a
    // pending view or revoke the result of the operation already in flight.
    if (owner.waiting) return Promise.resolve(BUSY)
    const task = { epoch: owner.epoch }
    owner.waiting = task
    owner.latest = task
    const pending = owner.session.read(input)
    const settled = pending.then(value => {
      if (owner.waiting === task) owner.waiting = null
      if (current === owner && !owner.closed && !task.epoch.refusal && owner.latest === task) {
        publish(owner.session.snapshot())
      }
      // Observers may invalidate, disconnect, or explicitly start another read.
      return adopt(owner, task, value)
    })
    if (current === owner && !owner.closed && !task.epoch.refusal && owner.latest === task) {
      publish(owner.session.snapshot())
    }
    // Notification and caller adoption are different microtasks. Check again.
    return settled.then(value => adopt(owner, task, value))
  }
  function invalidate() {
    const owner = current
    if (!owner) return snapshot
    owner.epoch.refusal = STALE_RESULT
    owner.epoch = { refusal: null }
    const next = owner.session.invalidate()
    if (current === owner && !owner.closed) publish(next)
    return snapshot
  }
  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Invalid S3 preview observer')
    const notify = () => listener() // No payload or stale captured view.
    listeners.add(notify)
    return () => { listeners.delete(notify) }
  }
  return Object.freeze({ connect, read, invalidate, subscribe, snapshot: () => snapshot })
}
