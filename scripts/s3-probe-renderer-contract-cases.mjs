// Test-only end-to-end contracts. The existing serial Go fixture owns port 27121;
// this module never binds that port, starts a process or contacts a real bucket.
import assert from 'node:assert/strict'
import http from 'node:http'
import { createS3ProbeService } from '../electron/s3-probe-bridge.js'
import { createS3ProbeBinding } from '../src/services/s3ProbeBinding.mjs'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function within(promise, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`renderer contract did not finish: ${label}`)), 2000)
    })])
  } finally { clearTimeout(timer) }
}
function publicOnly(value) {
  const text = JSON.stringify(value)
  assert.ok(Object.isFrozen(value))
  assert.doesNotMatch(text, /synthetic|AKIASYNTHETIC|PRIVATE_OBJECT|PRIVATE_ETAG|PRIVATE_TOKEN/)
  assert.match(value.limitation, /不验证凭据有效性、列举或写入权限/)
  if (value.summary) assert.ok(Object.isFrozen(value.summary))
}
async function withBinding(scopeFor, action) {
  const live = new Map(), nativeResults = [], seen = []
  let nativeCalls = 0, requests = 0, bridgeReads = 0, disconnect
  const service = createS3ProbeService({ requestImpl(url, options, callback) {
    requests++
    const req = http.request(url, options, callback)
    const closed = new Promise(resolve => req.once('close', () => { live.delete(req); resolve() }))
    live.set(req, closed)
    return req
  } })
  const ipc = scopeFor(service)
  const binding = createS3ProbeBinding({ getBridge() {
    bridgeReads++
    return { s3ProbeRead(input) {
      nativeCalls++
      const pending = ipc.invoke(input)
      nativeResults.push(pending)
      return pending
    } }
  } })
  // Observers deliberately isolate exceptions. Capture first, assert outside
  // notification so a failing privacy assertion cannot be swallowed.
  const unsubscribe = binding.subscribe(() => { seen.push(binding.snapshot()) })
  const f = { binding, ipc, seen, connect() { disconnect = binding.connect(); return disconnect },
    disconnect() { disconnect?.() }, counts: () => ({ nativeCalls, requests, bridgeReads }),
    async drained() {
      await within(Promise.all(nativeResults), 'native IPC settlement')
      await within(Promise.all([...live.values()]), 'owned ClientRequest close')
    } }
  try {
    const result = await action(f)
    for (const value of seen) publicOnly(value)
    return result
  }
  finally {
    unsubscribe(); disconnect?.(); ipc.scope.dispose()
    // Own requests only, including on assertion failure. Await actual close,
    // not response end; retain the original bounded cleanup discipline.
    const closed = [...live.values()]
    for (const req of live.keys()) req.destroy()
    await within(Promise.all(closed), 'final owned client cleanup')
    assert.equal(live.size, 0)
    assert.equal(ipc.sender.listenerCount('destroyed'), 0)
  }
}

