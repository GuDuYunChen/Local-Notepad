import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { desktopWindowWorkerArguments } from './desktop-window-session.mjs'

const failure = code => Object.assign(new Error('Local export native directory: ' + code), { code })
const integer = value => Number.isSafeInteger(value) && value > 0
const normalized = value => path.win32.normalize(value).toLowerCase()
const startupStages = new Set(['CONSOLE_ENCODING', 'ASSEMBLY_LOAD', 'SOURCE_COMPILATION', 'UIA_READINESS'])
const startupErrorTypes = new Set(['UNKNOWN', 'System.Exception', 'System.InvalidOperationException',
  'System.ArgumentException', 'System.TypeLoadException', 'System.TypeInitializationException',
  'System.IO.FileNotFoundException', 'System.IO.FileLoadException', 'System.BadImageFormatException',
  'System.Security.SecurityException', 'System.NotSupportedException', 'System.PlatformNotSupportedException',
  'System.Reflection.ReflectionTypeLoadException', 'System.Management.Automation.RuntimeException',
  'System.Management.Automation.PSInvalidOperationException', 'System.Management.Automation.MethodInvocationException',
  'System.Management.Automation.CmdletInvocationException', 'System.Management.Automation.ParseException'])
const startupReferences = new Set(['System.dll', 'System.Core.dll', 'UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll'])
function startupDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = ['stage', 'errorType', 'hresult', 'compilerCodes', 'powerShellVersion', 'references']
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) return null
  if (!startupStages.has(value.stage) || !startupErrorTypes.has(value.errorType)) return null
  if (value.hresult !== null && (!Number.isInteger(value.hresult) || value.hresult < -2147483648 || value.hresult > 2147483647)) return null
  if (value.powerShellVersion !== null && (typeof value.powerShellVersion !== 'string'
    || !/^\d{1,5}\.\d{1,5}(?:\.\d{1,5}){0,2}$/.test(value.powerShellVersion))) return null
  if (!Array.isArray(value.compilerCodes) || value.compilerCodes.length > 8
    || !value.compilerCodes.every(code => typeof code === 'string' && /^CS\d{4}$/.test(code))
    || new Set(value.compilerCodes).size !== value.compilerCodes.length) return null
  if (!Array.isArray(value.references) || value.references.length > 5
    || !value.references.every(name => startupReferences.has(name))
    || new Set(value.references).size !== value.references.length) return null
  return { stage: value.stage, errorType: value.errorType, hresult: value.hresult,
    compilerCodes: [...value.compilerCodes], powerShellVersion: value.powerShellVersion, references: [...value.references] }
}
export function assertExportDirectoryBinding(value) {
  assert.ok(value && integer(value.pid) && value.pid <= 0xffffffff)
  assert.ok(integer(value.mainHandle))
  assert.ok(typeof value.executable === 'string' && path.win32.isAbsolute(value.executable))
  return true
}
export function assertExportOwnedDirectory(root, directory) {
  assert.ok(typeof root === 'string' && path.win32.isAbsolute(root))
  assert.ok(typeof directory === 'string' && path.win32.isAbsolute(directory) && directory.length <= 1024)
  const relative = path.win32.relative(root, directory)
  assert.ok(relative && relative !== '..' && !relative.startsWith('..\\') && !path.win32.isAbsolute(relative),
    'The selected destination must be strictly inside this test run')
  return true
}
export function validateExportDirectoryObservation(dialog, binding) {
  assertExportDirectoryBinding(binding)
  assert.ok(dialog && integer(dialog.handle))
  assert.equal(dialog.pid, binding.pid); assert.equal(dialog.title, '选择文档导出目录')
  assert.equal(dialog.cls, '#32770'); assert.equal(dialog.visible, true)
  assert.equal(normalized(dialog.image), normalized(binding.executable))
  assert.ok(Array.isArray(dialog.ownerChain) && dialog.ownerChain.length > 0 && dialog.ownerChain.length <= 16)
  assert.equal(new Set(dialog.ownerChain).size, dialog.ownerChain.length)
  assert.ok(dialog.ownerChain.every(integer)); assert.equal(dialog.owner, dialog.ownerChain[0])
  assert.equal(dialog.ownerChain.at(-1), binding.mainHandle)
  assert.notEqual(dialog.handle, binding.mainHandle)
  return true
}
export function validateExportDirectoryResult(result, binding, operation, directory) {
  validateExportDirectoryObservation(result?.dialog, binding)
  assert.equal(result.action, operation); assert.equal(result.dialogClosed, true)
  assert.ok(Array.isArray(result.controls) && result.controls.length <= 128)
  if (operation === 'choose') {
    assert.equal(normalized(result.selectedPath), normalized(directory))
    assert.equal(result.valueWrites, 1); assert.equal(result.invocations, 1); assert.equal(result.closePosts, 0)
    assert.ok(['Folder:', '文件夹:', '文件夹：'].includes(result.inputName))
    assert.equal(result.buttonName, '选择此目录')
    assert.equal(typeof result.inputID, 'string')
  } else {
    assert.equal(operation, 'cancel'); assert.equal(result.valueWrites, 0)
    assert.equal(result.invocations, 0); assert.equal(result.closePosts, 1)
    assert.equal(result.selectedPath, null)
  }
  return true
}

