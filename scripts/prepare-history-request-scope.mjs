// Repair only native test fault selection: previous URL substring blocking also
// stopped the version preflight, so it never reached the intended write failure.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,'Exact source anchor mismatch');return s.replace(a,b)}
const helper=`export async function beginHistoryWriteFailure(cdp, target) {
 const parsed = new URL(target)
 assert.equal(parsed.origin, 'http://127.0.0.1:27121')
 assert.match(parsed.pathname, /^\\/api\\/files\\/[A-Za-z0-9-]+$/)
 assert.equal(parsed.search, ''); assert.equal(parsed.hash, '')
 assert.equal(typeof cdp.onEvent, 'function')
 const observed = [], pending = new Set()
 let active = true, closed = false, failure = null
 const detach = cdp.onEvent(message => {
  if (message.method !== 'Fetch.requestPaused') return
  const {requestId, request} = message.params
  const blocked = active && request.method === 'PUT' && request.url === target
  observed.push({method: request.method, url: request.url, blocked})
  const task = Promise.resolve().then(() => cdp.send(blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest',
   blocked ? {requestId, errorReason: 'Failed'} : {requestId})).catch(error => { failure ||= error }).finally(() => pending.delete(task))
  pending.add(task)
 })
 try { await cdp.send('Fetch.enable', {patterns: [{urlPattern: target + '*', requestStage: 'Request'}]}) }
 catch (error) { active = false; detach(); throw error }
 return {observed, async close() {
  if (closed) return
  closed = true; active = false
  try { await cdp.send('Fetch.disable'); await Promise.all([...pending]); if (failure) throw failure }
  finally { detach() }
 }}
}

`
if(process.argv[2]==='apply'){
 const runner='scripts/check-desktop-save.mjs';let s=fs.readFileSync(runner,'utf8');assert.equal(blob(s),'7e280895bbe4dfd33994fc1447afa3ce9893b9ce')
 s=replace(s,'  const ws = new WebSocket(url), pending = new Map()','  const ws = new WebSocket(url), pending = new Map(), eventListeners = new Set()')
 s=replace(s,'    const task = pending.get(message.id)','    if (message.method) for (const listener of [...eventListeners]) listener(message)\n    const task = pending.get(message.id)')
 s=replace(s,'    close: () => ws.close(),','    close: () => { eventListeners.clear(); ws.close() },\n    onEvent(listener) { eventListeners.add(listener); return () => eventListeners.delete(listener) },')
 fs.writeFileSync(runner,s)
 const native='scripts/check-version-history-desktop.mjs';s=fs.readFileSync(native,'utf8');assert.equal(blob(s),'d788851db11ad8ef6a8e6d10df95905d2b7bdb57')
 s=replace(s,'export async function verifyVersionHistoryDesktop',helper+'export async function verifyVersionHistoryDesktop')
 s=replace(s,' const report={complete:false,',' let writeFailure = null\n const report={complete:false,')
 s=replace(s,"  await cdp.send('Network.setBlockedURLs',{urls:[base+route]});await restore();await waitText('保存尚未确认')","  writeFailure=await beginHistoryWriteFailure(cdp,base+route);await restore();await waitText('保存尚未确认')")
 s=replace(s,'  await cdp.send(\'Network.setBlockedURLs\',{urls:[]});await click(\'.status-retry-btn\')',`  assert.equal(writeFailure.observed.filter(r=>r.blocked).length,1,'Expected exactly one failed write')
  assert.ok(writeFailure.observed.some(r=>r.method==='GET' && r.url===base+versionsRoute && !r.blocked),'Version preflight was not allowed through')
  report.failureInjection={mode:'exact-PUT-only',requests:writeFailure.observed};save()
  await writeFailure.close();writeFailure=null
  await cdp.send('Network.setBlockedURLs',{urls:[]});await click('.status-retry-btn')`)
 s=replace(s," finally{await cdp.send('Network.setBlockedURLs',{urls:[]})}"," finally{try{await writeFailure?.close()}finally{await cdp.send('Network.setBlockedURLs',{urls:[]})}}")
 fs.writeFileSync(native,s)
}else if(process.argv[2]==='test'){
 const {beginHistoryWriteFailure}=await import('./check-version-history-desktop.mjs')
 let tests=0
 function fake(fail=''){
  const calls=[],listeners=new Set()
  return {calls,listeners,onEvent(fn){listeners.add(fn);return()=>listeners.delete(fn)},async send(method,params={}){calls.push({method,params});if(method===fail)throw Error('fixture rejection')},emit(method,url,id='r'){for(const fn of listeners)fn({method:'Fetch.requestPaused',params:{requestId:id,request:{method,url}}})}}
 }
 const target='http://127.0.0.1:27121/api/files/owned-test'
 const c=fake(),f=await beginHistoryWriteFailure(c,target)
 for(const [method,url,expected]of [['GET',target+'/versions','Fetch.continueRequest'],['GET',target,'Fetch.continueRequest'],['OPTIONS',target,'Fetch.continueRequest'],['PUT',target+'?other=1','Fetch.continueRequest'],['PUT',target+'-different','Fetch.continueRequest'],['PUT',target,'Fetch.failRequest']]){
  const n=c.calls.length;c.emit(method,url);await new Promise(r=>setImmediate(r));assert.equal(c.calls[n].method,expected);tests++
 }
 assert.deepEqual(f.observed.filter(r=>r.blocked),[{method:'PUT',url:target,blocked:true}]);tests++
 await f.close();assert.equal(c.listeners.size,0);const count=c.calls.length;await f.close();assert.equal(c.calls.length,count);tests++
 for(const url of ['https://example.com/api/files/a',target+'/versions',target+'?x=1',target+'#x']){await assert.rejects(beginHistoryWriteFailure(fake(),url));tests++}
 const bad=fake('Fetch.enable');await assert.rejects(beginHistoryWriteFailure(bad,target));assert.equal(bad.listeners.size,0);tests++
 const badSend=fake('Fetch.failRequest'),session=await beginHistoryWriteFailure(badSend,target);badSend.emit('PUT',target);await new Promise(r=>setImmediate(r));await assert.rejects(session.close());assert.equal(badSend.listeners.size,0);tests++
 const badClose=fake('Fetch.disable'),session2=await beginHistoryWriteFailure(badClose,target);await assert.rejects(session2.close());assert.equal(badClose.listeners.size,0);tests++
 const result={complete:true,passed:tests,productionRequestsMocked:false,scope:'test-helper contracts using a fake CDP peer; not Windows execution'}
 fs.writeFileSync('source-objects/request-failure-contracts.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}else throw Error('Expected apply or test')
