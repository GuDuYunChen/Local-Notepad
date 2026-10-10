import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareHistoryExport } from '../src/services/syncHistoryExport.mjs'
import { parseHistoryFile, readHistoryFile } from '../src/services/syncHistoryFile.mjs'
const row = (id='a', patch={}) => ({ id, itemID:'note-'+id, kind:'file', title:'星图 <script>', status:'resolved', resolution:'local', createdAt:1, resolvedAt:1790726400, ...patch })
const json = (rows=[row()], options={}) => prepareHistoryExport({ snapshot:{items:rows,filter:'all',hasMore:true},phase:'ready',...options },new Date('2026-09-30T10:00:00Z')).raw
const data = () => JSON.parse(json())
const parse = data => parseHistoryFile(JSON.stringify(data))
test('reads exact production v1 exports without writing or including private notices',()=>{
 const r=parseHistoryFile(json());assert.equal(r.version,1);assert.equal(r.records[0].title,'星图 <script>');assert.equal(r.summary.count,1)
 assert.equal(r.loadedCount,1);assert.equal(r.hasUnreadOlderRecords,true);assert.equal(r.sourceState,'ready');assert.equal(r.notices,undefined)
})
for (const timeFilter of [{mode:'range',from:'2026-09-30',to:'2026-09-30'}, {mode:'range',from:'',to:'2026-10-01'}, {mode:'range',from:'2026-09-01',to:''},{mode:'missing',from:'',to:''}]) test('roundtrips production v2 '+JSON.stringify(timeFilter),()=>{
 const rows=timeFilter.mode==='missing'?[row('a',{resolvedAt:0})]:[row()]
 const r=parseHistoryFile(json(rows,{timeFilter}));assert.equal(r.version,2);assert.deepEqual(r.filters.timeFilter,timeFilter)
})
for(const phase of ['ready','error','stopped'])test('preserves file-declared source '+phase,()=>assert.equal(parseHistoryFile(json(undefined,{phase})).sourceState,phase))
test('keeps missing times null-equivalent and distinguishes the UTC range',()=>{
 const r=parseHistoryFile(json([row('a',{createdAt:0,resolvedAt:0}),row('b')]))
 assert.equal(r.records[0].createdAt,0);assert.equal(r.summary.times.missing,1);assert.equal(r.summary.times.known,1)
})
test('accepts UTF8 BOM and whitespace',()=>assert.equal(parseHistoryFile('\uFEFF'+json()+'  ').records.length,1))
test('preserves bounded literal markup/emoji/line breaks as inert text',()=>{
 const title='<img src=x>\n'+'🌱'.repeat(220);assert.equal(parseHistoryFile(json([row('a',{title})])).records[0].title,title)
})
test('preserves each record rather than merging common object IDs; deeply immutable output',()=>{
 const r=parseHistoryFile(json([row('a',{itemID:'same'}),row('b',{itemID:'same'})]))
 assert.equal(r.records.length,2);assert.equal(r.summary.count,2)
 for(const item of [r,r.records,r.records[0],r.filters,r.filters.timeFilter,r.summary,r.summary.times])assert.ok(Object.isFrozen(item))
})
for(const [label,alter] of [
 ['future version',d=>d.version=3],['foreign file',d=>d.format='notes-backup'],['missing root field',d=>delete d.notices],
 ['extra body root',d=>d.content='PRIVATE'],['wrong count',d=>d.scope.exportedCount=2],['negative loaded count',d=>d.scope.loadedCount=-1],
 ['unsafe loaded count',d=>d.scope.loadedCount=Number.MAX_SAFE_INTEGER+1],['remote claim',d=>d.scope.currentRemoteStateVerified=true],
 ['loading source',d=>d.scope.sourceState='loading'],['cursor leak',d=>d.scope.cursor='PRIVATE'],['text query leak',d=>d.filters.query='PRIVATE'],
 ['duplicate record',d=>{d.records.push(d.records[0]);d.scope.loadedCount=d.scope.exportedCount=2}],
 ['wrong object kind',d=>d.records[0].kind='__proto__'],['fake chosen outcome',d=>d.records[0].outcome='resolved successfully'],
 ['body in row',d=>d.records[0].content='PRIVATE'],['long title',d=>d.records[0].currentTitle='a'.repeat(256)],
 ['linebreak id',d=>d.records[0].id='a\nb'],['invalid ISO date',d=>d.records[0].completedAtUTC='2026-02-30T00:00:00.000Z'],
 ['non-UTC time',d=>d.records[0].completedAtUTC='2026-09-30T00:00:00.000+00:00'],['fractional second',d=>d.records[0].completedAtUTC='2026-09-30T00:00:00.001Z'],
 ['zero sentinel as date',d=>d.records[0].completedAtUTC='1970-01-01T00:00:00.000Z'],
 ['kind scope mismatch',d=>d.filters.objectType='attachment'],['outcome mismatch',d=>d.filters.outcome='remote'],
 ['status scope mismatch',d=>d.filters.recordStatus='superseded'],['invalid notice',d=>d.notices=[{}]],
 ['v1 with date scope',d=>d.filters.completedDateUTC={mode:'all',from:'',to:''}],
 ['v2 without dates',d=>d.version=2],['prototype property',d=>Object.defineProperty(d,'__proto__',{enumerable:true,value:{polluted:true}})],
])test('rejects '+label+' atomically without leaking content',()=>{
 const d=data();alter(d);assert.throws(()=>parse(d),e=>!e.message.includes('PRIVATE'));assert.equal({}.polluted,undefined)
})
test('v2 rejects contradictory date-bound metadata, not silently normalizing it',()=>{
 const d=JSON.parse(json([row()],{timeFilter:{mode:'range',from:'2026-09-30',to:''}}))
 d.filters.completedDateUTC.from='2026-10-01';assert.throws(()=>parse(d))
 d.filters.completedDateUTC={mode:'all',from:'',to:''};assert.throws(()=>parse(d))
 d.filters.completedDateUTC={mode:'missing',from:'bad',to:''};assert.throws(()=>parse(d))
})
test('size and record limits reject a whole file rather than showing a partial subset',()=>{
 assert.throws(()=>parseHistoryFile(' '.repeat(4*1024*1024+1)))
 const d=data();d.records=Array.from({length:2001},(_,i)=>({...d.records[0],id:'r'+i}));d.scope.loadedCount=d.scope.exportedCount=2001;assert.throws(()=>parse(d))
})
for(const raw of ['','{}','[1]','null','{bad','"PRIVATE"'])test('refuses malformed '+JSON.stringify(raw),()=>assert.throws(()=>parseHistoryFile(raw)))
function transport(bytes=new TextEncoder().encode(json())) {
 let savedLoad
 const reader={result:bytes.buffer,readAsArrayBuffer(){savedLoad=this.onload},abort(){this.aborted=true}}
 return {reader,file:{size:bytes.byteLength},readerFactory:()=>reader,deliver(){savedLoad?.()}}
}
test('actual byte reader validates UTF8 and parses only after complete length',async()=>{
 const t=transport(),p=readHistoryFile(t.file,{readerFactory:t.readerFactory});t.deliver();assert.equal((await p).records.length,1);assert.equal(t.reader.onload,null)
})
test('invalid UTF8 is refused rather than silently replaced',async()=>{
 const t=transport(new Uint8Array([0xc3,0x28])),p=readHistoryFile(t.file,{readerFactory:t.readerFactory});t.deliver();await assert.rejects(p,e=>e.code==='encoding')
})
test('declared byte length mismatch cannot become a partial success',async()=>{
 const t=transport();t.file.size++;const p=readHistoryFile(t.file,{readerFactory:t.readerFactory});t.deliver();await assert.rejects(p,e=>e.code==='read')
})
test('pre-aborted read never constructs or starts a reader',async()=>{
 const ctl=new AbortController();ctl.abort();let calls=0;await assert.rejects(readHistoryFile({size:1},{signal:ctl.signal,readerFactory:()=>calls++}),e=>e.code==='aborted');assert.equal(calls,0)
})
test('abort ignores an already queued late load event and cleans up the reader',async()=>{
 const t=transport(),ctl=new AbortController(),p=readHistoryFile(t.file,{signal:ctl.signal,readerFactory:t.readerFactory});ctl.abort();t.deliver();await assert.rejects(p,e=>e.code==='aborted');assert.equal(t.reader.aborted,true);assert.equal(t.reader.onload,null)
})
test('timeout settles even when transport does not cooperate with cancellation',async()=>{
 const t=transport(),p=readHistoryFile(t.file,{readerFactory:t.readerFactory,timeoutMs:5});await assert.rejects(p,e=>e.code==='timeout');t.deliver();assert.equal(t.reader.aborted,true)
})
test('native reader errors and thrown exceptions produce generic messages',async()=>{
 const t=transport(),p=readHistoryFile(t.file,{readerFactory:t.readerFactory});t.reader.onerror(Error('PRIVATE_PATH'));await assert.rejects(p,e=>e.code==='read'&&!e.message.includes('PRIVATE'))
 await assert.rejects(readHistoryFile({size:1},{readerFactory:()=>{throw Error('PRIVATE')}}),e=>!e.message.includes('PRIVATE'))
})
test('overlarge metadata is rejected before allocation or reading',async()=>{
 let called=false;await assert.rejects(readHistoryFile({size:4*1024*1024+1},{readerFactory:()=>{called=true}}),e=>e.code==='size');assert.equal(called,false)
})
