import assert from 'node:assert/strict'
import { createTrashWorkspace, TRASH_HISTORY_LIMIT, summarizeTrashReport } from '../src/services/trashWorkspace.mjs'
const entries = () => ['a','b'].map(id => ({ id, title: id+'.md', is_folder: false, is_deleted: true, deleted_at: 100, updated_at: 100, content: 'PRIVATE_BODY' }))
const tick = async () => { for(let i=0;i<20;i++) await Promise.resolve() }
function fixture(factory) {
  let mode='unknown', writes=0, reads=0
  const store=factory(async (route,init) => {
    if(!init.method) { reads++; if(mode==='read-error') throw Error('read failed');return entries() }
    writes++; if(mode==='unknown') throw Error('reply lost')
    if(typeof mode==='function') return mode(route,init)
    return null
  }, { timeoutMs:100 })
  return { store, mode:v=>{mode=v}, counts:()=>({reads,writes}),
    async run(id='a',action='restore') { await store.refresh(); const p=store.plan(action,[id]); assert.ok(p); return store.confirm(p.key) } }
}
export function registerTrashReceiptHistoryTests(test, factory=createTrashWorkspace) {
  test('collapse retains the exact immutable unconfirmed receipt for later inspection',async()=>{
    const f=fixture(factory);await f.run();const report=f.store.snapshot().report, counts=f.counts()
    f.store.clearReport();const state=f.store.snapshot()
    assert.equal(state.report,null);assert.equal(state.history[0],report);assert.equal(report.rows[0].status,'unconfirmed')
    assert.ok(Object.isFrozen(state.history));assert.ok(Object.isFrozen(report.rows[0]));assert.deepEqual(f.counts(),counts)
  })
  test('another successful batch cannot erase an older unknown outcome',async()=>{
    const f=fixture(factory);await f.run();const first=f.store.snapshot().report;f.mode('ok');await f.run('b')
    assert.equal(f.store.snapshot().history[0],first);assert.equal(first.rows[0].status,'unconfirmed')
    assert.equal(f.store.snapshot().report.rows[0].status,'succeeded');assert.equal(f.counts().writes,2)
  })
  test('disconnect and reopen retain collapsed history without sending a mutation',async()=>{
    const f=fixture(factory);const off=f.store.connect(()=>{});await f.run();f.store.clearReport();const history=f.store.snapshot().history
    off();const off2=f.store.connect(()=>{});try {await f.store.refresh();assert.equal(f.store.snapshot().history,history);assert.equal(history.length,1);assert.equal(f.counts().writes,1)}finally{off2()}
  })
  test('uncertain history cannot be removed without an explicit boolean acknowledgement',async()=>{
    const f=fixture(factory);await f.run();const key=f.store.snapshot().report.key;f.store.clearReport();const counts=f.counts()
    for(const ack of [undefined,false,1,'true',{}])assert.equal(f.store.removeHistory(key,ack),false)
    assert.equal(f.store.snapshot().history.length,1);assert.deepEqual(f.counts(),counts)
  })
  test('explicit history removal changes metadata only and does not resolve or retry a request',async()=>{
    const f=fixture(factory);await f.run();const old=f.store.snapshot().report;f.store.clearReport();const counts=f.counts()
    assert.equal(f.store.removeHistory(old.key,true),true);assert.equal(f.store.snapshot().history.length,0)
    assert.equal(old.rows[0].status,'unconfirmed');assert.deepEqual(f.counts(),counts)
  })
  test('completed known-outcome history can be explicitly removed',async()=>{
    const f=fixture(factory);f.mode('ok');await f.run();const key=f.store.snapshot().report.key;f.store.clearReport()
    assert.equal(f.store.removeHistory(key),true);assert.equal(f.store.snapshot().history.length,0)
  })
  test('unknown keys and repeated history removal do not affect a different record',async()=>{
    const f=fixture(factory);await f.run();const key=f.store.snapshot().report.key;f.store.clearReport()
    assert.equal(f.store.removeHistory(key+1,true),false);assert.equal(f.store.snapshot().history.length,1)
    assert.equal(f.store.removeHistory(key,true),true);assert.equal(f.store.removeHistory(key,true),false)
  })
  test('archived success does not re-emit restored notifications',async()=>{
    const f=fixture(factory);f.mode('ok');await f.run();assert.deepEqual(f.store.takeRestored(),['a'])
    f.store.clearReport();await f.store.refresh();assert.deepEqual(f.store.takeRestored(),[]);assert.equal(f.store.snapshot().history.length,1)
  })
  test('read failure keeps previously collapsed receipts and never upgrades them to success',async()=>{
    const f=fixture(factory);await f.run();f.store.clearReport();const report=f.store.snapshot().history[0]
    f.mode('read-error');await f.store.refresh();assert.equal(f.store.snapshot().history[0],report);assert.equal(report.rows[0].status,'unconfirmed')
  })
  test('archive bounds evict only old records without unknown outcomes',async()=>{
    const f=fixture(factory);await f.run();const protectedKey=f.store.snapshot().report.key;f.mode('ok')
    for(let i=0;i<TRASH_HISTORY_LIMIT+4;i++)await f.run('b')
    const history=f.store.snapshot().history
    assert.equal(history.length,TRASH_HISTORY_LIMIT);assert.ok(history.some(r=>r.key===protectedKey))
    assert.ok(!history.some(r=>r.key===2));assert.equal(history.find(r=>r.key===protectedKey).rows[0].status,'unconfirmed')
  })
  test('full uncertain history blocks the next batch before even preflight I/O',async()=>{
    const f=fixture(factory);for(let i=0;i<=TRASH_HISTORY_LIMIT;i++)await f.run()
    const counts=f.counts(), report=f.store.snapshot().report
    assert.equal(f.store.plan('delete',['a']),null);assert.equal(f.store.snapshot().report,report)
    assert.equal(f.store.snapshot().history.length,TRASH_HISTORY_LIMIT);assert.match(f.store.snapshot().historyError,/上限/)
    assert.deepEqual(f.counts(),counts)
  })
  test('collapse under full protected capacity refuses to discard the current unknown receipt',async()=>{
    const f=fixture(factory);for(let i=0;i<=TRASH_HISTORY_LIMIT;i++)await f.run()
    const report=f.store.snapshot().report;assert.equal(f.store.clearReport(),false)
    assert.equal(f.store.snapshot().report,report);assert.equal(summarizeTrashReport(report).unconfirmed,1)
  })
  test('freeing history capacity never auto-resumes the rejected operation',async()=>{
    const f=fixture(factory);for(let i=0;i<=TRASH_HISTORY_LIMIT;i++)await f.run()
    assert.equal(f.store.plan('delete',['a']),null);const counts=f.counts(),key=f.store.snapshot().history.at(-1).key
    assert.equal(f.store.removeHistory(key,true),true);await tick();assert.deepEqual(f.counts(),counts);assert.equal(f.store.snapshot().plan,null)
    const p=f.store.plan('delete',['a']);assert.ok(p);assert.deepEqual(f.counts(),counts)
  })
  test('collapse/removal cannot alter an active request or release its ownership',async()=>{
    const f=fixture(factory);await f.run();f.store.clearReport();const key=f.store.snapshot().history[0].key
    let resolve;f.mode(()=>new Promise(r=>{resolve=r}));const p=f.store.plan('restore',['b']),task=f.store.confirm(p.key)
    try {await tick();assert.equal(f.store.clearReport(),false);assert.equal(f.store.removeHistory(key,true),false);assert.equal(f.store.snapshot().pending,1)}finally{resolve?.(null);await task}
    assert.equal(f.store.snapshot().history[0].key,key)
  })
  test('late successful replies cannot rewrite archived timeout outcomes',async()=>{
    const f=fixture(factory);let resolve;f.mode(()=>new Promise(r=>{resolve=r}));await f.store.refresh();const p=f.store.plan('restore',['a']);await f.store.confirm(p.key)
    assert.equal(f.store.snapshot().report.rows[0].status,'unconfirmed');resolve(null);await tick();f.store.clearReport()
    assert.equal(f.store.snapshot().history[0].rows[0].status,'unconfirmed');assert.deepEqual(f.store.takeRestored(),[])
  })
  test('archive and next report are published atomically under synchronous listener reentry',async()=>{
    const f=fixture(factory);await f.run();const old=f.store.snapshot().report;let checked=false;const observations=[]
    const off=f.store.connect(()=>{
      const state=f.store.snapshot()
      if(!checked&&state.history?.length&&state.phase==='checking') {
        checked=true;observations.push({oldMatches:state.history[0]===old,differentKey:state.report.key!==old.key,clearResult:f.store.clearReport(),removeResult:f.store.removeHistory(old.key,true)})
      }
    })
    try{f.mode('ok');await f.run('b');assert.equal(checked,true);assert.deepEqual(observations,[{oldMatches:true,differentKey:true,clearResult:false,removeResult:false}]);assert.equal(f.store.snapshot().report.rows[0].status,'succeeded')}finally{off()}
  })
  test('repeated collapse does not duplicate a record or copy note bodies into history',async()=>{
    const f=fixture(factory);await f.run();f.store.clearReport();f.store.clearReport()
    assert.equal(f.store.snapshot().history.length,1);assert.ok(!JSON.stringify(f.store.snapshot().history).includes('PRIVATE_BODY'))
  })
  test('an archived plan cannot be replayed by its old key',async()=>{
    const f=fixture(factory);await f.run();const key=f.store.snapshot().report.key;f.store.clearReport();const counts=f.counts()
    assert.equal(await f.store.confirm(key),false);assert.deepEqual(f.counts(),counts)
  })
}
