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

it('resumes a persisted bookmark outside the visible filter using the full history queue', async () => {
 const { createHash, randomUUID } = await import('node:crypto')
 vi.stubGlobal('crypto', { randomUUID, subtle: { digest: async (_algorithm, bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer } })
 const { createCollectionStudyStore } = await import('../services/collectionStudy')
 const key = await seed(), entry = searchCollections.list().entries.find(row => row.key === key)
 const study = createCollectionStudyStore({ locks: () => ({ request: (_key, _options, callback) => Promise.resolve().then(callback) }) })
 await study.bookmark(await study.load(entry), 'n22')
 onOpenFile.mockResolvedValue(true); await render(); await select(key)
 await change(label('搜索资料集条目'), '章节 0')
 await click(button('从上次位置继续（全部条目）'))
 expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'n22', index: 22, view: { query: '', status: 'all' }, queue: expect.any(Array) }))
 expect(onOpened.mock.calls[0][0].queue).toHaveLength(23)
})
it('cancelled resume preserves the existing collection filter and saved bookmark', async () => {
 const { createHash, randomUUID } = await import('node:crypto')
 vi.stubGlobal('crypto', { randomUUID, subtle: { digest: async (_algorithm, bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer } })
 const { createCollectionStudyStore } = await import('../services/collectionStudy')
 const key = await seed(), entry = searchCollections.list().entries.find(row => row.key === key)
 const study = createCollectionStudyStore({ locks: () => ({ request: (_key, _options, callback) => Promise.resolve().then(callback) }) })
 await study.bookmark(await study.load(entry), 'n22')
 await render(); await select(key); await change(label('搜索资料集条目'), '章节 0')
 await click(button('从上次位置继续（全部条目）'))
 expect(label('搜索资料集条目').value).toBe('章节 0'); expect(onOpened).not.toHaveBeenCalled()
 expect((await study.load(entry)).data.bookmark.id).toBe('n22')
})
