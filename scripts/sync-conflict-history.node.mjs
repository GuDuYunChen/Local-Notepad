import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { appendConflictHistory, conflictHistoryURL, historyOutcome, historyTime, parseConflictHistory, readConflictHistory } from '../src/services/syncConflictHistory.mjs'
import { historyPage, historyRow } from './fixtures/sync-conflict-history.mjs'

test('only fixed GET targets and explicit pagination parameters are generated', () => {
  assert.equal(conflictHistoryURL(), '/api/sync/conflicts/history?filter=all&limit=25')
  for (const filter of ['resolved','superseded']) assert.ok(conflictHistoryURL(filter,'abc-123').includes('before=abc-123'))
  for (const [f,c] of [['open',''],['all','../../'],['all','x'.repeat(1025)],['__proto__','']]) assert.throws(() => conflictHistoryURL(f,c))
})
test('projection is deeply immutable, independent and excludes unrequested private fields', () => {
  const input = historyPage(); input.items[0].local_record = 'PRIVATE_BODY'; input.password = 'PRIVATE_PASSWORD'
  const before = structuredClone(input), page = parseConflictHistory(input)
  assert.deepEqual(input,before); assert.ok(Object.isFrozen(page)); assert.ok(Object.isFrozen(page.items)); assert.ok(Object.isFrozen(page.items[0]))
  assert.ok(!JSON.stringify(page).includes('PRIVATE_')); assert.equal(page.items[0].title,input.items[0].current_title)
})
for (const [name,change] of [
  ['absent', () => null], ['old version', x => ({...x,version:0})], ['foreign scope', x => ({...x,scope:'remote'})],
  ['missing list', x => ({...x,items:undefined})], ['oversized page', x => ({...x,items:Array(26).fill(historyRow())})],
  ['duplicate IDs', x => ({...x,items:[historyRow(),historyRow()]})], ['open conflict', x => ({...x,items:[historyRow('x','open')]})],
  ['unknown resolution', x => ({...x,items:[historyRow('x','resolved','PRIVATE') ]})],
  ['wrong filter', x => ({...x,filter:'resolved'})], ['missing cursor', x => ({...x,next_cursor:undefined})],
  ['inconsistent pagination', x => ({...x,has_more:true})], ['empty more', x => ({...x,items:[],has_more:true,next_cursor:'a'})],
  ['ascending times', x => ({...x,items:[historyRow('a','resolved','local',100),historyRow('b','resolved','local',200)]})],
]) test(`rejects ${name} rather than replacing the snapshot with an empty result`, () => assert.throws(() => parseConflictHistory(change(historyPage()))))
test('filter results must agree row by row, while empty results stay explicit', () => {
  assert.equal(parseConflictHistory(historyPage([], 'resolved'),'resolved').items.length,0)
  assert.throws(() => parseConflictHistory(historyPage([historyRow('s','superseded')],'resolved'),'resolved'))
})
test('invalid IDs, times, kinds and titles cannot pass structural validation', () => {
  for (const [key,value] of [['id',''],['id','x\n'],['item_id',null],['kind','constructor'],['created_at','10'],['resolved_at',-1],['resolved_at',253402300800],['current_title',{}]]) {
    const x=historyPage(); x.items[0][key]=value; assert.throws(() => parseConflictHistory(x))
  }
})
test('255 Unicode title characters, including supplementary characters, remain usable', () => {
  const x=historyPage();x.items[0].current_title='🌱'.repeat(255)
  assert.equal(parseConflictHistory(x).items[0].title,x.items[0].current_title)
})
test('append rejects mixed filters, overlapping IDs, newer data and non-advancing cursors', () => {
  const a=parseConflictHistory(historyPage([historyRow('a')],'all','c1'))
  const b=parseConflictHistory(historyPage([historyRow('b','resolved','remote',1790586500)]))
  assert.equal(appendConflictHistory(a,b).items.length,2);assert.equal(a.items.length,1)
  for (const p of [parseConflictHistory(historyPage([historyRow('a')])),{...b,filter:'resolved'},{...b,hasMore:true,nextCursor:'c1'}, {...b,items:[{...b.items[0],resolvedAt:1790586700}]}]) assert.throws(() => appendConflictHistory(a,p))
})
test('history timestamps and outcomes never imply current remote state or solved superseded records', () => {
  assert.equal(historyTime(1),'1970-01-01T00:00:01.000Z')
  for (const x of [0,-1,null,NaN,'100',253402300800]) assert.equal(historyTime(x),'')
  assert.equal(historyOutcome({status:'resolved',resolution:'local'}),'当时保留本机版本')
  assert.match(historyOutcome({status:'superseded',resolution:'local'}),/不代表已选边/)
  assert.match(historyOutcome({status:'superseded',resolution:'remote-rebind'}),/重新绑定/)
  assert.doesNotMatch(historyOutcome({status:'PRIVATE',resolution:'PRIVATE'}),/PRIVATE/)
})
test('successful reads issue one GET with a signal and validate the response', async () => {
  const calls=[];const page=await readConflictHistory((...args)=>{calls.push(args);return historyPage()})
  assert.equal(page.items.length,1);assert.equal(calls.length,1);assert.equal(calls[0][1].method,'GET');assert.ok(calls[0][1].signal)
})
test('timeout is bounded even when a loader ignores its abort signal', async () => {
  let signal
  await assert.rejects(readConflictHistory((_,opts)=>{signal=opts.signal;return new Promise(()=>{})},{timeoutMs:5}),e=>e.code==='timeout')
  assert.equal(signal.aborted,true)
})
test('already cancelled reads do not invoke the loader', async () => {
  const c=new AbortController();c.abort();let calls=0
  await assert.rejects(readConflictHistory(()=>{calls++;return historyPage()},{signal:c.signal}),e=>e.code==='aborted');assert.equal(calls,0)
})
test('cancellation before the scheduled loader prevents an unnecessary request', async () => {
  const c=new AbortController();let calls=0
  const p=readConflictHistory(()=>{calls++;return historyPage()},{signal:c.signal});c.abort()
  await assert.rejects(p,e=>e.code==='aborted');assert.equal(calls,0)
})
test('late completion after abort cannot masquerade as successful history', async () => {
  const c=new AbortController();let finish
  const p=readConflictHistory(()=>new Promise(r=>{finish=r}),{signal:c.signal});await Promise.resolve();c.abort()
  await assert.rejects(p,e=>e.code==='aborted');finish(historyPage());await Promise.resolve()
})
test('neither projection nor panel can resolve, write, remove or persist history', () => {
  for (const name of ['src/services/syncConflictHistory.mjs','src/components/SyncConflictHistoryPanel.jsx']) {
    const text=readFileSync(new URL('../'+name,import.meta.url),'utf8')
    assert.doesNotMatch(text,/localStorage|sessionStorage|electronAPI|clipboard|method:\s*['"](?:POST|PUT|DELETE)|\/resolve|dangerouslySetInnerHTML|setInterval/)
  }
})
