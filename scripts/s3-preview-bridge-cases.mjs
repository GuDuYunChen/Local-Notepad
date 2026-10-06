import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createS3PreviewService, registerS3PreviewHandler, S3_PREVIEW_CHANNEL, S3_PREVIEW_URL } from '../electron/s3-preview-bridge.js'
import { encodeS3PreviewRequest, decodeS3PreviewResponse, S3_PREVIEW_LIMITS, S3_PREVIEW_RESPONSE_LIMIT } from '../electron/s3-preview-codec.js'
import { createS3ProbeScope } from '../electron/s3-probe-scope.js'

const zero = () => ({ total: 0, upload_candidates: 0, download_candidates: 0, conflicts: 0, noops: 0 })
export function previewSuccess() {
  return { code: 0, message: 'OK', data: { format: 'local-notepad-s3-plan-overview', version: 1, read_only: true,
    counts: { ...zero(), total: 1, conflicts: 1 }, kinds: ['file', 'tag', 'file-tag', 'attachment'].map((kind, i) =>
      ({ kind, counts: i === 0 ? { ...zero(), total: 1, conflicts: 1 } : zero() })) } }
}
export function previewPayload() {
  return { readOnly: true,
    connection: { endpoint: 'https://synthetic.invalid', bucket: 'test-bucket', region: 'us-east-1', prefix: '目录/e\u0301 %2F',
      accessKeyId: 'AKIASYNTHETIC', secretAccessKey: 'PRIVATE_SECRET', sessionToken: 'PRIVATE_TOKEN' },
    pin: { storeId: 'PRIVATE_STORE', generation: 1, sha256: 'a'.repeat(64) },
    basis: { storeId: 'PRIVATE_STORE', localRecords: {}, baseItems: {} },
    limits: { localRecordBytes: 4096, totalLocalRecordBytes: 8192, maxLocalRecords: 4,
      manifestBytes: 4096, recordBytes: 4096, totalRecordBytes: 8192, maxRecords: 4, maxItems: 12 } }
}
const failure = code => ({ success: false, status: 0, code, data: null })
function cleanResult(value) { assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|AKIASYNTHETIC|synthetic\.invalid/) }
function fake(config = {}) {
  const calls = [], state = { requests: [], responses: [] }
  const requestImpl = (url, options, callback) => {
    if (config.throwRequest) throw new Error('PRIVATE_SECRET')
    const req = new EventEmitter(); state.requests.push(req)
    req.destroy = () => { req.destroyed = true; if (!config.holdClose) queueMicrotask(() => req.emit('close')) }
    req.end = body => {
      calls.push({ url: String(url), options, body })
      if (config.throwEnd) throw new Error('PRIVATE_SECRET')
      state.deliver = () => {
        const res = new EventEmitter(); state.responses.push(res)
        res.rawHeaders = config.rawHeaders || ['Content-Type', 'application/json; charset=utf-8']
        res.rawTrailers = config.trailers || []; res.trailers = {}
        res.complete = false; res.statusCode = config.status ?? 200
        res.destroy = () => { res.destroyed = true }
        callback(res)
        state.end = () => { res.complete = config.complete !== false; res.emit('end'); if (!config.holdClose) req.emit('close') }
        if (!config.holdBody) { res.emit('data', config.raw ?? Buffer.from(JSON.stringify(config.body || previewSuccess()))); state.end() }
        return res
      }
      if (!config.holdHeaders) queueMicrotask(state.deliver)
    }
    return req
  }
  return { requestImpl, calls, state }
}
export function previewScope(service, extras = {}) {
  const state = { expected: 'file:///synthetic-app/dist/index.html', closing: false }
  const sender = new EventEmitter(); sender.mainFrame = { url: state.expected }; sender.getURL = () => sender.mainFrame.url; sender.isDestroyed = () => false
  const win = new EventEmitter(); win.webContents = sender; win.isDestroyed = () => false
  state.win = win
  const scope = createS3ProbeScope({ getWindow: () => state.win, getExpectedURL: () => state.expected, isClosing: () => state.closing, ...extras })
  const handlers = new Map(); registerS3PreviewHandler({ handle: (k, v) => handlers.set(k, v) }, service, scope)
  const event = { sender, senderFrame: sender.mainFrame }
  return { state, sender, win, scope, event, handlers, invoke: (payload, e = event) => handlers.get(S3_PREVIEW_CHANNEL)(e, payload) }
}

