import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createS3ProbeService, encodeS3ProbeRequest, registerS3ProbeHandler,
  S3_PROBE_CHANNEL, S3_PROBE_URL } from '../electron/s3-probe-bridge.js'
import { createS3ProbeScope } from '../electron/s3-probe-scope.js'

export const probePayload = (overrides = {}) => ({ endpoint: 'https://synthetic.example.invalid', bucket: 'test', region: 'us-east-1',
  prefix: 'p/', accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret', sessionToken: 'synthetic-token',
  key: '目录/对象.json', maxBytes: 4096, readOnly: true, ...overrides })
const success = { code: 0, message: 'OK', data: { outcome: 'readable', httpStatus: 200, acceptedBytes: 17 } }
const resultOK = { success: true, status: 200, code: 'OK', data: success.data }
const error = code => ({ success: false, status: 0, code, data: null })

function fakeTransport(config = {}) {
  const calls = [], state = { requests: [], responses: [] }
  const requestImpl = (url, options, callback) => {
    if (config.throwRequest) throw new Error('synthetic-secret')
    const req = new EventEmitter(); req.destroyCount = 0; state.requests.push(req)
    req.destroy = () => {
      if (req.destroyed) return
      req.destroyed = true; req.destroyCount++
      if (!config.holdClose) queueMicrotask(() => req.emit('close'))
    }
    req.end = body => {
      calls.push({ url: String(url), options, body })
      if (config.throwEnd) throw new Error('synthetic-secret')
      state.deliver = () => {
        const res = new EventEmitter(); state.responses.push(res)
        res.headers = config.headers || { 'content-type': 'application/json; charset=utf-8' }
        res.rawHeaders = config.rawHeaders || Object.entries(res.headers).flatMap(([k, v]) => [k, v])
        res.rawTrailers = config.trailers || []; res.trailers = {}
        res.statusCode = config.status ?? 200; res.complete = false
        res.destroy = () => { res.destroyed = true }
        callback(res)
        state.end = () => {
          res.complete = config.complete !== false
          res.emit('end')
          if (!config.holdClose) req.emit('close')
        }
        if (!config.holdBody) {
          res.emit('data', config.raw ?? Buffer.from(JSON.stringify(config.body || success)))
          state.end()
        }
        return res
      }
      if (!config.holdHeaders) queueMicrotask(state.deliver)
    }
    return req
  }
  return { requestImpl, state, calls }
}
function scoped(service, options = {}) {
  const state = { closing: false, expected: 'file:///synthetic-app/dist/index.html' }
  const contents = new EventEmitter(); contents.mainFrame = { url: state.expected }
  contents.getURL = () => contents.mainFrame.url; contents.isDestroyed = () => false
  const win = new EventEmitter(); win.webContents = contents; win.isDestroyed = () => false
  const scope = createS3ProbeScope({ getWindow: () => win, getExpectedURL: () => state.expected,
    isClosing: () => state.closing, ...options })
  const handlers = new Map()
  registerS3ProbeHandler({ handle: (key, fn) => handlers.set(key, fn) }, service, scope)
  return { state, contents, win, scope, handlers, event: { sender: contents, senderFrame: contents.mainFrame },
    invoke: (event, payload) => handlers.get(S3_PROBE_CHANNEL)(event, payload) }
}

