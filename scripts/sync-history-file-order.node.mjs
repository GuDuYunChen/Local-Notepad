import test from 'node:test'
import assert from 'node:assert/strict'
import { orderHistoryFileRecords, HISTORY_FILE_ORDER_OPTIONS, isHistoryFileOrder } from '../src/services/syncHistoryFileOrder.mjs'
import { selectHistoryFilePage, HISTORY_FILE_FILTER_ALL } from '../src/services/syncHistoryFileSelection.mjs'
import { prepareHistoryExport } from '../src/services/syncHistoryExport.mjs'
import { parseHistoryFile } from '../src/services/syncHistoryFile.mjs'
const ids = rows => rows.map(row => row.id)
const rows = Object.freeze([
  { id: 'z', createdAt: 30, resolvedAt: 10 },
  { id: 'missing', createdAt: 0, resolvedAt: 0 },
  { id: 'b', createdAt: 10, resolvedAt: 30 },
  { id: 'a', createdAt: 10, resolvedAt: 30 },
  { id: 'c', createdAt: 20, resolvedAt: 20 },
].map(Object.freeze))
for (const [order, expected] of [
  ['file', ['z','missing','b','a','c']],
  ['completed-desc', ['b','a','c','z','missing']],
  ['completed-asc', ['z','c','b','a','missing']],
  ['created-desc', ['z','c','b','a','missing']],
  ['created-asc', ['b','a','c','z','missing']],
]) test(order + ' has exact stable ordering without mutating input', () => {
  const before = JSON.stringify(rows), result = orderHistoryFileRecords(rows, order)
  assert.deepEqual(ids(result), expected); assert.equal(JSON.stringify(rows), before)
  assert.notEqual(result, rows); assert.ok(Object.isFrozen(result)); assert.ok(result.every(row => rows.includes(row)))
})
test('default is exact file order, independent of ID, title and completion time', () => {
  assert.deepEqual(ids(orderHistoryFileRecords(rows)), ids(rows))
  assert.deepEqual(HISTORY_FILE_ORDER_OPTIONS.map(x => x.value), ['file','completed-desc','completed-asc','created-desc','created-asc'])
  assert.ok(Object.isFrozen(HISTORY_FILE_ORDER_OPTIONS)); assert.ok(HISTORY_FILE_ORDER_OPTIONS.every(Object.isFrozen))
})
for (const value of [null, '', 'newest', 'title', {}, 1, undefined]) test('invalid explicit order ' + String(value), () => {
  if (value === undefined) { assert.equal(isHistoryFileOrder(value), false); return }
  assert.throws(() => orderHistoryFileRecords(rows, value), /排序/)
  assert.throws(() => selectHistoryFilePage([], HISTORY_FILE_FILTER_ALL, 0, value), /排序/)
})
for (const value of [null, {}, 'rows']) test('reject non-array ' + String(value), () => assert.throws(() => orderHistoryFileRecords(value), /排序/))
for (const order of ['completed-desc','completed-asc','created-desc','created-asc']) test(order + ' puts every unrenderable time last and retains missing order', () => {
  const missing = [0, -1, 1.5, NaN, Infinity, '10', null, undefined, 253402300800]
  const data = missing.map((time, i) => ({ id: 'm' + i, createdAt: time, resolvedAt: time }))
  data.splice(2, 0, { id: 'valid', createdAt: 253402300799, resolvedAt: 1 })
  assert.deepEqual(ids(orderHistoryFileRecords(data, order)), ['valid', ...missing.map((_,i) => 'm' + i)])
})
test('empty and all-missing arrays stay stable', () => {
  for (const {value} of HISTORY_FILE_ORDER_OPTIONS) {
    assert.deepEqual(orderHistoryFileRecords([], value), [])
    const data = [{id:'z',createdAt:0,resolvedAt:0},{id:'a',createdAt:0,resolvedAt:0}]
    assert.deepEqual(ids(orderHistoryFileRecords(data, value)), ['z','a'])
  }
})
const large = Object.freeze(Array.from({length:2000}, (_,i) => Object.freeze({id:'r'+i,itemID:'n'+i,title:i%2 ? '另一组' : '目标',kind:'file',status:'resolved',resolution:'local',createdAt:2000-i,resolvedAt:i+1})))
test('order the entire 2000-record match before pagination, exact 80 pages and no lost rows', () => {
  const all = []
  for(let p=0;p<80;p++) {
    const selected=selectHistoryFilePage(large,HISTORY_FILE_FILTER_ALL,p,'completed-desc')
    assert.equal(selected.pages,80); assert.equal(selected.page,p); assert.equal(selected.matched,2000)
    assert.equal(selected.narrowed,false); assert.equal(selected.from,p*25+1); all.push(...ids(selected.rows))
  }
  assert.deepEqual(all,Array.from({length:2000},(_,i)=>'r'+(1999-i))); assert.equal(new Set(all).size,2000)
})
test('text/kind/outcome/date intersect before ordering, not only on the original first page', () => {
  const data=large.map(row=>({...row,resolvedAt:1790812800+Number(row.id.slice(1)),kind:Number(row.id.slice(1))%4===0?'tag':'file'}))
  const filters={query:'目标',kind:'tag',outcome:'local',timeFilter:{mode:'range',from:'2026-10-01',to:'2026-10-01'}}
  const page=selectHistoryFilePage(data,filters,0,'completed-desc')
  assert.equal(page.total,2000); assert.equal(page.matched,500); assert.equal(page.pages,20); assert.equal(page.narrowed,true)
  assert.deepEqual(ids(page.rows),Array.from({length:25},(_,i)=>'r'+(1996-i*4)))
})
test('ties across page boundaries preserve source order, not lexical ID order', () => {
  const data=Array.from({length:61},(_,i)=>({...large[0],id:'tie'+(60-i),resolvedAt:30}))
  assert.deepEqual(ids(selectHistoryFilePage(data,HISTORY_FILE_FILTER_ALL,1,'completed-asc').rows),Array.from({length:25},(_,i)=>'tie'+(35-i)))
})
test('returning to file order restores the original projection after all sort modes', () => {
  for(const {value} of HISTORY_FILE_ORDER_OPTIONS) selectHistoryFilePage(large,HISTORY_FILE_FILTER_ALL,0,value)
  assert.deepEqual(ids(selectHistoryFilePage(large).rows),Array.from({length:25},(_,i)=>'r'+i))
})
test('sorting an exported/parsed file does not mutate records, metadata, summary or raw bytes', () => {
  const raw=prepareHistoryExport({snapshot:{items:large.slice(0,61),filter:'all',hasMore:true},phase:'ready'},new Date('2026-10-01T10:00:00Z')).raw
  const report=parseHistoryFile(raw), before=JSON.stringify(report)
  for(const {value} of HISTORY_FILE_ORDER_OPTIONS) selectHistoryFilePage(report.records,HISTORY_FILE_FILTER_ALL,0,value)
  assert.equal(JSON.stringify(report),before); assert.equal(report.records[0].id,'r0'); assert.equal(report.records.at(-1).id,'r60')
  assert.equal(parseHistoryFile(raw).records.length,61)
})
test('zero matches have zero pages for every ordering without fabricating 1/0', () => {
  for(const {value} of HISTORY_FILE_ORDER_OPTIONS) {
    const page=selectHistoryFilePage(large,{...HISTORY_FILE_FILTER_ALL,query:'not-present'},0,value)
    assert.equal(page.matched,0); assert.equal(page.pages,0); assert.equal(page.from,0); assert.equal(page.to,0); assert.deepEqual(page.rows,[])
  }
})
