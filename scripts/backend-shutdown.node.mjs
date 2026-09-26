import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createBackendProcessControl, BACKEND_SHUTDOWN_COMMAND } from '../electron/backend-shutdown.mjs'

function fixture(managed = true) {
  const timers = new Map(); let next = 0
  const control = createBackendProcessControl({ schedule(fn, ms) { timers.set(++next, { fn, ms }); return next }, cancel(id) { timers.delete(id) } })
  const child = new EventEmitter()
  Object.assign(child, { exitCode: null, signalCode: null, killed: false, signals: [], messages: [] })
  child.stdin = new EventEmitter()
  child.stdin.write = (value, cb) => { child.messages.push(value); cb(); return true }
  child.kill = signal => { child.killed = true; child.signals.push(signal); return true }
  child.exit = (code = 0) => { child.exitCode = code; child.emit('exit', code, null) }
  let options
  if (managed) control.spawnManagedBackend((_exe, opts) => { options = opts; return child }, 'backend.exe', { env: { TEST: '1' } })
  const fire = ms => { const item = [...timers].find(([, v]) => v.ms === ms); assert.ok(item, `timer ${ms}`); timers.delete(item[0]); item[1].fn() }
  return { control, child, timers, options, fire }
}

test('managed child inherits a private pipe and opt-in flag', () => {
  const { options } = fixture()
  assert.deepEqual(options.stdio, ['pipe', 'ignore', 'ignore'])
  assert.deepEqual(options.env, { TEST: '1', NOTEPAD_PARENT_STDIN: '1' })
})
test('graceful exit sends one command, no signal, waits for actual exit', async () => {
  const { control, child, timers } = fixture()
  const p = control.stopChildProcess(child)
  assert.deepEqual(child.messages, [BACKEND_SHUTDOWN_COMMAND]); assert.deepEqual(child.signals, [])
  let finished = false; p.then(() => { finished = true }); await Promise.resolve()
  assert.equal(finished, false)
  child.exit(); assert.deepEqual(await p, { exited: true, forced: false, clean: true }); assert.equal(timers.size, 0)
})
test('quit and secret restart share one stop promise', async () => {
  const { control, child } = fixture()
  const a = control.stopChildProcess(child), b = control.stopChildProcess(child)
  assert.equal(a, b); assert.equal(child.messages.length, 1); child.exit(); await a
})
test('Windows managed stop never sends SIGTERM before the grace expires', async () => {
  const { control, child, fire } = fixture()
  const p = control.stopChildProcess(child, 2500)
  assert.deepEqual(child.signals, []); fire(10000)
  assert.deepEqual(child.signals, ['SIGKILL']); child.exit(1)
  assert.equal((await p).forced, true)
})
test('killed is not mistaken for exited, escalation still happens', async () => {
  const { control, child, fire } = fixture(false)
  const p = control.stopChildProcess(child, 25)
  assert.equal(child.killed, true); fire(25)
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']); child.exit(1); await p
})
test('cannot confirm exit: reject instead of permitting restart', async () => {
  const { control, child, fire } = fixture()
  const p = control.stopChildProcess(child)
  const rejection = assert.rejects(p, /阻止重启/)
  fire(10000); fire(1000); await rejection
})
test('error event is not an exit receipt', async () => {
  const { control, child } = fixture()
  const p = control.stopChildProcess(child)
  child.emit('error', new Error('signal failed'))
  let done = false; p.then(() => { done = true }); await Promise.resolve(); assert.equal(done, false)
  child.exit(); await p
})
test('closed stdin still gets bounded grace, not immediate force', async () => {
  const { control, child } = fixture()
  child.stdin.write = () => { throw new Error('EPIPE') }
  const p = control.stopChildProcess(child); assert.deepEqual(child.signals, [])
  child.exit(); await p
})
test('synchronous exit during command delivery does not leak timers', async () => {
  const { control, child, timers } = fixture()
  child.stdin.write = () => { child.exit(); return true }
  await control.stopChildProcess(child); assert.equal(timers.size, 0)
})
test('already exited process receives no command', async () => {
  const { control, child } = fixture(); child.exit()
  await control.stopChildProcess(child); assert.equal(child.messages.length, 0)
})

// Exercise the actual Electron lifecycle handlers without requiring Electron UI.
import fs from 'node:fs'
import vm from 'node:vm'
const mainSource = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8')
const quitSource = mainSource.slice(mainSource.indexOf("app.on('before-quit',"), mainSource.indexOf('// 启动后端进程'))
function quitFixture(stop) {
  const c = { backend: {}, backendStartPromise: null, allowQuit: false, quitting: false, quitPromise: null, handler: null, quitCalls: 0, errors: 0, console }
  c.app = { on(_e, fn) { c.handler = fn }, quit() { c.quitCalls++ } }
  c.dialog = { showErrorBox() { c.errors++ } }; c.stopChildProcess = stop
  vm.createContext(c); vm.runInContext(quitSource, c)
  return c
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
test('actual before-quit handler cannot be bypassed by a second quit', async () => {
  let resolve, calls = 0
  const c = quitFixture(() => { calls++; return new Promise(r => { resolve = r }) })
  let prevented = 0
  c.handler({ preventDefault() { prevented++ } }); await flush()
  c.handler({ preventDefault() { prevented++ } }); assert.equal(prevented, 2); assert.equal(c.quitCalls, 0); assert.equal(calls, 1)
  resolve({ exited: true, forced: false, clean: true }); await flush()
  assert.equal(c.quitCalls, 1); assert.equal(c.allowQuit, true); assert.equal(c.backend, null)
})
test('actual before-quit failure retains child and does not approve exit', async () => {
  const c = quitFixture(async () => { throw new Error('unconfirmed') }), child = c.backend
  c.handler({ preventDefault() {} }); await flush()
  assert.equal(c.backend, child); assert.equal(c.allowQuit, false); assert.equal(c.quitCalls, 0); assert.equal(c.errors, 1)
})
test('actual startBackend does not spawn after quitting during secret load', async () => {
  const source = mainSource.slice(mainSource.indexOf('async function startBackend()'), mainSource.indexOf('async function restartBackendForWebDAVSecret()'))
  let resolve, spawns = 0
  const c = { backend: null, backendStartPromise: null, quitting: false, process: { platform: 'win32', resourcesPath: '/app', env: {} },
    path: { join: (...v) => v.join('/') }, webdavSecrets: { load: () => new Promise(r => { resolve = r }) },
    spawn() {}, spawnManagedBackend() { spawns++; return new EventEmitter() }, dialog: { showErrorBox() {} }, console }
  vm.createContext(c); vm.runInContext(source, c)
  const pending = c.startBackend(); c.quitting = true; resolve('secret'); await pending
  assert.equal(spawns, 0); assert.equal(c.backend, null)
})