export function registerS3PreviewBridgeTests(test) {
  test('preview codec snapshots exact Unicode strings without evaluating toJSON or getters', () => {
    const p = previewPayload(); p.basis.localRecords['file:雪'] = '{ "content": "e\\u0301 %2F PRIVATE_BODY" }'
    const result = encodeS3PreviewRequest(p)
    assert.ok(result); assert.deepEqual(JSON.parse(result.body), p); assert.equal(result.maxItems, 12)
    p.connection.secretAccessKey = 'changed'; p.basis.localRecords['file:雪'] = 'changed'; p.limits.maxItems = 1
    assert.match(result.body, /PRIVATE_SECRET/); assert.match(result.body, /PRIVATE_BODY/); assert.equal(result.maxItems, 12)
  })
  for (const section of ['root', 'connection', 'pin', 'basis', 'limits', 'localRecords', 'baseItems']) {
    const get = p => section === 'root' ? p : ['localRecords', 'baseItems'].includes(section) ? p.basis[section] : p[section]
    const set = (p, v) => { if (section === 'root') return v; if (['localRecords','baseItems'].includes(section)) p.basis[section] = v; else p[section] = v; return p }
    for (const [name, value] of [['null', null], ['array', []], ['string', 'PRIVATE_SECRET']]) {
      test(`preview codec refuses ${section} ${name}`, () => assert.equal(encodeS3PreviewRequest(set(previewPayload(), value)), null))
    }
    test(`preview codec never invokes a ${section} getter`, () => {
      const p = previewPayload(), sectionValue = get(p); let touched = 0
      const key = Object.keys(sectionValue)[0] || 'file:secret'
      Object.defineProperty(sectionValue, key, { enumerable: true, configurable: true, get() { touched++; throw new Error('PRIVATE_SECRET') } })
      assert.equal(encodeS3PreviewRequest(p), null); assert.equal(touched, 0)
    })
    test(`preview codec refuses ${section} symbols and non-data prototypes`, () => {
      const p = previewPayload(); get(p)[Symbol('PRIVATE')] = 1; assert.equal(encodeS3PreviewRequest(p), null)
      const q = previewPayload(); Object.setPrototypeOf(get(q), { inherited: 1 }); assert.equal(encodeS3PreviewRequest(q), null)
    })
  }
  for (const field of ['readOnly', 'connection', 'pin', 'basis', 'limits']) {
    test(`preview codec requires explicit ${field}`, () => { const p = previewPayload(); delete p[field]; assert.equal(encodeS3PreviewRequest(p), null) })
  }
  for (const [field, cap] of Object.entries(S3_PREVIEW_LIMITS)) {
    test(`preview codec bounds exact safe integer ${field}`, () => {
      for (const n of [0, -1, 0.5, cap + 1, String(cap), NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const p = previewPayload(); p.limits[field] = n; assert.equal(encodeS3PreviewRequest(p), null)
      }
      const p = previewPayload(); p.limits[field] = cap; assert.ok(encodeS3PreviewRequest(p))
    })
  }
  test('preview codec refuses unsafe generation, wrong pin, missing basis and unsafe strings', () => {
    for (const mutate of [p => { p.readOnly = false }, p => { p.pin.generation = 2 ** 53 }, p => { p.pin.generation = '1' },
      p => { p.pin.sha256 = 'A'.repeat(64) }, p => { p.basis.storeId = 'OTHER' }, p => { delete p.basis.localRecords },
      p => { p.connection.secretAccessKey = '\ud800' }, p => { p.connection.prefix = '\udfff' }, p => { p.pin.storeId = '\n'; p.basis.storeId = '\n' },
      p => { p.connection.extra = 'PRIVATE' }, p => { p.basis.baseItems['file:a'] = 'invalid' }]) {
      const p = previewPayload(); mutate(p); assert.equal(encodeS3PreviewRequest(p), null)
    }
  })
  test('preview codec enforces individual UTF8, aggregate and cardinality budgets before encoding', () => {
    const p = previewPayload(); p.limits.localRecordBytes = 3; p.basis.localRecords['file:a'] = '雪'; assert.ok(encodeS3PreviewRequest(p))
    p.basis.localRecords['file:a'] = '雪雪'; assert.equal(encodeS3PreviewRequest(p), null)
    const q = previewPayload(); q.limits.totalLocalRecordBytes = 5; q.basis.localRecords = { 'file:a': 'abc', 'file:b': 'abc' }; assert.equal(encodeS3PreviewRequest(q), null)
    const r = previewPayload(); r.limits.maxLocalRecords = 1; r.basis.localRecords = { 'file:a': 'a', 'file:b': 'b' }; assert.equal(encodeS3PreviewRequest(r), null)
    const s = previewPayload(); for (let i = 0; i < 129; i++) s.basis.baseItems[`file:${i}`] = 'a'.repeat(64); assert.equal(encodeS3PreviewRequest(s), null)
  })
  test('preview codec counts escaped JSON in its 2MiB wire budget and refuses reflection exceptions', () => {
    const p = previewPayload(); p.limits = { ...S3_PREVIEW_LIMITS }
    for (let i = 0; i < 4; i++) p.basis.localRecords[`file:${i}`] = '\0'.repeat(256 * 1024)
    assert.equal(encodeS3PreviewRequest(p), null)
    const r = Proxy.revocable(previewPayload(), {}); r.revoke(); assert.equal(encodeS3PreviewRequest(r.proxy), null)
    assert.equal(encodeS3PreviewRequest(new Proxy(previewPayload(), { ownKeys() { throw new Error('PRIVATE_SECRET') } })), null)
    let touched = 0; const q = previewPayload(); q.toJSON = () => { touched++; return p }; assert.equal(encodeS3PreviewRequest(q), null); assert.equal(touched, 0)
  })
  test('preview result is a recursively frozen identity-free copy including conflicts and all four kinds', () => {
    const result = decodeS3PreviewResponse(200, JSON.stringify(previewSuccess()), 12)
    assert.equal(result.success, true); assert.equal(result.data.counts.conflicts, 1); assert.equal(result.data.kinds.length, 4)
    for (const v of [result, result.data, result.data.counts, result.data.kinds, ...result.data.kinds, ...result.data.kinds.map(r => r.counts)]) assert.equal(Object.isFrozen(v), true)
    cleanResult(result)
  })
  const safe = [[400,'invalid-request'],[400,'invalid-request-target'],[400,'invalid-connection'],[403,'native-loopback-required'],
    [405,'method-not-allowed'],[408,'preview-cancelled'],[413,'request-too-large'],[415,'json-required'],[415,'encoded-request-refused'],
    [422,'preview-not-available'],[429,'preview-busy'],[503,'preview-unavailable'],[504,'preview-timeout']]
  for (const [status, message] of safe) test(`preview result preserves exact ${status}/${message} with null data`, () => {
    const result = decodeS3PreviewResponse(status, JSON.stringify({ code: status, message, data: null }), 12)
    assert.deepEqual(result, { success: false, status, code: message, data: null }); cleanResult(result)
    assert.equal(decodeS3PreviewResponse(status, JSON.stringify({ code: status, message, data: previewSuccess().data }), 12).code, 'native-preview-invalid-response')
  })
  const badResults = [
    ['root extra', x => { x.secret = 'PRIVATE' }], ['root code', x => { x.code = 200 }], ['root message', x => { x.message = 'private' }],
    ['data extra', x => { x.data.id = 'PRIVATE' }], ['format', x => { x.data.format = 'other' }], ['version', x => { x.data.version = 2 }],
    ['read only', x => { x.data.read_only = false }], ['counts missing', x => { delete x.data.counts.noops }],
    ['counts extra', x => { x.data.counts.secret = 0 }], ['negative', x => { x.data.counts.conflicts = -1 }],
    ['fraction', x => { x.data.counts.conflicts = 0.5 }], ['unsafe integer', x => { x.data.counts.total = 2 ** 53 }],
    ['hidden conflict', x => { x.data.counts.conflicts = 0 }], ['wrong row aggregate', x => { x.data.kinds[0].counts.conflicts = 0; x.data.kinds[0].counts.total = 0 }],
    ['short kinds', x => { x.data.kinds.pop() }], ['duplicate kind', x => { x.data.kinds[1].kind = 'file' }],
    ['kind order', x => { x.data.kinds.reverse() }], ['kind field extra', x => { x.data.kinds[0].id = 'PRIVATE' }],
    ['kind null', x => { x.data.kinds[0] = null }], ['kind counts array', x => { x.data.kinds[0].counts = [] }],
  ]
  for (const [name, mutate] of badResults) test(`preview result refuses ${name}`, () => {
    const x = previewSuccess(); mutate(x)
    assert.deepEqual(decodeS3PreviewResponse(200, JSON.stringify(x), 12), failure('native-preview-invalid-response'))
  })
  test('preview result rejects duplicate escaped names, malformed Unicode, depth and body limits', () => {
    const raw = JSON.stringify(previewSuccess())
    for (const text of [raw.replace('"code":0', '"code":0,"\\u0063ode":0'), raw.replace('"conflicts":1', '"conflicts":1,"conflicts":1'),
      raw.replace('"file"', '"\\ud800"'), raw + '{}', '\ufeff' + raw, '['.repeat(7)+'0'+']'.repeat(7), ' '.repeat(S3_PREVIEW_RESPONSE_LIMIT)+raw]) {
      assert.equal(decodeS3PreviewResponse(200, text, 12).code, 'native-preview-invalid-response')
    }
    for (const status of [201, 204, 302, 404, 500]) assert.equal(decodeS3PreviewResponse(status, raw, 12).code, 'native-preview-invalid-response')
    const x = previewSuccess(); x.data.counts.total = x.data.counts.conflicts = x.data.kinds[0].counts.total = x.data.kinds[0].counts.conflicts = 2
    assert.equal(decodeS3PreviewResponse(200, JSON.stringify(x), 1).code, 'native-preview-invalid-response')
  })
  test('preview service is lazy and sends exactly the fixed native POST with body-only private inputs', async () => {
    const f = fake(), service = createS3PreviewService({ requestImpl: f.requestImpl }); assert.equal(f.calls.length, 0)
    const p = previewPayload(), out = await service.preview(p); assert.equal(out.success, true); cleanResult(out)
    assert.equal(f.calls.length, 1); const c = f.calls[0]
    assert.equal(c.url, S3_PREVIEW_URL); assert.equal(c.options.method, 'POST'); assert.equal(c.options.agent, false)
    assert.equal(c.options.headers['X-Notepad-Read-Only'], 's3-preview'); assert.equal(Number(c.options.headers['Content-Length']), Buffer.byteLength(c.body))
    assert.deepEqual(JSON.parse(c.body), p); assert.doesNotMatch(JSON.stringify(c.options), /PRIVATE_|AKIA|origin|referer|sec-fetch/i)
  })
  test('preview service refuses configurable targets, unsafe deadlines and invalid payload without I/O', async () => {
    for (const target of ['https://evil.invalid', S3_PREVIEW_URL+'?x', S3_PREVIEW_URL.replace('27121','27122')]) assert.throws(() => createS3PreviewService({ target }))
    for (const timeoutMs of [0,-1,7501,Infinity,0.5]) assert.throws(() => createS3PreviewService({ timeoutMs }))
    const f = fake(), service = createS3PreviewService({ requestImpl: f.requestImpl }); assert.deepEqual(await service.preview({}), failure('invalid-preview-request'))
    const c = new AbortController(); c.abort(); assert.deepEqual(await service.preview(previewPayload(), { signal: c.signal }), failure('native-preview-cancelled'))
    assert.equal(f.calls.length, 0)
  })
  test('preview service reserves the slot before hostile Proxy reentrancy', async () => {
    const f = fake(), service = createS3PreviewService({ requestImpl: f.requestImpl }); let inner, entered = false
    const value = new Proxy(previewPayload(), { getPrototypeOf(target) {
      if (!entered) { entered = true; inner = service.preview(previewPayload()) }
      return Object.getPrototypeOf(target)
    } })
    assert.equal((await service.preview(value)).success, true); assert.deepEqual(await inner, failure('native-preview-busy')); assert.equal(f.calls.length, 1)
  })
  test('preview service observes cancellation during parameter reflection before network', async () => {
    const c = new AbortController(), f = fake(), service = createS3PreviewService({ requestImpl: f.requestImpl })
    const value = new Proxy(previewPayload(), { getPrototypeOf(target) { c.abort(); return Object.getPrototypeOf(target) } })
    assert.equal((await service.preview(value, { signal: c.signal })).code, 'native-preview-cancelled'); assert.equal(f.calls.length, 0)
  })
  for (const [mode, config, expected] of [['success', { holdClose: true }, 'OK'], ['invalid', { holdClose: true, body: { secret: 'PRIVATE' } }, 'native-preview-invalid-response'],
    ['cancel', { holdHeaders: true, holdClose: true }, 'native-preview-cancelled'], ['timeout', { holdHeaders: true, holdClose: true }, 'native-preview-timeout']]) {
    test(`preview service holds ${mode} transport ownership until real request close`, async () => {
      const f = fake(config), c = new AbortController(), service = createS3PreviewService({ requestImpl: f.requestImpl, timeoutMs: mode==='timeout' ? 20 : 500 })
      const pending = service.preview(previewPayload(), { signal: c.signal }); if (mode==='cancel') c.abort()
      assert.equal((await pending).code, expected)
      assert.equal((await service.preview(previewPayload())).code, 'native-preview-busy'); assert.equal(f.calls.length, 1)
      f.state.requests[0].emit('close'); const next = service.preview(previewPayload()); f.state.requests.at(-1).emit('error', new Error('PRIVATE_LATE'))
      await next; f.state.requests.at(-1).emit('close')
    })
  }
  const badHeaders = [
    ['Content-Type','text/plain'], ['Content-Type','application/json','Content-Encoding',''],
    ['Content-Type','application/json','Content-Encoding','identity'], ['Content-Type','application/json','Trailer',''],
    ['Content-Type','application/json','content-type','application/json'], ['Content-Type','application/json','Content-Length','01'],
    ['Content-Type','application/json','Content-Length','2','content-length','2'], ['Content-Type','application/json','Transfer-Encoding','gzip'],
    ['Content-Type','application/json','Transfer-Encoding','chunked','Content-Length','10'], ['Content-Type','application/json','Content-Length','16385'],
    ['Content-Type'],
  ]
  badHeaders.forEach((rawHeaders, i) => test(`preview transport rejects ambiguous response headers ${i}`, async () => {
    const f = fake({ rawHeaders }); assert.equal((await createS3PreviewService({ requestImpl:f.requestImpl }).preview(previewPayload())).code, 'native-preview-invalid-response')
    assert.equal(f.state.requests[0].destroyed, true)
  }))
  for (const [name, config] of [['UTF8', { raw: Buffer.from([0xc0,0xaf]) }], ['BOM', { raw: Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(JSON.stringify(previewSuccess()))]) }],
    ['body limit',{raw:Buffer.alloc(16385)}], ['partial',{complete:false}], ['trailer',{trailers:['X-Private','PRIVATE_SECRET']}],
    ['wrong length',{rawHeaders:['Content-Type','application/json','Content-Length','1']}], ['text chunk',{raw:'not-a-buffer'}]]) {
    test(`preview transport rejects ${name} without partial data`, async () => {
      const f = fake(config); const out=await createS3PreviewService({requestImpl:f.requestImpl}).preview(previewPayload())
      assert.deepEqual(out,failure('native-preview-invalid-response'));cleanResult(out)
    })
  }
  test('preview transport never exposes constructor/end/errors and tolerates late error events', async () => {
    for (const option of ['throwRequest','throwEnd']) {
      const f=fake({[option]:true}); const result=await createS3PreviewService({requestImpl:f.requestImpl}).preview(previewPayload());assert.deepEqual(result,failure('native-preview-unavailable'));cleanResult(result)
    }
    const f=fake(),result=await createS3PreviewService({requestImpl:f.requestImpl}).preview(previewPayload())
    f.state.requests[0].emit('error',new Error('PRIVATE'));f.state.responses[0].emit('error',new Error('PRIVATE'));assert.equal(result.success,true)
  })
  test('preview transport monotonic deadline rejects success after a blocked event loop', async () => {
    const f=fake({holdHeaders:true}),service=createS3PreviewService({requestImpl:f.requestImpl,timeoutMs:20})
    const result=service.preview(previewPayload());const until=performance.now()+35;while(performance.now()<until){}
    f.state.deliver();assert.equal((await result).code,'native-preview-timeout')
  })
  test('preview IPC rejects foreign frames before payload reflection', async () => {
    const f=fake(),s=previewScope(createS3PreviewService({requestImpl:f.requestImpl}));let touched=0
    const p=new Proxy(previewPayload(),{getPrototypeOf(t){touched++;return Object.getPrototypeOf(t)}})
    for(const e of [{}, {sender:s.sender,senderFrame:{url:s.state.expected}}, {sender:{},senderFrame:s.sender.mainFrame}]) assert.equal((await s.invoke(p,e)).code,'untrusted-frame')
    s.state.closing=true;assert.equal((await s.invoke(p)).code,'untrusted-frame');assert.equal(touched,0);assert.equal(f.calls.length,0)
  })
  for(const eventName of ['did-start-navigation','render-process-gone','destroyed','close','closed','before-quit']) test(`preview IPC ${eventName} cancels and cannot deliver old success`, async () => {
    const f=fake({holdHeaders:true}),s=previewScope(createS3PreviewService({requestImpl:f.requestImpl}))
    const pending=s.invoke(previewPayload())
    if(eventName==='before-quit')s.scope.abortAll()
    else if(eventName==='close'||eventName==='closed')s.win.emit(eventName)
    else s.sender.emit(eventName,{},s.state.expected,false,true)
    assert.equal((await pending).code,'native-preview-cancelled');assert.equal(f.state.requests[0].destroyed,true)
    f.state.deliver();assert.equal(s.sender.listenerCount('destroyed'),0)
  })
  test('preview IPC rechecks a replaced window before response delivery and releases its lease', async () => {
    const f=fake({holdHeaders:true}),s=previewScope(createS3PreviewService({requestImpl:f.requestImpl}))
    const pending=s.invoke(previewPayload());s.state.win={...s.win};f.state.deliver()
    assert.equal((await pending).code,'native-preview-cancelled');assert.equal(s.sender.listenerCount('destroyed'),0)
  })
  test('preview main registration binds the original exact URL and closing state; quit only aborts', () => {
    const file=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8')
    const start=file.indexOf('// Independent preview lifetime;'),end=file.indexOf("app.on('before-quit', () => s3PreviewScope.abortAll())",start)
    assert.ok(start>0&&end>start);const configs=[],events=[],registrations=[];let aborted=0
    const env={createS3PreviewService:()=>({marker:true}),createS3ProbeScope:cfg=>{configs.push(cfg);return {abortAll:()=>{aborted++}}},
      registerS3PreviewHandler:(...args)=>registrations.push(args),ipcMain:{},mainWindow:{marker:true},path,pathToFileURL,
      app:{isPackaged:false,getAppPath:()=>path.resolve('synthetic-app'),on:(name,fn)=>events.push([name,fn])},quitting:false,allowQuit:false,windowClosePromise:null}
    vm.runInNewContext(file.slice(start,end)+"app.on('before-quit', () => s3PreviewScope.abortAll())",env)
    assert.equal(registrations.length,1);assert.equal(configs[0].getExpectedURL(),'http://localhost:5000/');assert.equal(configs[0].getWindow(),env.mainWindow)
    env.app.isPackaged=true;assert.equal(configs[0].getExpectedURL(),pathToFileURL(path.join(env.app.getAppPath(),'dist/index.html')).href)
    assert.equal(configs[0].isClosing(),false);env.windowClosePromise=Promise.resolve();assert.equal(configs[0].isClosing(),true)
    assert.deepEqual(events.map(x=>x[0]),['before-quit']);events[0][1]();assert.equal(aborted,1)
  })
  test('preview preload exposes only one explicit payload invoke without eager network or generic ipc', async () => {
    const raw=fs.readFileSync(new URL('../electron/preload.js',import.meta.url),'utf8')
    // Git's Windows checkout may use CRLF. Exercise both byte conventions;
    // strip only the leading Electron import, never rewrite the production file.
    for (const source of [raw.replace(/\r\n/g,'\n'), raw.replace(/\r?\n/g,'\r\n')]) {
      const file=source.replace(/^import [^\r\n]*\r?\n/,'')
      assert.doesNotMatch(file,/^import /)
      const worlds={},calls=[];vm.runInNewContext(file,{process:{env:{}},contextBridge:{exposeInMainWorld:(name,value)=>worlds[name]=value},
        ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve('ok')}},webUtils:{}})
      assert.equal(calls.length,0);const p=previewPayload();await worlds.electronAPI.s3PreviewRead(p)
      assert.equal(calls.length,1);assert.equal(calls[0][0],S3_PREVIEW_CHANNEL);assert.equal(calls[0][1],p)
      assert.equal(worlds.electronAPI.invoke,undefined);assert.equal(typeof worlds.electronAPI.s3ProbeRead,'function')
    }
  })
}
