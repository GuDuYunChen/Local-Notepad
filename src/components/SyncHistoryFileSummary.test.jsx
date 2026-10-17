import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Viewer from './SyncHistoryFileViewer'
import Summary from './SyncHistoryFileSummary'
import { prepareHistoryExport } from '~/services/syncHistoryExport.mjs'
import { readHistoryFile } from '~/services/syncHistoryFile.mjs'
vi.mock('~/services/syncHistoryFile.mjs', async original => ({...await original(), readHistoryFile: vi.fn((await original()).readHistoryFile)}))
let root, host, previous
const c = key => host.querySelector('[data-history-file-' + key + ']')
const s = key => host.querySelector('[data-file-summary-' + key + ']')
const counts = key => [...host.querySelectorAll('[data-file-summary-' + key + ']')].map(n => Number(n.textContent))
const rows = () => Array.from({length:61}, (_,i) => ({id:'r'+i,itemID:'same-object',title:i===60?'尾页 星图':'笔记 '+i,kind:i%2?'tag':'file',status:i===60?'superseded':'resolved',resolution:i===60?'remote-rebind':i%3?'remote':'local',createdAt:1,resolvedAt:i===60?0:1790726400}))
const raw = (items=rows(), phase='ready') => prepareHistoryExport({snapshot:{items,filter:'all',hasMore:true},phase}).raw
async function open(text=raw()) {
  await act(async () => {
    Object.defineProperty(c('input'),'files',{configurable:true,value:[new File([text],'history.json')]})
    c('input').dispatchEvent(new Event('change',{bubbles:true}))
    await readHistoryFile.mock.results.at(-1).value.catch(()=>{})
  })
}
async function type(value, composing=false) { await act(async()=> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(c('query'),value)
  c('query').dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:composing}))
}) }
async function click(key) { await act(async()=>c(key).click()) }
beforeEach(async()=>{
  previous=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  readHistoryFile.mockReset().mockImplementation((await vi.importActual('~/services/syncHistoryFile.mjs')).readHistoryFile)
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async()=>root.render(<Viewer/>))
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT=previous})
it('does not invent a file summary before an explicit successful read',()=>{expect(c('summary')).toBeNull();expect(readHistoryFile).not.toHaveBeenCalled()})
it('counts all 61 file matches, not 25 visible rows or one shared object',async()=>{
  await open();expect(c('summary').open).toBe(false);expect(host.querySelectorAll('[data-history-file-row]')).toHaveLength(25)
  expect(counts('outcome')).toEqual([20,40,1,0]);expect(counts('kind')).toEqual([31,30,0,0]);expect(s('scope').textContent).toContain('61 条')
  expect(s('coverage').textContent).toContain('有时间记录 60 条，时间缺失 1 条')
})
it('paging keeps all-match counts and a user-opened disclosure',async()=>{
  await open();const detail=c('summary');detail.open=true;const before=detail.textContent
  await click('next');await click('next');expect(c('summary')).toBe(detail);expect(detail.open).toBe(true);expect(detail.textContent).toBe(before)
})
it('an off-page match updates both dimensions and does not fabricate a missing timestamp',async()=>{
  await open();c('query').focus();await type('星图');expect(counts('outcome')).toEqual([0,0,1,0]);expect(counts('kind')).toEqual([1,0,0,0])
  expect(s('no-time').textContent).toContain('全部缺失');expect(s('earliest')).toBeNull();expect(document.activeElement).toBe(c('query'))
})
it('combined filters remain the same intersection as the file list',async()=>{
  await open();await act(async()=>{c('kind').value='tag';c('kind').dispatchEvent(new Event('change',{bubbles:true}))})
  await act(async()=>{c('outcome').value='local';c('outcome').dispatchEvent(new Event('change',{bubbles:true}))})
  expect(counts('outcome')).toEqual([10,0,0,0]);expect(counts('kind')).toEqual([0,10,0,0])
})
it('no matches produce zeros and no invented date range',async()=>{
  await open();await type('missing');expect(counts('outcome')).toEqual([0,0,0,0]);expect(counts('kind')).toEqual([0,0,0,0]);expect(s('no-time').textContent).toContain('没有匹配')
})
it('candidate text preserves committed counts until composition end',async()=>{
  await open();await type('笔记');await act(async()=>c('query').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
  await type('xingtu',true);expect(s('composing')).toBeTruthy();expect(counts('outcome')).toEqual([20,40,0,0])
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(c('query'),'星图');c('query').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'星图'}))})
  expect(counts('outcome')).toEqual([0,0,1,0]);expect(s('composing')).toBeNull()
})
it('bad replacements retain the previous file counts with stale provenance after clearing filters',async()=>{
  await open();await type('星图');await open('invalid');expect(counts('outcome')).toEqual([0,0,1,0]);expect(s('retained')).toBeTruthy()
  await click('filter-clear');expect(counts('outcome')).toEqual([20,40,1,0]);expect(s('retained')).toBeTruthy()
})
it('pending/stopped reads do not pretend retained counts are newly read',async()=>{
  await open();readHistoryFile.mockImplementationOnce(()=>new Promise(()=>{}))
  await act(async()=>{Object.defineProperty(c('input'),'files',{configurable:true,value:[new File(['{}'],'slow.json')]});c('input').dispatchEvent(new Event('change',{bubbles:true}))})
  expect(s('retained')).toBeTruthy();await click('stop');expect(s('retained')).toBeTruthy();expect(s('scope').textContent).toContain('61 条')
})
it('fresh replacement updates summary while original file-declared source remains separate',async()=>{
  await open();await type('星图');await open(raw([{...rows()[0],id:'only',resolution:'unknown'}],'error'))
  expect(counts('outcome')).toEqual([0,0,0,1]);expect(s('retained')).toBeNull();expect(c('source').textContent).toContain('读取失败');expect(s('scope').textContent).toContain('1 条')
})
it('expanding, filtering and paging cause no network, storage writes, downloads or rereads',async()=>{
  const net=vi.spyOn(globalThis,'fetch'),write=vi.spyOn(Storage.prototype,'setItem'),download=vi.spyOn(HTMLAnchorElement.prototype,'click')
  await open();c('summary').open=true;await click('next');await type('星图');await click('filter-clear')
  expect(net).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();expect(readHistoryFile).toHaveBeenCalledTimes(1)
  expect(c('summary').querySelector('button,input,select,a')).toBeNull()
})
it('invalid summary data fails without partial counts or raw private errors',async()=>{
  await act(async()=>root.render(<Summary report={{records:[{id:'PRIVATE_BAD'}]}} filters={{}} phase="ready"/>))
  expect(counts('outcome')).toEqual([]);expect(s('scope').textContent).toContain('未生成部分统计');expect(host.textContent).not.toContain('PRIVATE_BAD')
})
