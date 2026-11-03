import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, release } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDesktopWindowSession } from './desktop-window-session.mjs'
import { createExportDirectorySession } from './local-export-directory-session.mjs'

// Exercise the real unchanged PowerShell workers. Independent ChildProcess
// listeners must corroborate the session's own clean-disposal claim.
export async function verifyNativeHelperLifecycle() {
  assert.equal(process.platform, 'win32', 'Native helper verification requires Windows')
  const root = fileURLToPath(new URL('../', import.meta.url))
  const output = path.join(root, 'test-results/native-helper-lifecycle')
  mkdirSync(output, { recursive: true })
  const filename = path.join(output, 'native-helper-lifecycle.json')
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim()
  const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim()
  assert.match(sourceCommit, /^[a-f0-9]{40}$/); assert.match(sourceTree, /^[a-f0-9]{40}$/)
  const report = { schemaVersion: 1, complete: false, helperLifecycleOnly: true, productAcceptance: false,
    sourceCommit, sourceTree, node: process.version, platform: process.platform, osRelease: release(),
    noWindowCommands: true, originalBudgets: true, processes: {}, sessions: {}, sources: {} }
  writeFileSync(filename, JSON.stringify(report, null, 2), { flag: 'wx' })
  const save = () => writeFileSync(filename, JSON.stringify(report, null, 2))
  const observedSpawn = name => (...args) => {
    const child = spawn(...args), start = Date.now()
    const record = report.processes[name] = { pid: child.pid ?? null, exit: null, close: null, errors: 0 }
    child.on('error', () => { record.errors++; save() })
    child.on('exit', (code, signal) => { record.exit = { code, signal, elapsedMs: Date.now() - start }; save() })
    child.on('close', (code, signal) => { record.close = { code, signal, elapsedMs: Date.now() - start }; save() })
    return child
  }
  const ownedRoot = mkdtempSync(path.join(process.env.RUNNER_TEMP || tmpdir(), 'native-helper-lifecycle-'))
  const sessions = []
  try {
    for (const name of ['desktop-window-session.mjs', 'desktop-window-worker.ps1', 'local-export-directory-session.mjs', 'local-export-directory-worker.ps1', 'check-native-helper-lifecycle.mjs']) {
      const data = readFileSync(new URL(name, import.meta.url)), canonical = data.toString('utf8').replace(/\r\n/g, '\n')
      report.sources[name] = { sha256: createHash('sha256').update(data).digest('hex'),
        gitBlob: createHash('sha1').update('blob ' + Buffer.byteLength(canonical) + '\0').update(canonical).digest('hex') }
      const expected = execFileSync('git', ['rev-parse', 'HEAD:scripts/' + name], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim()
      assert.equal(report.sources[name].gitBlob, expected, 'Native helper source differs from actual checkout: ' + name)
    }
    for (const [name, factory, options] of [['window', createDesktopWindowSession, {}], ['directory', createExportDirectorySession, { ownedRoot }]]) {
      const entry = report.sessions[name] = { events: [], ready: false, clean: false }
      const session = factory({ ...options, spawnWorker: observedSpawn(name), onEvent: event => { entry.events.push(event); save() } })
      sessions.push([name, session])
    }
    await Promise.all(sessions.map(async ([name, session]) => { await session.ready; report.sessions[name].ready = true; save() }))
  } catch (error) {
    report.errorCode = /^[A-Z_]{1,80}$/.test(error?.code || '') ? error.code : 'NATIVE_HELPER_FAILED'
  } finally {
    for (const [name, session] of sessions.reverse()) {
      report.sessions[name].clean = await session.dispose()
      report.sessions[name].lifecycle = session.diagnostics()
      save()
    }
    rmSync(ownedRoot, { recursive: true, force: false })
  }
  assert.equal(report.errorCode, undefined)
  assert.equal(sessions.length, 2)
  for (const name of ['window', 'directory']) {
    const s = report.sessions[name], p = report.processes[name], d = s.lifecycle
    assert.equal(s.ready, true); assert.equal(s.clean, true)
    assert.equal(p.errors, 0); assert.equal(p.pid, d.pid)
    assert.equal(p.exit?.code, 0); assert.equal(p.exit?.signal, null)
    assert.equal(p.close?.code, 0); assert.equal(p.close?.signal, null)
    assert.equal(d.exit?.code, 0); assert.equal(d.close?.code, 0)
    assert.equal(d.eofRequested, true); assert.equal(d.failureCode, null); assert.equal(d.termination, null)
    assert.deepEqual(d.errors, {})
    assert.equal(d.startupMs, 30000); assert.equal(d.requestMs, 10000)
    assert.equal(d.disposeMs, name === 'window' ? 3000 : 2000)
    assert.deepEqual(s.events.map(e => e.type), ['spawn', 'ready', name === 'window' ? 'disposed' : 'dispose'])
  }
  report.complete = true; save()
  console.log(JSON.stringify({ helperLifecycleVerified: true, productAcceptance: false, sourceCommit, sourceTree }))
  return report
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyNativeHelperLifecycle()