export function registerS3ProbeBridgeTests(test) {
  test('retains exact input without normalizing object keys or credentials', () => {
    const p = probePayload({ key: 'a/../a%2F b/\u96ea', prefix: ' spaced /', secretAccessKey: ' whitespace ' })
    assert.deepEqual(JSON.parse(encodeS3ProbeRequest(p)), p)
  })
  for (const [name, input] of [
    ['false intent', () => probePayload({ readOnly: false })], ['bad limit', () => probePayload({ maxBytes: 0 })],
    ['oversized limit', () => probePayload({ maxBytes: 1048577 })], ['fractional limit', () => probePayload({ maxBytes: 1.5 })],
    ['missing field', () => { const p = probePayload(); delete p.key; return p }],
    ['unknown field', () => ({ ...probePayload(), extra: 'x' })], ['wrong string type', () => probePayload({ sessionToken: null })],
    ['array', () => []], ['null', () => null], ['prototype', () => new Date()],
    ['symbol', () => ({ ...probePayload(), [Symbol('private')]: true })],
    ['accessor', () => Object.defineProperty(probePayload(), 'key', { enumerable: true, get() { throw new Error('secret') } })],
    ['hidden field', () => Object.defineProperty(probePayload(), 'key', { enumerable: false, value: 'hidden' })],
    ['throwing proxy', () => new Proxy({}, { getPrototypeOf() { throw new Error('secret') } })],
    ['lone surrogate', () => probePayload({ key: '\ud800' })],
    ['oversized input', () => probePayload({ key: 'x'.repeat(65536) })],
    ['toJSON', () => ({ ...probePayload(), toJSON() { throw new Error('secret') } })],
  ]) test(`input: rejects ${name} without transport or error disclosure`, async () => {
    const f = fakeTransport(); const p = input()
    assert.equal(encodeS3ProbeRequest(p), null)
    assert.deepEqual(await createS3ProbeService({ requestImpl: f.requestImpl }).probe(p), error('invalid-bridge-request'))
    assert.equal(f.calls.length, 0)
  })
  test('fixed loopback POST; credentials are body-only; no browser-origin headers', async () => {
    const f = fakeTransport(), service = createS3ProbeService({ requestImpl: f.requestImpl })
    assert.deepEqual(await service.probe(probePayload()), resultOK)
    const call = f.calls[0]
    assert.equal(call.url, S3_PROBE_URL); assert.equal(call.options.method, 'POST')
    assert.equal(call.options.agent, false); assert.equal(call.options.headers.Connection, 'close')
    assert.equal(call.options.headers['X-Notepad-Read-Only'], 's3-probe')
    assert.equal(Number(call.options.headers['Content-Length']), Buffer.byteLength(call.body))
    assert.ok(!/origin|referer|sec-fetch/i.test(Object.keys(call.options.headers).join(' ')))
    assert.ok(!JSON.stringify([call.url, call.options]).includes('synthetic-secret'))
    assert.deepEqual(JSON.parse(call.body), probePayload())
    assert.deepEqual(await service.probe(probePayload()), resultOK)
  })
  for (const target of ['https://example.invalid/', 'http://127.0.0.1:27122/api/sync/s3/probe',
    S3_PROBE_URL + '?x=1', S3_PROBE_URL + '#x', 'http://user@127.0.0.1:27121/api/sync/s3/probe',
    'http://2130706433:27121/api/sync/s3/probe', 'http://localhost:27121/api/sync/s3/probe']) {
    test(`rejects non-fixed destination ${target}`, () => assert.throws(() => createS3ProbeService({ target }), /invalid native probe target/))
  }
  for (const [status, message, data] of [
    [400, 'invalid-request', null], [400, 'invalid-request-target', null], [403, 'native-loopback-required', null],
    [405, 'method-not-allowed', null], [413, 'request-too-large', null], [415, 'json-required', null],
    [415, 'encoded-request-refused', null], [429, 'probe-busy', null], [503, 'probe-unavailable', null],
    [422, 'probe-not-readable', { outcome: 'access-denied', httpStatus: 403, acceptedBytes: 0 }],
    [422, 'probe-not-readable', { outcome: 'not-found', httpStatus: 404, acceptedBytes: 0 }],
    [422, 'probe-not-readable', { outcome: 'invalid-config', acceptedBytes: 0 }],
    [422, 'probe-not-readable', { outcome: 'transport-failure', acceptedBytes: 0 }],
    [422, 'probe-not-readable', { outcome: 'cancelled', acceptedBytes: 0 }],
    [422, 'probe-not-readable', { outcome: 'deadline-exceeded', acceptedBytes: 0 }],
  ]) test(`preserves backend classification ${status}/${message}/${data?.outcome || 'none'}`, async () => {
    const f = fakeTransport({ status, body: { code: status, message, data } })
    const result = await createS3ProbeService({ requestImpl: f.requestImpl }).probe(probePayload())
    assert.deepEqual(result, { success: false, status, code: message, data: data && { ...data, httpStatus: data.httpStatus || 0 } })
  })
  const badResponses = [
    ['empty encoding header', { headers: { 'content-type': 'application/json', 'content-encoding': '' } }],
    ['gzip', { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } }],
    ['duplicate encoding', { rawHeaders: ['Content-Type', 'application/json', 'content-encoding', '', 'CONTENT-ENCODING', 'gzip'] }],
    ['duplicate content type', { rawHeaders: ['Content-Type', 'application/json', 'CONTENT-TYPE', 'application/json'] }],
    ['wrong content type', { headers: { 'content-type': 'text/plain' } }],
    ['missing content type', { headers: {} }],
    ['declared oversized body', { headers: { 'content-type': 'application/json', 'content-length': '65537' } }],
    ['length mismatch', { headers: { 'content-type': 'application/json', 'content-length': '1' } }],
    ['noncanonical length', { headers: { 'content-type': 'application/json', 'content-length': '01' } }],
    ['duplicate length', { rawHeaders: ['Content-Type','application/json','Content-Length','1','content-length','1'] }],
    ['length and transfer', { headers: { 'content-type':'application/json','content-length':'1','transfer-encoding':'chunked' } }],
    ['unknown transfer coding', { headers: { 'content-type':'application/json','transfer-encoding':'gzip' } }],
    ['oversized response', { raw: Buffer.alloc(65537) }], ['incomplete response', { complete: false }],
    ['encoded trailer', { trailers: ['Content-Encoding', 'gzip'] }],
    ['bad UTF8', { raw: Buffer.concat([Buffer.from('{"code":0,"message":"OK","data":{"outcome":"readable","httpStatus":200,"acceptedBytes":1},"x":"'),Buffer.from([0xff]),Buffer.from('"}')]) }],
    ['duplicate property', { raw: Buffer.from('{"code":999,"code":0,"message":"OK","data":{"outcome":"readable","httpStatus":200,"acceptedBytes":1}}') }],
    ['escaped duplicate property', { raw: Buffer.from('{"code":999,"co\\u0064e":0,"message":"OK","data":{"outcome":"readable","httpStatus":200,"acceptedBytes":1}}') }],
    ['trailing JSON', { raw: Buffer.from(JSON.stringify(success) + '{}') }],
    ['unknown envelope field', { body: { ...success, private: 'synthetic-secret' } }],
    ['unknown data field', { body: { ...success, data: { ...success.data, ETag: 'synthetic-secret' } } }],
    ['status/message mismatch', { status: 403, body: { code: 403, message: 'OK', data: null } }],
    ['wrong code', { body: { ...success, code: 200 } }],
    ['wrong success outcome', { body: { ...success, data: { ...success.data, outcome: 'not-found' } } }],
    ['failure with partial bytes', { status: 422, body: { code: 422, message: 'probe-not-readable', data: { outcome: 'access-denied', httpStatus:403,acceptedBytes:1 } } }],
    ['failure/outcome mismatch', { status:422,body:{code:422,message:'probe-not-readable',data:{outcome:'not-found',httpStatus:403,acceptedBytes:0}} }],
    ['unavailable with data', { status:503,body:{code:503,message:'probe-unavailable',data:{outcome:'transport-failure',acceptedBytes:0}} }],
    ['422 missing data', { status:422,body:{code:422,message:'probe-not-readable',data:null} }],
    ['transport status contradiction', { status:422,body:{code:422,message:'probe-not-readable',data:{outcome:'transport-failure',httpStatus:200,acceptedBytes:0}} }],
    ['returned key exceeds request limit', { body:{...success,data:{...success.data,acceptedBytes:4097}} }],
    ['malicious server message', { status:500,body:{code:500,message:'synthetic-secret',data:null} }],
  ]
  for (const [name, config] of badResponses) test(`response: rejects ${name}`, async () => {
    const f = fakeTransport(config), result = await createS3ProbeService({ requestImpl:f.requestImpl }).probe(probePayload())
    assert.deepEqual(result,error('native-probe-invalid-response'))
    assert.equal(f.state.requests[0].destroyCount,1)
    assert.ok(!JSON.stringify(result).includes('synthetic-secret'))
  })
  test('rejected response destroys transport and remains busy until close', async () => {
    const f=fakeTransport({headers:{'content-type':'text/plain'},holdClose:true}), service=createS3ProbeService({requestImpl:f.requestImpl})
    assert.deepEqual(await service.probe(probePayload()),error('native-probe-invalid-response'))
    assert.equal(f.state.requests[0].destroyCount,1)
    assert.deepEqual(await service.probe(probePayload()),error('native-probe-busy'))
    assert.equal(f.calls.length,1);f.state.requests[0].emit('close')
    assert.deepEqual(await service.probe(probePayload()),error('native-probe-invalid-response'))
    assert.equal(f.calls.length,2);f.state.requests[1].emit('close')
  })
  test('inflight request rejects a concurrent call without enqueuing', async () => {
    const f=fakeTransport({holdHeaders:true}), service=createS3ProbeService({requestImpl:f.requestImpl})
    const first=service.probe(probePayload());assert.deepEqual(await service.probe(probePayload()),error('native-probe-busy'))
    f.state.deliver();assert.deepEqual(await first,resultOK);assert.equal(f.calls.length,1)
  })
  test('abort before networking does not contact the service', async () => {
    const f=fakeTransport(),c=new AbortController();c.abort()
    assert.deepEqual(await createS3ProbeService({requestImpl:f.requestImpl}).probe(probePayload(),{signal:c.signal}),error('native-probe-cancelled'))
    assert.equal(f.calls.length,0)
  })
  test('abort during request holds slot until transport close; late error is absorbed', async () => {
    const f=fakeTransport({holdHeaders:true,holdClose:true}),c=new AbortController(),service=createS3ProbeService({requestImpl:f.requestImpl})
    const p=service.probe(probePayload(),{signal:c.signal});c.abort();assert.deepEqual(await p,error('native-probe-cancelled'))
    assert.deepEqual(await service.probe(probePayload()),error('native-probe-busy'))
    f.state.requests[0].emit('error',new Error('synthetic-secret'));f.state.requests[0].emit('close')
  })
  test('wall-clock timeout stops a slow drip, not only idle sockets', async () => {
    const f=fakeTransport({holdBody:true}), service=createS3ProbeService({requestImpl:f.requestImpl,timeoutMs:80})
    const p=service.probe(probePayload());await Promise.resolve()
    const drip=setInterval(()=>f.state.responses[0].emit('data',Buffer.from(' ')),5)
    try {assert.deepEqual(await p,error('native-probe-timeout'));assert.equal(f.state.requests[0].destroyCount,1)} finally {clearInterval(drip)}
  })
  for(const what of ['error','aborted','close']) test(`premature response ${what} settles without hanging or leakage`,async()=>{
    const f=fakeTransport({holdBody:true}),p=createS3ProbeService({requestImpl:f.requestImpl}).probe(probePayload());await Promise.resolve()
    f.state.responses[0].emit(what,new Error('synthetic-secret'));assert.deepEqual(await p,error('native-probe-unavailable'))
  })
  for(const setting of ['throwRequest','throwEnd']) test(`${setting} is sanitized`,async()=>{
    const f=fakeTransport({[setting]:true});assert.deepEqual(await createS3ProbeService({requestImpl:f.requestImpl}).probe(probePayload()),error('native-probe-unavailable'))
  })
  test('request close before headers settles with a fixed error',async()=>{
    const f=fakeTransport({holdHeaders:true}),p=createS3ProbeService({requestImpl:f.requestImpl}).probe(probePayload())
    f.state.requests[0].emit('close');assert.deepEqual(await p,error('native-probe-unavailable'))
  })
  test('late transport response after cancellation cannot become a success',async()=>{
    const f=fakeTransport({holdHeaders:true}),c=new AbortController(),p=createS3ProbeService({requestImpl:f.requestImpl}).probe(probePayload(),{signal:c.signal})
    c.abort();f.state.deliver();assert.deepEqual(await p,error('native-probe-cancelled'))
  })
  for(const [name,change] of [
    ['wrong contents',f=>{f.event.sender=new EventEmitter()}],['child frame',f=>{f.event.senderFrame={url:f.state.expected}}],
    ['other local page',f=>{f.contents.mainFrame.url='file:///other/index.html'}],['app quit',f=>{f.state.closing=true}],
  ])test(`IPC rejects ${name} before invoking transport`,async()=>{
    let calls=0;const f=scoped({probe:async()=>{calls++;return resultOK}});change(f)
    assert.deepEqual(await f.invoke(f.event,probePayload()),error('untrusted-frame'));assert.equal(calls,0)
  })
  for(const [name,fire] of [
    ['navigation',f=>f.contents.emit('did-start-navigation',{},'file:///other.html',false,true)],
    ['reload',f=>f.contents.emit('did-start-navigation',{},f.state.expected,false,true)],
    ['renderer crash',f=>f.contents.emit('render-process-gone')],['destroyed',f=>f.contents.emit('destroyed')],
    ['native close',f=>f.win.emit('close',{preventDefault(){}})],['scope dispose',f=>f.scope.dispose()],
  ])test(`IPC ${name} aborts and withholds late success without changing save/quit listeners`,async()=>{
    let finish,signal,calls=0;const f=scoped({probe:(_v,o)=>{calls++;signal=o.signal;return new Promise(r=>{finish=r})}})
    const save=()=>{};f.win.on('close',save);const p=f.invoke(f.event,probePayload());fire(f)
    assert.equal(signal.aborted,true)
    assert.equal((await f.invoke(f.event,probePayload())).success,false);assert.equal(calls,1)
    finish(resultOK);assert.deepEqual(await p,error('native-probe-cancelled'))
    assert.deepEqual(f.win.listeners('close'),[save]);assert.equal(f.contents.listenerCount('destroyed'),0)
  })
  test('IPC success is withheld when main document changes without a navigation event',async()=>{
    let finish;const f=scoped({probe:()=>new Promise(r=>{finish=r})}),p=f.invoke(f.event,probePayload())
    f.contents.mainFrame.url='file:///synthetic-other/document.html';finish(resultOK)
    assert.deepEqual(await p,error('native-probe-cancelled'))
  })
  test('scope timeout cancels transport and removes owned listeners on settlement',async()=>{
    const fake=fakeTransport({holdHeaders:true}),service=createS3ProbeService({requestImpl:fake.requestImpl})
    const f=scoped(service,{timeoutMs:30});assert.deepEqual(await f.invoke(f.event,probePayload()),error('native-probe-cancelled'))
    assert.equal(fake.state.requests[0].destroyCount,1);assert.equal(f.contents.listenerCount('destroyed'),0)
  })
  test('IPC preserves safe success and service failure while releasing lease',async()=>{
    const f=scoped({probe:async()=>resultOK});assert.deepEqual(await f.invoke(f.event,probePayload()),resultOK)
    assert.equal(f.contents.eventNames().length,0)
    const bad=scoped({probe:async()=>{throw new Error('synthetic-secret')}})
    assert.deepEqual(await bad.invoke(bad.event,probePayload()),error('native-probe-unavailable'))
    assert.equal(bad.contents.eventNames().length,0)
  })
  test('actual preload adds only s3ProbeRead; preserves save/quit handshake surface',async()=>{
    const source=fs.readFileSync(new URL('../electron/preload.js',import.meta.url),'utf8')
    const exposed=new Map(),calls=[],events=new EventEmitter()
    const api={...events,invoke:(...args)=>{calls.push(args);return Promise.resolve(resultOK)},send:()=>{},on:events.on.bind(events),removeListener:events.removeListener.bind(events)}
    vm.runInNewContext(source.replace(/^import[^\n]+\n/,''),{contextBridge:{exposeInMainWorld:(k,v)=>exposed.set(k,v)},ipcRenderer:api,webUtils:{},process:{env:{}}})
    const bridge=exposed.get('electronAPI');assert.equal(typeof bridge.s3ProbeRead,'function')
    assert.deepEqual(await bridge.s3ProbeRead(probePayload()),resultOK);assert.equal(calls[0][0],S3_PROBE_CHANNEL)
    assert.equal(calls[0].length,2);assert.deepEqual(calls[0][1],probePayload())
    let notified;const release=bridge.onQuitPrepare(v=>{notified=v});events.emit('editor:quit:prepare',{}, {id:'save-1'})
    assert.equal(notified.id,'save-1');release();assert.equal(events.listenerCount('editor:quit:prepare'),0)
  })
  for(const packaged of [true,false])test(`actual main scope configuration pins ${packaged?'packaged':'development'} document`,()=>{
    const source=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8')
    const start=source.indexOf('const s3ProbeScope = createS3ProbeScope('),end=source.indexOf('\nasync function createWindow',start)
    assert.ok(start>0&&end>start)
    let config,aborts=0;const app=new EventEmitter();app.isPackaged=packaged
    const syntheticAppPath=path.join(path.parse(process.cwd()).root,'synthetic app','app.asar')
    app.getAppPath=()=>syntheticAppPath
    const context={createS3ProbeScope:c=>{config=c;return{abortAll:()=>aborts++}},app,path,pathToFileURL,mainWindow:{},quitting:false,allowQuit:false,windowClosePromise:null}
    const cancelRegistration = source.match(/app\.on\('before-quit', \(\) => s3ProbeScope\.abortAll\(\)\)/g)
    assert.equal(cancelRegistration?.length, 1)
    vm.runInNewContext(source.slice(start,end) + '\n' + cancelRegistration[0],context)
    const expectedPackagedURL=pathToFileURL(path.join(syntheticAppPath,'dist/index.html')).href
    assert.equal(config.getExpectedURL(),packaged?expectedPackagedURL:'http://localhost:5000/')
    assert.equal(config.isClosing(),false);context.quitting=true;assert.equal(config.isClosing(),true)
    app.emit('before-quit');assert.equal(aborts,1)
    assert.ok(source.includes('registerS3ProbeHandler(ipcMain, s3Probe, s3ProbeScope)'))
  })
}
