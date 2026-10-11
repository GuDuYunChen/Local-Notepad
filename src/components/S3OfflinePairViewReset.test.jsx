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
const restore = () => click('[data-offline-view-reset]')
const description = () => host.querySelector('[data-offline-view-description]')?.textContent
const complete = () => {
  expect(rows()).toHaveLength(12)
  expect(host.querySelector('[data-offline-differences]').checked).toBe(false)
  for (const selector of ['[data-offline-direction]','[data-offline-scope]','[data-offline-order]']) expect(host.querySelector(selector)).toBeNull()
  expect(host.querySelector('[data-offline-view-reset]').disabled).toBe(true)
  expect(description()).toContain('全部 12 项 · 原始顺序')
}
it('offline view reset is absent until explicit confirmation and idle on complete view',async()=>{
  expect(host.querySelector('[data-offline-view-reset]')).toBeNull();expect(description()).toBeUndefined()
  await choose('a',report());await choose('b',report(3,13));expect(host.querySelector('[data-offline-view-reset]')).toBeNull()
  await click('[data-offline-compare]');complete();expect(read).toHaveBeenCalledTimes(2)
})
it('offline view reset clears combined direction type and magnitude in one action',async()=>{
  await setup();await select('[data-offline-direction]','increase');await select('[data-offline-order]','largest')
  expect(deltas()).toEqual([11,2]);expect(description()).toContain('仅差异 · 仅数量（项） · 仅增加 · 幅度从大到小')
  await restore();complete();expect(deltas().slice(0,8)).toEqual([2,128,0,0,-9,-576,11,704]);expect(read).toHaveBeenCalledTimes(2)
})
it('offline view reset preserves both report selections and comparison confirmation',async()=>{
  await setup();const sides=[...host.querySelectorAll('[data-offline-side]')].map(el=>el.textContent)
  const summary=host.querySelector('[data-offline-summary]').textContent
  await select('[data-offline-order]','largest');await restore();complete()
  expect([...host.querySelectorAll('[data-offline-side]')].map(el=>el.textContent)).toEqual(sides)
  expect(host.querySelector('[data-offline-summary]').textContent).toBe(summary);expect(read).toHaveBeenCalledTimes(2)
})
it('offline view reset puts focus on the existing accessible result region',async()=>{
  await setup();const region=host.querySelector('[data-offline-result]');await restore()
  expect(document.activeElement).toBe(region);expect(region.getAttribute('role')).toBe('region')
})
it('offline view reset restores all metrics from an empty matching direction',async()=>{
  await choose('a',report(3,13));await choose('b',report(3,13));await click('[data-offline-compare]')
  await click('[data-offline-differences]');await select('[data-offline-scope]','bytes');await select('[data-offline-direction]','decrease')
  expect(rows()).toHaveLength(0);expect(host.querySelector('[data-offline-no-differences]').textContent).toContain('恢复完整视图')
  await restore();complete();expect(host.querySelector('[data-offline-no-differences]')).toBeNull()
})
it('offline view reset does not revive sorting after filters are enabled again',async()=>{
  await setup();await select('[data-offline-order]','largest');await restore();await click('[data-offline-differences]')
  expect(host.querySelector('[data-offline-direction]').value).toBe('all');expect(host.querySelector('[data-offline-scope]').value).toBe('all')
  await select('[data-offline-scope]','counts');expect(host.querySelector('[data-offline-order]').value).toBe('original')
})
it('offline view reset cancelled picker retains the current description and ranking',async()=>{
  await setup();await select('[data-offline-order]','largest');const before=description();await choose('a',null)
  expect(description()).toBe(before);expect(deltas()).toEqual([11,-9,2]);expect(read).toHaveBeenCalledTimes(2)
})
it('offline view reset swap removes controls until a new comparison is confirmed',async()=>{
  await setup();await click('[data-offline-swap]');expect(host.querySelector('[data-offline-view-reset]')).toBeNull()
  expect(description()).toBeUndefined();await click('[data-offline-compare]');complete()
})
it('offline view reset old controls cannot restore results after file replacement',async()=>{
  await setup();const old=host.querySelector('[data-offline-view-reset]');await choose('a',report(1,2))
  await act(async()=>{old.click();await flush()});expect(rows()).toHaveLength(0);expect(description()).toBeUndefined()
  await click('[data-offline-compare]');complete()
})
it('offline view reset clear removes both the controls and their description',async()=>{
  await setup();await click('[data-offline-reset]');expect(host.querySelector('[data-offline-view-reset]')).toBeNull()
  expect(description()).toBeUndefined();expect(rows()).toHaveLength(0)
})
it('offline view reset has associated control and preservation instructions',async()=>{
  await setup();const button=host.querySelector('[data-offline-view-reset]')
  expect(document.getElementById(button.getAttribute('aria-controls'))).toBe(host.querySelector('[data-offline-result]'))
  expect(document.getElementById(button.getAttribute('aria-describedby')).textContent).toContain('保留两份报告、比较确认与完整导出')
})
it('offline view reset preserves exact download bytes and previous truthful feedback',async()=>{
  await setup();await select('[data-offline-order]','largest');vi.useFakeTimers();const blobs=[]
  vi.stubGlobal('Blob',class{constructor(parts){this.raw=parts.join('')}})
  const a=Object.getOwnPropertyDescriptor(URL,'createObjectURL'),b=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL')
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(blob=>{blobs.push(blob.raw);return 'blob:reset-test'})})
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
  try{
    for(const format of ['json','csv','html'])await click(`[data-offline-export-format=${format}]`)
    const feedback=host.querySelector('[data-offline-export-status]').textContent
    await restore();complete();expect(host.querySelector('[data-offline-export-status]').textContent).toBe(feedback)
    for(const format of ['json','csv','html'])await click(`[data-offline-export-format=${format}]`)
    expect(blobs.slice(3)).toEqual(blobs.slice(0,3));expect(JSON.parse(blobs[3]).metrics).toHaveLength(12)
    expect(read).toHaveBeenCalledTimes(2);await act(async()=>{vi.advanceTimersByTime(1000);await flush()})
  }finally{if(a)Object.defineProperty(URL,'createObjectURL',a);else delete URL.createObjectURL;if(b)Object.defineProperty(URL,'revokeObjectURL',b);else delete URL.revokeObjectURL}
})
