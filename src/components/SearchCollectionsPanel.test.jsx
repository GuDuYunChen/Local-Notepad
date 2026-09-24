import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import GlobalSearchPanel from './GlobalSearchPanel'
import { searchLibrary } from '~/services/globalSearch'
import { collectSearchResultReport } from '~/services/searchResultExport'
import { searchCollections, SEARCH_COLLECTION_PREFIX } from '~/services/searchCollections'
vi.mock('~/services/globalSearch',async original=>({...await original(),searchLibrary:vi.fn()}))
const item=i=>({id:'n'+i,title:'章节 '+i,folder_path:'旧卷',updated_at:1,is_pinned:false,title_match:false,body_count:0,content_sha256:'a'.repeat(64),snippets:[]})
const data=(number=1,rows=Array.from({length:23},(_,i)=>item(i)),patch={})=>({query:'',items:rows.slice((number-1)*20,number*20),folders:[],total:rows.length,total_occurrences:0,scanned:rows.length,unsupported:0,page:number,pages:Math.max(1,Math.ceil(rows.length/20)),page_size:20,revision:'b'.repeat(64),...patch})
let container,root,onClose,onOpenFile,onOpened
const label=name=>container.querySelector('[aria-label="'+name+'"]')
const button=text=>[...container.querySelectorAll('button')].find(el=>el.textContent===text)
const click=async el=>{expect(el).toBeTruthy();await act(async()=>el.click())}
const advance=async()=>act(async()=>vi.advanceTimersByTimeAsync(220))
async function change(el,value){await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})}
async function render(props={}){await act(async()=>root.render(<GlobalSearchPanel open onClose={onClose} onOpenFile={onOpenFile} onOpened={onOpened} {...props}/>));await advance()}
const makeReport=()=>collectSearchResultReport({query:''},data(),{mode:'all',request:async f=>data(f.page)})
async function seed(name='设定资料'){let value;await act(async()=>{value=searchCollections.save(name,await makeReport())});return SEARCH_COLLECTION_PREFIX+value.id}
async function select(key){await click(button('本地资料集'));await change(label('已保存资料集'),key)}
async function file(raw){await act(async()=>{const el=label('选择资料集备份');Object.defineProperty(el,'files',{value:[{size:raw.length,text:async()=>raw}],configurable:true});el.dispatchEvent(new Event('change',{bubbles:true}))})}
beforeEach(()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear()
 searchLibrary.mockReset().mockImplementation(async f=>data(f.page||1,undefined,{query:f.query||''}))
 onClose=vi.fn();onOpenFile=vi.fn().mockResolvedValue(false);onOpened=vi.fn()
 container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})

