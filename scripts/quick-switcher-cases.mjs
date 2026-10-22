import assert from 'node:assert/strict'
import { quickQuery, quickRows, quickTarget, boundedQuickRead, readQuickResults, readQuickTarget } from '../src/services/quickSwitcher.mjs'
const row = (patch={}) => ({id:'a',title:'笔记.md',content:'正文',updated_at:1,...patch})
export function registerQuickSwitcherTests(test) {
  test('query preserves literal syntax and Unicode',()=>{assert.equal(quickQuery('  [a]+🙂  '),'[a]+🙂');assert.equal(quickQuery('🙂'.repeat(128)).length,256)})
  for (const value of [undefined,42,'x'.repeat(129),'a\n','x\0']) test('invalid query '+JSON.stringify(value),()=>assert.throws(()=>quickQuery(value),{code:'query'}))
  test('recent candidates prioritize pinned then actual update time without mutating input',()=>{const rows=[row(),row({id:'b',updated_at:5}),row({id:'c',is_pinned:true})];assert.deepEqual(quickRows(rows,true).map(r=>r.id),['c','b','a']);assert.equal(rows[0].id,'a');assert.ok(Object.isFrozen(quickRows(rows)[0]))})
  test('list hides templates, folders and trash without turning malformed lists into empty success',()=>{assert.deepEqual(quickRows([row({title:'__tpl__xx'}),row({id:'b',is_folder:1}),row({id:'c',is_deleted:true})]),[]);assert.deepEqual(quickRows([]),[])})
  for (const [label,input] of [['null',null],['object',{}],['dup',[row(),row()]],['empty id',[row({id:''})]],['wrong content',[row({content:null})]],['wrong flag',[row({is_deleted:'false'})]],['bad timestamp',[row({updated_at:-1})]],['over limit',Array.from({length:201},(_,i)=>row({id:String(i)}))]])
    test('refuses '+label,()=>assert.throws(()=>quickRows(input),{code:'invalid'}))
  test('large result fails explicitly',()=>assert.throws(()=>quickRows([row({content:'x'.repeat(8*1024*1024)})]),{code:'oversize'}))
  for(const patch of [{id:'b'},{is_folder:true},{is_deleted:true},{title:'__tpl__x'},{content:null}])test('latest target refuses '+JSON.stringify(patch),()=>assert.throws(()=>quickTarget(row(patch),'a'),{code:'target'}))
  test('latest full body is retained exactly',()=>{assert.equal(quickTarget(row({content:' \n🙂\n '}),'a').content,' \n🙂\n ')})
  test('pre-aborted and same-turn cancellation send no request',async()=>{let calls=0;const a=new AbortController();a.abort();await assert.rejects(boundedQuickRead(()=>calls++,a.signal),{code:'cancelled'});const b=new AbortController(),p=boundedQuickRead(()=>calls++,b.signal);b.abort();await assert.rejects(p,{code:'cancelled'});assert.equal(calls,0)})
  test('ignored abort times out; a late rejection is consumed',async()=>{let reject,signal;const pending=new Promise((_,r)=>{reject=r});const p=boundedQuickRead(s=>{signal=s;return pending},undefined,10);await assert.rejects(p,{code:'timeout'});assert.ok(signal.aborted);reject(Error('late private detail'));await Promise.resolve()})
  test('transport failure is redacted',async()=>{await assert.rejects(boundedQuickRead(()=>{throw Error('SECRET')}),e=>e.code==='read'&&!e.message.includes('SECRET'))})
  test('recent and search use their original routes and propagate cancellation',async()=>{const calls=[];const api=(...a)=>{calls.push(a);return[row()]},search=(...a)=>{calls.push(a);return[row()]};await readQuickResults(api,search,'');assert.equal(calls[0][0],'/api/files?size=200');assert.ok(calls[0][1].signal instanceof AbortSignal);await readQuickResults(api,search,' [a]+ ');assert.equal(calls[1][0],'[a]+');assert.ok(calls[1][1].signal instanceof AbortSignal)})
  test('target path uses exact encoded identity and read only',async()=>{let args;const r=await readQuickTarget((...a)=>{args=a;return row({id:'a/b'})},'a/b');assert.equal(args[0],'/api/files/a%2Fb');assert.equal(args[1].method,undefined);assert.equal(r.id,'a/b')})
}
