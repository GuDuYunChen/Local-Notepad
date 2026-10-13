import assert from 'node:assert/strict'
import { validateHistoryRows, sameHistoryVersion, historyPreview, readVersionHistory,
  captureHistoryReview, restoreEditorHistory, historyRestoreBlock } from '../src/services/versionHistory.mjs'
const row = (patch = {}) => ({ id: 1, file_id: 'note-a', title: '原名.md', content: '历史全文', created_at: 10, ...patch })
const state = (patch = {}) => ({ id: 'note-a', ready: true, generation: 1, boundary: 2, revision: 3, content: '当前正文', saved: '当前正文', pending: false, uncertain: false, ...patch })
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return {promise,resolve,reject} }
export function registerVersionHistoryTests(test) {
 test('history sorts by timestamp then ID and never mutates server rows', () => {
  const a=row(), b=row({id:2}), c=row({id:3,created_at:9}), input=[c,a,b]
  const list=validateHistoryRows(input,'note-a'); assert.deepEqual(list.map(x=>x.id),[2,1,3]); assert.equal(input[0],c); assert.ok(Object.isFrozen(list[0]))
 })
 for (const [label, data] of [['nonarray',{}],['undefined',undefined],['foreign',[row({file_id:'note-b'})]],['duplicate',[row(),row()]],['string-id',[row({id:'1'})]],['missing-content',[row({content:undefined})]],['bad-time',[row({created_at:NaN})]],['fraction-time',[row({created_at:1.5})]],['zero-id',[row({id:0})]],['oversize-count',Array.from({length:51},(_,i)=>row({id:i+1}))]])
  test('history rejects '+label+' instead of displaying empty success',()=>assert.throws(()=>validateHistoryRows(data,'note-a'),{code:'invalid-list'}))
 test('empty and empty-body snapshots are valid, including unknown time',()=>{assert.deepEqual(validateHistoryRows([],'note-a'),[]);assert.deepEqual(validateHistoryRows(null,'note-a'),[]);assert.equal(validateHistoryRows([row({content:'',created_at:0})],'note-a')[0].content,'')})
 test('version comparison includes title, exact body, time and owning file',()=>{
  assert.equal(sameHistoryVersion(row(),row()),true)
  for(const change of [{title:'新名'},{content:'别的正文'},{created_at:11},{file_id:'note-b'},{id:2}]) assert.equal(sameHistoryVersion(row(),row(change)),false)
 })
 test('preview includes all characters across pages without splitting surrogate pairs',()=>{
  const text='文🙂'.repeat(4100), first=historyPreview(text,0), second=historyPreview(text,1), third=historyPreview(text,2)
  assert.equal(first.total,8200); assert.equal(first.pages,3); assert.equal(first.text+second.text+third.text,text)
  assert.equal(historyPreview('',99).page,0);assert.equal(historyPreview(text,-1).page,0)
 })
 test('reads exact encoded note route with actual AbortSignal',async()=>{
  const calls=[]; const list=await readVersionHistory((url,init)=>{calls.push([url,init]);return [row({file_id:'a/b'})]},'a/b')
  assert.equal(list.length,1);assert.equal(calls[0][0],'/api/files/a%2Fb/versions');assert.ok(calls[0][1].signal instanceof AbortSignal)
 })
 test('pre-aborted and synchronously aborted reads send nothing',async()=>{
  let calls=0; const api=()=>{calls++;return[]}, c=new AbortController();c.abort()
  await assert.rejects(readVersionHistory(api,'note-a',c.signal));const d=new AbortController(),p=readVersionHistory(api,'note-a',d.signal);d.abort();await assert.rejects(p);assert.equal(calls,0)
 })
 test('timeout ends ignored-abort reads and consumes their late rejection',async()=>{
  const d=deferred();let signal;const p=readVersionHistory((_,init)=>{signal=init.signal;return d.promise},'note-a',undefined,10)
  await assert.rejects(p,{code:'timeout'});assert.equal(signal.aborted,true);d.reject(Error('private details'));await Promise.resolve()
 })
 test('read transport errors do not expose arbitrary backend error strings',async()=>{
  await assert.rejects(readVersionHistory(()=>{throw Error('SECRET_PATH')},'note-a'),e=>e.code==='read-failed'&&!e.message.includes('SECRET_PATH'))
 })
 for (const [label, patch] of [['loading',{ready:false}],['different-note',{id:'note-b'}],['dirty',{content:'未保存'}],['pending',{pending:true}],['unconfirmed',{uncertain:true}]])
  test('restore refuses '+label+' before adopting or saving',async()=>{
   const version=row(),review=captureHistoryReview(state(),version);let changes=0
   await assert.rejects(restoreEditorHistory({snapshot:()=>state(patch),replace:()=>changes++,save:()=>changes++},version,review),{code:'editor-blocked'});assert.equal(changes,0)
  })
 for(const [label,patch] of [['new-lifetime',{generation:2}],['A-B-A-edits',{boundary:4}],['new-database-revision',{revision:4}],['changed-content',{content:'新',saved:'新'}]])
  test('review rejects '+label+' without a write',async()=>{
   const version=row(),review=captureHistoryReview(state(),version);let calls=0
   await assert.rejects(restoreEditorHistory({snapshot:()=>state(patch),replace:()=>calls++,save:()=>calls++},version,review),{code:'review-changed'});assert.equal(calls,0)
  })
 test('cancelled confirmation cannot adopt or write',async()=>{
  const version=row(),review=captureHistoryReview(state(),version),c=new AbortController();c.abort();let calls=0
  await assert.rejects(restoreEditorHistory({snapshot:()=>state(),replace:()=>calls++,save:()=>calls++},version,review,c.signal),{code:'cancelled'});assert.equal(calls,0)
 })
 test('same body is no-op even for the first historical snapshot',async()=>{
  const version=row({content:'当前正文'}),review=captureHistoryReview(state(),version);let calls=0
  const r=await restoreEditorHistory({snapshot:()=>state(),replace:()=>calls++,save:()=>calls++},version,review);assert.equal(r.unchanged,true);assert.equal(calls,0)
 })
 test('restore adopts exact full content then requires the original save acknowledgement',async()=>{
  const version=row({content:'完整🙂\n%2F\u0000尾'}),review=captureHistoryReview(state(),version),calls=[]
  const r=await restoreEditorHistory({snapshot:()=>state(),replace:text=>calls.push(['draft',text]),save:()=>{calls.push(['save']);return{id:'note-a',content:version.content}}},version,review)
  assert.deepEqual(calls,[['draft',version.content],['save']]);assert.equal(r.content,version.content)
 })
 test('failed save never discards the restored draft or fabricates success',async()=>{
  let draft='当前正文';const version=row(),review=captureHistoryReview(state(),version)
  await assert.rejects(restoreEditorHistory({snapshot:()=>state(),replace:text=>{draft=text},save:()=>Promise.reject(Error('conflict'))},version,review));assert.equal(draft,version.content)
 })
 for(const receipt of [null,{}, {id:'note-b',content:'历史全文'}, {id:'note-a',content:'别的内容'}])
  test('invalid acknowledgement '+JSON.stringify(receipt)+' is not restoration success',async()=>{
   const version=row(),review=captureHistoryReview(state(),version)
   await assert.rejects(restoreEditorHistory({snapshot:()=>state(),replace:()=>{},save:()=>receipt},version,review),{code:'save-unconfirmed'})
  })
 test('after adopting, caller abort does not undo an already sent editor save',async()=>{
  const d=deferred(),c=new AbortController(),version=row(),review=captureHistoryReview(state(),version);let adopted=''
  const p=restoreEditorHistory({snapshot:()=>state(),replace:text=>{adopted=text},save:()=>d.promise},version,review,c.signal)
  c.abort();d.resolve({id:'note-a',content:version.content});assert.equal((await p).content,adopted)
 })
 test('another edit while save is pending is not overwritten on acknowledgement',async()=>{
  const d=deferred(),version=row(),review=captureHistoryReview(state(),version);let draft='当前正文', replacements=0
  const p=restoreEditorHistory({snapshot:()=>state(),replace:text=>{draft=text;replacements++},save:()=>d.promise},version,review)
  draft='恢复后新输入';d.resolve({id:'note-a',content:version.content});await p;assert.equal(draft,'恢复后新输入');assert.equal(replacements,1)
 })
 test('no editor bridge is explicitly unavailable',()=>assert.ok(historyRestoreBlock(null,'note-a')))
}