// One prewarmed MTA helper per isolated run. Its pipe/error/timeout handling
// retains listeners through disposal; an uncertain native operation is never
// replayed and only this owned helper may be terminated.
export function createExportDirectorySession({ ownedRoot, spawnWorker = spawn,
  startupMs = 30000, requestMs = 10000, onEvent = () => {} } = {}) {
  assert.ok(typeof ownedRoot === 'string' && path.win32.isAbsolute(ownedRoot))
  assert.ok([startupMs, requestMs].every(value => integer(value) && value <= 30000))
  const args = desktopWindowWorkerArguments(readFileSync(new URL('./local-export-directory-worker.ps1', import.meta.url)))
  args.splice(1, 0, '-Mta')
  assert.ok(['powershell.exe', ...args].map(value => '"' + value + '"').join(' ').length + 1 < 32767)
  let child, state = 'starting', pending, sequence = 0, buffer = '', disposed = false, streamFailed = false
  let resolveReady, rejectReady, resolveExit, startupTimer, disposal
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  ready.catch(() => {})
  const exited = new Promise(resolve => { resolveExit = resolve })
  const events = [], started = Date.now()
  const event = record => {
    const value = { ...record, elapsedMs: Date.now() - started }; events.push(structuredClone(value))
    try { onEvent(structuredClone(value)) } catch {}
  }
  const fail = (code, detail = {}) => {
    if (state === 'failed' || state === 'closed') return
    state = 'failed'; clearTimeout(startupTimer); const error = failure(code)
    rejectReady(error)
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined }
    event({ type: 'failed', code, ...detail }); try { child?.kill() } catch {}
  }
  const pipeError = () => {
    if (state === 'closed') return
    streamFailed = true; if (!disposed) fail('PIPE_ERROR')
  }
  const receive = line => {
    let value
    try { value = JSON.parse(line) } catch { fail('INVALID_REPLY'); return }
    if (state === 'starting') {
      if (value?.protocol !== 1 || value.ready !== true) {
        const diagnostic = value?.protocol === 1 && value.ready === false && value.error === 'DIRECTORY_HELPER_STARTUP'
          ? startupDiagnostic(value.diagnostic) : null
        fail('STARTUP_REFUSED', { startupDiagnostic: diagnostic }); return
      }
      state = 'ready'; clearTimeout(startupTimer); event({ type: 'ready', pid: child.pid }); resolveReady(); return
    }
    if (state !== 'ready' || disposed) return
    if (!pending || value?.id !== pending.id || value.ok !== true) {
      fail('UNCONFIRMED_REPLY', { reason: typeof value?.error === 'string' && /^[A-Z_]{1,80}$/.test(value.error) ? value.error : null,
        nativeObservation: value?.observation ?? null }); return
    }
    const request = pending
    try {
      if (request.op === 'minimum-window') {
        assert.equal(value.result?.handle, request.binding.mainHandle); assert.equal(value.result?.pid, request.binding.pid)
        assert.equal(value.result?.width, 720); assert.equal(value.result?.height, 520); assert.equal(value.result?.applied, true)
      } else if (request.op === 'inspect') {
        if (value.dialog !== null) validateExportDirectoryObservation(value.dialog, request.binding)
      } else validateExportDirectoryResult(value.result, request.binding, request.op, request.directory)
    } catch { fail('IDENTITY_OR_ACTION_MISMATCH'); return }
    pending = undefined; clearTimeout(request.timer)
    const result = request.op === 'inspect' ? value.dialog : value.result
    event({ type: request.op, id: request.id, pid: request.binding.pid, completed: true, result })
    request.resolve(result)
  }
  try {
    child = spawnWorker('powershell.exe', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    event({ type: 'spawn', pid: child.pid })
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', pipeError)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (disposed || state === 'failed' || state === 'closed') return
      buffer += chunk
      if (Buffer.byteLength(buffer) > 256 * 1024) { fail('REPLY_LIMIT'); return }
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '').replace(/^\uFEFF/, '')
        buffer = buffer.slice(index + 1); if (line) receive(line)
      }
    })
    child.stderr.on('data', () => {})
    child.on('error', () => { fail('SPAWN_ERROR'); resolveExit({ code: null, signal: null }) })
    child.on('exit', (code, signal) => { resolveExit({ code, signal }); if (!disposed) fail('EARLY_EXIT') })
    startupTimer = setTimeout(() => fail('STARTUP_TIMEOUT'), startupMs)
  } catch { fail('SPAWN_ERROR'); resolveExit({ code: null, signal: null }) }
  const request = async (op, binding, directory) => {
    assertExportDirectoryBinding(binding)
    if (op === 'choose') assertExportOwnedDirectory(ownedRoot, directory)
    if (disposed) throw failure('DISPOSED')
    await ready
    if (state !== 'ready' || disposed) throw failure('UNAVAILABLE')
    if (pending) throw failure('REQUEST_IN_PROGRESS')
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail('REQUEST_TIMEOUT'), requestMs)
      pending = { id, op, binding: structuredClone(binding), directory, timer, resolve, reject }
      try {
        child.stdin.write(JSON.stringify({ id, op, ...binding, ...(directory ? { directory } : {}) }) + '\n', error => {
          if (error && pending?.id === id) fail('PIPE_ERROR')
        })
      } catch { fail('PIPE_ERROR') }
    })
  }
  return Object.freeze({ ready,
    minimumWindow: binding => request('minimum-window', binding),
    inspect: binding => request('inspect', binding),
    choose: (binding, directory) => request('choose', binding, directory),
    cancel: binding => request('cancel', binding),
    events: () => structuredClone(events),
    dispose() {
      if (disposal) return disposal
      disposed = true; clearTimeout(startupTimer)
      if (pending) { clearTimeout(pending.timer); pending.reject(failure('DISPOSED')); pending = undefined }
      rejectReady(failure('DISPOSED'))
      disposal = (async () => {
        let timeout
        try {
          try { child?.stdin.end() } catch { streamFailed = true }
          const result = await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(() => resolve(null), 2000) })])
          if (result === null) { try { child?.kill() } catch {}; event({ type: 'dispose', clean: false }); state = 'closed'; return false }
          const clean = state !== 'failed' && !streamFailed && result.code === 0 && result.signal === null
          state = 'closed'; event({ type: 'dispose', clean }); return clean
        } finally { clearTimeout(timeout) }
      })()
      return disposal
    },
  })
}
