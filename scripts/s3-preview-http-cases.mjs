import assert from 'node:assert/strict'
import { createS3PreviewService } from '../electron/s3-preview-bridge.js'
import { previewPayload, previewSuccess, previewScope } from './s3-preview-bridge-cases.mjs'

// Reuse the original serial fixed-port listener. Do NOT add a second service or
// release/rebind 27121 between cases. Only its owned request factory is injected.
export function registerS3PreviewHTTPTests(test, fixture) {
  const run = (handler, action) => fixture.run(handler, action, createS3PreviewService)
  test('preview real loopback fixed POST preserves full request and only returns frozen counts', async () => {
    let seen, count = 0
    await run((req, res) => {
      count++; const chunks = []
      req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
        seen = { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(previewSuccess()))
      })
    }, async makeService => {
      const p = previewPayload(); p.basis.localRecords['file:雪'] = '{"content":"PRIVATE_BODY e\\u0301 %2F"}'
      const out = await makeService().preview(p)
      assert.equal(out.success, true); assert.equal(out.data.counts.conflicts, 1); assert.ok(Object.isFrozen(out.data.kinds[0].counts))
      assert.equal(count, 1); assert.equal(seen.method, 'POST'); assert.equal(seen.path, '/api/sync/s3/preview')
      assert.equal(seen.headers.host, '127.0.0.1:27121'); assert.equal(seen.headers['x-notepad-read-only'], 's3-preview')
      assert.equal(Number(seen.headers['content-length']), Buffer.byteLength(seen.body)); assert.deepEqual(JSON.parse(seen.body), p)
      assert.ok(!Object.keys(seen.headers).some(k => /^(origin|referer|sec-fetch-)/i.test(k)))
      assert.doesNotMatch(JSON.stringify(seen.headers), /PRIVATE_|AKIA/); assert.doesNotMatch(JSON.stringify(out), /PRIVATE_|AKIA/)
    })
  })
  for (const [status, message] of [[422, 'preview-not-available'], [429, 'preview-busy'], [504, 'preview-timeout']]) {
    test(`preview real loopback preserves ${status}/${message} and never fabricates empty statistics`, async () => {
      let count = 0
      await run((req, res) => { count++; req.resume(); res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: status, message, data: null })) }, async makeService => {
        assert.deepEqual(await makeService().preview(previewPayload()), { success: false, status, code: message, data: null }); assert.equal(count, 1)
      })
    })
  }
  test('preview real loopback rejects a redirect without contacting its location', async () => {
    let count = 0
    await run((req, res) => { count++; req.resume(); res.writeHead(302, { 'content-type': 'application/json', location: '/PRIVATE_LOCATION' }); res.end(JSON.stringify(previewSuccess())) }, async makeService => {
      const result = await makeService().preview(previewPayload()); assert.equal(result.code, 'native-preview-invalid-response'); assert.equal(result.data, null); assert.equal(count, 1)
    })
  })
  test('preview real loopback truncation never accepts partial statistics', async () => {
    await run((req, res, timers) => {
      req.resume(); res.writeHead(200, { 'content-type': 'application/json', 'content-length': '4096' }); res.write('{"code":0')
      timers.add(setTimeout(() => res.destroy(), 15))
    }, async makeService => {
      const result = await makeService({ timeoutMs: 500 }).preview(previewPayload())
      assert.equal(result.success, false); assert.equal(result.data, null); assert.equal(result.code, 'native-preview-unavailable')
    })
  })
  test('preview real loopback slow drip cannot extend the absolute deadline', async () => {
    let chunks = 0
    await run((req, res, timers) => {
      req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders()
      timers.add(setInterval(() => { res.write(' '); chunks++ }, 10))
    }, async makeService => {
      const start = performance.now(), result = await makeService({ timeoutMs: 500 }).preview(previewPayload())
      assert.equal(result.code, 'native-preview-timeout'); assert.equal(result.data, null); assert.ok(chunks >= 2); assert.ok(performance.now() - start < 2000)
    })
  })
  test('preview real loopback IPC navigation cancels its actual client and cannot deliver late success', async () => {
    let arrive, socketClosed = false
    const arrived = new Promise(resolve => { arrive = resolve })
    await run((req, res, timers) => {
      req.socket.once('close', () => { socketClosed = true }); req.resume(); arrive()
      timers.add(setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(previewSuccess())) }, 300))
    }, async makeService => {
      const s = previewScope(makeService({ timeoutMs: 1000 })), pending = s.invoke(previewPayload())
      await Promise.race([arrived, pending.then(() => { throw new Error('owned request ended before arrival') })])
      s.sender.emit('did-start-navigation', {}, s.state.expected, false, true)
      assert.equal((await pending).code, 'native-preview-cancelled'); assert.equal(s.sender.listenerCount('destroyed'), 0)
    })
    assert.equal(socketClosed, true, 'owned HTTP request must be drained by its original fixture')
  })
}