it('saves all result pages into a named metadata-only collection and reopens it',async()=>{
 await render();await change(label('资料集名称'),'创作资料');await click(button('保存全部为资料集'))
 expect(searchCollections.list().entries[0].collection.report.count).toBe(23)
 const entry=searchCollections.list().entries[0];expect(entry.raw).not.toContain('snippets')
 await select(entry.key);expect(label('本地检索资料集').textContent).toContain('创作资料');expect(label('资料集条目 n0')).toBeTruthy()
})
it('saves only the cross-page selected subset without changing export or editor selection',async()=>{
 await render();await click(button('加入导出清单'));await click(button('下一页'));await advance();await click(button('加入导出清单'))
 await change(label('资料集名称'),'跨页');await click(button('保存所选为资料集'))
 expect(searchCollections.list().entries[0].collection.report.items.map(i=>i.id)).toEqual(['n0','n20']);expect(onOpenFile).not.toHaveBeenCalled()
 expect(button('导出所选 2 篇')).toBeTruthy()
})
it('collection save ignores excerpt opt-in and never downloads without an explicit export',async()=>{
 const url=vi.spyOn(URL,'createObjectURL');await render();await click(container.querySelector('.search-result-export input[type=checkbox]'))
 await change(label('资料集名称'),'无节选');await click(button('保存全部为资料集'))
 expect(searchCollections.list().entries[0].collection.report.includeSnippets).toBe(false);expect(url).not.toHaveBeenCalled()
})
it('preserves the name and selection after quota failure',async()=>{
 await render();await click(button('加入导出清单'));await change(label('资料集名称'),'不应丢失')
 const original=localStorage
 vi.stubGlobal('localStorage',{get length(){return original.length},key:i=>original.key(i),getItem:key=>original.getItem(key),removeItem:key=>original.removeItem(key),setItem:()=>{throw new Error('quota')}})
 await click(button('保存所选为资料集'));expect(label('资料集名称').value).toBe('不应丢失');expect(button('导出所选 1 篇')).toBeTruthy()
 expect(container.textContent).toContain('空间不足');expect(searchCollections.list().entries).toHaveLength(0)
})
it('cancels a pending save when switching to collections, even with a late transport result',async()=>{
 await render();await change(label('资料集名称'),'旧请求');let finish
 searchLibrary.mockImplementation(()=>new Promise(resolve=>finish=resolve));await click(button('保存全部为资料集'));await click(button('本地资料集'))
 await act(async()=>finish(data()));expect(searchCollections.list().entries).toHaveLength(0)
})
it('keyboard tabs select the view and maintain a roving tab index',async()=>{
 await render();const search=button('检索结果');await act(async()=>search.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})))
 expect(button('本地资料集').getAttribute('aria-selected')).toBe('true');expect(search.tabIndex).toBe(-1)
 expect(label('全局检索关键词').closest('[role=tabpanel]').hidden).toBe(true)
})
it('paginates all historical entries and filters titles without deleting records',async()=>{
 const key=await seed();await render();await select(key)
 await click(button('资料集下一页'));await click(button('资料集下一页'));expect(label('资料集条目 n22')).toBeTruthy()
 await change(label('搜索资料集条目'),'章节 22');expect(label('资料集条目 n0')).toBeNull();expect(searchCollections.list().entries[0].collection.report.count).toBe(23)
})
it('cancelled editor open preserves the collection, page and original draft guard',async()=>{
 const key=await seed();await render();await select(key);await click(button('资料集下一页'))
 await click(label('资料集条目 n8').querySelector('button'));expect(onOpenFile).toHaveBeenCalledWith('n8', expect.objectContaining({ shouldSelect: expect.any(Function), signal: expect.anything() }))
 expect(label('资料集条目 n8')).toBeTruthy();expect(container.textContent).toContain('已取消打开');expect(onClose).not.toHaveBeenCalled();expect(onOpened).not.toHaveBeenCalled()
})
it('accepted collection open replaces the search origin with a source-specific reading context',async()=>{
 const key=await seed();onOpenFile.mockResolvedValue(true);await render();await select(key);await click(label('资料集条目 n0').querySelector('button'))
 expect(onOpenFile).toHaveBeenCalledWith('n0', expect.objectContaining({ shouldSelect: expect.any(Function), signal: expect.anything() }));expect(onClose).toHaveBeenCalledOnce();expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({ kind: 'collection', documentId: 'n0', collectionName: '设定资料' }))
})
it('reopening the workbench retains the selected collection and historical page',async()=>{
 const key=await seed();await render();await select(key);await click(button('资料集下一页'));await render({open:false});await render()
 expect(button('本地资料集').getAttribute('aria-selected')).toBe('true');expect(label('资料集条目 n8')).toBeTruthy()
})
it('rechecking shows distinct body, metadata and outside statuses, not deleted claims',async()=>{
 const key=await seed();await render();await select(key)
 const rows=[{...item(0),content_sha256:'c'.repeat(64)},{...item(1),title:'新标题'}]
 searchLibrary.mockImplementation(async f=>data(f.page,rows,{revision:'c'.repeat(64)}));await click(button('检查当前变化'))
 expect(label('资料集条目 n0').textContent).toContain('正文有变化');expect(label('资料集条目 n1').textContent).toContain('新标题')
 expect(label('资料集条目 n2').textContent).toContain('这不是已删除的证明')
 await change(label('资料集变化筛选'),'body');expect(label('资料集条目 n1')).toBeNull()
 expect(searchCollections.list().entries[0].collection.report.items[1].title).toBe('章节 1')
})
it('all unmatched entries remain in the historical list and can still use guarded open',async()=>{
 const key=await seed();await render();await select(key);searchLibrary.mockResolvedValue(data(1,[]));await click(button('检查当前变化'))
 expect(container.textContent).toContain('不在原范围 23');expect(label('资料集条目 n0').querySelector('button').disabled).toBe(false)
})
it('inspection failure is explicit, retryable and preserves the historical collection',async()=>{
 const key=await seed();await render();await select(key);searchLibrary.mockRejectedValue(new Error('临时断开'))
 await click(button('检查当前变化'));expect(container.textContent).toContain('临时断开');expect(label('资料集条目 n0')).toBeTruthy()
 searchLibrary.mockImplementation(async f=>data(f.page));await click(button('检查当前变化'));expect(container.textContent).toContain('未变化 23')
})
it('cancels inspection when closing and never publishes a late comparison',async()=>{
 const key=await seed();await render();await select(key);let finish;searchLibrary.mockImplementation(()=>new Promise(resolve=>finish=resolve))
 await click(button('检查当前变化'));await render({open:false});await act(async()=>finish(data()));await render()
 expect(label('资料集条目 n0').textContent).toContain('尚未复查');expect(searchCollections.list().entries).toHaveLength(1)
})
it('detects changed local storage on refresh and clears obsolete check results',async()=>{
 const key=await seed();await render();await select(key);await click(button('检查当前变化'));expect(container.textContent).toContain('本次未变化')
 localStorage.setItem(key,'broken');await click(button('刷新资料集'));expect(label('资料集条目 n0')).toBeNull();expect(container.textContent).toContain('损坏')
})
it('requires deletion confirmation and never removes notes or unrelated storage',async()=>{
 const key=await seed();await render();await select(key);localStorage.setItem('theme','dark')
 await click(button('删除此资料集'));await click(button('取消删除资料集'));expect(searchCollections.list().entries).toHaveLength(1)
 await click(button('删除此资料集'));await click(button('确认删除资料集'));expect(searchCollections.list().entries).toHaveLength(0)
 expect(localStorage.getItem('theme')).toBe('dark');expect(onOpenFile).not.toHaveBeenCalled()
})
it('stale deletion cannot remove a newer record with the same key',async()=>{
 const key=await seed();await render();await select(key);await click(button('删除此资料集'));const raw=localStorage.getItem(key)+' '
 localStorage.setItem(key,raw);await click(button('确认删除资料集'));expect(localStorage.getItem(key)).toBe(raw);expect(container.textContent).toContain('更改')
})
it('import previews without writing; cancel is a no-op; confirm adds an independent copy',async()=>{
 await seed();const entry=searchCollections.list().entries[0],raw=searchCollections.export(entry);await render();await click(button('本地资料集'))
 await file(raw);expect(label('资料集导入预检')).toBeTruthy();expect(searchCollections.list().entries).toHaveLength(1)
 await click(button('取消资料集导入'));expect(searchCollections.list().entries).toHaveLength(1)
 await file(raw);await click(button('确认导入独立资料集'));expect(searchCollections.list().entries).toHaveLength(2)
 expect(label('已保存资料集').value).not.toBe(entry.key)
})
it('rejects malformed imports without altering an existing collection',async()=>{
 const key=await seed();await render();await select(key);await file('{bad')
 expect(label('资料集导入预检')).toBeNull();expect(searchCollections.list().entries).toHaveLength(1);expect(label('资料集条目 n0')).toBeTruthy()
})
it('closed import file reads never reopen a stale confirmation',async()=>{
 await render();await click(button('本地资料集'));let finish
 await act(async()=>{const el=label('选择资料集备份');Object.defineProperty(el,'files',{value:[{size:10,text:()=>new Promise(resolve=>finish=resolve)}]});el.dispatchEvent(new Event('change',{bubbles:true}))})
 await render({open:false});await act(async()=>finish('{}'));await render();expect(label('资料集导入预检')).toBeNull()
})
it('backs up exact metadata only after an explicit download request',async()=>{
 const key=await seed();await render();await select(key);const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:collection');vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
 await click(button('备份此资料集 JSON'));expect(create).toHaveBeenCalledOnce();expect(container.textContent).toContain('已发起资料集 JSON 下载')
})
it('renders imported hostile markup as text, without creating executable elements',async()=>{
 const report=structuredClone(await makeReport());report.items[0].title='<img src=x onerror=alert(1)>'
 const value=searchCollections.save('<script>资料集</script>',report);await render();await select(SEARCH_COLLECTION_PREFIX+value.id)
 expect(label('本地检索资料集').querySelector('img')).toBeNull();expect(label('本地检索资料集').textContent).toContain('<img src=x')
})

