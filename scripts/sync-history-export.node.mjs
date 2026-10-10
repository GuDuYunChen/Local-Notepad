import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareHistoryExport, HISTORY_EXPORT_LIMIT } from '../src/services/syncHistoryExport.mjs'
const now = new Date('2026-09-30T04:00:00Z')
const row = (id = 'r1', patch = {}) => ({ id, itemID: 'n-' + id, kind: 'file', title: '旅行 ＡＢＣ',
  createdAt: 100, resolvedAt: 200, status: 'resolved', resolution: 'local', ...patch })
const input = (items = [row()], patch = {}) => ({ snapshot: { filter: 'all', items, hasMore: false },
  query: '', kind: 'all', outcome: 'all', phase: 'ready', ...patch })
const report = value => JSON.parse(prepareHistoryExport(value, now).raw)

test('exports precisely the visible intersection, not all fetched or unread rows', () => {
  const value = input([row('a'), row('b', { resolution: 'remote' }), row('c', { kind: 'attachment' })], { query: 'abc', kind: 'file', outcome: 'local' })
  value.snapshot.hasMore = true
  const r = report(value)
  assert.deepEqual(r.records.map(x => x.id), ['a'])
  assert.equal(r.scope.loadedCount, 3); assert.equal(r.scope.exportedCount, 1)
  assert.equal(r.scope.hasUnreadOlderRecords, true); assert.equal(r.scope.currentRemoteStateVerified, false)
})
test('whitelists row and scope fields and omits the query, hidden rows, raw content and cursor', () => {
  const value = input([row('a', { private: 'SECRET', local_record: 'SECRET', toJSON: () => ({password:'SECRET'}) }), row('hidden', {title:'SECRET'})], { query: 'ａｂｃ' })
  value.snapshot.nextCursor = 'SECRET'; value.snapshot.endpoint = 'SECRET'
  const raw = prepareHistoryExport(value, now).raw
  assert.ok(!raw.includes('SECRET')); assert.ok(!raw.includes('ａｂｃ'))
  assert.equal(JSON.parse(raw).filters.textFilterApplied, true)
  assert.deepEqual(Object.keys(JSON.parse(raw).records[0]), ['id','itemID','kind','currentTitle','createdAtUTC','completedAtUTC','status','resolution','outcome'])
})
test('separates captured time from unknown history timestamps without inventing dates', () => {
  const r = report(input([row('a', {createdAt:0, resolvedAt:0})]))
  assert.equal(r.exportedAtUTC, now.toISOString()); assert.equal(r.records[0].createdAtUTC, null)
  assert.equal(r.records[0].completedAtUTC, null)
  assert.equal(report(input()).records[0].createdAtUTC, '1970-01-01T00:01:40.000Z')
})
test('keeps superseded and unknown outcomes truthful', () => {
  const r = report(input([row('a', {status:'superseded',resolution:'remote-rebind'}),row('b',{resolution:'unknown'})]))
  assert.match(r.records[0].outcome,/不代表已选边/); assert.match(r.records[1].outcome,/未核实/)
})
for (const phase of ['error', 'stopped']) test('labels retained old snapshot after ' + phase, () => {
  const r = report(input(undefined, {phase}))
  assert.equal(r.scope.sourceState, phase)
  assert.match(r.notices.join(' '), phase === 'error' ? /最近读取失败/ : /最近读取已停止/)
})
for (const [label, value] of [
  ['unread', input(undefined,{snapshot:null,phase:'unread'})],
  ['reading', input(undefined,{phase:'loading'})],
  ['composing', input(undefined,{composing:true})],
  ['no matches', input(undefined,{query:'not-present'})],
  ['empty history', input([])],
  ['too many rows', input(Array.from({length:HISTORY_EXPORT_LIMIT+1},(_,i)=>row('r'+i)))],
  ['duplicates', input([row(),row()])],
  ['invalid time', input([row('a',{resolvedAt:-1})])],
  ['unknown status', input([row('a',{status:'open'})])],
  ['unknown outcome', input([row('a',{resolution:'private-value'})])],
  ['malformed title', input([row('a',{title:{private:'SECRET'}})])],
]) test('refuses '+label+' without a partial file', () => assert.throws(()=>prepareHistoryExport(value,now)))
test('refuses oversized JSON in bytes, not a silently truncated collection', () => {
  const items=Array.from({length:800},(_,i)=>row('r'+i,{itemID:'文'.repeat(2048)}))
  assert.throws(()=>prepareHistoryExport(input(items),now),/4 MiB/)
})
test('supports bounded supplementary Unicode and literal JSON punctuation', () => {
  const title='<script>"\\\n'+ '🌱'.repeat(200)
  assert.equal(report(input([row('a',{title})])).records[0].currentTitle, title)
})
test('captures independent bytes, leaves source rows unchanged and preserves order', () => {
  const value=input([row('b'),row('a')]), before=structuredClone(value)
  const prepared=prepareHistoryExport(value,now);assert.deepEqual(value,before);assert.ok(Object.isFrozen(prepared))
  value.snapshot.items[0].title='changed'
  assert.deepEqual(JSON.parse(prepared.raw).records.map(r=>r.id),['b','a'])
  assert.ok(!prepared.raw.includes('changed'));assert.ok(!prepared.filename.includes('旅行'))
  assert.match(prepared.filename,/^Local-Notepad-冲突历史-2026-09-30T04-00-00-000Z.json$/)
})
test('validates server filter and export clock', () => {
  const v=input();v.snapshot.filter='resolved';v.snapshot.items=[row('a',{status:'superseded'})]
  assert.throws(()=>prepareHistoryExport(v,now));assert.throws(()=>prepareHistoryExport(input(),new Date('bad')))
  v.snapshot.filter='bad';assert.throws(()=>prepareHistoryExport(v,now))
})
