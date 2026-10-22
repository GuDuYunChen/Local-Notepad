import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { decodeS3PreviewResponse } from '../electron/s3-preview-codec.js'
import { createS3PreviewService } from '../electron/s3-preview-bridge.js'
import { createS3PreviewSession } from '../src/services/s3PreviewSession.mjs'
import { createS3PreviewBinding } from '../src/services/s3PreviewBinding.mjs'
import { previewPayload, previewScope } from './s3-preview-bridge-cases.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const CODE = 'encoded-or-trailer-request-refused'
const refused = { success: false, status: 415, code: CODE, data: null }
const invalid = { success: false, status: 0, code: 'native-preview-invalid-response', data: null }
const digest = b => createHash('sha256').update(b).digest('hex')
const expected = new Map([
  ...['encoding-empty', 'encoding-identity', 'encoding-gzip', 'encoding-mixed-case', 'trailer-declaration'].map(name => [name, [415, CODE]]),
  ['trailer-value', [400, 'invalid-request']], ['query-target', [400, 'invalid-request-target']],
  ['method-get', [405, 'method-not-allowed']], ['browser-origin', [403, 'native-loopback-required']],
  ['browser-referer', [403, 'native-loopback-required']], ['missing-intent', [403, 'native-loopback-required']],
  ['non-json', [415, 'json-required']], ['nil-body', [400, 'invalid-request']],
  ['declared-oversize', [413, 'request-too-large']], ['invalid-json-shape', [400, 'invalid-request']],
  ['cancelled', [408, 'preview-cancelled']], ['deadline', [504, 'preview-timeout']],
  ['nil-handler', [503, 'preview-unavailable']],
])

