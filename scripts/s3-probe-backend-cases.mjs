import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createS3ProbeService, registerS3ProbeHandler, S3_PROBE_CHANNEL } from '../electron/s3-probe-bridge.js'
import { createS3ProbeScope } from '../electron/s3-probe-scope.js'
import { trackProbeFixture } from './s3-probe-fixture-close.mjs'
import { verifyS3RendererBackendContract } from './s3-probe-renderer-contract-cases.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const digest = b => createHash('sha256').update(b).digest('hex')
const fixed = code => ({ success: false, status: 0, code, data: null })
const environment = () => ({ ...process.env, GOTOOLCHAIN: 'local', GO111MODULE: 'off',
  GOWORK: 'off', GOPROXY: 'off', GOSUMDB: 'off', GOFLAGS: '', CGO_ENABLED: '0' })

function launch(command, args, cwd, budgetMs) {
  const child = spawn(command, args, { cwd, env: environment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let output = '', diagnostic = '', failure = null
  const signals = new EventEmitter()
  const timer = setTimeout(() => { failure = 'fixture-budget-exceeded'; child.kill('SIGKILL') }, budgetMs)
  // Capture bounded diagnostics, never print body/credentials or raw native errors.
  for (const [stream, field] of [[child.stdout, 'out'], [child.stderr, 'err']]) stream.on('data', chunk => {
    if (field === 'out') output += chunk.toString(); else diagnostic += chunk.toString()
    if (Buffer.byteLength(output) + Buffer.byteLength(diagnostic) > 65536) {
      failure = 'fixture-output-limit'; child.kill('SIGKILL')
    }
    signals.emit('change')
  })
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => { failure ||= 'fixture-pipe-failed' })
  const done = new Promise(resolve => {
    child.on('error', () => { failure = 'fixture-launch-failed'; signals.emit('change') })
    child.on('close', (code, signal) => {
      clearTimeout(timer); resolve({ code, signal, failure, output, diagnostic }); signals.emit('change')
    })
  })
  return { child, done, signals, getOutput: () => output, getFailure: () => failure }
}

async function startFixture(binary, directory) {
  const process = launch(binary, [], directory, 20000)
  let timeout
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        const inspect = () => {
          if (process.getFailure()) reject(new Error('fixture-start-failed'))
          else if (process.getOutput() === 'probe-fixture-ready\n') resolve()
        }
        process.signals.on('change', inspect); inspect()
      }),
      process.done.then(() => { throw new Error('fixture-closed-before-ready') }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('fixture-start-timeout')), 5000) }),
    ])
    return process
  } catch (error) {
    process.child.stdin.end(); process.child.kill('SIGKILL'); await process.done
    throw error
  } finally { clearTimeout(timeout); process.signals.removeAllListeners() }
}

async function withObjectServer(handler, action, port = 0) {
  const server = http.createServer(handler)
  const closeOwnedFixture = trackProbeFixture(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
  })
  try { return await action(`http://127.0.0.1:${server.address().port}`) }
  finally { await closeOwnedFixture() }
}
const payload = (endpoint, overrides = {}) => ({ endpoint, bucket: 'synthetic-bucket', region: 'us-east-1',
  prefix: 'safe', accessKeyId: 'AKIASYNTHETIC', secretAccessKey: 'synthetic-secret', sessionToken: 'synthetic-token',
  key: '目录/对象.json', maxBytes: 4096, readOnly: true, ...overrides })
function scopeFor(service) {
  const sender = new EventEmitter(); sender.mainFrame = { url: 'file:///synthetic-app/dist/index.html' }
  sender.getURL = () => sender.mainFrame.url; sender.isDestroyed = () => false
  const win = new EventEmitter(); win.webContents = sender; win.isDestroyed = () => false
  const scope = createS3ProbeScope({ getWindow: () => win, getExpectedURL: () => 'file:///synthetic-app/dist/index.html' })
  const handlers = new Map(); registerS3ProbeHandler({ handle: (key, fn) => handlers.set(key, fn) }, service, scope)
  return { sender, scope, invoke: input => handlers.get(S3_PROBE_CHANNEL)({ sender, senderFrame: sender.mainFrame }, input) }
}
async function rawBrowserAttempt(input, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(input)
    const request = http.request('http://127.0.0.1:27121/api/sync/s3/probe', { method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'X-Notepad-Read-Only': 's3-probe', ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject)
      response.on('end', () => { try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }) } catch { reject(new Error('fixture-invalid-response')) } })
    })
    const timer = setTimeout(() => request.destroy(), 2000)
    request.on('close', () => clearTimeout(timer)); request.on('error', reject); request.end(body)
  })
}

