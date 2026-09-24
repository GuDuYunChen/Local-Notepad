import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import ResearchTasksPanel from './ResearchTasksPanel'
import { createResearchTaskStore, createResearchTaskService } from '../services/researchTasks'
import { buildStudyCompilation } from '../services/studyCompilation'
import { researchReceipt, RESEARCH_FILE_ID, testLocks } from '../test/researchFixtures'
import { memoryStorage } from '../test/collectionFixtures'
import { downloadCollectionReviewReport } from '../services/collectionReviewReport'
vi.mock('../services/collectionReviewReport',()=>({downloadCollectionReviewReport:vi.fn()}))
let host, root, store, service, request, onReceipt, entry, storage, server
const button = name => [...host.querySelectorAll('button')].find(x => x.textContent === name)
const click = async name => { expect(button(name)).toBeTruthy(); await act(async()=>button(name).click()) }
const checkbox = () => host.querySelector('.research-task-confirm input')
const render = (props={}) => act(async()=>root.render(<ResearchTasksPanel active service={service} onReceipt={onReceipt} {...props}/>))
const select = async () => { await act(async()=>host.querySelector('.research-task-list button').click()) }
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.stubGlobal('crypto',{randomUUID,subtle:{digest:async(_a,b)=>Uint8Array.from(createHash('sha256').update(b).digest()).buffer}})
 storage=memoryStorage();server=new Map();store=createResearchTaskStore({storage:()=>storage,locks:()=>testLocks})
 request=vi.fn(async(path,init)=>{
   const id=path.split('/').at(-1)
   if(init?.method==='POST'){const r=researchReceipt(path,JSON.parse(init.body));server.set(id,r);return r}
   return server.get(id)||{found:false,request_id:id}
 })
 service=createResearchTaskService({store,request});onReceipt=vi.fn()
 const rows=Array.from({length:23},(_,i)=>({collectionKey:'c',collectionId:'c',collectionName:'资料',id:'n'+i,title:'条目'+i,folderPath:'旧卷',ordinal:i+1,status:'revisit',note:'第'+i+'条批注\n中文😀',updatedAt:'2026-09-24T12:00:00.000Z'}))
 entry=await service.save(buildStudyCompilation(rows,{title:'研究笔记',goal:'目标',parentId:'',group:'collection'},'2026-09-24T13:00:00.000Z','2026-09-24T12:30:00.000Z'))
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks()})
it('lists persisted tasks without any network and shows the complete historical preview',async()=>{
 await render();await select();expect(host.textContent).toContain('第22条批注');expect(host.textContent).toContain('不会自动混入最新批注');expect(request).not.toHaveBeenCalled()
})
it('requires explicit historical-payload consent before retry and exposes the guarded open receipt',async()=>{
 await render();await select();expect(button('以同一任务创建或重试').disabled).toBe(true)
 await act(async()=>checkbox().click());await click('以同一任务创建或重试')
 expect(request.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1)
 expect(onReceipt).toHaveBeenCalledWith(expect.objectContaining({status:'confirmed',id:RESEARCH_FILE_ID}))
 expect(host.textContent).toContain('已查回此任务对应的笔记');expect(button('以同一任务创建或重试')).toBeUndefined()
})
it('lookup alone never posts and clearly reports missing receipts',async()=>{
 await render();await select();await click('查回此任务创建结果')
 expect(host.textContent).toContain('尚未查到');expect(request.mock.calls.every(([,init])=>!init.method)).toBe(true)
})
it('a failed POST remains visible with a recoverable stored task, not an erased error',async()=>{
 request.mockImplementation(async(path,init)=>{if(init?.method==='POST')throw new Error('网络中断');return {found:false,request_id:path.split('/').at(-1)}})
 await render();await select();await act(async()=>checkbox().click());await click('以同一任务创建或重试')
 expect(host.querySelector('[role="alert"]').textContent).toContain('结果尚未确认');expect(store.list()[0].task.phase).toBe('uncertain')
 expect(button('以同一任务创建或重试').disabled).toBe(true)
})
it('external task changes invalidate inspected bytes rather than silently adopting a new version',async()=>{
 await render();await select();await act(async()=>checkbox().click());await act(async()=>store.update(entry,'submitted'))
 expect(checkbox().checked).toBe(false);expect(button('以同一任务创建或重试').disabled).toBe(true);expect(host.textContent).toContain('重新选择')
 expect(request).not.toHaveBeenCalled()
})
it('deleted server notes have no retry or open action and are not recreated',async()=>{
 const result=await service.submit(entry);server.get(result.receipt.request_id).state='deleted';request.mockClear()
 await render();await select();await click('查回此任务创建结果')
 expect(host.textContent).toContain('回收站');expect(onReceipt).not.toHaveBeenCalled();expect(request.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(0)
})
it('removal requires confirmation and does not delete any server note',async()=>{
 await render();await select();await click('移除本地研究任务记录');await click('取消移除研究任务');expect(store.list()).toHaveLength(1)
 await click('移除本地研究任务记录');await click('确认只移除本地任务');expect(store.list()).toHaveLength(0);expect(request).not.toHaveBeenCalled()
})
it('download includes the last annotation without creating a note',async()=>{
 await render();await select();await click('下载已存研究草稿')
 expect(downloadCollectionReviewReport.mock.calls[0][0].text).toContain('第22条批注');expect(request).not.toHaveBeenCalled()
})
it('cancelled/hidden lookup cannot issue a late POST and reopening resets busy state',async()=>{
 let resolve;request.mockImplementationOnce(path=>new Promise(done=>{resolve=()=>done({found:false,request_id:path.split('/').at(-1)})}))
 await render();await select();await act(async()=>checkbox().click());await click('以同一任务创建或重试');await render({active:false});await act(async()=>resolve());await render()
 expect(button('刷新研究任务').disabled).toBe(false);expect(request.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(0)
})
it('refresh after remount finds the same journal task and does not create another one',async()=>{
 await render();await select();const id=store.read(entry).id
 await act(async()=>root.unmount());root=createRoot(host);await render();await select()
 expect(host.textContent).toContain(id);expect(store.list()).toHaveLength(1);expect(request).not.toHaveBeenCalled()
})
it('parent view callback failure cannot turn verified creation into failure',async()=>{
 onReceipt.mockImplementation(()=>{throw new Error('view')});await render();await select();await act(async()=>checkbox().click());await click('以同一任务创建或重试')
 expect(host.textContent).toContain('已查回此任务对应的笔记');expect(store.list()[0].task.phase).toBe('confirmed')
})
it('hostile-looking annotations render as text and never become DOM nodes',async()=>{
 const raw=JSON.parse(entry.raw);raw.document.rows[0].note='<img src=x onerror=alert(1)>'
 storage.setItem(entry.key,JSON.stringify(raw));await render();await select()
 expect(host.querySelectorAll('img,script')).toHaveLength(0);expect(host.textContent).toContain('<img src=x')
})
