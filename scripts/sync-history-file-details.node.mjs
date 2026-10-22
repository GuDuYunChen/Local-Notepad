import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setHistoryFileDetailsOpen, HISTORY_FILE_DETAILS_SELECTOR } from '../src/services/syncHistoryFileDetails.mjs'
const { verifyFileDetailsScene } = createRequire(import.meta.url)('./sync-history-file-details-evidence.cjs')
function page(values) {
  let writes=0,queries=0
  const nodes=values.map(value=>({get open(){return value},set open(next){writes++;value=next}}))
  return {nodes,get writes(){return writes},get queries(){return queries},querySelectorAll(selector){queries++;assert.equal(selector,HISTORY_FILE_DETAILS_SELECTOR);return nodes}}
}
test('unloaded and empty lists are safe no-ops',()=>{assert.equal(setHistoryFileDetailsOpen(null,true),0);assert.equal(setHistoryFileDetailsOpen(page([]),false),0)})
test('expand changes only closed identifiers on the supplied current page',()=>{const p=page([false,true,false]);assert.equal(setHistoryFileDetailsOpen(p,true),2);assert.equal(p.writes,2);assert.ok(p.nodes.every(n=>n.open));assert.equal(p.queries,1)})
test('collapse changes only open identifiers and never writes source records',()=>{const p=page([false,true,true]);assert.equal(setHistoryFileDetailsOpen(p,false),2);assert.ok(p.nodes.every(n=>!n.open));assert.equal(p.writes,2)})
test('repeated expand or collapse does not replay DOM changes',()=>{const p=page([false,false]);setHistoryFileDetailsOpen(p,true);assert.equal(setHistoryFileDetailsOpen(p,true),0);setHistoryFileDetailsOpen(p,false);assert.equal(setHistoryFileDetailsOpen(p,false),0);assert.equal(p.writes,4)})
test('other pages and live panels remain untouched',()=>{const a=page([false]),b=page([true]);setHistoryFileDetailsOpen(a,true);assert.equal(b.queries,0);assert.equal(b.writes,0)})
test('non-boolean expansion is rejected before querying any DOM',()=>{const p=page([false]);for(const v of [0,1,'false',null,undefined])assert.throws(()=>setHistoryFileDetailsOpen(p,v),TypeError);assert.equal(p.queries,0)})
const phases=['file','oldest','created','page-two','filtered','empty','restored']
function fixture(){return{frames:phases.map((phase,i)=>({phase,identifiersCount:[25,25,25,25,1,0,25][i],identifiersOpen:[0,0,25,0,1,0,0][i],detailsToolsVisible:true,detailsDisabled:{expand:i===5,collapse:i===5},detailsScope:`只展开或收起本页 ${[25,25,25,25,1,0,25][i]} 条记录`})),detailsActions:[['single',1],['expand',25],['collapse',0],['created-expand',25],['filtered-expand',1],['empty-expand',0],['empty-collapse',0],['restored-expand',25],['restored-collapse',0]].map(([action,open])=>({action,open,focusRetained:true,pageUnchanged:true,orderUnchanged:true,reads:1}))}}
test('accept all seven phases and nine independent detail actions',()=>assert.equal(verifyFileDetailsScene(fixture()),true))
for(const [name,change]of[
 ['expands only first record',s=>s.frames[2].identifiersOpen=1],
 ['old page remains expanded',s=>s.frames[3].identifiersOpen=25],
 ['hides narrow controls',s=>s.frames[0].detailsToolsVisible=false],
 ['claims all-file scope',s=>s.frames[0].detailsScope='展开全部61条'],
 ['missing disabled evidence',s=>s.frames[5].detailsDisabled={}],
 ['extra read',s=>s.detailsActions[1].reads=2],
 ['lost focus',s=>s.detailsActions[1].focusRetained=false],
 ['changed page',s=>s.detailsActions[1].pageUnchanged=false],
 ['missing action',s=>s.detailsActions.pop()],
])test('refuse '+name,()=>{const s=fixture();change(s);assert.throws(()=>verifyFileDetailsScene(s))})
