import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Comparison from './S3LocalOverviewComparison.jsx'
import { comparisonFile, comparisonLocal } from '../../scripts/s3-local-overview-comparison-cases.mjs'
import { comparisonCSVRows } from '../../scripts/s3-local-comparison-export-cases.mjs'
let host, root, blobs, clicked, createDescriptor, revokeDescriptor
const render = (report, localSummary) => act(async () => root.render(<StrictMode><Comparison report={report} localSummary={localSummary}/></StrictMode>))
const click = selector => act(async () => host.querySelector(selector).click())
const start = () => click('[data-local-compare-start]')
const download = format => click(`[data-local-compare-export="${format}"]`)
const status = () => host.querySelector('[data-local-compare-export-status]')?.textContent
const restore = (object,key,d) => { if(d)Object.defineProperty(object,key,d);else delete object[key] }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); vi.useFakeTimers(); blobs = []
  createDescriptor=Object.getOwnPropertyDescriptor(URL,'createObjectURL');revokeDescriptor=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL')
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(blob=>{blobs.push(blob);return 'blob:comparison-test'})})
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})
  clicked=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async () => {
  await act(async()=>{root.unmount();vi.runOnlyPendingTimers()});host.remove()
  restore(URL,'createObjectURL',createDescriptor);restore(URL,'revokeObjectURL',revokeDescriptor)
  vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()
})
it('comparison export UI requires explicit successful comparison and never downloads on mount',async()=>{
  await render(comparisonFile(),comparisonLocal());expect(host.querySelector('[data-local-compare-export]')).toBeNull()
  expect(clicked).not.toHaveBeenCalled();await start();expect([...host.querySelectorAll('[data-local-compare-export]')].map(button=>button.dataset.localCompareExport)).toEqual(['json','csv','html'])
  expect(clicked).not.toHaveBeenCalled();expect(status()).toBe('')
})
it('comparison export UI downloads JSON with original values but does not claim persistence or rescan',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch'),write=vi.spyOn(Storage.prototype,'setItem')
  await render(comparisonFile(),comparisonLocal());await start();await download('json')
  expect(clicked).toHaveBeenCalledTimes(1);expect(JSON.parse(await blobs[0].text()).metrics).toHaveLength(12)
  expect(status()).toContain('尚未确认落盘');expect(fetch).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled()
  expect(document.querySelector('a[download]')).toBeNull()
  await act(async()=>vi.advanceTimersByTime(1000));expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:comparison-test')
})
it('comparison export UI exports all twelve CSV rows while only six changed rows are displayed',async()=>{
  await render(comparisonFile(),comparisonLocal());await start();await click('[data-local-compare-differences]')
  expect(host.querySelectorAll('tbody tr')).toHaveLength(6);await download('csv')
  const rows=comparisonCSVRows(await blobs[0].text());expect(rows).toHaveLength(13)
  expect(rows.some(row=>row[5]==='-3')).toBe(true);expect(rows.some(row=>row[5]==='0')).toBe(true)
  expect(host.textContent).toContain('不受“仅看有差异的指标”影响')
})
it('comparison export UI preserves a zero-difference complete report while the table is empty',async()=>{
  const file=comparisonFile();await render(file,file.summary);await start();await click('[data-local-compare-differences]')
  expect(host.querySelectorAll('tbody tr')).toHaveLength(0);await download('json')
  const data=JSON.parse(await blobs[0].text());expect(data.metrics).toHaveLength(12);expect(data.changedMetricCount).toBe(0)
})
it('comparison export UI resets exports and feedback after source A-B-A',async()=>{
  const file=comparisonFile(),local=comparisonLocal();await render(file,local);await start();await download('json')
  await render(file,local);expect(status()).toContain('尚未确认落盘')
  await render(comparisonFile(),local);await render(file,local)
  expect(host.querySelector('[data-local-compare-export]')).toBeNull();await start();expect(status()).toBe('')
  expect(clicked).toHaveBeenCalledTimes(1)
})
it('comparison export UI clear or missing local observation removes the old output',async()=>{
  const file=comparisonFile(),local=comparisonLocal();await render(file,local);await start();await click('[data-local-compare-clear]')
  expect(host.querySelector('[data-local-compare-export]')).toBeNull();await start();await render(file,null)
  expect(host.querySelector('[data-local-compare-export]')).toBeNull();expect(clicked).not.toHaveBeenCalled()
})
it('comparison export UI keeps immutable confirmed values even if an input is mutated in place',async()=>{
  const file=structuredClone(comparisonFile()),local=structuredClone(comparisonLocal())
  await render(file,local);await start();local.records=999;file.summary.records=888
  await download('json');const data=JSON.parse(await blobs[0].text())
  expect(data.metrics[0]).toMatchObject({reference:2,local:4,delta:2});expect(host.textContent).not.toContain('999')
})
it('comparison export UI handles download failure without losing comparison or exposing private errors',async()=>{
  await render(comparisonFile(),comparisonLocal());await start()
  clicked.mockImplementation(()=>{throw Error('PRIVATE_PATH')});await download('csv')
  expect(status()).toContain('未能发起');expect(host.textContent).not.toContain('PRIVATE_PATH');expect(host.querySelectorAll('tbody tr')).toHaveLength(12)
  await act(async()=>vi.advanceTimersByTime(1000));expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
})
it('comparison export UI malformed inputs expose no export buttons or partial download',async()=>{
  const local=structuredClone(comparisonLocal());local.records++
  await render(comparisonFile(),local);await start();expect(host.querySelector('[data-local-compare-export]')).toBeNull()
  expect(host.querySelector('[data-local-compare-state]').dataset.localCompareState).toBe('failed');expect(clicked).not.toHaveBeenCalled()
})
it('comparison export UI buttons have stable format names, non-submit type and scope descriptions',async()=>{
  await render(comparisonFile(),comparisonLocal());await start()
  for(const button of host.querySelectorAll('[data-local-compare-export]')) {
    expect(button.type).toBe('button');expect(button.textContent).toContain(button.dataset.localCompareExport.toUpperCase())
    expect(document.getElementById(button.getAttribute('aria-describedby')).textContent).toContain('不是笔记备份')
  }
  expect(host.querySelector('[data-local-compare-export-status]').getAttribute('aria-live')).toBe('polite')
})
