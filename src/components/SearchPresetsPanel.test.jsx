import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import SearchPresetsPanel from './SearchPresetsPanel'
import { createSearchPresetStore, SEARCH_PRESET_PREFIX } from '~/services/searchPresets'
let root, container, store, values, storage, onApply
const filters={query:'关关',source:'body',folderId:'p',days:'7',sort:'updated',pinned:false,matchCase:false,page:3,revision:'old'}
const label = text => container.querySelector('[aria-label="'+text+'"]')
const button = text => [...container.querySelectorAll('button')].find(e=>e.textContent===text)
const click=async e=>{expect(e).toBeTruthy();await act(async()=>e.click())}
const change=async(e,value)=>{await act(async()=>{const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})}
const render=async(p={})=>{await act(async()=>root.render(<SearchPresetsPanel filters={filters} onApply={onApply} store={store} {...p}/>))}
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);values=new Map();let i=0
 storage={get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
 store=createSearchPresetStore({storage:()=>storage,createId:()=> 'ui-'+(++i),now:()=>new Date('2026-09-23T00:00:00.000Z')});onApply=vi.fn();container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals()})
it('starts collapsed and never saves by rendering or typing a name',async()=>{await render();expect(container.querySelector('details').open).toBe(false);await change(label('保存检索名称'),'check');expect(values.size).toBe(0)})
it('saves only after an explicit click and applies to page one',async()=>{await render();await change(label('保存检索名称'),'设定检查');await click(button('保存当前检索'));expect(values.size).toBe(1);await click(button('应用检索'));expect(onApply).toHaveBeenCalledWith(expect.objectContaining({query:'关关',folderId:'p',page:1,revision:''}))})
it('allows empty keyword browsing presets',async()=>{await render({filters:{...filters,query:''}});await change(label('保存检索名称'),'浏览');await click(button('保存当前检索'));expect(store.list().entries[0].preset.filters.query).toBe('')})
it('retains entered name and active filters after write failure',async()=>{storage.setItem=()=>{throw Error('quota')};await render();await change(label('保存检索名称'),'keep');await click(button('保存当前检索'));expect(label('保存检索名称').value).toBe('keep');expect(container.textContent).toContain('检索保存失败');expect(onApply).not.toHaveBeenCalled()})
it('a delete can be cancelled without removing the saved preset',async()=>{store.save('keep',filters);await render();await change(label('已保存检索'),store.list().entries[0].key);await click(button('删除此检索'));await click(button('取消删除'));expect(values.size).toBe(1)})
it('deletes only after confirmation',async()=>{store.save('delete',filters);await render();await change(label('已保存检索'),store.list().entries[0].key);await click(button('删除此检索'));expect(values.size).toBe(1);await click(button('确认删除检索'));expect(values.size).toBe(0);expect(onApply).not.toHaveBeenCalled()})
it('rejects deletion when a stored row changed during confirmation',async()=>{store.save('safe',filters);await render();const e=store.list().entries[0];await change(label('已保存检索'),e.key);await click(button('删除此检索'));values.set(e.key,e.raw+' ');await click(button('确认删除检索'));expect(values.size).toBe(1);expect(container.textContent).toContain('已变化')})
it('shows unavailable storage without pretending the shelf is empty',async()=>{store=createSearchPresetStore({storage:()=>{throw Error('blocked')}});await render();expect(container.textContent).toContain('读取失败');expect(button('保存当前检索').disabled).toBe(true)})
it('refreshes cross-window changes on storage events',async()=>{await render();const other=createSearchPresetStore({storage:()=>storage,createId:()=> 'other'});other.save('另一窗口',filters);await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:SEARCH_PRESET_PREFIX+'other'})));expect(container.textContent).toContain('另一窗口')})
it('renders markup-looking names as text',async()=>{store.save('<img src=x>',filters);await render();expect(container.querySelector('img')).toBeNull();expect(container.textContent).toContain('<img src=x>')})
it('shows corrupt entries and prevents applying them',async()=>{values.set(SEARCH_PRESET_PREFIX+'bad','broken');await render();await change(label('已保存检索'),SEARCH_PRESET_PREFIX+'bad');expect(button('应用检索').disabled).toBe(true);expect(container.textContent).toContain('版本不支持')})