export async function verifyS3RendererBackendContract({ check, withObjectServer, scopeFor, payload }) {
  const checked = []
  const run = async (name, fn) => {
    await check(`renderer binding -> actual Go: ${name}`, fn)
    checked.push(name)
  }
  for (const body of [Buffer.from('PRIVATE_OBJECT'), Buffer.alloc(0)]) {
    await run(`explicit signed Unicode read, ${body.length} bytes, no implicit I/O`, async () => {
      let gets = 0
      await withObjectServer((req, res) => {
        gets++
        assert.equal(req.method, 'GET')
        assert.equal(req.url, '/' + ['synthetic-bucket', 'safe', '目录', 'e\u0301 %2F.json'].map(encodeURIComponent).join('/'))
        assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIASYNTHETIC\//)
        assert.equal(req.headers['x-amz-security-token'], 'PRIVATE_TOKEN')
        res.writeHead(200, { 'Content-Length': body.length, ETag: 'PRIVATE_ETAG' }); res.end(body)
      }, async endpoint => withBinding(scopeFor, async f => {
        f.connect(); f.binding.invalidate()
        assert.deepEqual(f.counts(), { nativeCalls: 0, requests: 0, bridgeReads: 0 }); assert.equal(gets, 0)
        const result = await f.binding.read(payload(endpoint, { key: '目录/e\u0301 %2F.json', sessionToken: 'PRIVATE_TOKEN' }))
        publicOnly(result); assert.equal(result.state, 'readable'); assert.equal(result.serviceStatus, 200)
        assert.deepEqual(result.summary, { outcome: 'readable', httpStatus: 200, acceptedBytes: body.length })
        await f.drained(); assert.equal(gets, 1)
        assert.deepEqual(f.counts(), { nativeCalls: 1, requests: 1, bridgeReads: 1 })
        assert.ok(f.seen.some(v => v.state === 'pending')); assert.equal(f.binding.snapshot(), result)
      }))
    })
  }
  for (const [status, outcome] of [[403, 'access-denied'], [404, 'not-found'], [302, 'redirect-refused'], [500, 'http-failure']]) {
    await run(`upstream ${status} retains meaning without partial data or retry`, async () => {
      let gets = 0
      await withObjectServer((req, res) => {
        gets++; assert.equal(req.method, 'GET')
        res.writeHead(status, { Location: '/must-not-follow', ETag: 'PRIVATE_ETAG' }); res.end('PRIVATE_OBJECT')
      }, async endpoint => withBinding(scopeFor, async f => {
        f.connect(); const result = await f.binding.read(payload(endpoint)); publicOnly(result)
        assert.equal(result.state, 'failed'); assert.equal(result.serviceStatus, 422); assert.equal(result.code, outcome)
        assert.deepEqual(result.summary, { outcome, httpStatus: status, acceptedBytes: 0 })
        if (status === 403) assert.match(result.message, /不能据此判断密码错误/)
        if (status === 404) assert.match(result.message, /不能据此确认配置或权限正确/)
        await f.drained(); assert.equal(gets, 1); assert.equal(f.counts().requests, 1)
      }))
    })
  }
  await run('invalid renderer input and invalid Go key fail at their own boundaries', async () => {
    let gets = 0
    await withObjectServer((_req, res) => { gets++; res.end() }, async endpoint => withBinding(scopeFor, async f => {
      f.connect()
      const badInput = await f.binding.read(payload(endpoint, { readOnly: false }))
      assert.equal(badInput.code, 'invalid-input'); assert.equal(f.counts().nativeCalls, 0); publicOnly(badInput)
      const badKey = await f.binding.read(payload(endpoint, { key: '../not-allowed' }))
      assert.equal(badKey.code, 'invalid-key'); assert.equal(badKey.summary.acceptedBytes, 0); publicOnly(badKey)
      await f.drained(); assert.equal(f.counts().nativeCalls, 1); assert.equal(f.counts().requests, 1); assert.equal(gets, 0)
    }))
  })
  await run('untrusted main document is refused before loopback HTTP', async () => {
    let gets = 0
    await withObjectServer((_req, res) => { gets++; res.end() }, async endpoint => withBinding(scopeFor, async f => {
      f.connect(); f.ipc.sender.mainFrame.url = 'file:///synthetic-other/index.html'
      const result = await f.binding.read(payload(endpoint)); publicOnly(result)
      assert.equal(result.code, 'untrusted-frame'); assert.equal(result.summary, null)
      await f.drained(); assert.equal(f.counts().nativeCalls, 1); assert.equal(f.counts().requests, 0); assert.equal(gets, 0)
    }))
  })
  await run('navigation cancellation reaches the actual outbound Go GET', async () => {
    const arrived = deferred(), closed = deferred(); let gets = 0
    await withObjectServer((req, res) => {
      gets++; req.resume(); res.once('close', closed.resolve); arrived.resolve()
    }, async endpoint => withBinding(scopeFor, async f => {
      f.connect(); const first = f.binding.read(payload(endpoint))
      await within(arrived.promise, 'Go GET arrival')
      f.ipc.sender.emit('did-start-navigation', {}, f.ipc.sender.mainFrame.url, false, true)
      const result = await within(first, 'navigation result'); publicOnly(result)
      assert.equal(result.code, 'native-probe-cancelled'); assert.equal(result.summary, null)
      await within(closed.promise, 'Go outbound cancellation'); await f.drained()
      assert.equal(gets, 1); assert.equal(f.counts().requests, 1); assert.equal(f.binding.snapshot(), result)
    }))
  })
  await run('input A-B-A invalidation does not cancel or adopt the old GET', async () => {
    const arrived = deferred(); let gets = 0, response
    await withObjectServer((req, res) => {
      gets++; req.resume()
      if (gets === 1) { response = res; arrived.resolve() } else res.end('PRIVATE_OBJECT')
    }, async endpoint => withBinding(scopeFor, async f => {
      f.connect(); const input = payload(endpoint), first = f.binding.read(input)
      await within(arrived.promise, 'first GET')
      input.key = 'changed'; f.binding.invalidate(); input.key = payload(endpoint).key; f.binding.invalidate()
      const stopped = await first; publicOnly(stopped); assert.equal(stopped.code, 'wait-stopped')
      assert.equal((await f.binding.read(input)).code, 'session-busy')
      assert.equal(f.counts().nativeCalls, 1); assert.equal(gets, 1); assert.equal(response.destroyed, false)
      response.end('PRIVATE_OBJECT'); await f.drained()
      assert.equal(f.binding.snapshot().code, 'wait-stopped'); assert.equal(f.binding.snapshot().summary, null)
      const next = await f.binding.read(input); publicOnly(next); assert.equal(next.state, 'readable')
      await f.drained(); assert.equal(gets, 2); assert.equal(f.counts().nativeCalls, 2)
    }))
  })
  await run('disconnect/reconnect cannot bypass main concurrency or revive old success', async () => {
    const arrived = deferred(); let gets = 0, response
    await withObjectServer((req, res) => {
      gets++; req.resume()
      if (gets === 1) { response = res; arrived.resolve() } else res.end('PRIVATE_OBJECT')
    }, async endpoint => withBinding(scopeFor, async f => {
      f.connect(); const first = f.binding.read(payload(endpoint)); await within(arrived.promise, 'old mount GET')
      f.disconnect(); assert.equal((await first).code, 'disposed'); f.connect()
      assert.equal(f.binding.snapshot().code, 'not-checked'); assert.equal(f.counts().nativeCalls, 1)
      const busy = await f.binding.read(payload(endpoint)); publicOnly(busy)
      assert.equal(busy.code, 'native-probe-busy'); assert.equal(gets, 1); assert.equal(f.counts().requests, 1)
      response.end('PRIVATE_OBJECT'); await f.drained()
      assert.equal(f.binding.snapshot().code, 'native-probe-busy')
      const next = await f.binding.read(payload(endpoint)); publicOnly(next); assert.equal(next.state, 'readable')
      await f.drained(); assert.equal(gets, 2); assert.equal(f.counts().requests, 2)
    }))
  })
  await run('observer invalidation suppresses real success for caller and snapshot', async () => {
    let gets = 0
    await withObjectServer((_req, res) => { gets++; res.end('PRIVATE_OBJECT') }, async endpoint => withBinding(scopeFor, async f => {
      f.connect()
      const unsubscribe = f.binding.subscribe(() => { if (f.binding.snapshot().state === 'readable') f.binding.invalidate() })
      try {
        const result = await f.binding.read(payload(endpoint)); publicOnly(result)
        assert.equal(result.code, 'not-checked'); assert.equal(result.summary, null)
        await f.drained(); assert.equal(gets, 1); assert.equal(f.binding.snapshot().code, 'not-checked')
      } finally { unsubscribe() }
    }))
  })
  assert.equal(checked.length, 12)
  return { passed: checked.length, checks: checked, rendererSessionExecuted: true,
    observableBindingExecuted: true, reactRuntimeExecuted: false, electronRuntimeExecuted: false }
}
