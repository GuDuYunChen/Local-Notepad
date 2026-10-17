import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeHistoryRecords } from '../src/services/syncHistorySummary.mjs'
const row = (id, patch = {}) => ({id,kind:'file',status:'resolved',resolution:'local',resolvedAt:200,...patch})
const sum = groups => groups.reduce((n,g)=>n+g.count,0)

test('both count dimensions cover every selected record once, without implied success rate', () => {
 const r=summarizeHistoryRecords([row('a'),row('b',{resolution:'remote',kind:'attachment'}),row('c',{status:'superseded',resolution:'remote-rebind',kind:'tag'}),row('d',{resolution:'unknown',kind:'file-tag'})])
 assert.equal(r.count,4);assert.deepEqual(r.outcomes.map(x=>x.count),[1,1,1,1]);assert.deepEqual(r.kinds.map(x=>x.count),[1,1,1,1])
 assert.equal(sum(r.outcomes),r.count);assert.equal(sum(r.kinds),r.count);assert.equal(r.successRate,undefined)
})
test('counts records rather than deduplicating an object appearing in separate conflicts',()=>{
 const r=summarizeHistoryRecords([row('a',{itemID:'same'}),row('b',{itemID:'same'})]);assert.equal(r.count,2);assert.equal(r.kinds[0].count,2)
})
for(const resolution of ['local','remote','remote-rebind','unknown'])test('superseded '+resolution+' is not counted as a chosen version',()=>{
 const r=summarizeHistoryRecords([row('a',{status:'superseded',resolution})]);assert.deepEqual(r.outcomes.map(x=>x.count),[0,0,1,0])
})
test('a resolved record with no confirmed choice belongs to unknown, not local or remote',()=>{
 const r=summarizeHistoryRecords([row('a',{resolution:'unknown'}),row('b',{resolution:'remote-rebind'})]);assert.deepEqual(r.outcomes.map(x=>x.count),[0,0,0,2])
})
test('empty selection has explicit zeros and no fabricated dates',()=>{
 const r=summarizeHistoryRecords([]);assert.equal(r.count,0);assert.equal(sum(r.outcomes),0);assert.equal(sum(r.kinds),0)
 assert.deepEqual(r.times,{known:0,missing:0,earliestUTC:null,latestUTC:null})
})
test('range uses completion timestamps only, independent of row order and creation date',()=>{
 const r=summarizeHistoryRecords([row('a',{createdAt:9999,resolvedAt:300}),row('b',{resolvedAt:100}),row('c',{resolvedAt:200})])
 assert.deepEqual(r.times,{known:3,missing:0,earliestUTC:'1970-01-01T00:01:40.000Z',latestUTC:'1970-01-01T00:05:00.000Z'})
})
test('missing times are counted but excluded from known range, including all-missing history',()=>{
 const r=summarizeHistoryRecords([row('a',{resolvedAt:0}),row('b',{resolvedAt:100})])
 assert.equal(r.times.known,1);assert.equal(r.times.missing,1);assert.equal(r.times.earliestUTC,r.times.latestUTC)
 assert.equal(summarizeHistoryRecords([row('x',{resolvedAt:0})]).times.earliestUTC,null)
})
test('supports the upper permitted timestamp without unsafe number conversion',()=>{
 const r=summarizeHistoryRecords([row('a',{resolvedAt:253402300799})]);assert.equal(r.times.latestUTC,'9999-12-31T23:59:59.000Z')
})
for(const [field,value] of [['kind','__proto__'],['status','open'],['resolution','PRIVATE'],['resolvedAt',-1],['resolvedAt','200'],['resolvedAt',NaN],['resolvedAt',253402300800],['id','']])test('refuses invalid '+field+'='+value+' instead of reporting partial counts',()=>{
 assert.throws(()=>summarizeHistoryRecords([row('good'),row('bad',{[field]:value})]))
})
test('rejects missing collections and duplicate records',()=>{
 for(const input of [undefined,{},[null],[row('a'),row('a')]])assert.throws(()=>summarizeHistoryRecords(input))
})
test('output is deeply immutable, input untouched and private fields never inspected',()=>{
 const a=row('a');for(const key of ['title','itemID','content','password','toJSON'])Object.defineProperty(a,key,{get(){throw Error('Private property accessed')}})
 Object.freeze(a);const input=Object.freeze([a]),r=summarizeHistoryRecords(input)
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.times)&&Object.isFrozen(r.outcomes)&&Object.isFrozen(r.kinds))
 assert.ok([...r.outcomes,...r.kinds].every(Object.isFrozen));assert.equal(input[0],a)
 assert.equal(JSON.stringify(r).includes('password'),false)
})
test('many records preserve totals and leave timestamps missing when all are unknown',()=>{
 const rows=Array.from({length:5000},(_,i)=>row('r'+i,{resolvedAt:0,resolution:i%2?'remote':'local'}))
 const r=summarizeHistoryRecords(rows);assert.equal(r.count,5000);assert.equal(sum(r.kinds),5000);assert.equal(sum(r.outcomes),5000);assert.equal(r.times.missing,5000)
})
