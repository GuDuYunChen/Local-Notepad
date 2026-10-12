import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runNative } from './package-windows.mjs'
import { packageWindows } from './windows-package-core.mjs'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const temporary = async fn => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'notepad-termination-'))
  try { return await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { if (e.code === 'ESRCH') return false; throw e } }
async function waitForExit(file) {
  const deadline = performance.now() + 3000
  while (performance.now() < deadline) {
    if (existsSync(file) && !alive(Number(readFileSync(file, 'utf8')))) return
    await delay(20)
  }
  throw new Error('Isolated parent did not exit')
}
function inherited(stream, marker) {
  const grandchild = `process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});setTimeout(()=>{},3000)`
  return `const {spawn}=require('node:child_process');
    const stdio=['ignore',${stream === 'stdout' ? '1' : "'ignore'"},${stream === 'stderr' ? '2' : "'ignore'"}];
    const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio});
    require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));child.unref()`
}
function packageFixture(root) {
  const version = '4.217.2', name = 'notepad-desktop'
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, version,
    build: { directories: { output: 'release' }, nsis: { artifactName: 'Notepad-${version}-Setup.exe' } } }))
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name, version, lockfileVersion: 3, packages: { '': { name, version } } }))
  mkdirSync(path.join(root, 'release')); writeFileSync(path.join(root, 'release', 'previous.exe'), 'untouched')
  return { root, platform: 'win32', nodeVersion: '24.0.0' }
}
const receiptAt = root => {
  const folder = path.join(root, 'test-results', 'local-package')
  const dirs = readdirSync(folder, { withFileTypes: true }).filter(e => e.isDirectory())
  assert.equal(dirs.length, 1)
  return JSON.parse(readFileSync(path.join(folder, dirs[0].name, 'receipt.json')))
}

