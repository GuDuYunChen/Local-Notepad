import {dailyRequest} from './dailyNotes.mjs'
import {findWikiLinkOccurrences,extractHeadingReferences} from '../components/Editor/utils/referenceUtils.js'
import {extractLexicalText} from '../utils/lexicalText.js'
export const BACKLINK_LIMIT=200, BACKLINK_PAGE=12, BACKLINK_BODY_LIMIT=2*1024*1024, BACKLINK_TOTAL_LIMIT=8*1024*1024
const error=(code,message)=>Object.assign(new Error(message),{code})
const fail=(code,message)=>{throw error(code,message)}
const identity=v=>typeof v==='string'&&v.length>0&&v.length<=128&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v)
const bytes=v=>new TextEncoder().encode(v).length
const pathKey=p=>JSON.stringify(p)
function bodyState(content){
 if(typeof content!=='string'||content.length>BACKLINK_BODY_LIMIT||bytes(content)>BACKLINK_BODY_LIMIT)fail('body-limit','来源正文超出安全预览上限')
 let parsed
 try{parsed=JSON.parse(content)}catch{return null}
 if(!parsed?.root||!Array.isArray(parsed.root.children))return null
 let count=0;const stack=[{node:parsed.root,depth:0}]
 while(stack.length){
  const {node,depth}=stack.pop()
  if(!node||typeof node!=='object'||Array.isArray(node)||depth>64||++count>50000||('children' in node&&!Array.isArray(node.children)))fail('body-shape','来源正文结构无法安全预览')
  for(const child of node.children||[])stack.push({node:child,depth:depth+1})
 }
 return parsed
}
export function inspectBacklinkBody(content,targetId){
 if(!identity(targetId))fail('identity','目标笔记身份无效')
 const parsed=bodyState(content)
 if(!parsed)return {state:'unparsed',occurrences:0,sections:[],text:content}
 const occurrences=findWikiLinkOccurrences(parsed,targetId)
 if(occurrences.length>2000)fail('occurrences','单篇引用位置超过2000处，未采用不完整定位结果')
 const headings=extractHeadingReferences(parsed),counts=new Map(),sections=new Map()
 for(const h of headings)counts.set(pathKey(h.path),(counts.get(pathKey(h.path))||0)+1)
 for(const hit of occurrences){const key=pathKey(hit.sourceSectionPath);const group=sections.get(key)||{path:hit.sourceSectionPath,count:0,ambiguous:(counts.get(key)||0)>1};group.count++;sections.set(key,group)}
 return {state:occurrences.length?'verified':'stale',occurrences:occurrences.length,sections:[...sections.values()],text:extractLexicalText(content)}
}
export function validateBacklinkSnapshot(value,targetId){
 if(!identity(targetId)||!value||value.file_id!==targetId||value.complete!==true||!Array.isArray(value.sources)||value.sources.length>BACKLINK_LIMIT||value.indexed_count!==value.sources.length)fail('snapshot','反向来源列表不完整或所属笔记不符')
 const ids=new Set(),sources=new Set();let total=0
 const rows=value.sources.map(row=>{
  if(!row||!Number.isSafeInteger(row.link_id)||row.link_id<1||ids.has(row.link_id)||!identity(row.source_id)||sources.has(row.source_id)||!Number.isSafeInteger(row.indexed_at)||row.indexed_at<0||typeof row.available!=='boolean')fail('snapshot','反向来源身份或索引格式不正确')
  ids.add(row.link_id);sources.add(row.source_id)
  if(!row.available){if(row.file!==null)fail('snapshot','不可用来源不能携带正文');return Object.freeze({...row,analysis:null})}
  const file=row.file
  if(!file||file.id!==row.source_id||typeof file.title!=='string'||file.title.length>4096||file.is_folder!==false||file.is_deleted!==false||file.title.startsWith('__tpl__')||!Number.isSafeInteger(file.updated_at)||file.updated_at<0)fail('snapshot','来源不是有效普通笔记')
  const analysis=inspectBacklinkBody(file.content,targetId);total+=bytes(file.content)
  if(total>BACKLINK_TOTAL_LIMIT)fail('body-limit','来源正文合计超过8MiB，未采用不完整列表')
  return Object.freeze({...row,file:Object.freeze({...file}),analysis})
 })
 return Object.freeze({file_id:targetId,complete:true,indexed_count:rows.length,sources:Object.freeze(rows)})
}
export async function readBacklinkSnapshot(load,targetId,signal,budget=10000){
 if(!identity(targetId))fail('identity','目标笔记身份无效')
 const value=await dailyRequest(load,'/api/files/'+encodeURIComponent(targetId)+'/backlink-sources',{signal},budget)
 return validateBacklinkSnapshot(value,targetId)
}
export function backlinkPreview(text,page=0){
 const chars=Array.from(text),pages=Math.max(1,Math.ceil(chars.length/3000)),index=Number.isSafeInteger(page)?Math.max(0,Math.min(pages-1,page)):0
 return {text:chars.slice(index*3000,(index+1)*3000).join(''),total:chars.length,page:index,pages}
}
export function filterBacklinkSources(rows,query){
 const q=String(query||'').trim().toLocaleLowerCase()
 return rows.filter(r=>!q||[r.file?.title,r.source_id,...(r.analysis?.sections||[]).map(s=>s.path.join(' › '))].join('\n').toLocaleLowerCase().includes(q))
}
// This loader is used by the ORIGINAL guarded opener. It times out only reads,
// not the user's save/discard decision. No content or navigation is written here.
export async function readBacklinkDestination(load,targetId,row,sectionPath,signal,budget=10000){
 if(!identity(targetId)||!row?.available||!identity(row.source_id))fail('target','来源暂不可用')
 const end=performance.now()+budget
 const fetchFile=async id=>{
  const remaining=end-performance.now();if(remaining<=0)fail('timeout','核对来源超时，请重试')
  let file
  try{file=await dailyRequest(load,'/api/files/'+encodeURIComponent(id),{signal},remaining)}
  catch(e){if(e.code==='request')fail('target-unavailable','目标或来源不存在或暂时无法读取，请刷新后核对');throw e}
  if(!file||file.id!==id||file.is_deleted!==false||file.is_folder!==false||typeof file.title!=='string'||file.title.startsWith('__tpl__')||typeof file.content!=='string')fail('target','目标或来源已删除、移入回收站或不再是普通笔记')
  return file
 }
 await fetchFile(targetId)
 const file=await fetchFile(row.source_id)
 if(file.content!==row.file.content)fail('source-changed','来源正文已变化，请刷新反向链接后重新打开或定位')
 if(sectionPath!==null){
  const analysis=inspectBacklinkBody(file.content,targetId),key=pathKey(sectionPath)
  if(!analysis.sections.some(s=>pathKey(s.path)===key&&!s.ambiguous))fail('section-changed','引用位置已变化或同名章节不唯一，请刷新后查看')
 }
 if(signal?.aborted)fail('cancelled','已停止打开来源')
 return file
}