it('returns to the saved collection, filter and identity-based page with focus',async()=>{
 const key=await seed();onOpenFile.mockResolvedValue(true);await render();await select(key)
 await click(button('资料集下一页'));await click(button('资料集下一页'));await click(label('资料集条目 n22').querySelector('button'))
 const context=onOpened.mock.calls[0][0];await render({open:false});await render({returnRequest:{context}})
 expect(button('本地资料集').getAttribute('aria-selected')).toBe('true')
 expect(label('资料集条目 n22')).toBeTruthy();expect(document.activeElement).toBe(label('资料集条目 n22'))
 expect(label('已保存资料集').value).toBe(key);expect(container.textContent).toContain('原资料集条目和筛选')
})
it('restores a filtered comparison as a labeled old snapshot rather than calling it live',async()=>{
 const key=await seed();await render();await select(key)
 const rows=Array.from({length:23},(_,i)=>({...item(i),content_sha256:i%2?'c'.repeat(64):'a'.repeat(64)}))
 searchLibrary.mockImplementation(async f=>data(f.page,rows));await click(button('检查当前变化'))
 await change(label('资料集变化筛选'),'body');onOpenFile.mockResolvedValue(true)
 await click(label('资料集条目 n1').querySelector('button'));const context=onOpened.mock.calls[0][0]
 expect(context.queue).toHaveLength(11);await render({open:false});await render({returnRequest:{context}})
 expect(label('资料集变化筛选').value).toBe('body');expect(label('资料集条目 n1')).toBeTruthy()
 expect(container.textContent).toContain('先前复查快照');expect(container.textContent).toContain('未自动重查')
})
it('stale collection return never opens or recreates missing notes',async()=>{
 const key=await seed();onOpenFile.mockResolvedValue(true);await render();await select(key);await click(label('资料集条目 n0').querySelector('button'))
 const context=onOpened.mock.calls[0][0];await render({open:false});localStorage.removeItem(key)
 await render({returnRequest:{context}});expect(container.textContent).toContain('更改或删除');expect(label('资料集条目 n0')).toBeNull()
 expect(searchCollections.list().entries).toHaveLength(0);expect(onOpenFile).toHaveBeenCalledOnce()
})
it('explicit report export rechecks and includes all rows despite a restrictive view',async()=>{
 const key=await seed();await render();await select(key);await change(label('搜索资料集条目'),'章节 22')
 const before=localStorage.getItem(key);const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:review');vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
 const rows=Array.from({length:25},(_,i)=>item(i));searchLibrary.mockImplementation(async f=>data(f.page,rows,{revision:'c'.repeat(64)}))
 await click(button('重新复查并导出 JSON'));expect(create).toHaveBeenCalledOnce()
 const blob=create.mock.calls[0][0];const value=JSON.parse(await blob.text())
 expect(value.rows).toHaveLength(23);expect(value.additional).toHaveLength(2);expect(value.checkedAt).toBeTruthy()
 expect(label('搜索资料集条目').value).toBe('章节 22');expect(localStorage.getItem(key)).toBe(before)
 expect(container.textContent).toContain('已重新复查并发起完整报告下载')
})
it('report export rejects unavailable transport and does not download partial data',async()=>{
 const key=await seed();await render();await select(key);const create=vi.spyOn(URL,'createObjectURL');searchLibrary.mockRejectedValue(new Error('断开'))
 await click(button('重新复查并导出 Markdown'));expect(create).not.toHaveBeenCalled();expect(container.textContent).toContain('断开')
 expect(searchCollections.list().entries).toHaveLength(1)
})
it('closing cancels report export even when transport resolves late',async()=>{
 const key=await seed();await render();await select(key);const create=vi.spyOn(URL,'createObjectURL');let finish
 searchLibrary.mockImplementation(()=>new Promise(resolve=>finish=resolve));await click(button('重新复查并导出 JSON'));await render({open:false})
 await act(async()=>finish(data()));expect(create).not.toHaveBeenCalled();expect(searchCollections.list().entries).toHaveLength(1)
})
it('local record changing during report preparation rejects stale output',async()=>{
 const key=await seed();await render();await select(key);const create=vi.spyOn(URL,'createObjectURL');let count=0
 searchLibrary.mockImplementation(async f=>{count++;if(count===2)localStorage.setItem(key,localStorage.getItem(key)+' ');return data(f.page)})
 await click(button('重新复查并导出 JSON'));expect(create).not.toHaveBeenCalled();expect(container.textContent).toContain('更改或删除')
})
it('opening guard revalidates the source after the user has been shown save confirmation',async()=>{
 const key=await seed();await render();await select(key);let finish
 onOpenFile.mockImplementation(()=>new Promise(resolve=>finish=resolve));await click(label('资料集条目 n0').querySelector('button'))
 const options=onOpenFile.mock.calls[0][1];expect(options.shouldSelect()).toBe(true);localStorage.removeItem(key)
 expect(options.shouldSelect()).toBe(false);await act(async()=>finish(false));expect(onOpened).not.toHaveBeenCalled()
})