export function registerPackageTerminationTests(test) {
  for (const stream of ['stdout', 'stderr']) {
    test(`package termination timeout remains effective after parent exit with inherited ${stream}`, () => temporary(async root => {
      const marker = path.join(root, 'parent.pid'), started = performance.now()
      const result = runNative(process.execPath, ['-e', inherited(stream, marker)], { timeout: 1200, cleanupTimeout: 400, quiet: true })
      const outcome = result.then(value => ({ value }), error => ({ error }))
      await waitForExit(marker)
      const out = await outcome
      assert.ok(out.error, 'An elapsed command must not resolve as successful')
      assert.equal(out.error.reason, 'timeout')
      assert.ok(performance.now() - started < 2600, 'Must not wait for inherited pipes to close naturally')
      if (process.platform === 'win32') assert.equal(out.error.cleanupUnconfirmed, true)
    }))
    test(`package termination cancellation remains effective after parent exit with inherited ${stream}`, () => temporary(async root => {
      const marker = path.join(root, 'parent.pid'), controller = new AbortController()
      const result = runNative(process.execPath, ['-e', inherited(stream, marker)], { timeout: 4500, cleanupTimeout: 400, signal: controller.signal, quiet: true })
      const outcome = result.then(value => ({ value }), error => ({ error }))
      await waitForExit(marker)
      const started = performance.now(); controller.abort()
      const out = await outcome
      assert.ok(out.error, 'Cancellation cannot resolve with the old zero exit code')
      assert.equal(out.error.reason, 'cancelled')
      assert.ok(performance.now() - started < 1600)
      if (process.platform === 'win32') assert.equal(out.error.cleanupUnconfirmed, true)
    }))
  }
  test('package termination preserves normal output, command result and complete log', () => temporary(async root => {
    const logFile = path.join(root, 'commands.log')
    const result = await runNative(process.execPath, ['-e', "process.stdout.write('normal');process.stderr.write('diagnostic')"], { quiet: true, logFile, timeout: 4000 })
    assert.equal(result.code, 0); assert.equal(result.error, null); assert.equal(result.stdout, 'normal')
    const log = readFileSync(logFile, 'utf8'); assert.ok(log.includes('normal') && log.includes('diagnostic'))
  }))
  test('package termination retains failed native exit rather than rewriting it as success', async () => {
    const result = await runNative(process.execPath, ['-e', 'process.exit(13)'], { quiet: true, timeout: 4000 })
    assert.equal(result.code, 13)
  })
  test('package termination refuses a delayed over-budget close even when the child exited zero', async () => {
    const result = runNative(process.execPath, ['-e', 'process.exit(0)'], { quiet: true, timeout: 50, cleanupTimeout: 400 })
    const outcome = result.then(value => ({ value }), error => ({ error }))
    const until = performance.now() + 200
    while (performance.now() < until) { /* Simulate a blocked event loop, not a frozen wall clock. */ }
    assert.equal((await outcome).error?.reason, 'timeout')
  })
  test('package termination log failure aborts the command without a successful receipt', () => temporary(async root => {
    await assert.rejects(runNative(process.execPath, ['-e', "process.stdout.write('trigger');setInterval(()=>{},1000)"],
      { quiet: true, logFile: root, timeout: 4000, cleanupTimeout: 1000 }), e => e.reason === 'output-error')
  }))
  test('package termination pre-aborted operation issues no native command', () => temporary(async root => {
    const marker = path.join(root, 'must-not-exist'), c = new AbortController(); c.abort(new Error('before-start'))
    assert.throws(() => runNative(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'x')`], { signal: c.signal }), /before-start/)
    assert.equal(existsSync(marker), false)
  }))
  test('package termination rejects malformed command and cleanup budgets before spawning', () => {
    for (const key of ['timeout', 'cleanupTimeout']) for (const value of [0, -1, 0.5, NaN, Infinity, 2147483648])
      assert.throws(() => runNative(process.execPath, ['-e', 'process.exit(0)'], { [key]: value }), /time budget/)
  })
  test('package termination does not cancel an independent concurrent command', async () => {
    const c = new AbortController()
    const cancelled = runNative(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { quiet: true, signal: c.signal, cleanupTimeout: 1000 })
    const stopped = cancelled.catch(e => e)
    const other = runNative(process.execPath, ['-e', "setTimeout(()=>process.stdout.write('independent'),150)"], { quiet: true, timeout: 4000 })
    c.abort()
    assert.equal((await stopped).reason, 'cancelled'); assert.equal((await other).stdout, 'independent')
  })
  test('package termination keeps ownership when process cleanup cannot be confirmed', () => temporary(async root => {
    const options = packageFixture(root), lockPath = path.join(root, 'test-results', 'local-package', 'running.lock')
    let calls = 0
    const run = async () => { calls++; throw Object.assign(new Error('timeout'), { reason: 'timeout', cleanupUnconfirmed: true, childPid: 12345 }) }
    await assert.rejects(packageWindows({ ...options, run }), /lock retained/)
    const receipt = receiptAt(root), lock = JSON.parse(readFileSync(lockPath))
    assert.equal(receipt.complete, false); assert.equal(receipt.recoveryRequired, true)
    assert.equal(receipt.error.stage, 'version-check'); assert.equal(receipt.error.cleanupUnconfirmed, true)
    assert.equal(lock.state, 'cleanup-unconfirmed'); assert.equal(lock.childPid, 12345)
    assert.equal(receipt.installer, undefined); assert.equal(readFileSync(path.join(root, 'release', 'previous.exe'), 'utf8'), 'untouched')
    await assert.rejects(packageWindows({ ...options, run }), /owns/); assert.equal(calls, 1)
    assert.deepEqual(JSON.parse(readFileSync(lockPath)), lock)
  }))
  test('package termination releases the run lock after a confirmed clean failure', () => temporary(async root => {
    const options = packageFixture(root)
    await assert.rejects(packageWindows({ ...options, run: async () => { throw Object.assign(new Error('cancelled'), { cleanupUnconfirmed: false }) } }), /cancelled/)
    assert.equal(receiptAt(root).complete, false)
    assert.equal(existsSync(path.join(root, 'test-results', 'local-package', 'running.lock')), false)
  }))
  test('package termination failure never continues to install or build', () => temporary(async root => {
    const options = packageFixture(root), commands = []
    await assert.rejects(packageWindows({ ...options, run: async (_, args) => { commands.push(args); throw Object.assign(new Error('cancelled'), { reason: 'cancelled', cleanupUnconfirmed: true }) } }), /cancelled/)
    assert.deepEqual(commands, [['scripts/check-app-version.mjs']])
    assert.deepEqual(receiptAt(root).stages, [])
  }))
  test('package termination a missing native command remains a failed spawn result', async () => {
    const result = await runNative('notepad-termination-nonexistent-command', [], { quiet: true, timeout: 4000 })
    assert.ok(result.error); assert.notEqual(result.code, 0)
  })
}
