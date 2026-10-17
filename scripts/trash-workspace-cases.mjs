import assert from 'node:assert/strict'
import { createTrashWorkspace, validateTrashList, getTrashView, summarizeTrashReport, trashDaysRemaining, formatTrashDeletedAt } from '../src/services/trashWorkspace.mjs'
const item = (id = 'a', extra = {}) => ({ id, title: '笔记 ' + id, is_folder: false, is_deleted: true, parent_id: '', deleted_at: 1791760000, updated_at: 1791760001, ...extra })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const ticks = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }
function fixture(rows = [item('a'), item('b')], options = {}) {
  let list = structuredClone(rows), mutation = null, read = null
  const calls = []
  const request = async (route, init) => {
    calls.push({ route, method: init.method || 'GET' })
    if (!init.method) return read ? read() : structuredClone(list)
    if (mutation) return mutation(route, init)
    const id = decodeURIComponent(route.split('/')[3]); list = list.filter(row => row.id !== id)
    return null
  }
  const store = createTrashWorkspace(request, options)
  return { store, calls, writes: () => calls.filter(x => x.method !== 'GET'), list: () => list,
    setList: value => { list = value }, onRead: fn => { read = fn }, onWrite: fn => { mutation = fn } }
}
export function registerTrashWorkspaceTests(test) {
  test('constructing a store performs no I/O', () => { const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.store.snapshot().loadState, 'idle') })
  test('valid list strips all note content and foreign metadata', () => {
    const list = validateTrashList([item('a', { content: 'PRIVATE', secret: 'PRIVATE' })]); assert.ok(Object.isFrozen(list)); assert.ok(Object.isFrozen(list[0])); assert.ok(!JSON.stringify(list).includes('PRIVATE'))
  })
  for (const [name, raw] of [
    ['null', null], ['object', {}], ['string', '[]'], ['duplicate IDs', [item(), item()]],
    ['unsafe ID', [item('../file')]], ['slash ID', [item('a/b')]], ['missing ID', [{ title: 'a', is_folder: false }]],
    ['missing title', [{ id: 'a', is_folder: false }]], ['object title', [item('a', { title: {} })]],
    ['bad kind', [item('a', { is_folder: 'true' })]], ['live note', [item('a', { is_deleted: false })]],
    ['negative date', [item('a', { deleted_at: -1 })]], ['infinite date', [item('a', { deleted_at: Infinity })]],
    ['fractional date', [item('a', { deleted_at: 1.5 })]], ['self parent', [item('a', { parent_id: 'a' })]],
    ['invalid parent', [item('a', { parent_id: '../' })]], ['oversize list', Array(20001).fill(item())],
  ]) test('invalid list is rejected rather than empty: ' + name, () => assert.throws(() => validateTrashList(raw)))
  test('known zero-row response is a valid empty list', () => assert.deepEqual(validateTrashList([]), []))
  test('compatibility for numeric booleans and missing optional times', () => assert.equal(validateTrashList([{ id: 'a', title: '', is_folder: 0 }])[0].deleted_at, 0))
  test('retention preserves legacy helper behavior but unknown date is labelled unknown', () => {
    assert.equal(trashDaysRemaining(0), 30); assert.equal(formatTrashDeletedAt(0), '删除时间未知')
    assert.equal(trashDaysRemaining(100, 100000 + 30 * 86400000), 0)
    assert.equal(trashDaysRemaining(100, 0), 30); assert.match(formatTrashDeletedAt(1791760000), /2026/)
  })
  test('filters Chinese/composed text by title only, never content', () => {
    const items = validateTrashList([item('a', { title: '研究 e\u0301', content: 'secret' }), item('b')]);
    assert.equal(getTrashView(items, { query: 'É' }).total, 1); assert.equal(getTrashView(items, { query: 'secret' }).total, 0)
  })
  test('type, expiry, sort and clamped pagination have exact scope', () => {
    const rows = validateTrashList([item('z', { deleted_at: 50 }), item('a', { is_folder: true, deleted_at: 100 }), item('b', { deleted_at: 0 })])
    assert.deepEqual(getTrashView(rows).rows.map(x => x.id), ['a','z','b'])
    assert.equal(getTrashView(rows, { type: 'folder' }).total, 1)
    assert.equal(getTrashView(rows, { type: 'soon', now: 100000 + 29 * 86400000 }).total, 2)
    assert.equal(getTrashView(rows, { page: 999, pageSize: 2 }).page, 2)
    assert.equal(getTrashView(rows, { query: 'not matching' }).pages, 1)
  })
  for (const options of [{ query: '字'.repeat(201) }, { type: 'bad' }, { sort: 'bad' }, { pageSize: 0 }, { pageSize: 101 }])
    test('invalid presentation options cannot silently widen an operation: ' + JSON.stringify(options).slice(0,40), () => assert.throws(() => getTrashView([], options)))
  test('read failure has error state, never false empty success', async () => {
    const f=fixture(); f.onRead(() => { throw Error('PRIVATE ERROR') }); assert.equal(await f.store.refresh(), false)
    assert.equal(f.store.snapshot().loadState, 'error'); assert.ok(!f.store.snapshot().error.includes('PRIVATE'))
    assert.equal(f.store.plan('delete',['a']), null)
  })
  test('malformed successful read has explicit error', async () => { const f=fixture(); f.onRead(() => null); await f.store.refresh(); assert.equal(f.store.snapshot().loadState,'error') })
  test('refresh failure preserves stale prior list and disables writes', async () => {
    const f=fixture();await f.store.refresh(); f.onRead(() => {throw Error()});await f.store.refresh()
    assert.equal(f.store.snapshot().loadState,'stale');assert.equal(f.store.snapshot().items.length,2);assert.equal(f.store.plan('restore',['a']),null)
  })
  test('duplicate refresh while loading uses a single request', async () => {
    const d=deferred(),f=fixture();f.onRead(()=>d.promise);const first=f.store.refresh();await ticks();assert.equal(await f.store.refresh(),false)
    d.resolve([]);await first;assert.equal(f.calls.length,1)
  })
  test('unmounted read cannot populate next view with obsolete response', async () => {
    const d=deferred(),f=fixture();f.onRead(()=>d.promise);const off=f.store.connect(()=>{}),p=f.store.refresh();await ticks();off();d.resolve([item('old')]);await p
    assert.equal(f.store.snapshot().items.length,0);assert.equal(f.store.snapshot().loadState,'idle')
    f.onRead(null);await f.store.refresh();assert.equal(f.store.snapshot().items[0].id,'a')
  })
  test('planning and cancelling are pure, with no mutation or validation read', async () => {
    const f=fixture();await f.store.refresh();const p=f.store.plan('delete',['a']);assert.ok(p);assert.equal(f.calls.length,1);f.store.cancelPlan();assert.equal(await f.store.confirm(p.key),false);assert.equal(f.writes().length,0)
  })
  for(const ids of [[], ['a','a'], ['missing'], Array.from({length:501},(_,i)=>''+i)])
    test('invalid selection refused: '+ids.slice(0,3).join(','),async()=>{const f=fixture();await f.store.refresh();assert.throws(()=>f.store.plan('restore',ids));assert.equal(f.writes().length,0)})
  test('old plan key cannot execute after selection changes', async () => {
    const f=fixture();await f.store.refresh();const p=f.store.plan('restore',['a']);const q=f.store.plan('restore',['b'])
    assert.equal(await f.store.confirm(p.key),false);assert.equal(await f.store.confirm(q.key),true);assert.match(f.writes()[0].route,/\/b\/restore$/)
  })
  test('whole restore performs sequential requests and has durable result rows', async () => {
    const f=fixture();await f.store.refresh();const p=f.store.plan('restore',['a','b']);assert.equal(await f.store.confirm(p.key),true)
    assert.equal(f.writes().length,2);assert.equal(f.store.snapshot().items.length,0);assert.deepEqual(f.store.takeRestored(),['a','b']);assert.deepEqual(f.store.takeRestored(),[])
    assert.equal(summarizeTrashReport(f.store.snapshot().report).succeeded,2);assert.equal(f.store.snapshot().report.complete,true)
  })
  test('permanent deletion uses confirmed IDs, never unbounded DELETE trash', async () => {
    const f=fixture();await f.store.refresh();const p=f.store.plan('delete',['a','b'],'snapshot');f.setList([...f.list(),item('new-after-confirm')]);await f.store.confirm(p.key)
    assert.equal(f.writes().length,2);assert.equal(f.writes().some(x=>x.route==='/api/files/trash'),false);assert.deepEqual(f.list().map(x=>x.id),['new-after-confirm'])
  })
  for(const change of [rows=>rows.slice(1),rows=>rows.map(x=>x.id==='a'?{...x,title:'changed'}:x),rows=>rows.map(x=>x.id==='a'?{...x,deleted_at:x.deleted_at+1}:x),rows=>rows.map(x=>x.id==='a'?{...x,parent_id:'new-parent'}:x)])
    test('changed confirmation target causes zero writes: '+change.toString().slice(0,50),async()=>{const f=fixture();await f.store.refresh();const p=f.store.plan('delete',['a','b']);f.setList(change(f.list()));assert.equal(await f.store.confirm(p.key),false);assert.equal(f.writes().length,0);assert.match(f.store.snapshot().report.message,/项目发生变化/)})
  test('preflight GET failure blocks the entire batch',async()=>{const f=fixture();await f.store.refresh();const p=f.store.plan('restore',['a']);f.onRead(()=>{throw Error()});await f.store.confirm(p.key);assert.equal(f.writes().length,0);assert.equal(f.store.snapshot().report.rows[0].status,'not-started')})
  test('duplicate confirm cannot create duplicate mutations',async()=>{
    const d=deferred(),f=fixture();await f.store.refresh();const p=f.store.plan('restore',['a']);f.onWrite(()=>d.promise);const first=f.store.confirm(p.key);await ticks();assert.equal(await f.store.confirm(p.key),false);assert.equal(f.writes().length,1);d.resolve(null);await first;assert.equal(f.writes().length,1)
  })
  test('partial success stops at unknown outcome, preserving success and unstarted rows',async()=>{
    const f=fixture([item('a'),item('b'),item('c')]);await f.store.refresh();let n=0;f.onWrite(()=>{if(++n===2)throw Error('PRIVATE');return null});const p=f.store.plan('restore',['a','b','c']);assert.equal(await f.store.confirm(p.key),false)
    assert.equal(f.writes().length,2);assert.deepEqual(f.store.snapshot().report.rows.map(x=>x.status),['succeeded','unconfirmed','not-started']);assert.ok(!JSON.stringify(f.store.snapshot().report).includes('PRIVATE'))
  })
  test('non-null legacy mutation result is not invented as success',async()=>{const f=fixture();await f.store.refresh();f.onWrite(()=>({ok:true}));const p=f.store.plan('delete',['a']);await f.store.confirm(p.key);assert.equal(f.store.snapshot().report.rows[0].status,'unconfirmed')})
  test('stop before validation finishes sends no writes',async()=>{
    const d=deferred(),f=fixture();await f.store.refresh();const p=f.store.plan('restore',['a']);f.onRead(()=>d.promise);const result=f.store.confirm(p.key);await ticks();f.store.stop();d.resolve(f.list());await result;assert.equal(f.writes().length,0)
  })
  test('stop while first mutation is in flight allows its receipt but no next write',async()=>{
    const d=deferred(),f=fixture();await f.store.refresh();f.onWrite(()=>d.promise);const p=f.store.plan('restore',['a','b']),result=f.store.confirm(p.key);await ticks();f.store.stop();d.resolve(null);await result;assert.equal(f.writes().length,1);assert.deepEqual(f.store.snapshot().report.rows.map(x=>x.status),['succeeded','not-started'])
  })
  test('unmount stops remaining work, preserving an in-flight result for reopening',async()=>{
    const d=deferred(),f=fixture();const off=f.store.connect(()=>{});await f.store.refresh();f.onWrite(()=>d.promise);const p=f.store.plan('restore',['a','b']),result=f.store.confirm(p.key);await ticks();off();const off2=f.store.connect(()=>{});assert.equal(f.store.plan('delete',['a']),null);d.resolve(null);await result;assert.equal(f.writes().length,1);assert.equal(f.store.snapshot().report.rows[0].status,'succeeded');off2()
  })
  test('write timeout keeps the transport slot and never accepts a late success',async()=>{
    const d=deferred(),f=fixture(undefined,{timeoutMs:25});await f.store.refresh();f.onWrite(()=>d.promise);const p=f.store.plan('delete',['a','b']);await f.store.confirm(p.key)
    assert.equal(f.store.snapshot().phase,'held');assert.equal(f.store.snapshot().pending,1);assert.equal(f.store.plan('delete',['b']),null);assert.equal(await f.store.refresh(),false)
    d.resolve(null);await ticks();assert.equal(f.store.snapshot().phase,'idle');assert.equal(f.store.snapshot().report.rows[0].status,'unconfirmed');assert.equal(f.writes().length,1)
    await f.store.refresh();assert.equal(f.writes().length,1)
  })
  test('late rejected write is consumed without wiping uncertainty',async()=>{
    const d=deferred(),f=fixture(undefined,{timeoutMs:25});await f.store.refresh();f.onWrite(()=>d.promise);const p=f.store.plan('restore',['a']);await f.store.confirm(p.key);d.reject(Error('PRIVATE'));await ticks();assert.equal(f.store.snapshot().pending,0);assert.equal(f.store.snapshot().report.rows[0].status,'unconfirmed')
  })
  test('monotonic deadline still rejects success when timer did not run',async()=>{
    let t=0;const f=fixture(undefined,{timeoutMs:100,now:()=>t});await f.store.refresh();f.onWrite(()=>{t=100;return null});const p=f.store.plan('restore',['a']);await f.store.confirm(p.key);assert.equal(f.store.snapshot().report.rows[0].status,'unconfirmed')
  })
  test('refresh failure after successful mutation retains success and never repeats write',async()=>{
    const f=fixture();await f.store.refresh();f.onWrite(()=>{f.onRead(()=>{throw Error()});return null});const p=f.store.plan('restore',['a']);await f.store.confirm(p.key)
    assert.equal(f.store.snapshot().report.rows[0].status,'succeeded');assert.equal(f.store.snapshot().loadState,'stale');assert.equal(f.writes().length,1)
    f.onRead(null);await f.store.refresh();assert.equal(f.writes().length,1)
  })
  test('UI callback failure is separately visible and cannot turn success into failure',async()=>{
    const f=fixture();f.store.connect(()=>{throw Error('view')});await f.store.refresh();const p=f.store.plan('restore',['a']);await f.store.confirm(p.key);f.store.reportRefreshError();assert.equal(f.store.snapshot().report.rows[0].status,'succeeded');assert.match(f.store.snapshot().notificationError,/恢复已成功/)
  })
  test('refresh cannot race an active mutation or erase its confirmation',async()=>{
    const d=deferred(),f=fixture();await f.store.refresh();f.onWrite(()=>d.promise);const p=f.store.plan('delete',['a']),promise=f.store.confirm(p.key);await ticks();const n=f.calls.length;assert.equal(await f.store.refresh(),false);assert.equal(f.calls.length,n);d.resolve(null);await promise
  })
  test('report clearing is refused during an unresolved write',async()=>{
    const d=deferred(),f=fixture(undefined,{timeoutMs:20});await f.store.refresh();f.onWrite(()=>d.promise);const p=f.store.plan('delete',['a']);await f.store.confirm(p.key);f.store.clearReport();assert.ok(f.store.snapshot().report);d.resolve(null);await ticks();f.store.clearReport();assert.equal(f.store.snapshot().report,null)
  })
}
