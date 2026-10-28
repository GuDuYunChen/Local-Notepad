import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TagWorkspace from './TagWorkspace'
import { api } from '~/services/api'
import { TAG_WORKSPACE_CHANGED, TAG_WORKSPACE_JOURNAL, createTagWorkspaceJournal, tagWorkspaceIntent } from '~/services/tagWorkspace.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
let host, root, tags, links, revision, close, open, writeMode, holdRead, oldBody
const rev = () => revision.toString(16).padStart(64,'0')
const snap = () => ({ version:1,complete:true,revision:rev(),tags:tags.map(t=>({...t})) })
const panel = () => document.querySelector('.tag-workspace')
const disabled = button => button.disabled || Boolean(button.closest('fieldset:disabled'))
const button = text => [...panel().querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text)
const drain = async () => { for(let i=0;i<30;i++) await Promise.resolve() }
const click = async text => act(async()=>{const b=button(text);expect(b,text).toBeTruthy();expect(disabled(b),text).toBe(false);b.focus();b.click();await drain()})
const input = async (label,value) => act(async()=>{const el=panel().querySelector(`[aria-label="${label}"]`);const proto=el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));await drain()})
const writes = () => api.mock.calls.filter(([,init])=>init?.method==='POST')
const mount = async () => act(async()=>{root.render(<TagWorkspace onClose={close} onOpenFile={open}/>);await drain()})
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear();revision=1;writeMode='ok';holdRead=null;oldBody='original note body'
 tags=[{id:'a',name:'写作',color:'#123456',active_count:1,hidden_count:1,total_count:2},{id:'b',name:'资料',color:'#176b4a',active_count:0,hidden_count:0,total_count:0}]
 links={a:[{id:'note-a',title:'笔记 A'}],b:[]};close=vi.fn();open=vi.fn(async()=>false)
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 api.mockReset().mockImplementation(async(path,init={})=>{
  if(path==='/api/tag-workspace'){if(holdRead)await holdRead;return snap()}
  if(path.includes('/notes?')){const id=path.split('/')[3],offset=Number(new URLSearchParams(path.split('?')[1]).get('offset'));const rows=links[id]||[];return{tag_id:id,revision:rev(),complete:true,offset,total:rows.length,has_more:offset+50<rows.length,notes:rows.slice(offset,offset+50)}}
  if(path==='/api/tag-workspace/changes'){
   const c=JSON.parse(init.body);if(writeMode==='hold')await new Promise(()=>{})
   if(c.expected_revision!==rev())throw Error('conflict')
   if(writeMode==='refuse')throw Error('refused')
   if(c.kind==='create'){tags.push({id:c.id,name:c.name,color:c.color,active_count:0,hidden_count:0,total_count:0});links[c.id]=[]}
   if(c.kind==='rename'){const t=tags.find(t=>t.id===c.id);t.name=c.name;t.color=c.color}
   if(c.kind==='delete'||c.kind==='merge'){
    if(c.kind==='merge'){const src=tags.find(t=>t.id===c.id),target=tags.find(t=>t.id===c.target_id);target.total_count+=src.total_count;target.hidden_count+=src.hidden_count;target.active_count+=src.active_count;links[target.id]=[...links[target.id],...links[src.id]]}
    tags=tags.filter(t=>t.id!==c.id);delete links[c.id]
   }
   revision++;if(writeMode==='lost')throw Error('lost response')
   return{request_id:c.request_id,kind:c.kind,before_revision:c.expected_revision,snapshot:snap()}
  }
  throw Error('unexpected route '+path)
 })
 await mount()
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()})
describe('local tag workspace entry to result and recovery',()=>{
 it('reads complete counts and ordinary notes without reading bodies',()=>{expect(panel().textContent).toContain('1 篇普通笔记');expect(panel().textContent).toContain('1 个其他关联');expect(panel().textContent).toContain('笔记 A');expect(writes()).toHaveLength(0);expect(api.mock.calls.every(([path])=>path.startsWith('/api/tag-workspace'))).toBe(true)})
 it('creates only after confirmation and displays acknowledged result',async()=>{await input('工作台标签名称','新标签');await click('创建标签');expect(writes()).toHaveLength(0);await click('确认');expect(writes()).toHaveLength(1);expect(tags.some(t=>t.name==='新标签')).toBe(true);expect(localStorage.getItem(TAG_WORKSPACE_JOURNAL)).toBeNull();expect(panel().querySelector('[role="status"]').textContent).toContain('数据库已确认');expect(oldBody).toBe('original note body')})
 it('rename keeps tag identity, counts and note body untouched',async()=>{await click('编辑名称与颜色');await input('工作台标签名称','写作资料');await input('工作台标签颜色','#176b4a');await click('保存标签修改');await click('确认');expect(tags.find(t=>t.id==='a')).toMatchObject({name:'写作资料',active_count:1,hidden_count:1});expect(links.a[0].id).toBe('note-a');expect(writes()[0][1].body).not.toContain('content')})
 it('merge explains hidden scope, cancels cleanly, then commits the whole decision',async()=>{await input('合并目标标签','b');await click('合并标签');expect(panel().querySelector('[role="alertdialog"]').textContent).toContain('全部 2 个关联');await click('取消');expect(writes()).toHaveLength(0);await click('合并标签');await click('确认');expect(tags).toHaveLength(1);expect(tags[0]).toMatchObject({id:'b',total_count:2,hidden_count:1});expect(panel().textContent).toContain('笔记 A')})
 it('delete requires confirmation and preserves ordinary notes',async()=>{await click('删除标签');expect(panel().querySelector('[role="alertdialog"]').textContent).toContain('笔记本身和正文保留');expect(writes()).toHaveLength(0);await click('确认');expect(tags.some(t=>t.id==='a')).toBe(false);expect(oldBody).toBe('original note body')})
 it('refuses duplicate names and unsafe colors before sending',async()=>{await input('工作台标签名称','资料');await click('创建标签');expect(panel().querySelector('[role="alert"]').textContent).toContain('同名');expect(writes()).toHaveLength(0);await input('工作台标签名称','新名称');await input('工作台标签颜色','#zzzzzz');await click('创建标签');expect(writes()).toHaveLength(0)})
 it('uses search and unused filter without mutating catalog',async()=>{await input('工作台查找标签','资料');expect(panel().querySelectorAll('[data-workspace-tag]')).toHaveLength(1);await input('工作台查找标签','not found');expect(panel().textContent).toContain('没有符合筛选条件');expect(writes()).toHaveLength(0)})
 it('does not filter while an IME composition is still active',async()=>{const el=panel().querySelector('[aria-label="工作台查找标签"]');await act(async()=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await input('工作台查找标签','not found');expect(panel().querySelectorAll('[data-workspace-tag]')).toHaveLength(2);await act(async()=>{el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await drain()});expect(panel().querySelectorAll('[data-workspace-tag]')).toHaveLength(0)})
 it('retains dirty input when cancelling close and sends nothing when discarded',async()=>{await input('工作台标签名称','未提交');await click('关闭标签工作台');await click('取消');expect(close).not.toHaveBeenCalled();expect(panel().querySelector('[aria-label="工作台标签名称"]').value).toBe('未提交');await click('关闭标签工作台');await click('确认');expect(close).toHaveBeenCalledTimes(1);expect(writes()).toHaveLength(0)})
 it('does not send when operation journal cannot be persisted',async()=>{const storage=localStorage;vi.stubGlobal('localStorage',{getItem:k=>storage.getItem(k),setItem(){throw Error('quota')},removeItem:k=>storage.removeItem(k)});await input('工作台标签名称','新');await click('创建标签');await click('确认');expect(writes()).toHaveLength(0);expect(tags).toHaveLength(2);expect(panel().querySelector('[role=alert]').textContent).toContain('尚未发送标签修改')})
 it('keeps a lost response for explicit read-only reconciliation, never retries',async()=>{writeMode='lost';await input('工作台标签名称','已落库但无回执');await click('创建标签');await click('确认');expect(writes()).toHaveLength(1);expect(localStorage.getItem(TAG_WORKSPACE_JOURNAL)).not.toBeNull();expect(disabled(button('创建标签'))).toBe(true);await click('核对当前标签库');expect(panel().textContent).toContain('不是原请求的历史回执');await click('结束待核对记录');await click('确认');expect(localStorage.getItem(TAG_WORKSPACE_JOURNAL)).toBeNull();expect(writes()).toHaveLength(1)})
 it('reopens an unresolved record and does not auto-send',async()=>{const c=tagWorkspaceIntent(snap(),'delete',{id:'a'});createTagWorkspaceJournal(localStorage).save(c);await act(async()=>root.render(null));await mount();expect(panel().textContent).toContain('待核对');expect(disabled(button('删除标签'))).toBe(true);expect(writes()).toHaveLength(0);await click('核对当前标签库');expect(panel().textContent).toContain('与原目标不同')})
 it('retains corrupt records until a distinct clear confirmation',async()=>{localStorage.setItem(TAG_WORKSPACE_JOURNAL,'{');await act(async()=>root.render(null));await mount();expect(panel().textContent).toContain('记录损坏');expect(disabled(button('删除标签'))).toBe(true);await click('清除损坏记录');await click('取消');expect(localStorage.getItem(TAG_WORKSPACE_JOURNAL)).toBe('{');await click('清除损坏记录');await click('确认');expect(localStorage.getItem(TAG_WORKSPACE_JOURNAL)).toBeNull();expect(writes()).toHaveLength(0)})
 it('stops waiting without treating cancellation as a database rollback',async()=>{writeMode='hold';await input('工作台标签名称','未确认');await click('创建标签');await click('确认');await click('停止等待');expect(panel().textContent).toContain('停止或超时不等于撤销');expect(writes()).toHaveLength(1);expect(localStorage.getItem(TAG_WORKSPACE_JOURNAL)).not.toBeNull()})
 it('invalidates an open destructive confirmation when external data changes',async()=>{await click('删除标签');await act(async()=>{window.dispatchEvent(new CustomEvent(TAG_WORKSPACE_CHANGED));await drain()});expect(panel().querySelector('[role="alertdialog"]')).toBeNull();expect(disabled(button('删除标签'))).toBe(true);expect(writes()).toHaveLength(0);await click('重新读取标签库');expect(disabled(button('删除标签'))).toBe(false)})
 it('can reload after an external event aborts an in-flight initial read',async()=>{let done;holdRead=new Promise(resolve=>{done=resolve});await act(async()=>root.render(null));await mount();await act(async()=>{window.dispatchEvent(new StorageEvent('storage',{key:TAG_WORKSPACE_JOURNAL}));await drain()});expect(disabled(button('重新读取标签库'))).toBe(false);holdRead=null;await click('重新读取标签库');await act(async()=>{done();await drain()});expect(panel().textContent).toContain('笔记 A')})
 it('places errors and confirmations outside the independently scrolling form',async()=>{writeMode='refuse';await click('删除标签');expect(panel().querySelector('[role="alertdialog"]').closest('.tag-workspace-scroll')).toBeNull();await click('确认');const alert=panel().querySelector('[role="alert"]');expect(alert.closest('.tag-workspace-feedback')).not.toBeNull();expect(alert.closest('.tag-workspace-scroll')).toBeNull()})
 it('uses the original guarded opener and retains the workspace after cancellation',async()=>{await click('笔记 A');expect(open).toHaveBeenCalledWith('note-a',expect.objectContaining({signal:expect.any(AbortSignal),shouldSelect:expect.any(Function)}));expect(close).not.toHaveBeenCalled();expect(panel().textContent).toContain('未打开或已取消');open.mockResolvedValueOnce(true);await click('笔记 A');expect(close).toHaveBeenCalledTimes(1)})
 it('passes a cancellation signal and rejects late note navigation after unmount',async()=>{let resolve;open.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await click('笔记 A');const options=open.mock.calls[0][1];await act(async()=>root.render(null));expect(options.signal.aborted).toBe(true);expect(options.shouldSelect()).toBe(false);await act(async()=>{resolve(true);await drain()});expect(close).not.toHaveBeenCalled()})
 it('surfaces a malformed catalog rather than silently showing an empty list',async()=>{api.mockImplementation(async()=>({complete:false}));await click('重新读取标签库');expect(panel().querySelector('[role="alert"]').textContent).toContain('不完整');expect(panel().textContent).not.toContain('标签库为空');expect(writes()).toHaveLength(0)})
 it('pages through metadata with no missing or duplicate displayed rows',async()=>{links.a=Array.from({length:51},(_,i)=>({id:'n'+i,title:'行'+i}));tags[0].active_count=51;tags[0].total_count=52;revision++;await click('重新读取标签库');expect(panel().querySelectorAll('.tag-workspace-notes button')).toHaveLength(50);await click('下一页');expect(panel().querySelectorAll('.tag-workspace-notes button')).toHaveLength(1);expect(panel().textContent).toContain('行50');await click('上一页');expect(panel().querySelectorAll('.tag-workspace-notes button')).toHaveLength(50)})
 it('blocks duplicate confirmation clicks before a second write starts',async()=>{writeMode='hold';await input('工作台标签名称','新');await click('创建标签');await act(async()=>{const b=button('确认');b.click();b.click();await drain()});expect(writes()).toHaveLength(1);await click('停止等待')})
 it('does not turn Ctrl+S in the modal into a note save',async()=>{const e=new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true});await act(async()=>panel().dispatchEvent(e));expect(e.defaultPrevented).toBe(true);expect(writes()).toHaveLength(0)})
})


