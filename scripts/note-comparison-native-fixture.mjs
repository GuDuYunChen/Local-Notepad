import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
export const comparisonNativeHash=b=>createHash('sha256').update(b).digest('hex')
export const comparisonNativeBlob=b=>createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0').update(b).digest('hex')
export function comparisonNativeFixture(prefix){
 assert.match(prefix,/^CMP114 [a-f0-9]{8}$/)
 const lines=Array.from({length:72},(_,i)=>`${prefix} line ${String(i).padStart(2,'0')} 原文 👋`)
 const body=(n,format=0)=>JSON.stringify({root:{type:'root',version:1,format:'',indent:0,direction:null,children:lines.map((line,i)=>({type:'paragraph',version:1,format:'',indent:0,direction:null,children:[{type:'text',version:1,text:(i===3||i===66)?`${line} variant ${n}`:line,format,detail:0,mode:'normal',style:''}]}))}})
 const list=Array.from({length:51},(_,i)=>({title:`${prefix} list ${String(i).padStart(2,'0')}.md`,content:body(i),projected:lines.map((line,n)=>(n===3||n===66)?`${line} variant ${i}`:line).join('\n')+'\n'}))
 const extras=[{title:prefix+' format-only.md',content:body(0,1),projected:list[0].projected},{title:prefix+' unsupported.md',content:JSON.stringify({root:{type:'root',version:1,children:[{type:'comparison-unrecognized-node',version:1,text:prefix+' unknown MUST NOT disappear'}]}})},{title:prefix+' anchor.md',content:JSON.stringify({root:{type:'root',version:1,format:'',indent:0,direction:null,children:[{type:'paragraph',version:1,format:'',indent:0,direction:null,children:[{type:'text',version:1,text:prefix+' unchanged anchor',format:0,detail:0,mode:'normal',style:''}]}]}})},{title:prefix+' limit.md',content:'x'.repeat(524289)}]
 return{list,extras}
}
// Reconstruct both originals from observed diff rows instead of trusting counts.
export function validateObservedComparisonRows(rows,left,right){
 assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<=4000)
 const ending={LF:'\n',CRLF:'\r\n',CR:'\r',none:''};let l='',r='',li=0,ri=0,leftOnly=0,rightOnly=0;const changes=[]
 for(let i=0;i<rows.length;i++){
  const v=rows[i];assert.ok(['left','right','same'].includes(v.kind));assert.equal(typeof v.text,'string');assert.ok(Object.hasOwn(ending,v.ending));assert.deepEqual(Object.keys(v).sort(),['ending','kind','left','right','text'])
  if(v.kind!=='right'){assert.equal(v.left,++li);l+=v.text+ending[v.ending]}else assert.equal(v.left,null)
  if(v.kind!=='left'){assert.equal(v.right,++ri);r+=v.text+ending[v.ending]}else assert.equal(v.right,null)
  if(v.kind==='left')leftOnly++;if(v.kind==='right')rightOnly++
  if(v.kind!=='same'&&(i===0||rows[i-1].kind==='same'))changes.push(i)
 }
 assert.equal(l,left,'Left original was not reconstructed');assert.equal(r,right,'Right original was not reconstructed')
 return{leftLines:li,rightLines:ri,leftOnly,rightOnly,changes}
}
export function validateComparisonExport(v,{details,pair,rows}){
 assert.equal(typeof details,'boolean');assert.equal(v.format,'local-notepad-note-comparison');assert.equal(v.version,1);assert.ok(Number.isSafeInteger(v.captured_at)&&v.captured_at>0)
 assert.equal(v.mode,'text');assert.equal(v.scope,'two saved ordinary notes; not drafts, attachments, semantic equality or merge permission');assert.equal(v.state,'different');assert.equal(v.raw_equal,false);assert.equal(v.contains_contents,details)
 assert.deepEqual(v.counts,{leftLines:72,rightLines:72,leftOnly:2,rightOnly:2});assert.deepEqual(Object.keys(v).sort(),['format','version','captured_at','mode','scope','state','raw_equal','counts','contains_contents',...(details?['revision','notes','rows']:[])].sort())
 if(details){assert.equal(v.revision,pair.revision);assert.deepEqual(v.notes,pair.notes);assert.deepEqual(v.rows,rows)}
 else {const s=JSON.stringify(v);for(const t of [pair.revision,...pair.notes.flatMap(n=>[n.id,n.title,n.parent_id,n.folder,n.content_hash,n.content])])if(t)assert.equal(s.includes(t),false,'Summary leaked source data')}
 return true
}
