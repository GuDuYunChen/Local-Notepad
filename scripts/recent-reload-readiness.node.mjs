import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyRecentNotesAfterReload } from './recent-reload-readiness.mjs'
const before={id:'main',loaderId:'old',url:'file:///installed/index.html'}
const fresh={...before,loaderId:'new'}
function fixture(frames=[before,before,fresh,fresh], ready=[true]) {
 const calls=[],observations=[]; let polls=0,reads=0,clicked=false
 const cdp={send:async(method,params)=>{calls.push({method,params});if(method==='Page.getFrameTree')return {frameTree:{frame:frames[Math.min(reads++,frames.length-1)]}};return {ack:method}},onEvent(){return this===cdp}}
 const context={cdp,evaluate:async()=>{observations.push(frames[Math.max(0,reads-1)]?.loaderId);return ready.length>1?ready.shift():ready[0]},until:async(check,label,budget)=>{assert.equal(budget,18000);for(let i=0;i<8;i++){polls++;const value=await check();if(value)return value}throw Error(label)}}
 const driver=async({cdp:relay})=>{assert.equal(relay.onEvent(),true);assert.deepEqual(await relay.send('Network.enable'),{ack:'Network.enable'});assert.deepEqual(await relay.send('Page.reload'),{ack:'Page.reload'});clicked=true;await relay.send('Input.dispatchMouseEvent',{type:'mousePressed'})}
 return {context,driver,calls,observations,get polls(){return polls},get clicked(){return clicked}}
}
test('old presence-only predicate accepts the outgoing document: regression counterexample',async()=>{
 const f=fixture();await f.context.cdp.send('Page.reload');const outgoing=await f.context.evaluate();assert.equal(outgoing,true)
 // The same outgoing node can disappear during the still-pending navigation.
 assert.equal((await f.context.cdp.send('Page.getFrameTree')).frameTree.frame.loaderId,'old')
})
test('waits through old-document readiness before one original reload and click',async()=>{
 const f=fixture(),records=[];await verifyRecentNotesAfterReload(f.driver,f.context,x=>records.push(x))
 assert.equal(f.polls,2);assert.deepEqual(f.observations,['new']);assert.equal(f.clicked,true)
 assert.equal(f.calls.filter(x=>x.method==='Page.reload').length,1);assert.equal(f.calls.filter(x=>x.method==='Input.dispatchMouseEvent').length,1)
 assert.deepEqual(records,[{originalReloadCommands:1,mainFrameId:'main',previousLoader:'old',currentLoader:'new',sameDocumentURL:true,entryReadyInNewDocument:true,originalClickRetained:true}])
})
for(const [name,frame]of [['outgoing',before],['child-frame',{...fresh,id:'iframe'}],['missing-loader',{...fresh,loaderId:''}],['different-URL',{...fresh,url:'file:///other/index.html'}],['missing-frame',null]])test('does not click or pass when '+name+' remains',async()=>{
 const f=fixture([before,frame]);await assert.rejects(()=>verifyRecentNotesAfterReload(f.driver,f.context,()=>assert.fail('No readiness evidence')),/new main document/);assert.equal(f.clicked,false);assert.equal(f.calls.filter(x=>x.method==='Page.reload').length,1)
})
test('does not use an element from a document that changes during readiness evaluation',async()=>{
 const f=fixture([before,fresh,{...fresh,loaderId:'newer'},{...fresh,loaderId:'newer'},{...fresh,loaderId:'newer'}]),records=[]
 await verifyRecentNotesAfterReload(f.driver,f.context,x=>records.push(x));assert.equal(records[0].currentLoader,'newer');assert.equal(f.polls,2)
})
test('waits for the actual new entry, not just a new loader',async()=>{
 const f=fixture([before,fresh,fresh,fresh],[false,true]);await verifyRecentNotesAfterReload(f.driver,f.context,()=>{});assert.equal(f.polls,2)
})
test('rejects a permanently absent new entry without clicking',async()=>{
 const f=fixture([before,fresh],[false]);await assert.rejects(()=>verifyRecentNotesAfterReload(f.driver,f.context,()=>assert.fail()),/new main document/);assert.equal(f.clicked,false)
})
test('does not conceal reload command errors',async()=>{
 const f=fixture();const send=f.context.cdp.send;f.context.cdp.send=async(m,p)=>{if(m==='Page.reload')throw Error('disconnected');return send(m,p)}
 await assert.rejects(()=>verifyRecentNotesAfterReload(f.driver,f.context,()=>assert.fail()),/disconnected/);assert.equal(f.clicked,false)
})
test('rejects a driver that skipped the actual reload',async()=>{const f=fixture();await assert.rejects(()=>verifyRecentNotesAfterReload(async()=>{},f.context,()=>{}),/not executed/)})
test('refuses a second reload rather than silently retrying',async()=>{
 const f=fixture();await assert.rejects(()=>verifyRecentNotesAfterReload(async({cdp})=>{await cdp.send('Page.reload');await cdp.send('Page.reload')},f.context,()=>{}),/one real reload/);assert.equal(f.calls.filter(x=>x.method==='Page.reload').length,1)
})
test('preserves later original driver assertions',async()=>{
 const f=fixture();await assert.rejects(()=>verifyRecentNotesAfterReload(async c=>{await f.driver(c);throw Error('Original assertion failed')},f.context,()=>{}),/Original assertion failed/)
})

test('exact preparation adapter preserves the complete original source by inverse',async()=>{
 const {readFileSync}=await import('node:fs'),{prepareRecentReloadReadiness}=await import('./prepare-recent-reload-readiness.mjs')
 // The source in this checkout may already be adapted by the previous step.
 const source=readFileSync(new URL('./reading-mode-installed-evidence.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n')
 const {existsSync}=await import('node:fs'),backup=new URL('../test-results/installer-lifecycle/recent-reload-preparation/reading-mode-installed-evidence.mjs.before.txt',import.meta.url)
 const original=existsSync(backup)?readFileSync(backup,'utf8'):source
 const changed=prepareRecentReloadReadiness(original)
 assert.match(changed,/verifyRecentNotesAfterReload\(verifyRecentNotesDesktop/)
 for(const invalid of [original+'\n',original.replace('validateReadingModePin(pin)','removedGuard(pin)'),changed])assert.throws(()=>prepareRecentReloadReadiness(invalid))
})
