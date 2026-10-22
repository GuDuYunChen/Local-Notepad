import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { test, beforeEach, afterEach, expect, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import TemplateLibrary from './TemplateLibrary'
import { api } from '../services/api'
import { textTemplateDocument, templatePayloadHash, TEMPLATE_INTENT_PREFIX } from '../services/templateLibrary.mjs'
vi.mock('../services/api',()=>({api:vi.fn()}))
let root,host,templates,receipts,files,onCreated,beforeCreate
const row=(patch={})=>({id:'template-fixture',title:'周报',content:textTemplateDocument('旧正文'),archived:false,updated_at:1,...patch})
const tick=async()=>{for(let i=0;i<100;i++){await act(async()=>{await new Promise(r=>setTimeout(r,5))});if(!host.querySelector('.template-library-index [role=status]') && host.querySelector('.template-library > header button')?.textContent!=='停止等待')return}throw Error('Template UI did not settle')}
beforeEach(()=>{
 localStorage.clear();vi.stubGlobal('crypto',webcrypto);globalThis.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();templates=[row()];receipts=new Map();files=new Map();onCreated=vi.fn();beforeCreate=vi.fn(async()=>true)
 api.mockImplementation(async(path,init={})=>{
  if(path==='/api/template-library')return{complete:true,items:templates.map(x=>({...x}))}
  if(path.startsWith('/api/template-library/items/')){const id=decodeURIComponent(path.split('/').at(-1)),current=templates.find(x=>x.id===id);if(!current)throw Error('missing');if(init.method==='PUT'){const p=JSON.parse(init.body);templates=templates.map(x=>x.id===id?{...p.next,updated_at:2}:x);return {...p.next,updated_at:2}}return current}
  if(path.startsWith('/api/template-library/requests/')){const id=path.split('/').at(-1);if(init.method!=='POST')return receipts.get(id)||{request_id:id,found:false};const p=JSON.parse(init.body),fileId=crypto.randomUUID(),title=(p.kind==='template'?'__tpl__':'')+p.title
   const r={found:true,request_id:id,payload_sha256:await templatePayloadHash(p),file_id:fileId,title,parent_id:p.parent_id,state:'available',created_at:1};receipts.set(id,r);files.set(fileId,{id:fileId,title,content:p.content,parent_id:p.parent_id,is_folder:false,is_deleted:false});if(p.kind==='template')templates.push(row({id:fileId,title:p.title,content:p.content}));return r}
  if(path.startsWith('/api/files/'))return files.get(path.split('/').at(-1))
  throw Error('unexpected route '+path)
 })
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();localStorage.clear();delete globalThis.IS_REACT_ACT_ENVIRONMENT;vi.unstubAllGlobals()})
async function mount(seed=null){await act(async()=>root.render(<React.StrictMode><TemplateLibrary seed={seed} onClose={vi.fn()} onCreated={onCreated} beforeCreate={beforeCreate} parentId="" parentLabel="根目录"/></React.StrictMode>));await tick()}
const button=(label,scope=host)=>[...scope.querySelectorAll('button')].find(n=>n.textContent.trim()===label)
async function click(label,scope=host){const b=button(label,scope);expect(b,'missing '+label).toBeTruthy();await act(async()=>b.click());await tick()}
async function fill(label,text){const input=host.querySelector('[aria-label="'+label+'"]');expect(input).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}))})}
const writes=()=>api.mock.calls.filter(([,i])=>i?.method)
async function newTemplate(){await click('新建模板');await fill('模板名称','新模板');await fill('模板正文','完整文本\n🙂');await click('保存模板')}
test('mount loads templates without sending writes',async()=>{await mount();expect(host.textContent).toContain('周报');expect(writes()).toHaveLength(0)})
test('read failure is visible and manual refresh recovers',async()=>{const original=api.getMockImplementation();api.mockRejectedValue(Error('private'));await mount();expect(host.textContent).toContain('不能据此判断为空');expect(host.textContent).not.toContain('private');api.mockImplementation(original);await click('刷新模板库');expect(host.textContent).toContain('周报')})
test('create persists operation before sending and refreshes template list',async()=>{await mount();const original=api.getMockImplementation();api.mockImplementation(async(p,i)=>{if(i?.method==='POST')expect(Object.keys(localStorage).some(k=>k.startsWith(TEMPLATE_INTENT_PREFIX))).toBe(true);return original(p,i)});await newTemplate();expect(templates.some(t=>t.title==='新模板')).toBe(true);expect(host.textContent).toContain('创建回执已确认');expect(writes()).toHaveLength(1)})
test('invalid names stay in the draft without writes',async()=>{await mount();await click('新建模板');await fill('模板名称','bad/name');await click('保存模板');expect(writes()).toHaveLength(0);expect(host.textContent).toContain('名称须为')})
test('edit sends original snapshot and preserves unrelated templates',async()=>{await mount();await click('编辑');await fill('模板正文','新的正文');await click('保存模板');const write=writes()[0];expect(write[1].method).toBe('PUT');expect(JSON.parse(write[1].body).expected.content).toBe(textTemplateDocument('旧正文'));expect(templates[0].content).toBe(textTemplateDocument('新的正文'))})
test('archive cancel writes nothing, confirm and restore complete',async()=>{await mount();await click('移除模板');await click('取消');expect(writes()).toHaveLength(0);await click('移除模板');await click('确认移除模板');expect(templates[0].archived).toBe(true);await act(async()=>host.querySelector('input[type=checkbox]').click());await tick();await click('恢复模板');await click('确认恢复模板');expect(templates[0].archived).toBe(false)})
test('built-in copy creates a canonical separate note and only opens on explicit action',async()=>{await mount({id:'meeting',title:'会议',content:'议题\n结论'});await click('从预览创建文本笔记');expect(writes()).toHaveLength(1);expect(onCreated).not.toHaveBeenCalled();await click('打开已创建的笔记');expect(onCreated).toHaveBeenCalledTimes(1);expect(onCreated.mock.calls[0][0].content).toBe(textTemplateDocument('议题\n结论'));expect(beforeCreate).toHaveBeenCalledTimes(2)})
test('original editor protection cancellation prevents copy POST',async()=>{beforeCreate.mockResolvedValue(false);await mount({id:'meeting',title:'会议',content:'内容'});await click('从预览创建文本笔记');expect(writes()).toHaveLength(0);expect(onCreated).not.toHaveBeenCalled();expect(host.textContent).toContain('已取消新建')})
test('lost create response is retained and recovered through read-only check',async()=>{await mount({id:'meeting',title:'会议',content:'内容'});const original=api.getMockImplementation();api.mockImplementation(async(p,i)=>{const result=await original(p,i);if(i?.method==='POST')throw Error('lost');return result});await click('从预览创建文本笔记');expect(host.textContent).toContain('操作尚未确认');expect(writes()).toHaveLength(1);await click('核对操作结果');expect(writes()).toHaveLength(1);expect(host.textContent).toContain('创建回执已确认');expect(button('打开已创建的笔记')).toBeTruthy()})
test('rechecking old success never discards a newer unsaved template draft',async()=>{await mount();await newTemplate();await click('新建模板');await fill('模板名称','正在编辑');await fill('模板正文','不能丢失');await click('核对操作结果');expect(host.querySelector('[aria-label="模板正文"]').value).toBe('不能丢失');expect(host.querySelector('[aria-label="模板名称"]').value).toBe('正在编辑')})
test('stale existing template change is refused before PUT',async()=>{await mount();await click('编辑');await fill('模板正文','旧确认修改');templates[0]={...templates[0],content:'其他修改'};await click('保存模板');expect(writes()).toHaveLength(0);expect(host.textContent).toContain('旧确认失效')})
test('dirty template close asks whether to keep or discard its local draft',async()=>{await mount();await click('新建模板');await fill('模板名称','未完成');await click('返回模板选择');expect(host.textContent).toContain('保留草稿并关闭');await click('取消');expect(host.querySelector('[aria-label="模板名称"]').value).toBe('未完成');expect(writes()).toHaveLength(0)})
test('archived view and pagination retain exact selection',async()=>{templates=Array.from({length:14},(_,i)=>row({id:'tpl'+i,title:'模板'+i}));await mount();expect(host.querySelectorAll('.template-library-row')).toHaveLength(12);await click('下一页');expect(host.querySelectorAll('.template-library-row')).toHaveLength(2);expect(host.textContent).toContain('模板13')})
test('clear operation requires explicit confirmation and does not remove its created note',async()=>{await mount({id:'meeting',title:'会议',content:'正文'});await click('从预览创建文本笔记');await click('清除这条记录');await click('取消');expect(files.size).toBe(1);await click('清除这条记录');await click('确认清除记录');expect(Object.keys(localStorage).filter(k=>k.startsWith(TEMPLATE_INTENT_PREFIX))).toHaveLength(0);expect(files.size).toBe(1)})

