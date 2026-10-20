import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import assert from 'node:assert/strict'
import { selectDesktopMainWindow, selectDesktopUnappliedDialog } from './desktop-window-target.mjs'

const validPID = value => Number.isInteger(value) && value > 0 && value <= 0xffffffff
const failure = code => Object.assign(new Error('Desktop window helper: ' + code), { code })
const MAX_REPLY = 256 * 1024

// Keep the single prewarmed helper below CreateProcessW's UTF-16 command limit.
// The payload is the exact UTF-8 worker bytes; PowerShell's default file encoding
// is never involved. No policy change, temporary script or second process.
export function desktopWindowWorkerArguments(source) {
  if (!Buffer.isBuffer(source) || source.length === 0 || !Buffer.from(source.toString('utf8'), 'utf8').equals(source)) {
    throw failure('INVALID_WORKER_UTF8')
  }
  const payload = gzipSync(source, { level: 9 }).toString('base64')
  const bootstrap = "$ErrorActionPreference='Stop';" +
    "$desktopPayload=[Convert]::FromBase64String('" + payload + "');" +
    '$desktopStream=[IO.MemoryStream]::new($desktopPayload);' +
    '$desktopZip=[IO.Compression.GZipStream]::new($desktopStream,[IO.Compression.CompressionMode]::Decompress);' +
    '$desktopReader=[IO.StreamReader]::new($desktopZip,[Text.UTF8Encoding]::new($false,$true),$false);' +
    'try{$desktopSource=$desktopReader.ReadToEnd()}finally{$desktopReader.Dispose()};' +
    '&([ScriptBlock]::Create($desktopSource))'
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')]
  // All five values have a fixed alphabet without quotes or whitespace. Quoting
  // every value is a conservative bound, including the terminating Unicode NUL.
  const commandLine = ['powershell.exe', ...args].map(value => '"' + value + '"').join(' ') + '\0'
  if (commandLine.length >= 32767) throw failure('WORKER_COMMAND_LIMIT')
  return args
}

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
  const workerArguments = desktopWindowWorkerArguments(readFileSync(new URL('./desktop-window-worker.ps1', import.meta.url)))
  let child, state = 'starting', buffer = '', pending = null, sequence = 0, startupTimer
  let resolveReady, rejectReady, resolveExit, disposed = false, disposal, streamFailed = false
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // Avoid an unhandled rejection if startup fails before the caller awaits it.
  ready.catch(() => {})
  const exited = new Promise(resolve => { resolveExit = resolve })
  const started = Date.now()
  const journal = []
  const event = value => {
    const entry = structuredClone({ ...value, elapsedMs: Date.now() - started })
    journal.push(entry)
    try { onEvent(structuredClone(entry)) } catch {}
  }
  const fail = (code, details = {}) => {
    if (state === 'failed' || state === 'closed') return
    state = 'failed'; clearTimeout(startupTimer)
    const error = failure(code)
    rejectReady(error)
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null }
    event({ type: 'failed', code, ...details })
    // Terminate only the owned helper. Never retry a potentially posted close.
    try { child?.kill() } catch {}
  }
  // Pipe errors are EventEmitter errors, not promise rejections. Keep listeners
  // attached through teardown so a late error cannot terminate the test runner.
  const pipeError = () => {
    if (state === 'closed') return
    streamFailed = true
    if (!disposed) fail('PIPE_ERROR')
  }
  const receive = line => {
    let message
    try { message = JSON.parse(line) } catch { fail('INVALID_REPLY'); return }
    if (state === 'starting') {
      if (message?.protocol === 1 && message.ready === false &&
        ['UIA_ASSEMBLY_UNAVAILABLE', 'UIA_PREWARM_FAILED'].includes(message.error)) {
        fail(message.error, { diagnostic: message.diagnostic }); return
      }
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
        typeof w.visible !== 'boolean' || (w.image !== undefined && typeof w.image !== 'string') || !Array.isArray(w.childText) ||
        w.childText.length > 512 || w.childText.some(t => typeof t !== 'string'))) {
        fail('INVALID_WINDOWS'); return
      }
    } else if (message.posted !== true) {
      fail(request.op === 'dismiss-unapplied' ? 'DISMISS_NOT_CONFIRMED' : 'CLOSE_NOT_CONFIRMED',
        request.op === 'dismiss-unapplied' ? { nativeWindow: message.window ?? null, nativeWindows: message.windows ?? null, reason: message.reason ?? null } : {})
      return
    }
    if (request.op === 'dismiss-unapplied') {
      try {
        const fresh = selectDesktopUnappliedDialog(message.windows, request.pid, request.executablePath)
        assert.deepEqual(message.window, fresh)
        if (fresh.handle !== request.handle) throw failure('DISMISS_TARGET_CHANGED')
      } catch {
        fail('INVALID_DISMISS_OBSERVATION', { nativeWindow: message.window ?? null, nativeWindows: message.windows ?? null }); return
      }
    }
    pending = null; clearTimeout(request.timer)
    event({ type: request.op, id: request.id, pid: request.pid, completed: true,
      ...(request.op === 'dismiss-unapplied' ? { window: message.window, windows: message.windows } : {}) })
    request.resolve(request.op === 'inspect' ? message.windows : true)
  }
  try {
    child = spawnWorker('powershell.exe', workerArguments, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    event({ type: 'spawn', pid: child.pid })
    child.stdin.on('error', pipeError)
    child.stdout.on('error', pipeError)
    child.stderr.on('error', pipeError)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (disposed || state === 'failed' || state === 'closed') return
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
      pending = { id, op, ...payload, timer, resolve, reject }
      try {
        child.stdin.write(JSON.stringify({ id, op, ...payload }) + '\n', error => {
          if (error && pending?.id === id) fail('PIPE_ERROR')
        })
      } catch { fail('PIPE_ERROR') }
    })
  }
  return Object.freeze({
    ready,
    events() { return structuredClone(journal) },
    inspect(pid, executablePath) {
      if (executablePath !== undefined && (typeof executablePath !== 'string' || !path.win32.isAbsolute(executablePath))) throw failure('INVALID_IMAGE')
      return request('inspect', { pid, ...(executablePath === undefined ? {} : { executablePath }) })
    },
    close(window) {
      // Preserve the existing strict main-window selector before sending.
      selectDesktopMainWindow([window], window?.pid, window?.title)
      return request('close', { pid: window.pid, handle: window.handle, title: window.title })
    },
    dismissUnappliedDialog(window, executablePath) {
      selectDesktopUnappliedDialog([window], window?.pid, executablePath)
      return request('dismiss-unapplied', { pid: window.pid, handle: window.handle, executablePath })
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
        const clean = !streamFailed && end?.code === 0 && end?.signal === null
        event({ type: 'disposed', clean })
        return clean
      })()
      return disposal
    },
  })
}
