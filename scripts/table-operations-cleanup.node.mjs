import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { closeTableOperationsApp } from './run-table-operations-desktop.mjs'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function app({ failed = false } = {}) {
  const child = new EventEmitter(), calls = [], waits = []
  Object.assign(child, { pid: 412, exitCode: null, signalCode: null })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  let exitCount = 0
  const emitExit = (code = 0, signal = null) => {
    assert.equal(exitCount++, 0, 'The owned process exits only once')
    child.exitCode = code; child.signalCode = signal
    calls.push({ type: 'exit', code, signal })
    child.emit('exit', code, signal)
  }
  const executable = 'C:\\owned-table-cleanup\\Local-Notepad.exe'
  const report = { pid: child.pid, executable, complete: !failed, cleanupComplete: false,
    forceTerminated: false, realBackend: true, nativeInputs: [] }
  if (failed) report.error = 'Original Table business assertion failed'
  const boundWindow = { pid: child.pid, handle: 900, title: 'Local Notepad', cls: 'Chrome_WidgetWin_1',
    visible: true, childText: ['Chrome Legacy Window'], image: executable }
  const context = {
    report, child, exited, boundWindow, failed,
    cdp: { async send(method, params, budget) { calls.push({ type: 'input', method, params, budget }); return {} } },
    windowSession: { async close(window) {
      assert.equal(window, boundWindow, 'Close uses the already verified native window')
      calls.push({ type: 'close' }); queueMicrotask(() => emitExit()); return true
    } },
  }
  const dependencies = {
    async wait(promise, label, budget) { waits.push({ label, budget }); return promise },
    async backendStopped() {
      assert.equal(exitCount, 1, 'Backend cleanup cannot be asserted before the process exit event')
      calls.push({ type: 'backend' }); return true
    },
    forceKill(pid) {
      assert.equal(pid, child.pid, 'Only the owned child may be terminated')
      calls.push({ type: 'force', pid }); emitExit(null, 'SIGKILL'); return { status: 0, signal: null }
    },
  }
  return { context, dependencies, report, child, calls, waits, emitExit, get exitCount() { return exitCount } }
}

test('confirmed WM_CLOSE waits for an actual child exit and backend stop before reporting graceful cleanup', async () => {
  const f = app(), close = deferred(), backend = deferred()
  f.context.windowSession.close = async window => {
    assert.equal(window, f.context.boundWindow); f.calls.push({ type: 'close' }); return close.promise
  }
  f.dependencies.backendStopped = async () => {
    assert.equal(f.exitCount, 1); f.calls.push({ type: 'backend' }); return backend.promise
  }
  let finished = false
  const result = closeTableOperationsApp(f.context, f.dependencies).then(value => { finished = true; return value })
  await nextTurn()
  assert.equal(f.report.cleanup.closeRequested, true)
  close.resolve(true)
  await nextTurn()
  assert.equal(f.report.cleanup.closeConfirmed, true)
  assert.equal(f.exitCount, 0)
  assert.equal(f.report.exit, undefined, 'A fulfilled close request is not an observed process exit')
  assert.equal(f.report.backendStopped, undefined)
  assert.equal(finished, false)
  f.emitExit(0, null)
  await nextTurn()
  assert.equal(finished, false, 'A successful process exit still requires the backend check')
  assert.equal(f.report.backendStopped, undefined)
  backend.resolve(true)
  assert.equal(await result, true)
  assert.deepEqual(f.report.exit, { pid: 412, code: 0, signal: null, normalClose: true })
  assert.equal(f.report.backendStopped, true)
  assert.equal(f.report.forceTerminated, false)
  assert.equal(f.report.complete, true)
  assert.equal(f.report.cleanupComplete, false, 'The runner still owns helper disposal and file cleanup')
  assert.deepEqual(f.calls.map(call => call.type), ['close', 'exit', 'backend'])
  assert.deepEqual(f.waits.map(wait => wait.budget), [15000, 5000])
})

test('failed business work releases held native input before close without changing its error or acceptance result', async () => {
  const f = app({ failed: true })
  f.report.nativeInputs = [
    { sequence: 1, method: 'Input.dispatchKeyEvent', type: 'rawKeyDown', key: 'Control', windowsVirtualKeyCode: 17, modifiers: 2 },
    { sequence: 2, method: 'Input.dispatchMouseEvent', type: 'mousePressed', x: 47, y: 53, button: 'left', buttons: 1, clickCount: 1 },
  ]
  const inputs = structuredClone(f.report.nativeInputs), originalError = f.report.error
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), true)
  assert.equal(f.exitCount, 1)
  assert.equal(f.report.complete, false)
  assert.equal(f.report.error, originalError)
  assert.equal(f.report.cleanupComplete, false)
  assert.deepEqual(f.report.nativeInputs, inputs, 'Cleanup receipts do not rewrite business input evidence')
  const released = f.calls.filter(call => call.type === 'input')
  assert.deepEqual(released.slice(0, 2).map(call => [call.method, call.params.type, call.params.key]), [
    ['Input.dispatchKeyEvent', 'rawKeyDown', 'Escape'], ['Input.dispatchKeyEvent', 'keyUp', 'Escape'],
  ])
  assert.ok(released.some(call => call.method === 'Input.dispatchKeyEvent' && call.params.type === 'keyUp' && call.params.key === 'Control'))
  assert.ok(released.some(call => call.method === 'Input.dispatchMouseEvent' && call.params.type === 'mouseReleased' &&
    call.params.button === 'left' && call.params.buttons === 0 && call.params.x === 47 && call.params.y === 53))
  assert.deepEqual(released.slice(-2).map(call => [call.method, call.params]), [
    ['Input.setInterceptDrags', { enabled: false }], ['Network.setBlockedURLs', { urls: [] }],
  ])
  assert.ok(released.every(call => call.budget > 0 && call.budget <= 500))
  assert.ok(f.report.cleanup.inputRelease.every(item => item.confirmed === true))
  assert.equal(f.calls.findIndex(call => call.type === 'close'), released.length)
  assert.deepEqual(f.waits.map(wait => wait.budget), [15000, 5000])
  assert.equal(f.report.forceTerminated, false)
})

