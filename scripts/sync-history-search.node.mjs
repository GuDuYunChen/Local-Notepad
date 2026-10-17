import test from 'node:test'
import assert from 'node:assert/strict'
import { limitHistoryQuery, selectHistoryRecords, historyOutcomeKey } from '../src/services/syncHistorySearch.mjs'
const rows = Object.freeze([
  Object.freeze({ id:'rec-A', title:'第一章·ＡＢＣ', itemID:'note-alpha',kind:'file',status:'resolved',resolution:'local',private:'SECRET_ONLY' }),
  Object.freeze({ id:'rec-B', title:'Cafe\u0301 🌱', itemID:'note-beta',kind:'file',status:'resolved',resolution:'remote' }),
  Object.freeze({ id:'rec-C', title:'', itemID:'attachment-photo',kind:'attachment',status:'superseded',resolution:'remote-rebind' }),
  Object.freeze({ id:'rec-D', title:'', itemID:'tag-topic',kind:'tag',status:'resolved',resolution:'unknown' }),
  Object.freeze({ id:'rec-E', title:'', itemID:'file-tag-relation',kind:'file-tag',status:'resolved',resolution:'local' }),
])
const ids = options => selectHistoryRecords(rows, options).items.map(row=>row.id)
test('no local filter preserves source order, references and the loaded count',()=>{
 const result=selectHistoryRecords(rows);assert.deepEqual(result.items,rows);assert.equal(result.items[0],rows[0]);assert.equal(result.loaded,5);assert.equal(result.matched,5)
 assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.items));assert.equal(result.narrowed,false)
})
for(const [query,expected] of [['第一章',['rec-A']],['  abc  ',['rec-A']],['café',['rec-B']],['🌱',['rec-B']],['NOTE-BETA',['rec-B']],['REC-C',['rec-C']],['SECRET_ONLY',[]],['rec-A第一章',[]],['[.*]',[]]])test('literal Unicode query '+query,()=>assert.deepEqual(ids({query}),expected))
for(const [kind,id] of [['tag','rec-D'],['file-tag','rec-E'],['attachment','rec-C']])test('filters exact object kind '+kind,()=>assert.deepEqual(ids({kind}),[id]))
for(const [outcome,expected] of [['local',['rec-A','rec-E']],['remote',['rec-B']],['superseded',['rec-C']],['unknown',['rec-D']]])test('truthful historical outcome '+outcome,()=>assert.deepEqual(ids({outcome}),expected))
test('combines query, kind and outcome with AND without mutating the input',()=>{
 assert.deepEqual(ids({query:'note',kind:'file',outcome:'local'}),['rec-A']);assert.equal(rows.length,5)
 assert.deepEqual(ids({query:'note',kind:'file',outcome:'superseded'}),[])
})
test('rebind invalidation is never reported as remote choice or resolution',()=>{
 assert.equal(historyOutcomeKey(rows[2]),'superseded');assert.equal(selectHistoryRecords(rows,{outcome:'remote'}).matched,1)
})
test('empty loaded scope is not expanded and whitespace alone is not a narrowed search',()=>{
 assert.equal(selectHistoryRecords([],{query:'future'}).loaded,0);assert.equal(selectHistoryRecords(rows,{query:'  '}).narrowed,false)
})
test('limits Unicode characters without splitting surrogate pairs',()=>{
 assert.equal([...limitHistoryQuery('🌱'.repeat(140))].length,128)
 assert.equal(limitHistoryQuery('a'.repeat(127)+'🌱x'),'a'.repeat(127)+'🌱')
})
test('invalid conditions fail instead of silently showing unrelated rows',()=>{
 for(const options of [{kind:'secret'},{outcome:'deleted'},{query:123}])assert.throws(()=>selectHistoryRecords(rows,options))
 assert.throws(()=>selectHistoryRecords(null));assert.throws(()=>limitHistoryQuery(null))
})