// Runs behind the existing single HTTP test entry to avoid competing for its
// fixed production loopback port. No network endpoint, PID or data-dir override.
export async function verifyS3ProbeBackendContract() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notepad-probe-contract-'))
  let running
  const identities = [], passed = []
  try {
    await fs.mkdir(path.join(dir, 'syncs3'))
    const from = path.join(ROOT, 'server/internal/syncs3')
    for (const name of (await fs.readdir(from)).filter(name => name.endsWith('.go') && !name.endsWith('_test.go')).sort()) {
      const bytes = await fs.readFile(path.join(from, name)); await fs.writeFile(path.join(dir, 'syncs3', name), bytes)
      identities.push({ path: `server/internal/syncs3/${name}`, bytes: bytes.length, sha256: digest(bytes) })
    }
    assert.deepEqual(identities.map(entry => path.basename(entry.path)), ['read_client.go', 'read_probe.go', 'read_probe_http.go'])
    await fs.copyFile(path.join(ROOT, 'scripts/fixtures/s3-probe-backend/main.go'), path.join(dir, 'main.go'))
    const binary = path.join(dir, process.platform === 'win32' ? 'fixture.exe' : 'fixture')
    const version = launch('go', ['version'], dir, 5000); version.child.stdin.end()
    const v = await version.done; assert.equal(v.code, 0, 'local Go toolchain unavailable'); assert.equal(v.failure, null)
    const compiler = launch('go', ['build', '-trimpath', '-o', binary, 'main.go'], dir, 90000); compiler.child.stdin.end()
    const build = await compiler.done
    assert.equal(build.code, 0, 'offline standard-library fixture build failed'); assert.equal(build.failure, null)
    assert.equal(build.signal, null)
    const check = async (name, fn) => { await fn(); passed.push(name) }
    await check('occupied fixed port fails closed without sending to or stopping its existing owner', async () => {
      let contacted = 0
      await withObjectServer((_req, res) => { contacted++; res.end() }, async () => {
        await assert.rejects(() => startFixture(binary, dir), /fixture-closed-before-ready/)
        assert.equal(contacted, 0)
      }, 27121)
    })
    running = await startFixture(binary, dir)
    const objectBody = Buffer.from('合成对象')
    await check('native IPC through exact Go handler: signed Unicode GET and bounded sanitized success', async () => {
      let count = 0
      await withObjectServer((req, res) => {
        count++; assert.equal(req.method, 'GET')
        assert.equal(req.url, '/synthetic-bucket/safe/%E7%9B%AE%E5%BD%95/%E5%AF%B9%E8%B1%A1.json')
        assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIASYNTHETIC\//)
        assert.equal(req.headers['x-amz-security-token'], 'synthetic-token')
        assert.ok(!Object.keys(req.headers).some(k => /^(origin|referer|sec-fetch-)/i.test(k)))
        res.writeHead(200, { 'Content-Length': objectBody.length, ETag: 'synthetic-private-etag' }); res.end(objectBody)
      }, async endpoint => {
        const f = scopeFor(createS3ProbeService())
        try {
          const result = await f.invoke(payload(endpoint))
          assert.deepEqual(result, { success: true, status: 200, code: 'OK', data: { outcome: 'readable', httpStatus: 200, acceptedBytes: objectBody.length } })
          assert.ok(!JSON.stringify(result).includes('synthetic')); assert.equal(count, 1)
          assert.equal(f.sender.listenerCount('destroyed'), 0)
        } finally { f.scope.dispose() }
      })
    })
    for (const [status, outcome] of [[403, 'access-denied'], [404, 'not-found'], [302, 'redirect-refused'], [500, 'http-failure']]) {
      await check(`Go upstream ${status}: exact outcome, one GET and zero retries/followups`, async () => {
        let count = 0
        await withObjectServer((req, res) => {
          count++; assert.equal(req.method, 'GET')
          res.writeHead(status, { Location: '/must-not-follow', ETag: 'synthetic-etag' }); res.end('synthetic-private-error')
        }, async endpoint => {
          const result = await createS3ProbeService().probe(payload(endpoint))
          assert.deepEqual(result, { success: false, status: 422, code: 'probe-not-readable', data: { outcome, httpStatus: status, acceptedBytes: 0 } })
          assert.equal(count, 1); assert.ok(!JSON.stringify(result).includes('synthetic'))
        })
      })
    }
    for (const [name, headers, body, limit, outcome] of [
      ['too large', { 'Content-Length': '5' }, '12345', 4, 'too-large'],
      ['encoded object', { 'Content-Encoding': 'gzip' }, 'synthetic-private-body', 4096, 'body-rejected'],
    ]) await check(`Go ${name} cannot become partial success`, async () => {
      let count = 0
      await withObjectServer((req, res) => { count++; res.writeHead(200, headers); res.end(body) }, async endpoint => {
        const result = await createS3ProbeService().probe(payload(endpoint, { maxBytes: limit }))
        assert.deepEqual(result, { success: false, status: 422, code: 'probe-not-readable', data: { outcome, httpStatus: 0, acceptedBytes: 0 } })
        assert.equal(count, 1)
      })
    })
    for (const [name, overrides, outcome] of [
      ['config', { prefix: 'safe/' }, 'invalid-config'],
      ['credentials', { accessKeyId: 'synthetic-invalid-hyphen' }, 'invalid-credentials'],
      ['key', { key: '../not-allowed' }, 'invalid-key'],
    ]) await check(`real Go rejects invalid ${name} without contacting object server`, async () => {
      let count = 0
      await withObjectServer((_req, res) => { count++; res.end() }, async endpoint => {
        const result = await createS3ProbeService().probe(payload(endpoint, overrides))
        assert.deepEqual(result, { success: false, status: 422, code: 'probe-not-readable', data: { outcome, httpStatus: 0, acceptedBytes: 0 } }); assert.equal(count, 0)
      })
    })
    for (const headers of [{ Origin: 'null' }, { Referer: 'http://localhost:5000/' }, { 'Sec-Fetch-Mode': 'cors' }]) {
      await check(`real Go retains browser guard: ${Object.keys(headers)[0]}`, async () => {
        let count = 0
        await withObjectServer((_req, res) => { count++; res.end() }, async endpoint => {
          assert.deepEqual(await rawBrowserAttempt(payload(endpoint), headers), { status: 403,
            body: { code: 403, message: 'native-loopback-required', data: null } }); assert.equal(count, 0)
        })
      })
    }
    await check('IPC navigation cancels actual Go outbound GET; concurrent attempt creates no second GET', async () => {
      let arrived, cancelled, count = 0
      const started = new Promise(resolve => { arrived = resolve })
      const stopped = new Promise(resolve => { cancelled = resolve })
      await withObjectServer((req, res) => { count++; req.resume(); res.on('close', cancelled); arrived() }, async endpoint => {
        const f = scopeFor(createS3ProbeService({ timeoutMs: 1000 }))
        try {
          const first = f.invoke(payload(endpoint))
          await Promise.race([started, delay(2000).then(() => { throw new Error('synthetic-get-not-started') })])
          assert.deepEqual(await f.invoke(payload(endpoint)), fixed('native-probe-busy')); assert.equal(count, 1)
          f.sender.emit('did-start-navigation', {}, f.sender.mainFrame.url, false, true)
          assert.deepEqual(await first, fixed('native-probe-cancelled'))
          await Promise.race([stopped, delay(2000).then(() => { throw new Error('Go GET cancellation missing') })])
          assert.equal(count, 1); assert.equal(f.sender.listenerCount('destroyed'), 0)
        } finally { f.scope.dispose() }
      })
    })
    const rendererBindingContract = await verifyS3RendererBackendContract({ check, withObjectServer, scopeFor, payload })
    for (const entry of identities) {
      const original = await fs.readFile(path.join(ROOT, entry.path)); const copy = await fs.readFile(path.join(dir, 'syncs3', path.basename(entry.path)))
      assert.equal(digest(original), entry.sha256); assert.deepEqual(copy, original)
    }
    return { scope: 'node-ipc-and-exact-standard-library-go-handler', go: v.output.trim(), sourceFiles: identities,
      checks: passed, passed: passed.length, rendererBindingContract, framework: 'net/http (not GoFrame)', electronRuntimeExecuted: false, realBucketAccess: false }
  } finally {
    try {
      if (running) {
        running.child.stdin.end()
        const exit = await running.done
        assert.equal(exit.code, 0, 'fixture did not shut down normally'); assert.equal(exit.signal, null); assert.equal(exit.failure, null)
        assert.equal(exit.diagnostic, ''); assert.equal(exit.output, 'probe-fixture-ready\n')
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  }
}
