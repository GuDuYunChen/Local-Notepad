import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {observeExportRequests} from './export-http-observer.mjs'
function fake(options={}){
 const listeners=new Map();const channelFor=name=>({subscribe:fn=>listeners.set(name,fn),unsubscribe:fn=>{assert.equal(listeners.get(name),fn);listeners.delete(name)}})
 const observer=observeExportRequests({channelFor,active:()=>true,clock:()=>100,...options})
 return {observer,listeners,emit:(kind,payload)=>listeners.get('undici:'+kind)?.(payload)}
}
test('records only readonly allowed transport metadata and never request identities or bodies',()=>{
 const {observer,emit}=fake(),request=Object.freeze({origin:'http://127.0.0.1:27121',method:'POST',path:'/api/files?secret=private',headers:['token','SECRET'],body:'PRIVATE'})
 emit('request:create',{request});emit('client:sendHeaders',{request});emit('request:bodySent',{request});emit('request:headers',{request,response:{statusCode:200,headers:['SECRET']}});emit('request:trailers',{request})
 const r=observer.snapshot();assert.equal(r.events.length,5);assert.equal(r.activeRequests,1);assert.equal(r.observerErrors,0);assert.equal(r.networkModified,false);assert.equal(r.extraRequests,0);assert.equal(r.retries,0)
 assert.equal(r.events[3].status,200);assert.equal(r.events[0].route,'/api/files');assert.doesNotMatch(JSON.stringify(r),/PRIVATE|SECRET|secret|token/)
 observer.stop();observer.stop()
})
for(const path of ['/api/files/private-id','/api/files/中文','/api/files/secret?auth=abc'])test('redacts concrete source '+path,()=>{const{observer,emit}=fake();emit('request:create',{request:{origin:'http://127.0.0.1:27121',method:'GET',path}});assert.equal(observer.snapshot().events[0].route,'/api/files/:id')})
for(const origin of ['https://api.github.com','http://127.0.0.1:27122','http://localhost:27121'])test('ignores origin '+origin,()=>{const{observer,emit}=fake();emit('request:create',{request:{origin,method:'GET',path:'/api/files'}});assert.equal(observer.snapshot().events.length,0)})
test('ignores earlier modules and orphan events',()=>{const{observer,emit}=fake({active:()=>false}),request={origin:'http://127.0.0.1:27121',method:'GET',path:'/api/files'};emit('request:create',{request});emit('request:error',{request,error:{name:'TimeoutError'}});assert.equal(observer.snapshot().activeRequests,0)})
test('correlates original error without consuming or changing it',()=>{const{observer,emit}=fake(),request=Object.freeze({origin:'http://127.0.0.1:27121',method:'POST',path:'/api/files'}),error=Object.freeze({name:'TimeoutError',message:'sensitive',code:'UNKNOWN_SECRET'});emit('request:create',{request});emit('request:error',{request,error});const e=observer.snapshot().events[1];assert.equal(e.error,'TimeoutError');assert.equal(e.code,null);assert.doesNotMatch(JSON.stringify(e),/sensitive|UNKNOWN/);assert.equal(observer.snapshot().observerErrors,0)})
test('bounds volume and exposes truncation without throwing or reusing identifiers',()=>{const{observer,emit}=fake({maximum:2});for(let i=0;i<10;i++)emit('request:create',{request:{origin:'http://127.0.0.1:27121',method:'GET',path:'/api/files'}});assert.equal(observer.snapshot().events.length,2);assert.equal(observer.snapshot().dropped,8);assert.equal(observer.snapshot().activeRequests,10)})
test('stops all subscriptions',()=>{const{observer,listeners}=fake();assert.equal(listeners.size,6);observer.stop();assert.equal(listeners.size,0)})
test('malformed observation never throws into transport',()=>{const{observer,emit}=fake({active:()=>{throw Error('observer fault')}});assert.doesNotThrow(()=>emit('request:create',{request:{}}));assert.equal(observer.snapshot().observerErrors,1)})
for(const maximum of [0,-1,4097,1.5,NaN])test('rejects invalid trace limit '+maximum,()=>assert.throws(()=>fake({maximum})))
test('real loopback successful POST and original aborted GET keep status/body and one request each',async()=>{
 const originalFetch=globalThis.fetch,received=[];let release
 const server=createServer((req,res)=>{received.push(req.method+' '+req.url);if(req.url==='/slow'){release=()=>{if(!res.destroyed){res.writeHead(200);res.end('late')}};return}let body='';req.on('data',b=>body+=b);req.on('end',()=>{res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({body}))})})
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(27121,'127.0.0.1',resolve)})
 const o=observeExportRequests({active:()=>true})
 try{
  const result=await fetch('http://127.0.0.1:27121/api/files',{method:'POST',body:'private fixture'});assert.equal(result.status,201);assert.deepEqual(await result.json(),{body:'private fixture'})
  const controller=new AbortController(),request=fetch('http://127.0.0.1:27121/slow',{signal:controller.signal})
  while(!release)await new Promise(r=>setImmediate(r))
  const reason=new DOMException('test deadline','TimeoutError');controller.abort(reason);await assert.rejects(request,e=>e===reason)
  assert.equal(globalThis.fetch,originalFetch);assert.deepEqual(received,['POST /api/files','GET /slow'])
  const r=o.snapshot();assert.equal(r.activeRequests,2);assert.equal(r.observerErrors,0);assert.ok(r.events.some(e=>e.event==='request:headers'&&e.status===201));assert.ok(r.events.some(e=>e.event==='request:error'));assert.doesNotMatch(JSON.stringify(r),/private fixture|test deadline/)
 }finally{o.stop();release?.();server.closeAllConnections();await new Promise(r=>server.close(r))}
})
test('launcher change is only an explicit child observer import, no environment inheritance or policy changes',()=>{
 const root=new URL('./',import.meta.url),s=readFileSync(new URL('run-reading-mode-installer.mjs',root),'utf8')
 assert.match(s,/\['--import', fileURLToPath\(new URL\('\.\/export-http-observer\.mjs', import.meta.url\)\), fileURLToPath/)
 assert.doesNotMatch(s,/NODE_OPTIONS|process\.execArgv|timeout:/)
 const helper=readFileSync(new URL('export-http-observer.mjs',root),'utf8');assert.doesNotMatch(helper,/globalThis\.fetch\s*=|await fetch\(|\.addHeader\(|request\.[a-zA-Z]+\s*=/)
 const workflow=readFileSync(new URL('../.github/workflows/local-installation-2f86.yml',root),'utf8');assert.match(workflow,/timeout-minutes: 20/);assert.match(workflow,/run: node scripts\/run-reading-mode-installer.mjs run/)
})