// A finite program, not a server or a second fixed-port fixture. Copy entire
// production packages verbatim into an isolated standard-library-only module;
// never modify the real GoFrame module or download modules/toolchains.
function actualGoRefusals() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-preview-refusals-'))
  const files = []
  const env = { ...process.env, GOTOOLCHAIN: 'local', GO111MODULE: 'on', GOWORK: 'off',
    GOPROXY: 'off', GOSUMDB: 'off', CGO_ENABLED: '0', GOFLAGS: '' }
  function execute(command, args, timeout) {
    const p = spawnSync(command, args, { cwd: directory, env, encoding: 'utf8',
      windowsHide: true, timeout, maxBuffer: 64 * 1024 })
    assert.equal(p.error, undefined, 'owned Go fixture failed to start or exceeded its budget')
    assert.equal(p.status, 0, `owned Go fixture exited unsuccessfully: ${p.stderr.slice(0, 2000)}`)
    return p.stdout
  }
  try {
    fs.writeFileSync(path.join(directory, 'go.mod'), 'module notepad-server\n\ngo 1.22\n')
    for (const name of ['syncengine', 'syncs3', 'syncjob']) {
      const source = path.join(ROOT, 'server', 'internal', name), dest = path.join(directory, 'internal', name)
      fs.mkdirSync(dest, { recursive: true })
      for (const file of fs.readdirSync(source).filter(n => n.endsWith('.go') && !n.endsWith('_test.go')).sort()) {
        const from = path.join(source, file), to = path.join(dest, file), bytes = fs.readFileSync(from)
        fs.writeFileSync(to, bytes); files.push({ from, to, sha256: digest(bytes) })
      }
    }
    fs.copyFileSync(path.join(ROOT, 'scripts', 'fixtures', 's3-preview-refusals', 'main.go'), path.join(directory, 'main.go'))
    const binary = path.join(directory, process.platform === 'win32' ? 'refusals.exe' : 'refusals')
    execute('go', ['build', '-o', binary, '.'], 60_000)
    const output = execute(binary, [], 5_000)
    for (const f of files) {
      assert.equal(digest(fs.readFileSync(f.from)), f.sha256, 'original production source drifted')
      assert.equal(digest(fs.readFileSync(f.to)), f.sha256, 'copied production source drifted')
    }
    return JSON.parse(output)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

// Only simulate Node's transport callbacks here; the envelope is emitted by
// the real Go handler above. This is not a live TCP/Electron/GoFrame test.
function recordedTransport(observation) {
  let requests = 0
  return { count: () => requests, requestImpl: (_url, _options, callback) => {
    const request = new EventEmitter()
    request.destroy = () => queueMicrotask(() => request.emit('close'))
    request.end = () => {
      requests++
      queueMicrotask(() => {
        const response = new EventEmitter()
        Object.assign(response, { statusCode: observation.status, complete: false,
          rawHeaders: ['Content-Type', 'application/json'], rawTrailers: [], trailers: {}, destroy() {} })
        callback(response)
        response.emit('data', Buffer.from(JSON.stringify(observation.body)))
        response.complete = true; response.emit('end'); request.emit('close')
      })
    }
    return request
  } }
}

export function registerS3PreviewRefusalTests(test) {
  test('preview rejection contract: actual Go handler envelopes survive codec IPC and renderer binding', async () => {
    const observations = actualGoRefusals()
    assert.equal(observations.length, expected.size)
    assert.equal(new Set(observations.map(row => row.name)).size, expected.size)
    for (const row of observations) {
      const [status, code] = expected.get(row.name) ?? []
      assert.equal(row.status, status, row.name)
      assert.deepEqual(row.body, { code: status, message: code, data: null }, row.name)
      const decoded = decodeS3PreviewResponse(status, JSON.stringify(row.body), 12)
      assert.deepEqual(decoded, { success: false, status, code, data: null }, row.name)
      const transport = recordedTransport(row)
      const scope = previewScope(createS3PreviewService({ requestImpl: transport.requestImpl }))
      const binding = createS3PreviewBinding({ getBridge: () => ({ s3PreviewRead: scope.invoke }) })
      const disconnect = binding.connect()
      try {
        const out = await binding.read(previewPayload())
        assert.equal(out.state, 'failed', row.name); assert.equal(out.code, code, row.name)
        assert.equal(out.serviceStatus, status, row.name); assert.equal(out.summary, null, row.name)
        assert.equal(transport.count(), 1, 'a refusal must not retry')
        assert.doesNotMatch(JSON.stringify(out), /PRIVATE_|AKIA|synthetic\.invalid/)
      } finally { disconnect() }
    }
  }, 90_000)

  test('preview canonical encoded/trailer refusal requires exact 415 and null data', () => {
    const body = { code: 415, message: CODE, data: null }
    assert.deepEqual(decodeS3PreviewResponse(415, JSON.stringify(body), 12), refused)
    for (const status of [0, 200, 400, 403, 413, 422, 500]) {
      assert.deepEqual(decodeS3PreviewResponse(status, JSON.stringify({ ...body, code: status }), 12), invalid)
    }
    for (const data of [{}, [], '', false, 0]) {
      assert.deepEqual(decodeS3PreviewResponse(415, JSON.stringify({ ...body, data }), 12), invalid)
    }
  })
  test('preview refusal compatibility retains only the preexisting exact legacy alias', () => {
    const legacy = 'encoded-request-refused'
    assert.equal(decodeS3PreviewResponse(415, JSON.stringify({ code: 415, message: legacy, data: null }), 12).code, legacy)
    for (const message of [CODE + ' ', CODE.toUpperCase(), CODE + ':PRIVATE_ERROR', 'encoded-anything-refused']) {
      assert.deepEqual(decodeS3PreviewResponse(415, JSON.stringify({ code: 415, message, data: null }), 12), invalid)
    }
  })
  test('preview canonical refusal still rejects ambiguous and private JSON fields', () => {
    for (const raw of [
      `{"code":415,"message":"${CODE}","data":null,"private":"PRIVATE"}`,
      `{"code":415,"message":"${CODE}","data":null,"\\u0064ata":null}`,
      `{"code":415,"message":"${CODE}","message":"${CODE}","data":null}`,
    ]) assert.deepEqual(decodeS3PreviewResponse(415, raw, 12), invalid)
  })
  test('preview canonical refusal does not execute response getters or adopt late results', async () => {
    let resolve, touched = 0
    const pending = new Promise(done => { resolve = done })
    const session = createS3PreviewSession({ getBridge: () => ({ s3PreviewRead: () => pending }) })
    const result = session.read(previewPayload()); session.invalidate()
    const raw = { ...refused }; Object.defineProperty(raw, 'code', { enumerable: true, get() { touched++; return CODE } })
    resolve(raw)
    assert.equal((await result).code, 'wait-stopped')
    await Promise.resolve(); assert.equal(touched, 0); assert.equal(session.snapshot().summary, null)
    session.dispose()
  })
}
