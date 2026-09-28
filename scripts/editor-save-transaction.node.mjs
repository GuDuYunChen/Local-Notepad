import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorSaveAttempt, commitEditorSave } from '../src/services/editorSaveTransaction.mjs'
const ack = a => ({ id: a.id, content: a.content, save_receipt: { request_id: a.requestID, reference_pending: false } })
test('each deliberate body write owns an immutable random identity', () => {
 const a=createEditorSaveAttempt('a','old','new',[{from:['一'],to:['二']}]); const b=createEditorSaveAttempt('a','old','new')
 assert.ok(Object.isFrozen(a)); assert.match(a.requestID,/^[a-f0-9]{32}$/);assert.notEqual(a.requestID,b.requestID)
})
test('timed out committed writes retry the exact identity and cannot overwrite newer data', async () => {
 const a=createEditorSaveAttempt('a','old','new'), requests=[], receipts=new Map();let body='old',writes=0
 const load=(_path,init)=>{const p=JSON.parse(init.body);requests.push(p)
  if(receipts.has(p.save_request_id))return receipts.get(p.save_request_id)
  body=p.content;writes++;receipts.set(p.save_request_id,ack(a));return new Promise(()=>{})
 }
 await assert.rejects(commitEditorSave(load,a,undefined,5),e=>e.code==='save-uncertain')
 body='later body'
 assert.equal((await commitEditorSave(load,a,undefined,20)).content,'new')
 assert.deepEqual(requests[0],requests[1]);assert.equal(writes,1);assert.equal(body,'later body')
})
test('timeouts settle even if the transport ignores AbortSignal', async () => {
 let signal;const a=createEditorSaveAttempt('a','old','new')
 await assert.rejects(commitEditorSave((_p,i)=>{signal=i.signal;return new Promise(()=>{})},a,undefined,5))
 assert.equal(signal.aborted,true)
})
for(const change of [r=>delete r.save_receipt,r=>r.save_receipt.request_id='wrong',r=>r.content='wrong',r=>r.id='wrong'])test('rejects an incomplete or mismatched save receipt '+change,async()=>{
 const a=createEditorSaveAttempt('a','old','new'),r=ack(a);change(r);await assert.rejects(commitEditorSave(()=>r,a))
})
test('abort before microtask cannot start an unexpected PUT',async()=>{
 const ctl=new AbortController(),a=createEditorSaveAttempt('a','old','new');ctl.abort();let calls=0
 await assert.rejects(commitEditorSave(()=>{calls++;return ack(a)},a,ctl.signal));assert.equal(calls,0)
})
test('later transport completion cannot approve a timed-out call',async()=>{
 const a=createEditorSaveAttempt('a','old','new');let resolve
 await assert.rejects(commitEditorSave(()=>new Promise(r=>resolve=r),a,undefined,5));resolve(ack(a));await Promise.resolve()
})
