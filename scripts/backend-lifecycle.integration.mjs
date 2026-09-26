import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { spawnManagedBackend, stopChildProcess } from '../electron/backend-shutdown.mjs'
const binary = process.env.NOTEPAD_TEST_BACKEND
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p }
async function start(t, managed = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'notepad-exit-')), port = await freePort()
  const env = { ...process.env, PORT: String(port), NOTEPAD_DATA: root }; delete env.NOTEPAD_PARENT_STDIN
  const child = managed ? spawnManagedBackend(spawn, path.resolve(binary), { env }) : spawn(path.resolve(binary), { env, stdio: ['pipe', 'ignore', 'ignore'] })
  const exit = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject) })
  const base = `http://127.0.0.1:${port}`
  t.after(async () => {
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL')
    await Promise.race([exit, sleep(1500)])
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  let ready = false
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null || child.signalCode) throw new Error('backend exited before readiness')
    try { const res = await fetch(base + '/api/health', { signal: AbortSignal.timeout(500) }); ready = res.ok; await res.text(); if (ready) break } catch {}
    await sleep(100)
  }
  assert.equal(ready, true, 'backend readiness')
  return { child, exit, base, root }
}
const opts = { skip: !binary, timeout: 45000 }
test('real managed backend exits cleanly through parent command', opts, async t => {
  const { child, exit } = await start(t)
  const receipt = await stopChildProcess(child)
  assert.equal(receipt.clean, true); assert.equal(receipt.forced, false)
  assert.equal((await exit).code, 0)
})
test('real managed backend exits on parent pipe EOF', opts, async t => {
  const { child, exit } = await start(t)
  child.stdin.end()
  const result = await Promise.race([exit, sleep(12000).then(() => ({ code: 'timeout' }))])
  assert.equal(result.code, 0)
})
test('ordinary CLI does not interpret stdin EOF as shutdown', opts, async t => {
  const { child } = await start(t, false)
  child.stdin.end(); await sleep(150)
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, null)
})
test('real backend shutdown preserves uncertain-write checkpoint', opts, async t => {
  let notify
  const entered = new Promise(r => { notify = r })
  const remote = http.createServer((req, res) => {
    if (req.method === 'PROPFIND') { res.writeHead(404); res.end(); return }
    if (req.method === 'MKCOL') { notify(); return } // hold the first potentially-mutating request
    res.writeHead(500); res.end()
  })
  await new Promise(r => remote.listen(0, '127.0.0.1', r))
  t.after(() => { remote.closeAllConnections(); remote.close() })
  const { child, root, base } = await start(t)
  const settings = await fetch(base+'/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sync_enabled: true, sync_provider: 'webdav', sync_endpoint: `http://127.0.0.1:${remote.address().port}/dav` }), signal: AbortSignal.timeout(5000) })
  assert.equal((await settings.json()).code, 0)
  const run = fetch(base+'/api/sync/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) }).then(r => r.text()).catch(() => '')
  await Promise.race([entered, sleep(8000).then(() => { throw new Error('write stage was not entered') })])
  const receipt = await stopChildProcess(child)
  assert.equal(receipt.clean, true); assert.equal(receipt.forced, false)
  await run
  const journal = JSON.parse(await fs.readFile(path.join(root, 'sync-runtime', 'job.json'), 'utf8'))
  assert.ok(['applying', 'review_required'].includes(journal.mode)); assert.equal(journal.last_success_at, 0)
})
