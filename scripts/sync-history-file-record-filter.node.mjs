import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { selectHistoryRecords } from '../src/services/syncHistorySearch.mjs'
import { HISTORY_FILE_FILTER_ALL, selectHistoryFilePage } from '../src/services/syncHistoryFileSelection.mjs'
const { verifyRecordFilterScene } = createRequire(import.meta.url)('./sync-history-file-record-filter-evidence.cjs')
const row=(id,itemID='object',extra={})=>({id,itemID,title:'笔记 '+id,kind:'file',status:'resolved',resolution:'local',createdAt:1,resolvedAt:2,...extra})
const rows=[row('记录-Ａ'),row('记录-A'),row(' 记录-Ａ '),row('r3')]
test('exact record filtering keeps the complete opaque identifier only',()=>{
  assert.deepEqual(selectHistoryRecords(rows,{recordID:'记录-Ａ'}).items.map(r=>r.id),['记录-Ａ'])
  assert.deepEqual(selectHistoryRecords(rows,{recordID:'记录-A'}).items.map(r=>r.id),['记录-A'])
  assert.deepEqual(selectHistoryRecords(rows,{recordID:' 记录-Ａ '}).items.map(r=>r.id),[' 记录-Ａ '])
})
test('exact record filtering composes with object, text, kind and outcome filters',()=>{
  const selected=selectHistoryRecords([row('r0','same'),row('r1','same',{kind:'tag'})],{recordID:'r1',itemID:'same',query:'r1',kind:'tag',outcome:'local'})
  assert.deepEqual(selected.items.map(r=>r.id),['r1']);assert.equal(selected.narrowed,true)
})
test('empty record filter preserves existing selection semantics',()=>{
  assert.deepEqual(selectHistoryRecords(rows,HISTORY_FILE_FILTER_ALL).items.map(r=>r.id),rows.map(r=>r.id))
})
test('file paging applies exact record filtering before pagination and ordering',()=>{
  const many=Array.from({length:61},(_,i)=>row('r'+i,'object-'+i))
  const selected=selectHistoryFilePage(many,{...HISTORY_FILE_FILTER_ALL,recordID:'r60'},2)
  assert.deepEqual(selected.rows.map(r=>r.id),['r60']);assert.equal(selected.page,0);assert.equal(selected.pages,1);assert.equal(selected.matched,1)
})
test('record identifiers at the validated file limit are accepted without truncation',()=>{
  const id='界'.repeat(2048);assert.deepEqual(selectHistoryRecords([row(id)],{recordID:id}).items.map(r=>r.id),[id])
})
for(const value of [null,1,{},'x'.repeat(2049)])test('invalid exact record filter is rejected: '+typeof value,()=>{
  assert.throws(()=>selectHistoryRecords(rows,{recordID:value}),/本地筛选条件无效/)
})
function scene(){return {recordFilterActions:[
 {action:'apply',ids:['r0'],matches:'当前匹配 1 条 / 文件内共 61 条',page:'第 1 / 1 页',order:'file',query:'',itemID:'',recordID:'r0',filterVisible:true,focusRecord:true,focusQuery:false,outcomes:[1,0,0,0],reads:1,network:0,mutations:0,requests:0,navigation:0,contrast:4.8},
 {action:'combined-empty',ids:[],matches:'当前匹配 0 条 / 文件内共 61 条',page:'没有匹配记录，暂无可翻页内容',order:'file',query:'笔记 1',itemID:'',recordID:'r0',filterVisible:true,focusRecord:false,focusQuery:true,outcomes:[0,0,0,0],reads:1,network:0,mutations:0,requests:0,navigation:0,contrast:4.8},
 {action:'clear-record',ids:['r1','r10','r11','r12','r13','r14','r15','r16','r17','r18','r19'],matches:'当前匹配 11 条 / 文件内共 61 条',page:'第 1 / 1 页',order:'file',query:'笔记 1',itemID:'',recordID:'',filterVisible:false,focusRecord:false,focusQuery:true,outcomes:[11,0,0,0],reads:1,network:0,mutations:0,requests:0,navigation:0,contrast:4.8},
 {action:'clear-all',ids:Array.from({length:25},(_,i)=>'r'+i),matches:'当前匹配 61 条 / 文件内共 61 条',page:'第 1 / 3 页',order:'file',query:'',itemID:'',recordID:'',filterVisible:false,focusRecord:false,focusQuery:true,outcomes:[61,0,0,0],reads:1,network:0,mutations:0,requests:0,navigation:0,contrast:4.8},
]}}
test('accept exact-record native evidence contract',()=>assert.equal(verifyRecordFilterScene(scene()),true))
for(const [name,change]of[
 ['normalised id',s=>s.recordFilterActions[0].recordID='r0 '],['wrong whole-file result',s=>s.recordFilterActions[0].ids=['r0','r1']],
 ['dropped empty intersection',s=>s.recordFilterActions[1].ids=['r0']],['clear lost query',s=>s.recordFilterActions[2].query=''],
 ['extra read',s=>s.recordFilterActions[0].reads=2],['network',s=>s.recordFilterActions[0].network=1],
 ['lost focus',s=>s.recordFilterActions[0].focusRecord=false],['low contrast',s=>s.recordFilterActions[0].contrast=4.49],
 ['missing action',s=>s.recordFilterActions.pop()],
])test('reject record-filter evidence: '+name,()=>{const s=scene();change(s);assert.throws(()=>verifyRecordFilterScene(s))})


// Zero results have no navigable page. These cases are intentionally independent
// from the evidence verifier: accepting a fabricated page must remain a failure.
test('exact record and text intersection has zero pages without changing the source',()=>{
  const records=[row('r0'),row('r1')], before=JSON.stringify(records)
  const selected=selectHistoryFilePage(records,{...HISTORY_FILE_FILTER_ALL,recordID:'r0',query:'r1'},2)
  assert.equal(selected.total,2);assert.equal(selected.matched,0);assert.equal(selected.pages,0)
  assert.equal(selected.page,0);assert.equal(selected.from,0);assert.equal(selected.to,0)
  assert.deepEqual(selected.rows,[]);assert.equal(JSON.stringify(records),before)
})
for(const page of [
  '第 0 / 0 页','第 1 / 1 页','第 1 / 0 页','第 0 / 1 页','第 2 / 3 页',
  '第 1 / 1 页，本页第 1–1 条','',
  '没有匹配记录，暂无可翻页内容；第 0 / 0 页',
  '第 1 / 1 页；没有匹配记录，暂无可翻页内容',
  '没有匹配记录，暂无可翻页内容\n',
])test('reject fabricated or ambiguous empty page: '+JSON.stringify(page),()=>{
  const s=scene();s.recordFilterActions[1].page=page
  assert.throws(()=>verifyRecordFilterScene(s))
})
for(const index of [0,2,3])test('nonempty action '+index+' cannot masquerade as empty pagination',()=>{
  const s=scene();s.recordFilterActions[index].page='没有匹配记录，暂无可翻页内容'
  assert.throws(()=>verifyRecordFilterScene(s))
})
