import assert from 'node:assert/strict'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { createS3ProbeService, registerS3ProbeHandler, S3_PROBE_CHANNEL } from '../electron/s3-probe-bridge.js'
import { createS3ProbeScope } from '../electron/s3-probe-scope.js'
import { probePayload } from './s3-probe-bridge-cases.mjs'
import { trackProbeFixture } from './s3-probe-fixture-close.mjs'

// Fixed port is intentional: the production service cannot be redirected. A
// bind error fails this isolated test; never kill or contact an existing server.
async function withLoopback(handler, action) {
  const timers = new Set()
  const server = http.createServer((req, res) => handler(req, res, timers))
  const closeOwnedFixture = trackProbeFixture(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 27121, exclusive: true }, resolve)
  })
  try { await action() }
  finally {
    for (const timer of timers) { clearTimeout(timer); clearInterval(timer) }
    await closeOwnedFixture()
  }
}
const ok = {code:0,message:'OK',data:{outcome:'readable',httpStatus:200,acceptedBytes:5}}
export function registerS3ProbeHTTPTests(test) {
  test('fixture teardown waits for owned socket close before allowing port reuse', async () => {
    let socketClosed = false, arrive
    const arrived = new Promise(resolve => { arrive = resolve })
    await withLoopback((req, res) => {
      req.socket.once('close', () => { socketClosed = true })
      req.resume()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.flushHeaders()
      arrive()
    }, async () => {
      const controller = new AbortController()
      const request = createS3ProbeService({ timeoutMs: 2000 }).probe(probePayload(), { signal: controller.signal })
      try {
        await Promise.race([arrived, request.then(() => { throw new Error('fixture request ended before arrival') })])
      } finally { controller.abort() }
      assert.equal((await request).code, 'native-probe-cancelled')
    })
    assert.equal(socketClosed, true, 'fixture returned before its own TCP socket closed')
  })
  test('real loopback fixed POST: credentials only in body, no browser headers', async () => {
    let received
    await withLoopback((req,res)=>{
      const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
        received={method:req.method,url:req.url,headers:req.headers,body:JSON.parse(Buffer.concat(chunks).toString())}
        res.writeHead(200,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(ok))
      })
    },async()=>{
      const result=await createS3ProbeService().probe(probePayload())
      assert.equal(result.success,true);assert.equal(result.data.acceptedBytes,5)
      assert.equal(received.method,'POST');assert.equal(received.url,'/api/sync/s3/probe')
      assert.equal(received.headers.host,'127.0.0.1:27121');assert.equal(received.headers['x-notepad-read-only'],'s3-probe')
      assert.ok(!Object.keys(received.headers).some(k=>/^(origin|referer|sec-fetch-)/i.test(k)))
      assert.deepEqual(received.body,probePayload());assert.ok(!JSON.stringify(received.headers).includes('synthetic-secret'))
    })
  })
  for (const [httpStatus,outcome] of [[403,'access-denied'],[404,'not-found']]) {
    test(`real loopback preserves ${httpStatus}/${outcome} without claiming valid credentials`,async()=>{
      await withLoopback((req,res)=>{
        req.resume();res.writeHead(422,{'content-type':'application/json'})
        res.end(JSON.stringify({code:422,message:'probe-not-readable',data:{outcome,httpStatus,acceptedBytes:0}}))
      },async()=>{
        const r=await createS3ProbeService().probe(probePayload())
        assert.deepEqual(r,{success:false,status:422,code:'probe-not-readable',data:{outcome,httpStatus,acceptedBytes:0}})
      })
    })
  }
  test('real slow-drip response is stopped by absolute deadline',async()=>{
    let chunks=0
    await withLoopback((req,res,timers)=>{
      req.resume();res.writeHead(200,{'content-type':'application/json'});res.flushHeaders()
      timers.add(setInterval(()=>{res.write(' ');chunks++},10))
    },async()=>{
      const started=Date.now(),r=await createS3ProbeService({timeoutMs:500}).probe(probePayload())
      assert.equal(r.code,'native-probe-timeout');assert.equal(r.success,false)
      assert.ok(chunks>=2);assert.ok(Date.now()-started<2000)
    })
  })
  test('real truncated HTTP body is never interpreted as success',async()=>{
    await withLoopback((req,res,timers)=>{
      req.resume();res.writeHead(200,{'content-type':'application/json','content-length':'500'})
      res.write('{"code":0');timers.add(setTimeout(()=>res.destroy(),15))
    },async()=>{
      const r=await createS3ProbeService({timeoutMs:500}).probe(probePayload())
      assert.equal(r.success,false);assert.equal(r.data,null);assert.equal(r.code,'native-probe-unavailable')
    })
  })
  test('integrated IPC navigation aborts actual HTTP and cannot deliver a late reply',async()=>{
    let arrived;const requestArrived=new Promise(resolve=>{arrived=resolve})
    await withLoopback((req,res,timers)=>{
      req.resume();arrived();timers.add(setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(ok))},200))
    },async()=>{
      const sender=new EventEmitter();sender.mainFrame={url:'file:///synthetic-app/dist/index.html'}
      sender.getURL=()=>sender.mainFrame.url;sender.isDestroyed=()=>false
      const win=new EventEmitter();win.webContents=sender;win.isDestroyed=()=>false
      const scope=createS3ProbeScope({getWindow:()=>win,getExpectedURL:()=> 'file:///synthetic-app/dist/index.html'})
      const handlers=new Map();registerS3ProbeHandler({handle:(k,v)=>handlers.set(k,v)},createS3ProbeService({timeoutMs:600}),scope)
      const p=handlers.get(S3_PROBE_CHANNEL)({sender,senderFrame:sender.mainFrame},probePayload())
      await requestArrived;sender.emit('did-start-navigation',{},sender.mainFrame.url,false,true)
      assert.deepEqual(await p,{success:false,status:0,code:'native-probe-cancelled',data:null})
      assert.equal(sender.listenerCount('destroyed'),0)
    })
  })
}
