import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createDesktopWindowSession } from './desktop-window-session.mjs'
import { createExportDirectorySession } from './local-export-directory-session.mjs'

// These are event-order counterexamples, not a claim of Windows execution.
// ChildProcess exit and close deliberately remain separately controllable.
function fixture(kind, { automaticReady = true, endThrows = false, exitOnEnd = false, closeOnEnd = false } = {}) {
  const child = new EventEmitter(); child.pid = 701
  child.stdout = new PassThrough(); child.stderr = new PassThrough()
  const calls = { kills: 0, writes: 0, ends: 0 }
  let exited = false, closed = false
  const exit = (code = 0, signal = null) => { if (!exited) { exited = true; child.emit('exit', code, signal) } }
  const close = (code = 0, signal = null) => { if (!closed) { closed = true; child.emit('close', code, signal) } }
  child.stdin = new Writable({ write(_data, _encoding, done) { calls.writes++; done() } })
  child.stdin.end = () => {
    calls.ends++
    if (exitOnEnd) queueMicrotask(() => { exit(); if (closeOnEnd) close() })
    if (endThrows) throw Object.assign(new Error('PRIVATE_INPUT_PATH'), { code: 'EPIPE' })
  }
  // A failed kill is NOT an exit. Only the explicitly delivered events prove it.
  child.kill = () => { calls.kills++; return false }
  const factory = kind === 'window' ? createDesktopWindowSession : createExportDirectorySession
  const session = factory({ ownedRoot: 'C:\\owned-helper-test', spawnWorker: () => child })
  const ready = () => child.stdout.write('{"protocol":1,"ready":true}\n')
  if (automaticReady) queueMicrotask(ready)
  return { child, session, calls, ready, exit, close }
}

for (const kind of ['window', 'directory']) {
  test(`${kind}: unexpected zero exit must never become a clean disposal`, async () => {
    const f = fixture(kind); await f.session.ready
    f.exit(); f.close()
    assert.equal(await f.session.dispose(), false)
  })
  test(`${kind}: protocol failure followed by zero exit remains failed`, async () => {
    const f = fixture(kind, { automaticReady: false })
    const rejected = assert.rejects(f.session.ready)
    f.child.stdout.write('{"protocol":0,"ready":true}\n')
    await rejected; f.exit(); f.close()
    assert.equal(await f.session.dispose(), false)
  })
  test(`${kind}: thrown stdin EOF cannot become a clean disposal`, async () => {
    const f = fixture(kind, { endThrows: true, exitOnEnd: true, closeOnEnd: true }); await f.session.ready
    assert.equal(await f.session.dispose(), false)
  })
  test(`${kind}: process error does not substitute for an actual close`, async () => {
    const f = fixture(kind); await f.session.ready
    f.child.emit('error', Object.assign(new Error('PRIVATE_PROCESS_PATH'), { code: 'EPERM' }))
    let settled = false
    const disposal = f.session.dispose().then(result => { settled = true; return result })
    try {
      await nextTurn(); assert.equal(settled, false, 'error alone must not finish resource cleanup')
    } finally { f.exit(1); f.close(1) }
    assert.equal(await disposal, false); assert.equal(f.calls.writes, 0)
  })
  test(`${kind}: exit with open pipes cannot finish a clean disposal`, async () => {
    const f = fixture(kind, { exitOnEnd: true }); await f.session.ready
    let settled = false
    const disposal = f.session.dispose().then(result => { settled = true; return result })
    try { await nextTurn(); assert.equal(settled, false, 'wait for ChildProcess close, not merely exit') }
    finally { f.close() }
    assert.equal(await disposal, true); assert.equal(f.calls.kills, 0)
  })
  test(`${kind}: pipe error between exit and close refuses clean cleanup`, async () => {
    const f = fixture(kind, { exitOnEnd: true }); await f.session.ready
    const disposal = f.session.dispose(); await nextTurn()
    f.child.stderr.emit('error', Object.assign(new Error('PRIVATE_LATE_PIPE'), { code: 'EIO' })); f.close()
    assert.equal(await disposal, false)
  })
  test(`${kind}: successful EOF stays idempotent and never sends window commands`, async () => {
    const f = fixture(kind, { exitOnEnd: true, closeOnEnd: true }); await f.session.ready
    const first = f.session.dispose(); assert.equal(first, f.session.dispose())
    assert.equal(await first, true); assert.deepEqual(f.calls, { kills: 0, writes: 0, ends: 1 })
  })
}

