import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import vm from 'node:vm'
import { createEditorQuitRegistry, createEditorQuitParticipant, EditorQuitError } from '../src/services/editorQuit.mjs'
import { installEditorQuitBridge, installDocumentQuitBridge } from '../src/services/editorQuitBridge.mjs'
import { createQuitSaveGate, QUIT_PREPARE, QUIT_RESULT, QUIT_RELEASE } from '../electron/quit-save.mjs'

const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise,resolve,reject } }
const signal = () => new AbortController().signal
function clock() {
  let id=0; const timers=new Map()
  return { timers, schedule(fn,ms){timers.set(++id,{fn,ms});return id}, cancel(id){timers.delete(id)},
    fire(ms){const item=[...timers].find(([,v])=>v.ms===ms);assert.ok(item,`missing ${ms} timer`);timers.delete(item[0]);item[1].fn()} }
}
function participant(overrides={}) {
  const registry=createEditorQuitRegistry()
  const state={ id:'n1',ready:true,deleted:false,content:'draft',saved:'old',structural:false,pending:[],...overrides }
  registry.remember(state.id,state.content)
  let caches=0,saves=0
  const fn=createEditorQuitParticipant({registry,snapshot:()=>({...state,pending:[...state.pending]}),cache(){caches++},
    save:async()=>{saves++;state.saved=state.content;registry.saved(state.id,state.content)} })
  registry.register(fn)
  return {registry,state,fn,counts:()=>({caches,saves})}
}
test('only an acknowledgement for the latest draft clears the ledger',async()=>{
  const r=createEditorQuitRegistry();r.remember('a','first');r.remember('a','second');r.saved('a','first')
  assert.equal(r.pending(),1);await assert.rejects(r.flush(signal()),e=>e.code==='unresolved')
  r.saved('a','second');await r.flush(signal());assert.equal(r.pending(),0)
})
test('unregistering an editor never erases its unsaved draft',async()=>{
  const r=createEditorQuitRegistry();r.remember('a','text');const off=r.register(()=>{});off()
  await assert.rejects(r.flush(signal()),e=>e.code==='unresolved');r.forget('a');await r.flush(signal())
})
test('exit caches and saves the actual current draft through the participant',async()=>{
  const f=participant();await f.registry.flush(signal());assert.deepEqual(f.counts(),{caches:1,saves:1});assert.equal(f.registry.pending(),0)
})
test('a clean current document needs no duplicate PUT',async()=>{
  const f=participant({content:'same',saved:'same'});await f.registry.flush(signal());assert.equal(f.counts().saves,0)
})
test('exit waits for an older in-flight write before saving a later revert',async()=>{
  const old=deferred(),f=participant({content:'original',saved:'original',pending:[old.promise]})
  const p=f.registry.flush(signal());await flush();assert.equal(f.counts().saves,0)
  f.state.saved='older-write';f.state.pending=[];old.resolve();await p
  assert.equal(f.state.saved,'original');assert.equal(f.counts().saves,1)
})
test('an old failed save prevents exit and preserves its ledger entry',async()=>{
  const old=deferred(),f=participant({pending:[old.promise]});const p=f.registry.flush(signal())
  const rejected=assert.rejects(p,/network/);old.reject(new Error('network'));await rejected
  assert.equal(f.registry.pending(),1);assert.equal(f.counts().saves,0)
})
test('unconfirmed structure cannot take the ordinary quit save path',async()=>{
  const f=participant({structural:true});await assert.rejects(f.registry.flush(signal()),e=>e.code==='structure');assert.equal(f.counts().saves,0)
})
test('loading or switching a document blocks confirmation',async()=>{
  const f=participant({ready:false});await assert.rejects(f.registry.flush(signal()),e=>e.code==='loading')
})
test('timeout does not convert an outstanding save into success',async()=>{
  const f=participant({pending:[new Promise(()=>{})]}),ctl=new AbortController()
  const p=f.registry.flush(ctl.signal);const rejected=assert.rejects(p,e=>e.code==='timeout');ctl.abort();await rejected;assert.equal(f.registry.pending(),1)
})
test('a save completing for another version or document does not approve exit',async()=>{
  const r=createEditorQuitRegistry(),state={id:'n1',ready:true,content:'text',saved:'old',pending:[],structural:false}
  const fn=createEditorQuitParticipant({registry:r,snapshot:()=>state,cache(){},save:async()=>{state.content='new';state.saved='text'}})
  await assert.rejects(fn(signal()),e=>e.code==='changed')
})
test('an unresolved previous document is not silently bulk-saved',async()=>{
  const f=participant();f.registry.remember('prior','unsaved');await assert.rejects(f.registry.flush(signal()),e=>e.code==='unresolved')
  assert.equal(f.counts().saves,1);assert.equal(f.registry.pending(),1)
})
function nativeFixture(){
  const ipcMain=new EventEmitter(),wc=new EventEmitter(),c=clock();let next=0
  Object.assign(wc,{mainFrame:{},sent:[],getURL:()=> 'file:///app/index.html',isLoading:()=>false,isDestroyed:()=>false,isCrashed:()=>false,
    send(channel,value){wc.sent.push({channel,value})}})
  const win={isDestroyed:()=>false,webContents:wc}
  const gate=createQuitSaveGate({ipcMain,...c,makeID:()=> (++next).toString(16).padStart(32,'0')})
  const reply=(value={},sender=wc,frame=wc.mainFrame)=>ipcMain.emit(QUIT_RESULT,{sender,senderFrame:frame},{id:wc.sent.findLast(v=>v.channel===QUIT_PREPARE)?.value.id,ready:true,...value})
  return {ipcMain,wc,win,gate,reply,...c}
}
test('native challenge is single-flight and approved renderer remains frozen until release',async()=>{
  const f=nativeFixture(),p=f.gate.prepare(f.win);assert.equal(f.gate.prepare(f.win),p);assert.equal(f.wc.sent.length,1)
  f.reply();await p;assert.equal(f.timers.size,0);assert.equal(f.wc.sent.some(v=>v.channel===QUIT_RELEASE),false)
  f.gate.release();assert.equal(f.wc.sent.at(-1).channel,QUIT_RELEASE);assert.equal(f.ipcMain.listenerCount(QUIT_RESULT),0)
})
test('wrong sender, child frame, malformed result and old challenge cannot approve exit',async()=>{
  const f=nativeFixture(),p=f.gate.prepare(f.win);let approved=false;p.then(()=>{approved=true})
  f.reply({},{});f.reply({},f.wc,{});f.reply({id:'f'.repeat(32)});f.reply({ready:'true'});await flush();assert.equal(approved,false)
  f.reply();await p;f.gate.release()
})
test('navigation replacing the main frame blocks native confirmation',async()=>{
  const f=nativeFixture(),p=f.gate.prepare(f.win),rejected=assert.rejects(p,/无法确认/)
  f.wc.emit('did-start-navigation',{},'file:///other',false,true);await rejected;assert.equal(f.timers.size,0)
})
test('a renderer failure reports a fixed safe message, releases and keeps native exit unapproved',async()=>{
  const f=nativeFixture(),p=f.gate.prepare(f.win),rejected=assert.rejects(p,/正文保存未获确认/)
  f.reply({ready:false,code:'secret://untrusted-text'});await rejected;assert.equal(f.wc.sent.at(-1).channel,QUIT_RELEASE)
})
test('native timeout rejects instead of approving a stopped renderer',async()=>{
  const f=nativeFixture(),p=f.gate.prepare(f.win),rejected=assert.rejects(p,/超时/);f.fire(10000);await rejected
  assert.equal(f.ipcMain.listenerCount(QUIT_RESULT),0);assert.equal(f.timers.size,0)
})
test('late response from failed challenge cannot authorize a later quit',async()=>{
  const f=nativeFixture(),p=f.gate.prepare(f.win),first=f.wc.sent[0].value.id,rejected=assert.rejects(p)
  f.reply({ready:false,code:'structure'});await rejected
  const q=f.gate.prepare(f.win);let done=false;q.then(()=>{done=true});f.reply({id:first});await flush();assert.equal(done,false)
  f.reply();await q;f.gate.release()
})
test('renderer crash rejects and an unloaded never-started renderer requires no save',async()=>{
  const f=nativeFixture(),p=f.gate.prepare(f.win),rejected=assert.rejects(p);f.wc.emit('render-process-gone');await rejected
  f.wc.getURL=()=>'';await f.gate.prepare(f.win)
})
function bridgeFixture(registry,freeze){
  const c=clock(),handlers={},results=[];let locked=0
  const bridge={onQuitPrepare(fn){handlers.prepare=fn;return()=>{delete handlers.prepare}},onQuitRelease(fn){handlers.release=fn;return()=>{delete handlers.release}},reportQuitResult(v){results.push(v)}}
  const dispose=installEditorQuitBridge({bridge,registry,freeze:freeze||(()=>{locked++;return()=>locked--}),...c})
  return {bridge,handlers,results,dispose,locked:()=>locked,...c}
}
test('successful renderer flush stays frozen until matching native release',async()=>{
  const f=bridgeFixture({flush:async()=>{}}),id='1'.repeat(32);f.handlers.prepare({id});await flush()
  assert.deepEqual(f.results,[{id,ready:true}]);assert.equal(f.locked(),1);f.handlers.release({id:'2'.repeat(32)});assert.equal(f.locked(),1)
  f.handlers.release({id});assert.equal(f.locked(),0);f.dispose()
})
test('duplicate prepare cannot duplicate save and stale completion cannot approve the next challenge',async()=>{
  const a=deferred();let calls=0
  const f=bridgeFixture({flush:()=>{calls++;return a.promise}}),first='1'.repeat(32),second='2'.repeat(32)
  f.handlers.prepare({id:first});f.handlers.prepare({id:first});await flush();assert.equal(calls,1)
  f.handlers.prepare({id:second});await flush();a.resolve();await flush()
  assert.deepEqual(f.results,[{id:second,ready:true}]);f.dispose();assert.equal(f.locked(),0)
})
test('save rejection reports failure and unfreezes without sharing content',async()=>{
  const f=bridgeFixture({flush:async()=>{throw new Error('private note content')}}),id='1'.repeat(32)
  f.handlers.prepare({id});await flush();assert.deepEqual(f.results,[{id,ready:false,code:'save-failed'}]);assert.equal(f.locked(),0);f.dispose()
})
test('renderer deadline and disposal clear timers/listeners and never report success later',async()=>{
  const a=deferred(),f=bridgeFixture({flush:()=>a.promise}),id='1'.repeat(32)
  f.handlers.prepare({id});await flush();f.fire(8000);await flush();assert.deepEqual(f.results,[{id,ready:false,code:'timeout'}])
  f.dispose();a.resolve();await flush();assert.equal(f.results.length,1);assert.equal(f.locked(),0);assert.equal(f.timers.size,0)
})
test('active composition blocks before focus changes or any save is attempted',async()=>{
  const win=new EventTarget(),results=[];let prepare,called=0
  const bridge={onQuitPrepare(fn){prepare=fn;return()=>{}},onQuitRelease(){return()=>{}},reportQuitResult(v){results.push(v)}}
  const dispose=installDocumentQuitBridge({bridge,win,doc:{getElementById(){throw new Error('must not blur')}},registry:{flush:async()=>{called++}}})
  win.dispatchEvent(new Event('compositionstart'));prepare({id:'c'.repeat(32)});await flush()
  assert.equal(results[0].code,'composition');assert.equal(called,0);dispose()
})
test('source buffer refusal propagates without applying Markdown implicitly',async()=>{
  const f=bridgeFixture({flush:async()=>{throw new EditorQuitError('source')}});f.handlers.prepare({id:'1'.repeat(32)});await flush()
  assert.equal(f.results[0].code,'source');assert.equal(f.locked(),0);f.dispose()
})

