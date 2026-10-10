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
const raw=(records=rows())=>prepareHistoryExport({snapshot:{items:records,filter:'all',hasMore:true},phase:'ready'},new Date('2026-10-02T06:00:00Z')).raw
const c=key=>host.querySelector('[data-history-file-'+key+']')
const ids=()=>[...host.querySelectorAll('[data-history-file-row]')].map(n=>n.querySelectorAll('code')[1].textContent)
async function mount(){await act(async()=>root.render(<Viewer/>));host.querySelector('[data-history-file-viewer]').open=true}
async function open(text=raw(),name='history.json',wait=true){await act(async()=>{Object.defineProperty(c('input'),'files',{configurable:true,value:[new File([text],name,{type:'application/json'})]});c('input').dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();if(wait)await readHistoryFile.mock.results.at(-1).value.catch(()=>{})})}
async function click(node){await act(async()=>node.click())}
async function type(value){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(c('query'),value);c('query').dispatchEvent(new InputEvent('input',{bubbles:true}))})}
beforeEach(async()=>{oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true;const m=await vi.importActual('~/services/syncHistoryFile.mjs');readHistoryFile.mockReset().mockImplementation(m.readHistoryFile);host=document.createElement('div');document.body.append(host);root=createRoot(host);await mount();await open()})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct})
it('filters the entire validated file by one exact record from the current row',async()=>{
  await click(c('filter-record'));expect(ids()).toEqual(['r0']);expect(c('matches').textContent).toContain('当前匹配 1 条 / 文件内共 61 条')
  expect(c('record-filter-value').textContent).toBe('r0');expect(c('page').textContent).toContain('第 1 / 1 页')
})
it('keeps record identity exact instead of text-search normalisation',async()=>{
  const exact=[{...rows()[0],id:'记录-Ａ'},{...rows()[1],id:'记录-A'}]
  await open(raw(exact),'opaque-record.json');await click(c('filter-record'));expect(ids()).toEqual(['记录-Ａ']);expect(c('record-filter-value').textContent).toBe('记录-Ａ')
})
it('combines exact record scope with exact object scope and text query',async()=>{
  await click(c('filter-object'));await click(c('filter-record'));await type('笔记 0')
  expect(ids()).toEqual(['r0']);expect(c('object-filter-value').textContent).toBe('same');expect(c('record-filter-value').textContent).toBe('r0')
})
it('cancels only the record scope and retains text and object filters with focus',async()=>{
  await click(c('filter-object'));await type('笔记');await click(c('filter-record'))
  const clear=c('record-filter-clear');clear.focus();await click(clear)
  expect(c('record-filter')).toBeNull();expect(c('object-filter-value').textContent).toBe('same');expect(c('query').value).toBe('笔记');expect(document.activeElement).toBe(c('query'))
  expect(ids()).toEqual(['r0','r30'])
})
it('clear-file-filters removes object, record and text scopes but keeps the file',async()=>{
  await click(c('filter-object'));await click(c('filter-record'));await type('笔记');await click(c('filter-clear'))
  expect(c('object-filter')).toBeNull();expect(c('record-filter')).toBeNull();expect(c('query').value).toBe('');expect(ids()).toHaveLength(25);expect(c('name').textContent).toBe('history.json')
})
it('failed replacement retains the prior record context; successful replacement resets it',async()=>{
  await click(c('filter-record'));await open('bad','bad.json');expect(c('record-filter-value').textContent).toBe('r0');expect(c('stale')).toBeTruthy()
  const fresh=[{...rows()[0],id:'fresh',itemID:'fresh-object'}];await open(raw(fresh),'fresh.json')
  expect(c('record-filter')).toBeNull();expect(ids()).toEqual(['fresh'])
})
it('same-record action is idempotent and exposes pressed state without losing focus',async()=>{
  const button=c('filter-record');button.focus();await click(button);const active=c('filter-record');expect(active.getAttribute('aria-pressed')).toBe('true')
  active.focus();await click(active);expect(document.activeElement).toBe(active);expect(ids()).toEqual(['r0'])
})
it('exact record filtering causes no reread, network, storage or download side effects',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch'),store=vi.spyOn(Storage.prototype,'setItem'),download=vi.spyOn(HTMLAnchorElement.prototype,'click')
  await click(c('filter-record'));await type('笔记 1');await click(c('record-filter-clear'));await click(c('filter-clear'))
  expect(readHistoryFile).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled()
})