it('does not adopt an older acknowledged snapshot after an external change', async () => {
 let release; const gate=new Promise(resolve=>{release=resolve}); const previous=api.getMockImplementation()
 api.mockImplementation(async (path,init)=>{const value=await previous(path,init);if(init?.method==='POST')await gate;return value})
 await input('工作台标签名称','本次创建');await click('创建标签');await click('确认')
 await act(async()=>{tags.push({id:'external',name:'随后变化',color:'#123456',active_count:0,hidden_count:0,total_count:0});revision++;window.dispatchEvent(new CustomEvent(TAG_WORKSPACE_CHANGED));await drain()})
 await act(async()=>{release();await drain()})
 expect(panel().textContent).toContain('随后有外部变化');expect(panel().querySelector('.tag-workspace-list')).toBeNull()
 expect(writes()).toHaveLength(1);expect(localStorage.getItem(TAG_WORKSPACE_JOURNAL)).toBeNull()
 await click('重新读取标签库');expect(panel().textContent).toContain('随后变化');expect(writes()).toHaveLength(1)
})

// A previous operation's acknowledgement must never describe a new refusal.
describe('sequential operation feedback belongs to the current attempt',()=>{
 const statusText=()=>panel().querySelector('.tag-workspace-feedback [role="status"]')?.textContent || ''
 const acknowledgeFirst=async()=>{
  await input('工作台标签名称','第一次成功');await click('创建标签');await click('确认')
  expect(statusText()).toContain('本机数据库已确认标签修改');expect(writes()).toHaveLength(1)
 }
 it('clears the old acknowledgement when the next journal write is denied',async()=>{
  await acknowledgeFirst();const storage=localStorage
  vi.stubGlobal('localStorage',{getItem:k=>storage.getItem(k),setItem(){throw Error('quota')},removeItem:k=>storage.removeItem(k)})
  await input('工作台标签名称','这次未发送');await click('创建标签');await click('确认')
  expect(panel().querySelector('[role="alert"]').textContent).toContain('尚未发送标签修改')
  expect(statusText()).not.toContain('数据库已确认');expect(writes()).toHaveLength(1)
  expect(tags.some(t=>t.name==='这次未发送')).toBe(false);expect(storage.getItem(TAG_WORKSPACE_JOURNAL)).toBeNull()
 })
 it('does not combine invalid input with the previous success',async()=>{
  await acknowledgeFirst();await input('工作台标签名称','新的无效输入');await input('工作台标签颜色','#zzzzzz');await click('创建标签')
  expect(panel().querySelector('[role="alert"]').textContent).toContain('颜色')
  expect(statusText()).not.toContain('数据库已确认');expect(writes()).toHaveLength(1)
 })
 it('does not claim a pending or cancelled deletion was acknowledged',async()=>{
  await acknowledgeFirst();await click('删除标签')
  expect(panel().querySelector('[role="alertdialog"]')).not.toBeNull()
  expect(statusText()).not.toContain('数据库已确认');await click('取消')
  expect(statusText()).not.toContain('数据库已确认');expect(writes()).toHaveLength(1)
 })
 it('keeps the second refused request unresolved without reusing the first receipt',async()=>{
  await acknowledgeFirst();writeMode='refuse';await input('工作台标签名称','被拒绝');await click('创建标签');await click('确认')
  expect(panel().querySelector('[role="alert"]').textContent).toContain('结果未确认')
  expect(statusText()).not.toContain('数据库已确认');expect(writes()).toHaveLength(2)
  expect(localStorage.getItem(TAG_WORKSPACE_JOURNAL)).not.toBeNull()
 })
 it('preserves a genuine current acknowledgement if only journal cleanup fails',async()=>{
  await acknowledgeFirst();const storage=localStorage
  vi.stubGlobal('localStorage',{getItem:k=>storage.getItem(k),setItem:(k,v)=>storage.setItem(k,v),removeItem(){throw Error('cleanup denied')}})
  await input('工作台标签名称','这次也已保存');await click('创建标签');await click('确认')
  expect(tags.some(t=>t.name==='这次也已保存')).toBe(true);expect(writes()).toHaveLength(2)
  expect(panel().querySelector('[role="alert"]').textContent).toContain('数据库已确认，但本机操作记录未能清除')
  expect(statusText()).toContain('本机数据库已确认标签修改');expect(storage.getItem(TAG_WORKSPACE_JOURNAL)).not.toBeNull()
 })
})