test('independent text copy preserves every blank line and boundary space',async()=>{
 const text='  \n\n保留空行🙂\n\n末尾  \n'
 await mount({id:'preserve',title:'保真模板',content:text})
 expect(host.querySelector('[aria-label="模板正文预览"]').textContent).toBe(text)
 await click('从预览创建文本笔记')
 expect(JSON.parse(writes()[0][1].body).content).toBe(textTemplateDocument(text))
 expect(onCreated).not.toHaveBeenCalled()
})
test('legacy literal JSON remains editable text instead of a blank rich preview',async()=>{
 const text='{"topic":"周报","done":false}'
 templates=[row({title:'JSON文本',content:text})]
 await mount();await click('编辑')
 expect(host.querySelector('[aria-label="模板正文"]').value).toBe(text)
 expect(host.querySelector('[aria-label="模板正文"]').disabled).toBe(false)
 await click('保存模板');expect(templates[0].content).toBe(textTemplateDocument(text))
})

// A confirmed write and the following catalog read are separate events.
// Native navigation must await the actual enabled row, not the receipt text.
test('confirmed creation remains valid while its catalog row is still loading',async()=>{
 await mount();await click('新建模板');await fill('模板名称','迟到列表');await fill('模板正文','正文')
 const original=api.getMockImplementation();let afterWrite=false,release
 api.mockImplementation(async(p,i={})=>{
  if(p==='/api/template-library'&&afterWrite)return new Promise(resolve=>{release=()=>resolve({complete:true,items:templates.map(t=>({...t}))})})
  const value=await original(p,i);if(i.method==='POST')afterWrite=true;return value
 })
 await act(async()=>button('保存模板').click())
 try{
  for(let i=0;i<100&&(!release||!host.textContent.includes('创建回执已确认'));i++)await act(async()=>{await new Promise(r=>setTimeout(r,5))})
  expect(release).toBeTypeOf('function');expect(host.textContent).toContain('创建回执已确认')
  const currentRow=()=>[...host.querySelectorAll('.template-library-index li')].find(n=>n.querySelector('strong')?.textContent==='迟到列表')
  expect(currentRow()).toBeUndefined();expect(writes()).toHaveLength(1)
  await act(async()=>release());await tick()
  expect(currentRow()).toBeTruthy();expect([...currentRow().querySelectorAll('button')].every(n=>!n.disabled)).toBe(true)
  await click('编辑',currentRow());expect(host.querySelector('[aria-label="模板正文"]').value).toBe('正文');expect(writes()).toHaveLength(1)
 }finally{release?.()}
})
