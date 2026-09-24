import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import SearchPresetTransfer from './SearchPresetTransfer'
import {createSearchPresetStore,SEARCH_PRESET_PREFIX} from '~/services/searchPresets'
import {buildSearchPresetBackup} from '~/services/searchPresetBackup'
let container,root,store,storage
const filters={query:'关关',source:'body',folderId:'p',days:'7',pinned:false,matchCase:false,sort:'updated'}
function fixture(){const map=new Map();let serial=0;const storage={get length(){return map.size},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};return {storage,store:createSearchPresetStore({storage:()=>storage,createId:()=>`preset-${++serial}`})}}
const raw=(names=['人物'])=>{const f=fixture();for(const name of names)f.store.save(name,filters);return buildSearchPresetBackup(f.store)}
const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text)
const click=async text=>{expect(button(text)).toBeTruthy();await act(async()=>button(text).click())}
async function upload(value){const input=container.querySelector('input[type=file]');Object.defineProperty(input,'files',{value:[typeof value==='string'?{size:new TextEncoder().encode(value).length,text:async()=>value}:value],configurable:true});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})))}
beforeEach(async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);({store,storage}=fixture());container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(<SearchPresetTransfer store={store}/>))})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('previews every row without writing until confirmation',async()=>{
 await upload(raw(['人物','设定']));expect(store.list().entries).toHaveLength(0);expect(container.textContent).toContain('预检 2 条');expect(container.querySelectorAll('li')).toHaveLength(2)
 await click('确认导入常用检索');expect(store.list().entries).toHaveLength(2);expect(container.textContent).toContain('已新增 2 条')
})
it('cancelled preflight does not import or change ordinary search filters',async()=>{
 await upload(raw());await click('取消导入预检');expect(store.list().entries).toHaveLength(0);expect(button('确认导入常用检索')).toBeUndefined()
})
it('displays duplicate counts without overwriting stored entries',async()=>{
 store.save('人物',filters);const original=store.list().entries[0].raw;await upload(raw(['人物','设定','设定']));expect(container.textContent).toContain('新增 1 条，本地已有 1 条，文件内重复 1 条')
 await click('确认导入常用检索');expect(store.list().entries).toHaveLength(2);expect(store.list().entries.some(e=>e.raw===original)).toBe(true)
})
it('reports invalid JSON and oversized files before writes',async()=>{
 await upload('not json');expect(container.querySelector('[role=alert]').textContent).toContain('JSON')
 const text=vi.fn();await upload({size:600000,text});expect(text).not.toHaveBeenCalled();expect(store.list().entries).toHaveLength(0)
})
it('ignores a late file read after cancellation',async()=>{
 let done;await upload({size:100,text:()=>new Promise(resolve=>{done=resolve})});await click('取消导入预检');await act(async()=>done(raw()))
 expect(button('确认导入常用检索')).toBeUndefined();expect(store.list().entries).toHaveLength(0)
})
it('newer file selections supersede slow prior reads',async()=>{
 let done;await upload({size:100,text:()=>new Promise(resolve=>{done=resolve})});await upload(raw(['最新']))
 await act(async()=>done(raw(['过期'])));expect(container.textContent).toContain('最新');expect(container.textContent).not.toContain('过期')
})
it('detects shelf changes between preview and confirmation',async()=>{
 await upload(raw());store.save('另一窗口',filters);await click('确认导入常用检索')
 expect(container.querySelector('[role=alert]').textContent).toContain('已变化');expect(store.list().entries).toHaveLength(1)
})
it('reports exact partial import counts and retains written entries',async()=>{
 await upload(raw(['一','二']));const set=storage.setItem;let writes=0;storage.setItem=(k,v)=>{if(++writes>1)throw Error('quota');set(k,v)}
 await click('确认导入常用检索');expect(container.textContent).toContain('已新增 1 条，跳过 0 条，剩余 1 条');expect(store.list().entries).toHaveLength(1)
})
it('renders imported markup as text rather than executable HTML',async()=>{
 await upload(raw(['<img src=x onerror=alert(1)>']));expect(container.querySelector('img')).toBeNull();expect(container.textContent).toContain('<img src=x')
})
it('exports through a download without falsely claiming disk-save completion',async()=>{
 store.save('人物',filters);vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
 await click('备份全部常用检索');expect(URL.createObjectURL).toHaveBeenCalled();expect(container.textContent).toContain('已发起完整备份下载');expect(container.textContent).not.toContain('已保存到磁盘')
})
it('does not export an unreadable record as if it did not exist',async()=>{
 storage.setItem(SEARCH_PRESET_PREFIX+'broken','broken');await click('备份全部常用检索');expect(container.querySelector('[role=alert]').textContent).toContain('不可读取')
})
