import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { HISTORY_TIME_ALL, normalizeHistoryTimeFilter, compileHistoryTimeFilter, describeHistoryTimeFilter } from '../src/services/syncHistoryTime.mjs'
import { selectHistoryRecords } from '../src/services/syncHistorySearch.mjs'
import { prepareHistoryExport } from '../src/services/syncHistoryExport.mjs'
const at = text => Date.parse(text + 'Z') / 1000
const row = (id, date, patch = {}) => Object.freeze({ id, itemID:'note-'+id, title:'星图', kind:'file', status:'resolved', resolution:'local', createdAt:1, resolvedAt:date, ...patch })
const items = Object.freeze([row('after',at('2026-10-02T00:00:00')), row('last',at('2026-10-01T23:59:59')), row('first',at('2026-10-01T00:00:00')), row('before',at('2026-09-30T23:59:59')), row('missing',0)])
const range = (from='',to='') => ({mode:'range',from,to})
const ids = options => selectHistoryRecords(items,options).items.map(r=>r.id)
const snapshot = Object.freeze({filter:'all',hasMore:true,items})

test('all retains identical ordering and old selection shape',()=>{
 assert.deepEqual(ids({}),items.map(r=>r.id));assert.equal(selectHistoryRecords(items).narrowed,false)
 assert.equal(normalizeHistoryTimeFilter(),HISTORY_TIME_ALL)
})
test('UTC end day includes its last second but excludes next midnight',()=>{
 assert.deepEqual(ids({timeFilter:range('2026-10-01','2026-10-01')}),['last','first'])
})
test('open start and open end are independent bounds, never include missing times',()=>{
 assert.deepEqual(ids({timeFilter:range('','2026-10-01')}),['last','first','before'])
 assert.deepEqual(ids({timeFilter:range('2026-10-01')}),['after','last','first'])
})
test('missing mode includes only the explicit zero sentinel',()=>{
 assert.deepEqual(ids({timeFilter:{mode:'missing'}}),['missing']);assert.equal(selectHistoryRecords(items,{timeFilter:{mode:'missing'}}).narrowed,true)
})
test('1970 dates preserve positive seconds while zero remains unknown',()=>{
 const match=compileHistoryTimeFilter(range('1970-01-01','1970-01-01')).includes
 assert.equal(match({resolvedAt:0}),false);assert.equal(match({resolvedAt:1}),true);assert.equal(match({resolvedAt:86399}),true);assert.equal(match({resolvedAt:86400}),false)
})
test('upper year 9999 includes the maximum supported timestamp exactly',()=>{
 const match=compileHistoryTimeFilter(range('9999-12-31','9999-12-31')).includes
 assert.equal(match({resolvedAt:253402300799}),true);assert.equal(match({resolvedAt:253402300800}),false)
})
test('valid leap date is not interpreted in the system timezone',()=>{
 const result=normalizeHistoryTimeFilter(range('2024-02-29','2024-02-29'));assert.equal(result.from,'2024-02-29')
})
for(const invalid of ['2026-02-29','2024-02-30','2026-04-31','2026-13-01','2026-00-01','2026-01-00','1969-12-31','10000-01-01','2026-1-01','2026-10-01T00:00:00Z',' 2026-10-01'])test('refuses invalid date '+invalid,()=>{
 assert.throws(()=>normalizeHistoryTimeFilter(range(invalid,'2026-10-31')))
})
test('reversed or absent bounds are errors, not empty successful selections',()=>{
 for(const value of [range(),range('2026-10-02','2026-10-01'),null,{mode:'PRIVATE'},range(10),range('',false)]){
  assert.throws(()=>selectHistoryRecords(items,{timeFilter:value}))
 }
})
test('query, kind, outcome and dates all form one intersection without mutating input',()=>{
 const rows=[...items,row('other',at('2026-10-01T12:00:00'),{kind:'tag',resolution:'remote',title:'OTHER'})]
 const before=JSON.stringify(rows)
 const selected=selectHistoryRecords(rows,{query:'星',kind:'file',outcome:'local',timeFilter:range('2026-10-01','2026-10-01')})
 assert.deepEqual(selected.items.map(r=>r.id),['last','first']);assert.equal(selected.loaded,6);assert.equal(selected.matched,2)
 assert.equal(JSON.stringify(rows),before);assert.ok(Object.isFrozen(selected.items))
})
test('date selection does not read title, body or private fields when text query is absent',()=>{
 const item={resolvedAt:1};for(const k of ['title','content','password'])Object.defineProperty(item,k,{get(){throw Error('PRIVATE READ')}})
 assert.equal(selectHistoryRecords([item],{timeFilter:range('1970-01-01')}).matched,1)
})
test('normalization whitelists fields and immutable output; all/missing discard inactive dates',()=>{
 const r=normalizeHistoryTimeFilter({...range('2026-10-01'),password:'PRIVATE'})
 assert.deepEqual(Object.keys(r),['mode','from','to']);assert.ok(Object.isFrozen(r))
 assert.deepEqual(normalizeHistoryTimeFilter({...r,mode:'missing'}),{mode:'missing',from:'',to:''})
})
test('unfiltered export retains exactly the old v1 bytes',()=>{
 const now=new Date('2026-10-02T00:00:00Z')
 const a=prepareHistoryExport({snapshot,phase:'ready'},now)
 const b=prepareHistoryExport({snapshot,phase:'ready',timeFilter:HISTORY_TIME_ALL},now)
 assert.equal(a.raw,b.raw);const j=JSON.parse(a.raw);assert.equal(j.version,1);assert.equal(j.filters.completedDateUTC,undefined)
})
test('date export v2 records match list and record the precise applied UTC bounds',()=>{
 const value=range('2026-10-01','2026-10-01')
 const j=JSON.parse(prepareHistoryExport({snapshot,phase:'ready',query:'星',timeFilter:value}).raw)
 assert.equal(j.version,2);assert.deepEqual(j.filters.completedDateUTC,value);assert.deepEqual(j.records.map(r=>r.id),ids({timeFilter:value}))
 assert.equal(j.scope.loadedCount,5);assert.equal(j.scope.exportedCount,2);assert.equal(j.scope.hasUnreadOlderRecords,true)
 assert.ok(!Object.hasOwn(j.filters,'query'));assert.equal(j.records.some(r=>r.content!==undefined),false)
})
test('timeless export has explicit missing mode and null completion, not epoch',()=>{
 const j=JSON.parse(prepareHistoryExport({snapshot,phase:'ready',timeFilter:{mode:'missing'}}).raw)
 assert.equal(j.version,2);assert.equal(j.filters.completedDateUTC.mode,'missing');assert.equal(j.records[0].completedAtUTC,null)
})
for(const phase of ['error','stopped'])test('dated export preserves stale provenance '+phase,()=>{
 const j=JSON.parse(prepareHistoryExport({snapshot,phase,timeFilter:range('2026-10-01')}).raw)
 assert.equal(j.scope.sourceState,phase);assert.equal(j.scope.currentRemoteStateVerified,false)
 assert.match(j.notices.join(''),phase==='error'?/最近读取失败/:/最近读取已停止/)
})
test('invalid, empty and reading exports do not produce a misleading file',()=>{
 for(const params of [{timeFilter:range()},{timeFilter:range('2030-01-01')},{phase:'loading',timeFilter:range('2026-10-01')}]){
  assert.throws(()=>prepareHistoryExport({snapshot,phase:'ready',...params}))
 }
})
test('date descriptions always distinguish missing records and inclusive UTC days',()=>{
 assert.match(describeHistoryTimeFilter(range('2026-10-01')),/UTC.*包含结束当日.*不含时间缺失/)
 assert.match(describeHistoryTimeFilter({mode:'missing'}),/仅.*缺失/)
})
test('UTC day membership is the same in DST and non-DST device timezones',()=>{
 const script=`import {compileHistoryTimeFilter as c} from './src/services/syncHistoryTime.mjs'; const m=c({mode:'range',from:'2026-03-08',to:'2026-03-08'}).includes; console.log(JSON.stringify([1772928000,1773014399,1773014400].map(resolvedAt=>m({resolvedAt}))));`
 const results=['UTC','America/Los_Angeles','Asia/Shanghai'].map(TZ=>execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),env:{...process.env,TZ},encoding:'utf8'}))
 assert.ok(results.every(r=>r===results[0]));assert.equal(results[0].trim(),'[true,true,false]')
})
