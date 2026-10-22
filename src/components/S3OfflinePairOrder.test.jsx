import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Pair from './S3OfflineReportPair.jsx'
import { readLocalOverviewFile } from '../services/s3LocalOverviewFile.mjs'
vi.mock('../services/s3LocalOverviewFile.mjs', async () => ({
  ...await vi.importActual('../services/s3LocalOverviewFile.mjs'), readLocalOverviewFile: vi.fn(),
}))
let host, root
const read = vi.mocked(readLocalOverviewFile)
const report = (files=12,tags=2) => ({ generatedAtUTC:'2026-10-01T00:00:00.000Z',source:'untrusted-file',
  summary:{format:'local-notepad-s3-local-candidate-overview',version:1,read_only:true,observed_stable:true,
    complete_for_preview:false,records:files+tags,record_bytes:(files+tags)*64,attachment_bytes:0,base_items:0,
    kinds:['file','tag','file-tag','attachment'].map((kind,i)=>({kind,records:[files,tags,0,0][i],record_bytes:[files*64,tags*64,0,0][i]}))}})
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
const click=selector=>act(async()=>{host.querySelector(selector).click();await flush()})
const select=(selector,value)=>act(async()=>{const el=host.querySelector(selector);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));await flush()})
const choose=(side,value)=>act(async()=>{
  const el=host.querySelector(`[data-offline-side="${side}"] input[type=file]`)
  if(value)read.mockResolvedValueOnce(value)
  Object.defineProperty(el,'files',{configurable:true,value:value?[new File(['x'],'report.json')]:[]})
  el.dispatchEvent(new Event('change',{bubbles:true}));await flush()
})
const rows=()=>[...host.querySelectorAll('[data-offline-result] tbody tr')]
const deltas=()=>rows().map(r=>Number(r.cells[3].textContent))
const setup=async()=>{await choose('a',report());await choose('b',report(3,13));await click('[data-offline-compare]');await click('[data-offline-differences]');await select('[data-offline-scope]','counts')}
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);read.mockReset()
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async()=>{root.render(<StrictMode><Pair/></StrictMode>);await flush()})
  await act(async()=>{const el=host.querySelector('details');el.open=true;el.dispatchEvent(new Event('toggle'));await flush()})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('offline order UI waits for explicit comparison and a single metric unit',async()=>{
  expect(host.querySelector('[data-offline-order]')).toBeNull();expect(read).not.toHaveBeenCalled()
  await choose('a',report());await choose('b',report(3,13));expect(rows()).toHaveLength(0)
  await click('[data-offline-compare]');expect(host.querySelector('[data-offline-order]')).toBeNull()
  await click('[data-offline-differences]');expect(host.querySelector('[data-offline-order]')).toBeNull()
  await select('[data-offline-scope]','counts');expect(host.querySelector('[data-offline-order]').value).toBe('original')
})
it('offline order UI largest and smallest rank absolute deltas and restore original rows',async()=>{
  await setup();expect(deltas()).toEqual([2,-9,11]);await select('[data-offline-order]','largest');expect(deltas()).toEqual([11,-9,2])
  await select('[data-offline-order]','smallest');expect(deltas()).toEqual([2,-9,11]);await select('[data-offline-order]','original');expect(deltas()).toEqual([2,-9,11]);expect(read).toHaveBeenCalledTimes(2)
})
it('offline order UI unit change resets ranking without clearing direction',async()=>{
  await setup();await select('[data-offline-order]','largest');await select('[data-offline-direction]','increase')
  expect(deltas()).toEqual([11,2]);await select('[data-offline-scope]','bytes')
  expect(host.querySelector('[data-offline-order]').value).toBe('original');expect(host.querySelector('[data-offline-direction]').value).toBe('increase')
  await select('[data-offline-order]','largest');expect(deltas()).toEqual([704,128])
})
it('offline order UI switching to mixed units then back never revives ranking',async()=>{
  await setup();await select('[data-offline-order]','largest');await select('[data-offline-scope]','all');expect(host.querySelector('[data-offline-order]')).toBeNull()
  await select('[data-offline-scope]','counts');expect(host.querySelector('[data-offline-order]').value).toBe('original')
})
it('offline order UI direction changes retain same-unit ranking',async()=>{
  await setup();await select('[data-offline-order]','largest');await select('[data-offline-direction]','increase');expect(deltas()).toEqual([11,2])
  await select('[data-offline-direction]','decrease');expect(deltas()).toEqual([-9]);expect(host.querySelector('[data-offline-order]').value).toBe('largest')
})
it('offline order UI disable differences restores twelve rows and clears sort',async()=>{
  await setup();await select('[data-offline-order]','largest');await click('[data-offline-differences]');expect(rows()).toHaveLength(12)
  await click('[data-offline-differences]');await select('[data-offline-scope]','counts');expect(host.querySelector('[data-offline-order]').value).toBe('original')
})
it('offline order UI cancelled picker keeps confirmed ranking',async()=>{
  await setup();await select('[data-offline-order]','largest');await choose('a',null);expect(deltas()).toEqual([11,-9,2]);expect(read).toHaveBeenCalledTimes(2)
})
it('offline order UI swap requires new confirmation without old sort',async()=>{
  await setup();await select('[data-offline-order]','largest');await click('[data-offline-swap]');expect(rows()).toHaveLength(0)
  expect(host.querySelector('[data-offline-order]')).toBeNull();await click('[data-offline-compare]');expect(rows()).toHaveLength(12)
  await click('[data-offline-differences]');await select('[data-offline-scope]','counts');expect(deltas()).toEqual([-2,9,-11]);expect(host.querySelector('[data-offline-order]').value).toBe('original')
})
it('offline order UI replacing A then restoring A does not restore old sort',async()=>{
  await setup();await select('[data-offline-order]','largest');await choose('a',report(1,2));await choose('a',report());expect(rows()).toHaveLength(0)
  await click('[data-offline-compare]');await click('[data-offline-differences]');await select('[data-offline-scope]','counts');expect(host.querySelector('[data-offline-order]').value).toBe('original')
})
it('offline order UI clear and fresh comparison never restore old sort',async()=>{
  await setup();await select('[data-offline-order]','largest');await click('[data-offline-reset]');expect(host.querySelector('[data-offline-order]')).toBeNull()
  await setup();expect(host.querySelector('[data-offline-order]').value).toBe('original')
})
it('offline order UI exposes native options status and absolute-value explanation',async()=>{
  await setup();const el=host.querySelector('[data-offline-order]');expect(el.closest('label').textContent).toContain('同单位差异排序')
  expect([...el.options].map(o=>o.value)).toEqual(['original','largest','smallest']);expect(document.getElementById(el.getAttribute('aria-controls'))).not.toBeNull()
  for(const id of el.getAttribute('aria-describedby').split(' '))expect(document.getElementById(id)).not.toBeNull()
  await select('[data-offline-order]','largest');expect(host.textContent).toContain('按差值绝对值排序');expect(host.textContent).toContain('当前按差异幅度从大到小排列')
})
it('offline order UI leaves summary and complete export bytes unchanged',async()=>{
  await setup();const overview=host.querySelector('[data-offline-summary]').textContent
  vi.useFakeTimers();const blobs=[];vi.stubGlobal('Blob',class{constructor(parts){this.raw=parts.join('')}})
  const a=Object.getOwnPropertyDescriptor(URL,'createObjectURL'),b=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL')
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(blob=>{blobs.push(blob.raw);return 'blob:sort-test'})})
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
  try{
    for(const format of ['json','csv','html'])await click(`[data-offline-export-format=${format}]`)
    await select('[data-offline-order]','largest');for(const format of ['json','csv','html'])await click(`[data-offline-export-format=${format}]`)
    expect(blobs.slice(3)).toEqual(blobs.slice(0,3));expect(JSON.parse(blobs[3]).metrics).toHaveLength(12)
    expect(host.querySelector('[data-offline-summary]').textContent).toBe(overview);expect(read).toHaveBeenCalledTimes(2)
    await act(async()=>{vi.advanceTimersByTime(1000);await flush()})
  }finally{if(a)Object.defineProperty(URL,'createObjectURL',a);else delete URL.createObjectURL;if(b)Object.defineProperty(URL,'revokeObjectURL',b);else delete URL.revokeObjectURL}
})
