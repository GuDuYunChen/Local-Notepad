import assert from 'node:assert/strict'
import {inspectBacklinkBody,validateBacklinkSnapshot,readBacklinkSnapshot,readBacklinkDestination,backlinkPreview,filterBacklinkSources} from '../src/services/backlinkSources.mjs'
const text=value=>({type:'text',text:value})
const h=(value,tag='h1')=>({type:'heading',tag,children:[text(value)]})
const link=(id='target')=>({type:'wiki-link',id,title:'目标'})
const doc=children=>JSON.stringify({root:{type:'root',children}})
const body=doc([h('章节一'),{type:'paragraph',children:[text('source body'),link(),link()]}])
const file=(patch={})=>({id:'source',title:'来源',content:body,is_folder:false,is_deleted:false,updated_at:1,...patch})
const row=(patch={})=>({link_id:1,source_id:'source',indexed_at:1,available:true,file:file(),...patch})
const snapshot=(patch={})=>({file_id:'target',complete:true,indexed_count:1,sources:[row()],...patch})
export function registerBacklinkTests(test){
 test('groups multiple real links by exact section without claiming each is a different note',()=>{const a=inspectBacklinkBody(body,'target');assert.equal(a.state,'verified');assert.equal(a.occurrences,2);assert.deepEqual(a.sections,[{path:['章节一'],count:2,ambiguous:false}]);assert.ok(a.text.includes('source body'))})
 test('empty saved rich body is stale index, unstructured content is only an indexed lead',()=>{assert.equal(inspectBacklinkBody(doc([]),'target').state,'stale');assert.equal(inspectBacklinkBody('literal [[target]]','target').state,'unparsed')})
 test('identical heading paths are ambiguous but differently nested headings are not',()=>{const b=doc([h('same'),link(),h('same'),link(),h('child','h2'),link()]);const a=inspectBacklinkBody(b,'target');assert.equal(a.sections[0].ambiguous,true);assert.equal(a.sections[1].ambiguous,false)})
 test('heading-less occurrence has an explicit start-of-body location',()=>assert.deepEqual(inspectBacklinkBody(doc([link()]),'target').sections[0].path,[]))
 test('foreign wiki IDs do not become verified backlinks',()=>assert.equal(inspectBacklinkBody(doc([link('other')]),'target').occurrences,0))
 test('literal HTML is preview text, not an executable object',()=>assert.equal(inspectBacklinkBody('<script>bad()</script>','target').text,'<script>bad()</script>'))
 test('rejects oversized and deeply nested rich bodies instead of recursing unbounded',()=>{assert.throws(()=>inspectBacklinkBody('x'.repeat(2*1024*1024+1),'target'));let n=link();for(let i=0;i<70;i++)n={children:[n]};assert.throws(()=>inspectBacklinkBody(doc([n]),'target'),{code:'body-shape'})})
 test('refuses non-array children inside parsed source state',()=>assert.throws(()=>inspectBacklinkBody(doc([{children:{}}]),'target'),{code:'body-shape'}))
 test('rejects more than 2000 locations instead of a partial location list',()=>assert.throws(()=>inspectBacklinkBody(doc(Array.from({length:2001},()=>link())),'target'),{code:'occurrences'}))
 test('empty snapshot and unavailable sources preserve exact indexed counts',()=>{const a=validateBacklinkSnapshot(snapshot({indexed_count:0,sources:[]}),'target');assert.equal(a.sources.length,0);const b=validateBacklinkSnapshot(snapshot({sources:[row({available:false,file:null})]}),'target');assert.equal(b.indexed_count,1);assert.equal(b.sources[0].analysis,null)})
 for(const [label,patch]of [
 ['wrong-note',{file_id:'other'}],['not-complete',{complete:false}],['wrong-count',{indexed_count:0}],['null-sources',{sources:null}],
 ['duplicate-link',{indexed_count:2,sources:[row(),row({source_id:'other',file:file({id:'other'})})]}],
 ['duplicate-source',{indexed_count:2,sources:[row(),row({link_id:2})]}],['wrong-source',{sources:[row({file:file({id:'other'})})]}],
 ['deleted-leak',{sources:[row({file:file({is_deleted:true})})]}],['hidden-content',{sources:[row({available:false})]}],
 ['folder',{sources:[row({file:file({is_folder:true})})]}],['template',{sources:[row({file:file({title:'__tpl__hidden'})})]}],
 ['timestamp',{sources:[row({indexed_at:NaN})]}],['large-count',{indexed_count:201,sources:Array.from({length:201},(_,i)=>row({link_id:i+1,source_id:'s'+i,file:file({id:'s'+i})}))}],
 ])test('snapshot refuses '+label,()=>assert.throws(()=>validateBacklinkSnapshot(snapshot(patch),'target')))
 test('total UTF8 source budget includes every available source',()=>{const content='x'.repeat(2*1024*1024);assert.throws(()=>validateBacklinkSnapshot(snapshot({indexed_count:5,sources:Array.from({length:5},(_,i)=>row({link_id:i+1,source_id:'s'+i,file:file({id:'s'+i,content})}))}),'target'),{code:'body-limit'})})
 test('client does not mutate backend lists or bodies',()=>{const original=snapshot(),copy=JSON.stringify(original),a=validateBacklinkSnapshot(original,'target');assert.equal(JSON.stringify(original),copy);assert.ok(Object.isFrozen(a.sources));assert.ok(Object.isFrozen(a.sources[0].file))})
 test('search is literal and supports title or source section',()=>{const rows=validateBacklinkSnapshot(snapshot(),'target').sources;assert.equal(filterBacklinkSources(rows,'章节一').length,1);assert.equal(filterBacklinkSources(rows,'[x]').length,0)})
 test('preview paging retains all Unicode characters',()=>{const t='文🙂'.repeat(4000);let combined='';for(let i=0;i<3;i++)combined+=backlinkPreview(t,i).text;assert.equal(combined,t);assert.equal(backlinkPreview(t,-1).page,0);assert.equal(backlinkPreview('',100).pages,1)})
 test('snapshot request encodes ID and passes the actual signal',async()=>{let call;const id='a/b';await readBacklinkSnapshot((p,o)=>{call={p,o};return snapshot({file_id:id,indexed_count:0,sources:[]})},id);assert.equal(call.p,'/api/files/a%2Fb/backlink-sources');assert.ok(call.o.signal instanceof AbortSignal);assert.equal(call.o.method,undefined)})
 test('pre-aborted reads send zero requests',async()=>{const c=new AbortController();c.abort();let calls=0;await assert.rejects(readBacklinkSnapshot(()=>{calls++},'target',c.signal));assert.equal(calls,0)})
 test('timeout remains bounded when a source adapter ignores abort',async()=>{let release;await assert.rejects(readBacklinkSnapshot(()=>new Promise(r=>release=r),'target',undefined,8),{code:'timeout'});release(snapshot())})
 test('raw transport errors are not exposed as private details',async()=>{await assert.rejects(readBacklinkSnapshot(()=>Promise.reject(Error('PRIVATE')),'target'),e=>!e.message.includes('PRIVATE'))})
 test('opening rechecks target and source with GET only and returns the original full saved file',async()=>{const calls=[];const source=row();const result=await readBacklinkDestination((p,o)=>{calls.push([p,o]);return p.endsWith('/target')?file({id:'target'}):file()},'target',source,['章节一']);assert.equal(result.content,body);assert.equal(calls.length,2);assert.ok(calls.every(([,o])=>!o.method))})
 for(const [label,patch] of [['deleted',{is_deleted:true}],['folder',{is_folder:true}],['wrong-id',{id:'other'}],['changed-body',{content:body+' '}],['template',{title:'__tpl__new'}]])test('fresh source '+label+' is refused before selection',async()=>{await assert.rejects(readBacklinkDestination(p=>p.endsWith('/target')?file({id:'target'}):file(patch),'target',row(),null))})
 test('a deleted target is refused before reading its source',async()=>{let calls=0;await assert.rejects(readBacklinkDestination(()=>{calls++;return file({id:'target',is_deleted:true})},'target',row(),null));assert.equal(calls,1)})
 test('missing or ambiguous location cannot be silently used',async()=>{await assert.rejects(readBacklinkDestination(p=>p.endsWith('/target')?file({id:'target'}):file(),'target',row(),['missing']),{code:'section-changed'})})
 test('stale indexed-only source can be opened as a note, never as an invented section',async()=>{const f=file({content:'raw'}),r=row({file:f});const load=p=>p.endsWith('/target')?file({id:'target'}):f;assert.equal((await readBacklinkDestination(load,'target',r,null)).id,'source');await assert.rejects(readBacklinkDestination(load,'target',r,[]))})
 test('stopping during source verification prevents a successful return',async()=>{const c=new AbortController();await assert.rejects(readBacklinkDestination(p=>{if(p.endsWith('/source'))c.abort();return file({id:p.split('/').pop()})},'target',row(),null,c.signal))})
}
