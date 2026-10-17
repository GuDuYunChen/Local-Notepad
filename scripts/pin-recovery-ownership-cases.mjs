// Execute the production callbacks extracted verbatim from the component.
// This is a callback contract harness, NOT a React mount or native desktop test.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {URL as NodeURL} from 'node:url'
import fs from 'node:fs'
const source=fs.readFileSync(new NodeURL('../src/components/PinnedNotesPanel.jsx',import.meta.url),'utf8')
function callback(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a+start.length,b).trim()}
const pendingCode=callback('  const refreshPending=','\n  const cancelOperation=')
const loadCode=callback('  const load=','\n  useEffect(')
function fixture({raw='known',previous='known',readError=false,rawError=false,getError=false}={}){
  const calls=[],state={reviewed:true,notice:'previous success',error:''}
  const c={pendingRaw:{current:previous},reader:{current:null},operation:{current:null},alive:{current:true},AbortController,
    journal:{raw(){if(rawError)throw Error('Storage disabled');return raw},read(){if(readError)throw Error('invalid');return {version:1}}},
    readPins:async()=>{if(getError)throw Error('Read failed');return{items:[]}},api:()=>{},
  }
  for(const key of ['Reviewed','Pending','Corrupt','Error','Snapshot','SelectedId','Page','Status','Notice'])c['set'+key]=value=>{calls.push([key,value]);state[key[0].toLowerCase()+key.slice(1)]=value}
  vm.createContext(c);c.refreshPending=vm.runInContext(`(${pendingCode})`,c)
  const load=vm.runInContext(`(${loadCode})`,c)
  return{c,state,calls,load}
}
export function registerPinRecoveryOwnershipTests(test){
test('a replacement operation invalidates the prior readback approval',()=>{const f=fixture({raw:'replacement'});f.c.refreshPending();assert.equal(f.state.reviewed,false);assert.equal(f.c.pendingRaw.current,'replacement')})
test('the same unchanged operation keeps its existing readback status',()=>{const f=fixture();f.c.refreshPending();assert.equal(f.state.reviewed,true)})
test('corrupt current operation cannot retain a successful prior readback',()=>{const f=fixture({readError:true});f.c.refreshPending();assert.equal(f.state.reviewed,false);assert.equal(f.state.corrupt,true)})
test('storage access failure invalidates prior readback without deleting anything',()=>{const f=fixture({rawError:true});f.c.refreshPending();assert.equal(f.state.reviewed,false);assert.equal(f.state.corrupt,true);assert.equal(f.c.pendingRaw.current,'known')})
test('manual catalog refresh requires a fresh operation-specific readback',async()=>{const f=fixture();await f.load();assert.equal(f.state.reviewed,false);assert.equal(f.state.notice,'');assert.equal(f.state.status,'ready')})
test('failed refresh does not display stale successful result or permit prior approval',async()=>{const f=fixture({getError:true});await f.load();assert.equal(f.state.reviewed,false);assert.equal(f.state.notice,'');assert.equal(f.state.error,'Read failed');assert.equal(f.state.status,'error')})
test('an active mutation prevents refresh from interfering with its state',async()=>{const f=fixture();f.c.operation.current=new AbortController();await f.load();assert.equal(f.calls.length,0)})
}