for (const kind of ['window', 'directory']) {
  test(`${kind}: terminal diagnostics are bounded, detached and contain no private strings`, async () => {
    const f = fixture(kind); await f.session.ready
    f.child.stderr.write('PRIVATE_STDERR_PAYLOAD')
    const error = Object.assign(new Error('PRIVATE_ERROR_MESSAGE'), { code: 'PRIVATE_ERROR_CODE' })
    f.child.stdout.emit('error', error)
    f.exit(1); f.close(1)
    assert.equal(await f.session.dispose(), false)
    const first = f.session.diagnostics()
    assert.equal(first.startupMs, 30000); assert.equal(first.requestMs, 10000)
    assert.equal(first.disposeMs, kind === 'window' ? 3000 : 2000)
    assert.equal(first.pid, 701); assert.equal(first.ready, true)
    assert.equal(first.stdoutBytes, Buffer.byteLength('{"protocol":1,"ready":true}\n'))
    assert.equal(first.stderrBytes, Buffer.byteLength('PRIVATE_STDERR_PAYLOAD'))
    assert.deepEqual(first.errors.stdout, { count: 1, code: 'OTHER' })
    assert.equal(first.exit.code, 1); assert.equal(first.close.code, 1)
    assert.equal(first.failureCode, 'PIPE_ERROR'); assert.equal(first.termination.accepted, false)
    assert.doesNotMatch(JSON.stringify(first), /PRIVATE|owned-helper-test|EncodedCommand/)
    assert.ok(JSON.stringify(first).length < 2000)
    first.errors.stdout.code = 'MUTATED'; first.exit.code = 0
    assert.equal(f.session.diagnostics().errors.stdout.code, 'OTHER')
    assert.equal(f.session.diagnostics().exit.code, 1)
  })
  test(`${kind}: a missing close stays false at the ORIGINAL disposal deadline`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const f = fixture(kind, { exitOnEnd: true }); await f.session.ready
    const disposal = f.session.dispose()
    await Promise.resolve(); t.mock.timers.tick(kind === 'window' ? 3000 : 2000)
    assert.equal(await disposal, false)
    const d = f.session.diagnostics()
    assert.equal(d.close, null); assert.equal(d.termination.reason, 'DISPOSE_TIMEOUT')
    assert.equal(f.calls.kills, 1); assert.equal(f.calls.writes, 0)
    f.close(); assert.equal(await f.session.dispose(), false)
  })
  test(`${kind}: startup timeout preserves cause and never retries a termination`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const f = fixture(kind, { automaticReady: false })
    const rejected = assert.rejects(f.session.ready, { code: 'STARTUP_TIMEOUT' })
    t.mock.timers.tick(30000); await rejected
    const disposal = f.session.dispose(); t.mock.timers.tick(kind === 'window' ? 3000 : 2000)
    assert.equal(await disposal, false)
    assert.equal(f.session.diagnostics().failureCode, 'STARTUP_TIMEOUT')
    assert.equal(f.session.diagnostics().exit, null); assert.equal(f.calls.kills, 1)
    assert.equal(f.calls.writes, 0); f.exit(1); f.close(1)
  })
}

// Real isolated Node children validate the OS pipe/event boundary. They do not
// compile PowerShell or exercise a Windows window, which requires native CI.
import { spawn } from 'node:child_process'
for (const kind of ['window', 'directory']) {
  test(`${kind}: actual child process EOF proves both exit and stdio close`, async () => {
    let child
    const factory = kind === 'window' ? createDesktopWindowSession : createExportDirectorySession
    const session = factory({ ownedRoot: 'C:\\owned-real-child', spawnWorker: () => {
      child = spawn(process.execPath, ['--input-type=module', '-e',
        `process.stdout.write('{"protocol":1,"ready":true}\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`],
        { stdio: ['pipe', 'pipe', 'pipe'] })
      return child
    } })
    try {
      await session.ready; assert.equal(await session.dispose(), true)
      const d = session.diagnostics()
      assert.equal(d.pid, child.pid); assert.equal(d.eofRequested, true)
      assert.equal(d.exit.code, 0); assert.equal(d.close.code, 0)
      assert.ok(d.close.elapsedMs >= d.exit.elapsedMs); assert.equal(d.termination, null)
      assert.deepEqual(d.errors, {})
    } finally { await session.dispose(); if (child.exitCode === null && child.signalCode === null) child.kill() }
  })
}
