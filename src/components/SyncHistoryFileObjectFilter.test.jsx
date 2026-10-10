import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Viewer from './SyncHistoryFileViewer'
import { readHistoryFile } from '~/services/syncHistoryFile.mjs'
import { prepareHistoryExport } from '~/services/syncHistoryExport.mjs'
vi.mock('~/services/syncHistoryFile.mjs', async original => { const m=await original();return {...m,readHistoryFile:vi.fn(m.readHistoryFile)} })
let host,root,oldAct
const rows=()=>Array.from({length:61},(_,i)=>({id:'r'+i,itemID:[0,30,60].includes(i)?'same':'object-'+i,title:i===60?'尾页':'笔记 '+i,
  kind:i===30?'tag':'file',status:'resolved',resolution:'local',createdAt:i+1,resolvedAt:1790812800+i}))
const raw=(records=rows())=>prepareHistoryExport({snapshot:{items:records,filter:'all',hasMore:true},phase:'ready'},new Date('2026-10-02T02:00:00Z')).raw
const c=key=>host.querySelector('[data-history-file-'+key+']')
const ids=()=>[...host.querySelectorAll('[data-history-file-row]')].map(n=>n.querySelectorAll('code')[1].textContent)
async function mount(){await act(async()=>root.render(<Viewer/>));host.querySelector('[data-history-file-viewer]').open=true}
async function open(text=raw(),name='history.json',wait=true){await act(async()=>{Object.defineProperty(c('input'),'files',{configurable:true,value:[new File([text],name,{type:'application/json'})]});c('input').dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();if(wait)await readHistoryFile.mock.results.at(-1).value.catch(()=>{})})}
async function click(node){await act(async()=>node.click())}
async function type(value){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(c('query'),value);c('query').dispatchEvent(new InputEvent('input',{bubbles:true}))})}
beforeEach(async()=>{oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true;const m=await vi.importActual('~/services/syncHistoryFile.mjs');readHistoryFile.mockReset().mockImplementation(m.readHistoryFile);host=document.createElement('div');document.body.append(host);root=createRoot(host);await mount();await open()})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct})
it('filters the entire validated file by one exact object from the current row',async()=>{
  await click(c('filter-object'));expect(ids()).toEqual(['r0','r30','r60']);expect(c('matches').textContent).toContain('当前匹配 3 条 / 文件内共 61 条')
  expect(c('object-filter-value').textContent).toBe('same');expect(c('page').textContent).toContain('第 1 / 1 页')
  expect(host.querySelector('[data-file-summary-scope]').textContent).toContain('全部 3 条匹配记录')
})
it('keeps opaque identifier identity exact instead of text-search normalisation',async()=>{
  const exact=[{...rows()[0],id:'a',itemID:'对象-Ａ'},{...rows()[1],id:'b',itemID:'对象-A'}]
  await open(raw(exact),'opaque.json');await click(c('filter-object'));expect(ids()).toEqual(['a']);expect(c('object-filter-value').textContent).toBe('对象-Ａ')
})
it('combines exact object scope with the existing text query without replacing it',async()=>{
  await click(c('filter-object'));await type('尾页');expect(ids()).toEqual(['r60']);expect(c('object-filter-value').textContent).toBe('same');expect(c('query').value).toBe('尾页')
})
it('cancels only the object scope and retains the other file filters and focus',async()=>{
  await type('笔记 3');await click(host.querySelectorAll('[data-history-file-filter-object]')[0])
  const clear=c('object-filter-clear');clear.focus();await click(clear)
  expect(c('object-filter')).toBeNull();expect(c('query').value).toBe('笔记 3');expect(document.activeElement).toBe(c('query'))
  expect(ids().map(String)).toEqual(['r3','r30','r31','r32','r33','r34','r35','r36','r37','r38','r39'])
})
it('clear-file-filters removes both text and exact object scope but keeps the file',async()=>{
  await click(c('filter-object'));await type('笔记');await click(c('filter-clear'))
  expect(c('object-filter')).toBeNull();expect(c('query').value).toBe('');expect(ids()).toHaveLength(25);expect(c('name').textContent).toBe('history.json')
})
it('failed replacement retains the prior exact object context; successful replacement resets it',async()=>{
  await click(c('filter-object'));await open('bad','bad.json');expect(c('object-filter-value').textContent).toBe('same');expect(c('stale')).toBeTruthy()
  const fresh=[{...rows()[0],id:'fresh',itemID:'fresh-object'}];await open(raw(fresh),'fresh.json')
  expect(c('object-filter')).toBeNull();expect(ids()).toEqual(['fresh'])
})
it('same-object action is idempotent and exposes pressed state without losing focus',async()=>{
  const button=c('filter-object');button.focus();await click(button);const active=c('filter-object');expect(active.getAttribute('aria-pressed')).toBe('true')
  active.focus();await click(active);expect(document.activeElement).toBe(active);expect(ids()).toEqual(['r0','r30','r60'])
})
it('exact object filtering causes no reread, network, storage or download side effects',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch'),store=vi.spyOn(Storage.prototype,'setItem'),download=vi.spyOn(HTMLAnchorElement.prototype,'click')
  await click(c('filter-object'));await type('尾页');await click(c('object-filter-clear'));await click(c('filter-clear'))
  expect(readHistoryFile).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled()
})
