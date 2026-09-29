// Deterministic model: saved snapshots may lag, but the latest edit must survive
// arbitrary delivery and note switches. No wall-clock sleeps or production writes.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { it, expect, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { readEditorDraft, removeEditorDraft } from '~/services/editorDraftCache'
vi.mock('~/services/api',()=>({api:vi.fn()}))
vi.mock('./Editor/Editor',()=>({default:({initialContent,onChange,documentId})=>{
 globalThis.fuzzEdit=onChange;return <pre data-fuzz={documentId}>{initialContent}</pre>
}}))
for(let seed=1;seed<=80;seed++)it('model interleaving seed '+seed, async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const ids=['fuzz-a','fuzz-b'],db=new Map(ids.map(id=>[id,'original '+id])), latest=new Map(db)
 const calls=[], held=[], pendingSaves=[], ops=[]
 const host=document.createElement('div');document.body.append(host);let root=createRoot(host),ref=React.createRef(),active=ids[0]
 let n=seed
 const random=max=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n%max}
 const render=async()=>{await act(async()=>root.render(<TextEditor ref={ref} activeId={active} autoSaveOnSwitch={false}/>))}
 const release=async index=>{const x=held.splice(index,1)[0];ops.push('reply '+x.id+' '+x.method+' '+x.body);await act(async()=>x.resolve(x.response))}
 const edit=async text=>{latest.set(active,text);ops.push('edit '+active+' '+text);await act(async()=>globalThis.fuzzEdit(text))}
 const save=async()=>{ops.push('save '+active);await act(async()=>{const p=ref.current.save();p.catch(()=>{});pendingSaves.push(p);await Promise.resolve()})}
 api.mockReset()
 api.mockImplementation((url,init={})=>{
  const id=decodeURIComponent(url.split('/').pop()),method=init.method||'GET'
  let response
  if(method==='PUT'){
   const p=JSON.parse(init.body)
   if(db.get(id)!==p.expected_content)response={id,content:db.get(id),save_receipt:{request_id:p.save_request_id,outcome:'conflict',reference_pending:false}}
   else{db.set(id,p.content);response={id,content:p.content,save_receipt:{request_id:p.save_request_id,outcome:'applied',reference_pending:false}}}
  }else response={id,content:db.get(id)}
  calls.push({id,method,body:response.content});return new Promise(resolve=>held.push({id,method,body:response.content,response,resolve}))
 })
 for(const id of ids){editorQuit.forget(id);removeEditorDraft(id)}
 try{
  await render();await release(0)
  for(let step=0;step<28;step++){
   const loaded=host.querySelector(`[data-fuzz="${active}"]`)
   const cmd=random(5)
   if(cmd===0&&loaded)await edit('body-'+random(3))
   else if(cmd===1&&loaded)await save()
   else if(cmd===2){active=ids[random(2)];ops.push('switch '+active);await render()}
   else if(held.length)await release(random(held.length))
   if(host.querySelector(`[data-fuzz="${active}"]`)){
    const current=ref.current.getReferenceRefactorState().currentContent
    expect(current,ops.join('\n')).toBe(latest.get(active))
   }
  }
  for(let i=0;i<150&&held.length;i++)await release(0)
  for(const id of ids){
   active=id;ops.push('finish switch '+active);await render();for(let i=0;i<150&&held.length;i++)await release(0)
   expect(ref.current.getReferenceRefactorState().currentContent,ops.join('\n')).toBe(latest.get(active))
  }
 }finally{
  await act(async()=>root.unmount());for(const x of held)x.resolve(x.response)
  await Promise.allSettled(pendingSaves);host.remove()
  for(const id of ids){editorQuit.forget(id);removeEditorDraft(id)}
  vi.restoreAllMocks();vi.unstubAllGlobals()
 }
})
