import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { selectHistoryRecords } from '../src/services/syncHistorySearch.mjs'
import { HISTORY_FILE_FILTER_ALL, selectHistoryFilePage } from '../src/services/syncHistoryFileSelection.mjs'
const { verifyObjectFilterScene } = createRequire(import.meta.url)('./sync-history-file-object-filter-evidence.cjs')
const row=(id,itemID,extra={})=>({id,itemID,title:'笔记 '+id,kind:'file',status:'resolved',resolution:'local',createdAt:1,resolvedAt:2,...extra})
const rows=[row('r0','对象-Ａ'),row('r1','对象-A'),row('r2','对象-Ａ',{kind:'tag'}),row('r3',' 对象-Ａ ')]
test('exact object filtering keeps the complete opaque identifier only',()=>{
  assert.deepEqual(selectHistoryRecords(rows,{itemID:'对象-Ａ'}).items.map(r=>r.id),['r0','r2'])
  assert.deepEqual(selectHistoryRecords(rows,{itemID:'对象-A'}).items.map(r=>r.id),['r1'])
  assert.deepEqual(selectHistoryRecords(rows,{itemID:' 对象-Ａ '}).items.map(r=>r.id),['r3'])
})
test('exact object filtering composes with existing text, kind and outcome filters',()=>{
  const selected=selectHistoryRecords(rows,{itemID:'对象-Ａ',query:'r2',kind:'tag',outcome:'local'})
  assert.deepEqual(selected.items.map(r=>r.id),['r2']);assert.equal(selected.narrowed,true)
})
test('empty object filter preserves existing selection semantics',()=>{
  assert.deepEqual(selectHistoryRecords(rows,HISTORY_FILE_FILTER_ALL).items.map(r=>r.id),rows.map(r=>r.id))
})
test('file paging applies exact object filtering before pagination and ordering',()=>{
  const many=Array.from({length:61},(_,i)=>row('r'+i,[0,30,60].includes(i)?'same':'object-'+i))
  const selected=selectHistoryFilePage(many,{...HISTORY_FILE_FILTER_ALL,itemID:'same'},2)
  assert.deepEqual(selected.rows.map(r=>r.id),['r0','r30','r60']);assert.equal(selected.page,0);assert.equal(selected.pages,1);assert.equal(selected.matched,3)
})
test('object identifiers at the validated file limit are accepted without truncation',()=>{
  const id='界'.repeat(2048);assert.deepEqual(selectHistoryRecords([row('r',id)],{itemID:id}).items.map(r=>r.id),['r'])
})
for(const value of [null,1,{},'x'.repeat(2049)])test('invalid exact object filter is rejected: '+typeof value,()=>{
  assert.throws(()=>selectHistoryRecords(rows,{itemID:value}),/本地筛选条件无效/)
})
function scene(){return {objectFilterActions:[
 {action:'apply',ids:['r0','r1','r2'],matches:'当前匹配 3 条 / 文件内共 61 条',page:'第 1 / 1 页',order:'file',query:'',itemID:'same',filterVisible:true,focusObject:true,focusQuery:false,outcomes:[3,0,0,0],reads:1,network:0,mutations:0,requests:0,navigation:0,contrast:4.8},
 {action:'combined',ids:['r1'],matches:'当前匹配 1 条 / 文件内共 61 条',page:'第 1 / 1 页',order:'file',query:'笔记 1',itemID:'same',filterVisible:true,focusObject:false,focusQuery:true,outcomes:[1,0,0,0],reads:1,network:0,mutations:0,requests:0,navigation:0,contrast:4.8},
 {action:'clear-object',ids:['r1','r10','r11','r12','r13','r14','r15','r16','r17','r18','r19'],matches:'当前匹配 11 条 / 文件内共 61 条',page:'第 1 / 1 页',order:'file',query:'笔记 1',itemID:'',filterVisible:false,focusObject:false,focusQuery:true,outcomes:[11,0,0,0],reads:1,network:0,mutations:0,requests:0,navigation:0,contrast:4.8},
 {action:'clear-all',ids:Array.from({length:25},(_,i)=>'r'+i),matches:'当前匹配 61 条 / 文件内共 61 条',page:'第 1 / 3 页',order:'file',query:'',itemID:'',filterVisible:false,focusObject:false,focusQuery:true,outcomes:[61,0,0,0],reads:1,network:0,mutations:0,requests:0,navigation:0,contrast:4.8},
]}}
test('accept exact-object native evidence contract',()=>assert.equal(verifyObjectFilterScene(scene()),true))
for(const [name,change]of[
 ['normalised id',s=>s.objectFilterActions[0].itemID='same '],['wrong whole-file result',s=>s.objectFilterActions[0].ids=['r0']],
 ['dropped query intersection',s=>s.objectFilterActions[1].ids=['r0','r1','r2']],['clear lost query',s=>s.objectFilterActions[2].query=''],
 ['extra read',s=>s.objectFilterActions[0].reads=2],['network',s=>s.objectFilterActions[0].network=1],
 ['lost focus',s=>s.objectFilterActions[0].focusObject=false],['low contrast',s=>s.objectFilterActions[0].contrast=4.49],
 ['missing action',s=>s.objectFilterActions.pop()],
])test('reject object-filter evidence: '+name,()=>{const s=scene();change(s);assert.throws(()=>verifyObjectFilterScene(s))})