// Execute the real saveNow closure, using a minimal ref/state harness rather
// than a second implementation of the queue under test.
const editorSource=fs.readFileSync(new URL('../src/components/TextEditor.jsx',import.meta.url),'utf8')
function actualSave(){
  const ref=current=>({current}),writes=[],cache=[],responses=[]
  const c={React:{useCallback:fn=>fn},currentIdRef:ref('n1'),loadedDocumentRef:ref('n1'),deletedIdsRef:ref(new Set()),
    contentRef:ref('draft'),lastSavedContentRef:ref('old'),inFlightSavesRef:ref(new Map()),saveControllersRef:ref(new Set()),
    pendingStructureMappingsRef:ref([]),onSavedRef:ref(()=>{}),editorQuit:createEditorQuitRegistry(),
    hasHeadingStructureChanged:()=>false,beginSaving(){},endSaving(){},setSaving(){},setSaveError(){},setStructureDirty(){},setLastSavedAt(){},
    writeEditorDraft(...args){cache.push(args)},AbortController,Date,console:{error(){}},
    api(_url,init){writes.push(JSON.parse(init.body).content);const d=deferred();responses.push(d);return d.promise}}
  c.editorQuit.remember('n1','draft')
  const a=editorSource.indexOf('  const saveNow = React.useCallback('),b=editorSource.indexOf('  }, [beginSaving, endSaving])',a)
  assert.ok(a>=0&&b>a);vm.createContext(c);vm.runInContext(editorSource.slice(a,b+'  }, [beginSaving, endSaving])'.length)+'\nglobalThis.saveNow=saveNow',c)
  return {c,writes,cache,responses}
}
test('actual saveNow leaves newer typed text cached when an older PUT completes',async()=>{
  const f=actualSave(),p=f.c.saveNow('external');f.c.contentRef.current='newer';f.c.editorQuit.remember('n1','newer')
  f.responses[0].resolve({id:'n1',content:'draft'});await p
  assert.equal(f.cache.at(-1)[1],'newer');assert.equal(f.c.editorQuit.pending(),1);assert.equal(f.c.lastSavedContentRef.current,'draft')
})
test('actual saveNow does not skip a revert while an older different write is pending',async()=>{
  const f=actualSave(),first=f.c.saveNow('external');f.c.contentRef.current='old';f.c.editorQuit.remember('n1','old')
  const revert=f.c.saveNow('quit');assert.equal(f.writes.length,1)
  f.responses[0].resolve({id:'n1',content:'draft'});await first;await flush();assert.deepEqual(f.writes,['draft','old'])
  f.responses[1].resolve({id:'n1',content:'old'});await revert;assert.equal(f.c.lastSavedContentRef.current,'old');assert.equal(f.c.editorQuit.pending(),0)
})
test('actual saveNow rejects missing or wrong content acknowledgements',async()=>{
  for(const result of [null,{id:'wrong',content:'draft'},{id:'n1',content:'different'}]){
    const f=actualSave(),p=f.c.saveNow('quit'),rejected=assert.rejects(p,/未确认/);f.responses[0].resolve(result);await rejected
    assert.equal(f.c.lastSavedContentRef.current,'old');assert.equal(f.c.editorQuit.pending(),1);assert.equal(f.cache.length,0)
  }
})
const mainSource=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8')
function actualQuit(prepare,stop){
  const c={backend:{},mainWindow:{},backendStartPromise:null,allowQuit:false,quitting:false,quitPromise:null,handler:null,quitCalls:0,errors:0,releases:0,console,
    rendererQuit:{prepare,release(){c.releases++}},stopChildProcess:stop}
  c.app={on(_e,fn){c.handler=fn},quit(){c.quitCalls++}};c.dialog={showErrorBox(){c.errors++}}
  vm.createContext(c);vm.runInContext(mainSource.slice(mainSource.indexOf("app.on('before-quit',"),mainSource.indexOf('// 启动后端进程')),c);return c
}
test('actual quit waits for renderer save before sending backend shutdown and handles duplicate quits',async()=>{
  const d=deferred(),events=[];const c=actualQuit(()=>{events.push('prepare');return d.promise},async()=>{events.push('stop');return{exited:true,clean:true}})
  c.handler({preventDefault(){}});c.handler({preventDefault(){}});await flush();assert.deepEqual(events,['prepare']);assert.equal(c.quitCalls,0)
  d.resolve();await flush();assert.deepEqual(events,['prepare','stop']);assert.equal(c.quitCalls,1)
})
test('actual save failure keeps the existing window/backend and permits later retry',async()=>{
  let stops=0;const c=actualQuit(async()=>{throw new Error('save failed')},()=>{stops++});const child=c.backend
  c.handler({preventDefault(){}});await flush();assert.equal(stops,0);assert.equal(c.backend,child);assert.equal(c.allowQuit,false);assert.equal(c.quitting,false);assert.equal(c.releases,1)
})
test('actual backend-stop failure releases renderer but does not approve exit',async()=>{
  const c=actualQuit(async()=>{},async()=>{throw new Error('stop uncertain')});c.handler({preventDefault(){}});await flush()
  assert.equal(c.allowQuit,false);assert.equal(c.quitCalls,0);assert.equal(c.releases,1);assert.equal(c.errors,1)
})