test('no child process cannot produce a fabricated normal-close or backend receipt', async () => {
  const f = app({ failed: true })
  Object.assign(f.context, { child: undefined, exited: undefined, boundWindow: undefined })
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
  assert.equal(f.report.cleanup.started, false)
  assert.equal(f.report.exit, undefined)
  assert.equal(f.report.backendStopped, undefined)
  assert.equal(f.report.forceTerminated, false)
  assert.equal(f.report.complete, false)
  assert.equal(f.exitCount, 0)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.waits, [])
})

test('no verified native binding never posts close and forced exit cannot become normal close', async () => {
  const f = app({ failed: true })
  f.context.boundWindow = undefined
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
  assert.equal(f.report.cleanup.closeRequested, false)
  assert.equal(f.report.cleanup.closeConfirmed, false)
  assert.equal(f.report.cleanup.exitObserved, true)
  assert.equal(f.exitCount, 1)
  assert.equal(f.report.forceTerminated, true)
  assert.deepEqual(f.report.exit, { pid: 412, code: null, signal: 'SIGKILL', normalClose: false })
  assert.equal(f.calls.some(call => call.type === 'close'), false)
  assert.deepEqual(f.calls.filter(call => call.type === 'force'), [{ type: 'force', pid: 412 }])
  assert.equal(f.report.error, 'Original Table business assertion failed')
})

test('the unchanged 15-second native-close deadline forces only the owned process and records its actual forced exit', async () => {
  const f = app({ failed: true }), close = deferred()
  f.context.cdp = undefined
  f.context.windowSession.close = async () => { f.calls.push({ type: 'close' }); return close.promise }
  f.dependencies.wait = async (promise, label, budget) => {
    f.waits.push({ label, budget })
    if (budget === 15000) { void promise.catch(() => {}); throw new Error('Synthetic native close deadline') }
    return promise
  }
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
  assert.equal(f.report.cleanup.closeRequested, true)
  assert.equal(f.report.cleanup.closeConfirmed, false)
  assert.equal(f.report.cleanup.exitObserved, true)
  assert.equal(f.exitCount, 1)
  assert.equal(f.report.forceTerminated, true)
  assert.equal(f.report.exit.normalClose, false)
  assert.equal(f.report.complete, false)
  assert.match(f.report.cleanupError, /Synthetic native close deadline/)
  assert.deepEqual(f.waits.map(wait => wait.budget), [15000, 3000, 5000])
  close.resolve(true)
  await nextTurn()
  assert.equal(f.report.exit.normalClose, false, 'A late close acknowledgement cannot relabel a forced exit')
  assert.equal(f.calls.filter(call => call.type === 'force').length, 1)
})

for (const [code, signal] of [[7, null], [null, 'SIGTERM']]) {
  test(`observed abnormal exit code=${code} signal=${signal} is never reported as normal close`, async () => {
    const f = app({ failed: true })
    f.context.cdp = undefined
    f.context.windowSession.close = async () => { f.calls.push({ type: 'close' }); queueMicrotask(() => f.emitExit(code, signal)); return true }
    assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
    assert.equal(f.exitCount, 1)
    assert.deepEqual(f.report.exit, { pid: 412, code, signal, normalClose: false })
    assert.equal(f.report.cleanup.exitObserved, true)
    assert.equal(f.report.backendStopped, true)
    assert.equal(f.report.forceTerminated, false, 'An already exited process must not be killed again')
    assert.equal(f.calls.some(call => call.type === 'force'), false)
    assert.match(f.report.cleanupError, /did not exit normally/)
    assert.equal(f.report.error, 'Original Table business assertion failed')
    assert.equal(f.report.complete, false)
  })
}

test('a clean application exit does not assert that an unconfirmed backend stopped', async () => {
  const f = app({ failed: true })
  f.context.cdp = undefined
  f.dependencies.backendStopped = async () => { assert.equal(f.exitCount, 1); f.calls.push({ type: 'backend' }); return false }
  assert.equal(await closeTableOperationsApp(f.context, f.dependencies), false)
  assert.equal(f.exitCount, 1)
  assert.equal(f.report.exit.normalClose, true)
  assert.equal(f.report.cleanup.backendChecked, true)
  assert.equal(f.report.backendStopped, undefined)
  assert.equal(f.report.forceTerminated, false)
  assert.ok(f.report.cleanupError)
  assert.deepEqual(f.waits.map(wait => wait.budget), [15000, 5000])
  assert.equal(f.report.error, 'Original Table business assertion failed')
  assert.equal(f.report.complete, false)
})
