import { dailyRequest } from './dailyNotes.mjs'
export const ATTACHMENT_PAGE_SIZE = 50
export const ATTACHMENT_STATES = Object.freeze({ available: '文件存在 · 有候选引用', missing: '缺失附件', unreferenced: '未发现候选引用', blocked: '非普通文件 · 未跟随' })
const int = (v,max=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v)&&v>=0&&v<=max
const text = (v,max) => typeof v==='string'&&v.length<=max
const id = v => text(v,128)&&v.length>0&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v)
const name = v => text(v,1024)&&v.length>0&&v.trim()===v&&!['.','..'].includes(v)&&!/[\\/:\u0000-\u001f\u007f-\u009f]/.test(v)
const fail = () => { throw new Error('附件检查响应不完整或相互矛盾，未采用部分结果。请重新检查。') }
export function validateAttachmentAudit(raw) {
 if(!raw||raw.version!==1||raw.complete!==true||!/^[a-f0-9]{64}$/.test(raw.revision||'')||!int(raw.captured_at,253402300799)||!Array.isArray(raw.items)||raw.items.length>10000||!Array.isArray(raw.notes)||raw.notes.length>20000)fail()
 const notesById=new Map(), names=new Set()
 const notes=raw.notes.map(n=>{
  if(!n||!id(n.id)||notesById.has(n.id)||!text(n.title,4000)||!['active','template','trash'].includes(n.scope)||typeof n.parsed!=='boolean'||!int(n.rejected_urls,50000))fail()
  const note=Object.freeze({id:n.id,title:n.title,scope:n.scope,parsed:n.parsed,rejected_urls:n.rejected_urls});notesById.set(n.id,note);return note
 })
 const totals={files:0,bytes:0,referenced:0,unreferenced:0,missing:0,blocked:0,notes:notes.length,unparsed:notes.filter(n=>!n.parsed).length,rejected_urls:notes.reduce((sum,n)=>sum+n.rejected_urls,0),references:0}
 if(!int(totals.rejected_urls,50000))fail()
 const items=raw.items.map(item=>{
  if(!item||!name(item.name)||names.has(item.name)||!Object.hasOwn(ATTACHMENT_STATES,item.state)||!int(item.bytes)||!Array.isArray(item.notes)||item.notes.length>20000||new Set(item.notes).size!==item.notes.length||item.notes.some(x=>!notesById.has(x)))fail()
  names.add(item.name)
  if(item.state==='available'&&!item.notes.length||item.state==='missing'&&(!item.notes.length||item.bytes!==0)||item.state==='unreferenced'&&item.notes.length||item.state==='blocked'&&item.bytes!==0)fail()
  if(['available','unreferenced'].includes(item.state)){totals.files++;totals.bytes+=item.bytes}
  totals[item.state==='available'?'referenced':item.state]++;totals.references+=item.notes.length
  return Object.freeze({name:item.name,state:item.state,bytes:item.bytes,notes:Object.freeze([...item.notes])})
 })
 for(const [key,value] of Object.entries(totals))if(!int(value)||raw.totals?.[key]!==value)fail()
 if(totals.references>50000||JSON.stringify({notes,items}).length>8*1024*1024)fail()
 return Object.freeze({version:1,complete:true,revision:raw.revision,captured_at:raw.captured_at,totals:Object.freeze(totals),notes:Object.freeze(notes),items:Object.freeze(items)})
}
export async function readAttachmentAudit(load,signal,budget=10000){
 const raw=await dailyRequest(load,'/api/attachment-audit',{signal},budget)
 if(signal?.aborted)throw new Error('附件检查已取消')
 return validateAttachmentAudit(raw)
}
export function auditItems(snapshot,{query='',filter='all',sort='state'}={}){
 if(!text(query,128)||!['all',...Object.keys(ATTACHMENT_STATES)].includes(filter)||!['state','size','name'].includes(sort))throw new Error('附件筛选参数无效')
 const q=query.trim().normalize('NFC').toLocaleLowerCase(), rank={missing:0,blocked:1,unreferenced:2,available:3}
 return snapshot.items.filter(i=>(filter==='all'||i.state===filter)&&(!q||i.name.normalize('NFC').toLocaleLowerCase().includes(q))).sort((a,b)=>(sort==='size'?b.bytes-a.bytes:sort==='state'?rank[a.state]-rank[b.state]:0)||a.name.localeCompare(b.name))
}
export function attachmentAuditReport(snapshot,options={},includeDetails=false){
 const value=validateAttachmentAudit(snapshot),items=auditItems(value,options),ids=new Set(items.flatMap(i=>i.notes))
 return JSON.stringify({format:'local-notepad-attachment-audit',version:1,captured_at:value.captured_at,revision:value.revision,
  scope:'saved active/template/trash text URL candidates and flat uploads metadata only',
  limitations:['not content integrity or malware verification','unreferenced does not mean safe to delete','excludes drafts, history and external libraries','not atomic across SQLite and filesystem'],
  totals:value.totals,selection:{filter:options.filter||'all',sort:options.sort||'state',count:items.length,query:includeDetails===true?(options.query||''):'',query_omitted:includeDetails!==true&&Boolean(options.query)},
  contains_details:includeDetails===true,...(includeDetails===true?{items,notes:value.notes.filter(n=>ids.has(n.id)),coverage_notes:value.notes.filter(n=>!n.parsed||n.rejected_urls>0)}:{})},null,2)+'\n'
}
export function downloadAttachmentAudit(snapshot,options,includeDetails=false){
 const content=attachmentAuditReport(snapshot,options,includeDetails);let url,anchor
 try{url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));anchor=document.createElement('a');anchor.href=url;anchor.download='local-notepad-attachment-audit.json';document.body.appendChild(anchor);anchor.click()}
 finally{anchor?.remove();if(url)setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
