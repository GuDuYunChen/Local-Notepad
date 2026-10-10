import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSyncActivity, syncActivityLabel, requestSyncCancellation } from '../src/services/syncActivity.mjs'
import { createSyncStatusReader } from '../src/services/syncStatusReader.mjs'
const a = { active:true, id:'a'.repeat(32), kind:'sync', phase:'preflight', started_at:1700000000, cancel_requested:false }
test('rejects invalid metadata without treating it as idle', () => {
  for (const value of [null,{}, {...a,id:'*'}, {...a,kind:'private-url'}, {...a,phase:'done'}, {...a,started_at:Infinity}]) assert.throws(()=>parseSyncActivity(value))
  assert.equal(parseSyncActivity({active:false,password:'secret'}).id,'')
})
test('cancel declined means no write', async () => {
  let calls=0
  const result=await requestSyncCancellation(async()=>{calls++},a,()=>false)
  assert.equal(calls,0); assert.equal(result.reason,'declined')
})
test('cancel only sends captured ID even if a successor starts during confirmation', async () => {
  let active=a, sent
  const result=await requestSyncCancellation(async(path,init)=>{sent={path,init}; return {id:a.id,accepted:false,reason:'not-active'}},active,()=>{active={...a,id:'b'.repeat(32)};return true})
  assert.equal(sent.path,'/api/sync/cancel'); assert.deepEqual(JSON.parse(sent.init.body),{id:a.id}); assert.equal(active.id,'b'.repeat(32)); assert.equal(result.accepted,false)
})
test('accepted cancellation is a receipt, not a success or rollback', async () => {
  const r=await requestSyncCancellation(async()=>({id:a.id,accepted:true,reason:'requested'}),a,()=>true)
  assert.equal(r.accepted,true); assert.equal(r.reason,'requested'); assert.equal(r.success,undefined)
  assert.match(syncActivityLabel({...a,cancel_requested:true}),/等待任务结束/)
})
test('idle or already-requested operations never send cancellation', async () => {
  let calls=0; const api=async()=>{calls++}
  await requestSyncCancellation(api,{active:false},()=>true)
  await requestSyncCancellation(api,{...a,cancel_requested:true},()=>true)
  assert.equal(calls,0)
})
test('network failures are not automatically retried', async () => {
  let calls=0
  await assert.rejects(requestSyncCancellation(async()=>{calls++;throw new Error('offline')},a,()=>true))
  assert.equal(calls,1)
})
test('receipt mismatches cannot report a different operation cancelled', async () => {
  for(const receipt of [{id:'b'.repeat(32),accepted:true,reason:'requested'}, {id:a.id,accepted:true,reason:'not-active'}, null]) {
    await assert.rejects(requestSyncCancellation(async()=>receipt,a,()=>true),/尚未确认/)
  }
})
test('abort signal is forwarded without substituting current task ID', async () => {
  const c=new AbortController()
  await requestSyncCancellation(async(_,init)=>{assert.equal(init.signal,c.signal);return {id:a.id,accepted:true,reason:'already-requested'}},a,()=>true,c.signal)
})
function clock() {
 let id=0; const timers=new Map()
 return {timers,schedule:(fn,ms)=>{timers.set(++id,{fn,ms}); return id},cancel:id=>timers.delete(id)}
}
test('activity poll cadence can switch between active and idle; default remains 15s', async () => {
  const c=clock(); let active=true
  const r=createSyncStatusReader({load:async()=>({active}),onSnapshot:()=>{},shouldPoll:()=>true,pollInterval:()=>active?1000:5000,...c})
  await r.refresh(); assert.equal([...c.timers.values()][0].ms,1000)
  active=false; await r.refresh(); assert.equal([...c.timers.values()][0].ms,5000); r.dispose(); assert.equal(c.timers.size,0)
  const d=clock(); const old=createSyncStatusReader({load:async()=>({}),onSnapshot:()=>{},shouldPoll:()=>true,...d})
  await old.refresh(); assert.equal([...d.timers.values()][0].ms,15000); old.dispose()
})
test('failed activity reads retain existing snapshot and use 30s backoff', async () => {
  const c=clock(); let fail=false, value,health
  const r=createSyncStatusReader({load:async()=>{if(fail)throw new Error('private');return a},onSnapshot:s=>value=s,onHealth:s=>health=s,shouldPoll:()=>true,pollInterval:()=>1000,...c})
  await r.refresh(); fail=true; await r.refresh()
  assert.equal(value.id,a.id);assert.notEqual(health.error,'private');assert.equal([...c.timers.values()][0].ms,30000);r.dispose()
})
test('activity reader is single-flight and ignores completion after disposal', async () => {
  const c=clock(); let complete,calls=0, snapshots=0
  const r=createSyncStatusReader({load:()=>{calls++;return new Promise(resolve=>complete=resolve)},onSnapshot:()=>snapshots++,shouldPoll:()=>true,pollInterval:()=>1000,...c})
  const first=r.refresh(),second=r.refresh();assert.equal(first,second);await Promise.resolve();assert.equal(calls,1)
  r.dispose(); complete(a);await first;assert.equal(snapshots,0);assert.equal(c.timers.size,0)
})
