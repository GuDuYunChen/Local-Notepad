import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { selectDesktopMainWindow } from './desktop-window-target.mjs'

const validPID = value => Number.isInteger(value) && value > 0 && value <= 0xffffffff
const failure = code => Object.assign(new Error('Desktop window helper: ' + code), { code })
const MAX_REPLY = 256 * 1024

// One helper per test run, not per lookup/close. No spawnSync, replay, fallback
// HWND or process termination of the application. Startup is outside editing.
// Injection below is solely for protocol/lifecycle tests; production uses spawn.
export function createDesktopWindowSession({
  spawnWorker = spawn, startupMs = 30000, requestMs = 10000,
  onEvent = () => {},
} = {}) {
  if (![startupMs, requestMs].every(n => Number.isInteger(n) && n > 0 && n <= 30000)) {
    throw failure('INVALID_BUDGET')
  }
  const script = readFileSync(new URL('./desktop-window-worker.ps1', import.meta.url), 'utf8')
  let child, state = 'starting', buffer = '', pending = null, sequence = 0, startupTimer
  let resolveReady, rejectReady, resolveExit, disposed = false, disposal
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // Avoid an unhandled rejection if startup fails before the caller awaits it.
  ready.catch(() => {})
  const exited = new Promise(resolve => { resolveExit = resolve })
  const started = Date.now()
  const event = value => { try { onEvent({ ...value, elapsedMs: Date.now() - started }) } catch {} }
  const fail = code => {
    if (state === 'failed' || state === 'closed') return
    state = 'failed'; clearTimeout(startupTimer)
    const error = failure(code)
    rejectReady(error)
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null }
    event({ type: 'failed', code })
    // Terminate only the owned helper. Never retry a potentially posted close.
    try { child?.kill() } catch {}
  }
  const receive = line => {
    let message
    try { message = JSON.parse(line) } catch { fail('INVALID_REPLY'); return }
    if (state === 'starting') {
      if (message?.protocol !== 1 || message.ready !== true) { fail('INVALID_READY'); return }
      state = 'ready'; clearTimeout(startupTimer)
      event({ type: 'ready', pid: child.pid }); resolveReady(); return
    }
    if (state !== 'ready') return
    if (!pending || message?.id !== pending.id || message.ok !== true) { fail('UNCONFIRMED_REPLY'); return }
    const request = pending
    // Inspect responses cannot carry an unrelated close acknowledgement.
    if (request.op === 'inspect') {
      const rows = Array.isArray(message.windows?.[0]) && message.windows.length === 1
        ? message.windows[0] : message.windows
      message.windows = rows
      if (!Array.isArray(rows) || rows.length > 128 || rows.some(w => !w ||
        w.pid !== request.pid || !Number.isSafeInteger(w.handle) || w.handle <= 0 ||
        typeof w.title !== 'string' || typeof w.cls !== 'string' ||
        typeof w.visible !== 'boolean' || !Array.isArray(w.childText) ||
        w.childText.length > 512 || w.childText.some(t => typeof t !== 'string'))) {
        fail('INVALID_WINDOWS'); return
      }
    } else if (message.posted !== true) { fail('CLOSE_NOT_CONFIRMED'); return }
    pending = null; clearTimeout(request.timer)
    event({ type: request.op, id: request.id, pid: request.pid, completed: true })
    request.resolve(request.op === 'inspect' ? message.windows : true)
  }
  try {
    child = spawnWorker('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    event({ type: 'spawn', pid: child.pid })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (state === 'failed' || state === 'closed') return
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > MAX_REPLY) { fail('REPLY_LIMIT'); return }
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '').replace(/^\uFEFF/, '')
        buffer = buffer.slice(index + 1)
        if (line) receive(line)
      }
    })
    // Drain stderr to avoid pipe deadlock; never dump an encoded command/stack.
    child.stderr.on('data', () => {})
    child.stdin.on('error', () => { if (!disposed) fail('PIPE_ERROR') })
    child.on('error', () => { fail('SPAWN_ERROR'); resolveExit({ code: null, signal: null }) })
    child.on('exit', (code, signal) => {
      resolveExit({ code, signal })
      if (!disposed) fail('EARLY_EXIT')
    })
    startupTimer = setTimeout(() => fail('STARTUP_TIMEOUT'), startupMs)
  } catch { fail('SPAWN_ERROR'); resolveExit({ code: null, signal: null }) }

  async function request(op, payload) {
    if (!validPID(payload.pid)) throw failure('INVALID_PID')
    if (disposed) throw failure('DISPOSED')
    await ready
    if (state !== 'ready' || disposed) throw failure('SESSION_UNAVAILABLE')
    if (pending) throw failure('REQUEST_IN_PROGRESS')
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail('REQUEST_TIMEOUT'), requestMs)
      pending = { id, op, pid: payload.pid, timer, resolve, reject }
      try {
        child.stdin.write(JSON.stringify({ id, op, ...payload }) + '\n', error => {
          if (error && pending?.id === id) fail('PIPE_ERROR')
        })
      } catch { fail('PIPE_ERROR') }
    })
  }
  return Object.freeze({
    ready,
    inspect(pid) { return request('inspect', { pid }) },
    close(window) {
      // Preserve the existing strict main-window selector before sending.
      selectDesktopMainWindow([window], window?.pid, window?.title)
      return request('close', { pid: window.pid, handle: window.handle, title: window.title })
    },
    dispose() {
      if (disposal) return disposal
      disposed = true
      clearTimeout(startupTimer); rejectReady(failure('DISPOSED'))
      if (pending) {
        clearTimeout(pending.timer); pending.reject(failure('DISPOSED')); pending = null
      }
      disposal = (async () => {
        try { child?.stdin.end() } catch {}
        let timer
        const end = await Promise.race([exited, new Promise(resolve => {
          timer = setTimeout(() => { try { child?.kill() } catch {} ; resolve(null) }, 3000)
        })])
        clearTimeout(timer); state = 'closed'
        const clean = end?.code === 0 && end?.signal === null
        event({ type: 'disposed', clean })
        return clean
      })()
      return disposal
    },
  })
}
