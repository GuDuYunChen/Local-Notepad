import test from 'node:test'
import assert from 'node:assert/strict'
import { selectHistoryFilePage, HISTORY_FILE_FILTER_ALL } from '../src/services/syncHistoryFileSelection.mjs'
import { summarizeHistoryRecords } from '../src/services/syncHistorySummary.mjs'
import { selectHistoryRecords } from '../src/services/syncHistorySearch.mjs'
const seconds=s=>Date.parse(s)/1000
const rows=[['before','2026-09-29T23:59:59Z'],['start','2026-09-30T00:00:00Z'],['end','2026-09-30T23:59:59Z'],['after','2026-10-01T00:00:00Z'],['unknown',null]].map(([id,date])=>Object.freeze({id,title:'星图',itemID:'object',kind:'file',status:'resolved',resolution:'local',resolvedAt:date?seconds(date):0}))
const selected=timeFilter=>selectHistoryFilePage(rows,{...HISTORY_FILE_FILTER_ALL,timeFilter})
test('file defaults preserve the all-dates condition and remain immutable',()=>{
 assert.equal(HISTORY_FILE_FILTER_ALL.timeFilter.mode,'all');assert.ok(Object.isFrozen(HISTORY_FILE_FILTER_ALL.timeFilter));assert.equal(selectHistoryFilePage(rows).matched,5)
})
for(const [label,timeFilter,expected] of [
 ['both boundaries',{mode:'range',from:'2026-09-30',to:'2026-09-30'},['start','end']],
 ['from only',{mode:'range',from:'2026-09-30',to:''},['start','end','after']],
 ['to only',{mode:'range',from:'',to:'2026-09-29'},['before']],
 ['unknown only',{mode:'missing',from:'',to:''},['unknown']],
 ['empty',{mode:'range',from:'2027-01-01',to:''},[]],
])test('file and summary share '+label,()=>{
 const p=selected(timeFilter),sum=summarizeHistoryRecords(selectHistoryRecords(rows,{timeFilter}).items)
 assert.deepEqual(p.rows.map(r=>r.id),expected);assert.equal(sum.count,p.matched)
 if(timeFilter.mode==='missing')assert.equal(sum.times.earliestUTC,null)
})
test('invalid local date intent cannot yield a partly filtered file',()=>{
 for(const timeFilter of [{mode:'range',from:'2026-10-01',to:'2026-09-30'},{mode:'range',from:'2026-02-30',to:''},{mode:'range',from:'',to:''}])assert.throws(()=>selected(timeFilter))
})
test('entire-file date intersection is evaluated before page slicing',()=>{
 const data=[...Array.from({length:30},(_,i)=>({...rows[0],id:'before-'+i})),...rows.slice(1,3)]
 const p=selectHistoryFilePage(data,{timeFilter:{mode:'range',from:'2026-09-30',to:'2026-09-30'}},1)
 assert.deepEqual(p.rows.map(r=>r.id),['start','end']);assert.equal(p.total,32);assert.equal(p.page,0)
})
